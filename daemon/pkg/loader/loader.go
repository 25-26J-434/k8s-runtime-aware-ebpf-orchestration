package loader

import (
	"bytes"
	"fmt"
	"log"
	"os"

	_ "embed"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
)

//go:embed bpf/dns_latency.o
var dnsObj []byte

//go:embed bpf/rtt.o
var rttObj []byte

//go:embed bpf/tcp_metrics.o
var tcpMetricsObj []byte

var DNSSpec *ebpf.CollectionSpec
var DNSObjs *ebpf.Collection
var RTTSpec *ebpf.CollectionSpec
var RTTObjs *ebpf.Collection
var TCPMetricsSpec *ebpf.CollectionSpec
var TCPMetricsObjs *ebpf.Collection

// Store links for cleanup
var dnsStartLink link.Link
var dnsEndLink link.Link
var rttConnectLink link.Link
var rttFinishLink link.Link

func LoadDNSLatencyBPF() error {
	log.Println("[Loader] Loading DNS Latency BPF program...")

	if len(dnsObj) == 0 {
		return fmt.Errorf("embedded BPF object is empty - ensure dns_latency.o is compiled")
	}

	spec, err := ebpf.LoadCollectionSpecFromReader(bytes.NewReader(dnsObj))
	if err != nil {
		return fmt.Errorf("failed to load collection spec: %w", err)
	}
	DNSSpec = spec

	// Log available programs and maps
	log.Println("[Loader] Available programs:")
	for name := range spec.Programs {
		log.Printf("  - %s", name)
	}
	log.Println("[Loader] Available maps:")
	for name := range spec.Maps {
		log.Printf("  - %s", name)
	}

	objs, err := ebpf.NewCollection(DNSSpec)
	if err != nil {
		return fmt.Errorf("failed to create collection: %w", err)
	}
	DNSObjs = objs

	log.Println("[Loader] DNS Latency BPF programs loaded successfully")
	return nil
}

// AttachDNSProbes attaches the kprobes to kernel functions
func AttachDNSProbes() error {
	log.Println("[Loader] Attaching DNS kprobes...")

	// Attach kprobe to udp_sendmsg
	startProg := DNSObjs.Programs["dns_start_probe"]
	if startProg == nil {
		return fmt.Errorf("program 'dns_start_probe' not found")
	}

	var err error
	dnsStartLink, err = link.Kprobe("udp_sendmsg", startProg, nil)
	if err != nil {
		return fmt.Errorf("failed to attach kprobe to udp_sendmsg: %w", err)
	}
	log.Println("[Loader] Attached kprobe to udp_sendmsg")

	// Attach kprobe to udp_recvmsg
	endProg := DNSObjs.Programs["dns_end_probe"]
	if endProg == nil {
		dnsStartLink.Close()
		return fmt.Errorf("program 'dns_end_probe' not found")
	}

	dnsEndLink, err = link.Kprobe("udp_recvmsg", endProg, nil)
	if err != nil {
		dnsStartLink.Close()
		return fmt.Errorf("failed to attach kprobe to udp_recvmsg: %w", err)
	}
	log.Println("[Loader] Attached kprobe to udp_recvmsg")

	log.Println("[Loader] All DNS kprobes attached successfully")
	return nil
}

// LoadRTTBPF loads the RTT eBPF program
func LoadRTTBPF() error {
	log.Println("[Loader] Loading RTT BPF program...")

	if len(rttObj) == 0 {
		log.Println("[Loader] WARNING: RTT BPF object is empty - RTT collection disabled")
		return fmt.Errorf("embedded RTT BPF object is empty - ensure rtt.o is compiled")
	}

	spec, err := ebpf.LoadCollectionSpecFromReader(bytes.NewReader(rttObj))
	if err != nil {
		return fmt.Errorf("failed to load RTT collection spec: %w", err)
	}
	RTTSpec = spec

	log.Println("[Loader] Available RTT programs:")
	for name := range spec.Programs {
		log.Printf("  - %s", name)
	}

	objs, err := ebpf.NewCollection(RTTSpec)
	if err != nil {
		return fmt.Errorf("failed to create RTT collection: %w", err)
	}
	RTTObjs = objs

	// Add RTT ring buffer to DNS objects for shared access
	if RTTObjs.Maps["rtt_events"] != nil && DNSObjs != nil {
		DNSObjs.Maps["rtt_events"] = RTTObjs.Maps["rtt_events"]
		log.Println("[Loader] Merged rtt_events map into DNS collection for collector access")
	}

	log.Println("[Loader] RTT BPF programs loaded successfully")
	return nil
}

