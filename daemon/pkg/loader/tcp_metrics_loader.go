package loader

import (
	"bytes"
	"fmt"
	"log"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
)

// Store links for TCP metrics probes
var tcpMetricsLinks []link.Link

// LoadTCPMetricsBPF loads the TCP metrics eBPF program
func LoadTCPMetricsBPF() error {
	log.Println("[Loader] Loading TCP Metrics BPF program...")

	if len(tcpMetricsObj) == 0 {
		log.Println("[Loader] WARNING: TCP Metrics BPF object is empty - TCP metrics collection disabled")
		return fmt.Errorf("embedded TCP Metrics BPF object is empty - ensure tcp_metrics.o is compiled")
	}

	spec, err := ebpf.LoadCollectionSpecFromReader(bytes.NewReader(tcpMetricsObj))
	if err != nil {
		return fmt.Errorf("failed to load TCP Metrics collection spec: %w", err)
	}
	TCPMetricsSpec = spec

	log.Println("[Loader] Available TCP Metrics programs:")
	for name := range spec.Programs {
		log.Printf("  - %s", name)
	}

	objs, err := ebpf.NewCollection(TCPMetricsSpec)
	if err != nil {
		return fmt.Errorf("failed to create TCP Metrics collection: %w", err)
	}
	TCPMetricsObjs = objs

	log.Println("[Loader] TCP Metrics BPF programs loaded successfully")
	return nil
}

// AttachTCPMetricsProbes attaches kprobes for TCP metrics collection
func AttachTCPMetricsProbes() error {
	log.Println("[Loader] Attaching TCP Metrics kprobes...")

	probes := map[string]string{
		"tcp_set_state_probe":      "tcp_set_state",
		"tcp_retransmit_skb_probe": "tcp_retransmit_skb",
		"tcp_rtt_estimator_probe":  "tcp_rtt_estimator",
		"tcp_cwnd_restart_probe":   "tcp_cwnd_restart",
		"tcp_enter_loss_probe":     "tcp_enter_loss",
		"tcp_v4_connect_start_probe": "tcp_v4_connect",
		"tcp_syn_retransmit_probe": "tcp_syn_retransmit",
		"tcp_close_probe":          "tcp_close",
	}

	for progName, kernelFunc := range probes {
		prog := TCPMetricsObjs.Programs[progName]
		if prog == nil {
			log.Printf("[Loader] WARNING: Program '%s' not found, skipping", progName)
			continue
		}

		link, err := link.Kprobe(kernelFunc, prog, nil)
		if err != nil {
			log.Printf("[Loader] WARNING: Failed to attach %s to %s: %v", progName, kernelFunc, err)
			continue
		}

		tcpMetricsLinks = append(tcpMetricsLinks, link)
		log.Printf("[Loader] Attached kprobe %s -> %s", progName, kernelFunc)
	}

	log.Printf("[Loader] TCP Metrics: Attached %d probes", len(tcpMetricsLinks))
	return nil
}




