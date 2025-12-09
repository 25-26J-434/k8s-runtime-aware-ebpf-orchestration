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

var DNSSpec *ebpf.CollectionSpec
var DNSObjs *ebpf.Collection

// Store links for cleanup
var dnsStartLink link.Link
var dnsEndLink link.Link

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

// Close cleans up all resources
func Close() {
	log.Println("[Loader] Cleaning up...")

	if dnsStartLink != nil {
		dnsStartLink.Close()
	}
	if dnsEndLink != nil {
		dnsEndLink.Close()
	}
	if DNSObjs != nil {
		DNSObjs.Close()
	}

	log.Println("[Loader] Cleanup complete")
}

// SaveVerifierLog writes verifier output to a file for debugging
func SaveVerifierLog(filename string, log string) error {
	return os.WriteFile(filename, []byte(log), 0644)
}