// AttachRTTProbes attaches the kprobes to TCP kernel functions
func AttachRTTProbes() error {
	log.Println("[Loader] Attaching RTT kprobes...")

	// Attach kprobe to tcp_v4_connect (marks start of IPv4 connection)
	// Try tcp_v4_connect first, fallback to tcp_connect if not available
	connectProg := RTTObjs.Programs["tcp_v4_connect_probe"]
	if connectProg == nil {
		// Fallback to tcp_connect if tcp_v4_connect_probe not found
		connectProg = RTTObjs.Programs["tcp_connect_probe"]
		if connectProg == nil {
			return fmt.Errorf("neither 'tcp_v4_connect_probe' nor 'tcp_connect_probe' found")
		}
		log.Println("[Loader] Using tcp_connect (fallback)")
	}

	var err error
	if RTTObjs.Programs["tcp_v4_connect_probe"] != nil {
		rttConnectLink, err = link.Kprobe("tcp_v4_connect", connectProg, nil)
		if err != nil {
			log.Printf("[Loader] WARNING: Failed to attach tcp_v4_connect: %v, trying tcp_connect", err)
			// Fallback to tcp_connect
			connectProg = RTTObjs.Programs["tcp_connect_probe"]
			if connectProg != nil {
				rttConnectLink, err = link.Kprobe("tcp_connect", connectProg, nil)
			}
		} else {
			log.Println("[Loader] Attached kprobe to tcp_v4_connect")
		}
	} else {
		rttConnectLink, err = link.Kprobe("tcp_connect", connectProg, nil)
		if err == nil {
			log.Println("[Loader] Attached kprobe to tcp_connect")
		}
	}

	if err != nil {
		return fmt.Errorf("failed to attach kprobe to tcp_v4_connect/tcp_connect: %w", err)
	}

	// Attach kprobe to tcp_finish_connect (marks end of connection establishment)
	finishProg := RTTObjs.Programs["tcp_finish_connect_probe"]
	if finishProg == nil {
		log.Println("[Loader] ERROR: tcp_finish_connect_probe not found - RTT measurement requires both probes")
		return fmt.Errorf("tcp_finish_connect_probe program not found")
	}

	rttFinishLink, err = link.Kprobe("tcp_finish_connect", finishProg, nil)
	if err != nil {
		log.Printf("[Loader] ERROR: Failed to attach tcp_finish_connect: %v", err)
		log.Println("[Loader] RTT measurement requires both tcp_connect and tcp_finish_connect")
		// Clean up the first probe if second fails
		rttConnectLink.Close()
		return fmt.Errorf("failed to attach tcp_finish_connect: %w", err)
	}
	log.Println("[Loader] Attached kprobe to tcp_finish_connect")

	log.Println("[Loader] All RTT kprobes attached successfully")
	log.Println("[Loader] RTT measurement: tcp_connect -> tcp_finish_connect (connection establishment time)")
	return nil
}

// Close cleans up all resources
func Close() {
	log.Println("[Loader] Cleaning up...")

	if dnsStartLink != nil {
		dnsStartLink.Close()
	}
	if dnsEndLink != nil {
		dnsEndLink.Close()
	}
	if rttConnectLink != nil {
		rttConnectLink.Close()
	}
	if rttFinishLink != nil {
		rttFinishLink.Close()
	}
	if DNSObjs != nil {
		DNSObjs.Close()
	}
	if RTTObjs != nil {
		RTTObjs.Close()
	}

	log.Println("[Loader] Cleanup complete")
}

// SaveVerifierLog writes verifier output to a file for debugging
func SaveVerifierLog(filename string, log string) error {
	return os.WriteFile(filename, []byte(log), 0644)
}
