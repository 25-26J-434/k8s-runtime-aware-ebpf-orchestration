package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/api"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/loader"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

func main() {
	log.Println("========================================")
	log.Println("  eBPF Daemon - Runtime-Aware Telemetry")
	log.Println("  Component 1: Sidecar-less Orchestration")
	log.Println("========================================")

	// Check for required capabilities
	if os.Geteuid() != 0 {
		log.Println("[WARN] Not running as root - eBPF operations may fail")
	}

	// Load eBPF programs
	log.Println("[Main] Loading eBPF programs...")
	if err := loader.LoadDNSLatencyBPF(); err != nil {
		log.Fatalf("[Main] Failed to load DNS latency BPF: %v", err)
	}

	// Load RTT BPF program
	log.Println("[Main] Loading RTT BPF program...")
	if err := loader.LoadRTTBPF(); err != nil {
		log.Printf("[Main] WARNING: Failed to load RTT BPF: %v", err)
		log.Println("[Main] Continuing without RTT collection...")
	} else {
		// Attach RTT probes
		if err := loader.AttachRTTProbes(); err != nil {
			log.Printf("[Main] WARNING: Failed to attach RTT probes: %v", err)
		}
	}

	// Get node name for metrics
	nodeName := os.Getenv("NODE_NAME")
	if nodeName == "" {
		nodeName = "unknown"
		log.Println("[Main] Warning: NODE_NAME not set, using 'unknown'")
	}

	// Initialize DNS collector and register with global registry
	log.Println("[Main] Initializing DNS collector...")
	telemetry.InitDNSCollector(nodeName)

	// Attach kprobes to kernel functions
	if err := loader.AttachDNSProbes(); err != nil {
		log.Fatalf("[FATAL] Failed to attach DNS probes: %v", err)
	}

	// Setup cleanup on exit
	defer loader.Close()

	// Start telemetry collectors in background goroutines
	go telemetry.StartDNSLatencyCollector()
	go telemetry.StartRTTCollector()

	// [Optional] Start other components that use telemetry data
	// Uncomment to enable example routing component:
	//
	// import "github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/plugins/routing"
	// router := routing.NewRouter(nodeName)
	// go router.Start()
	//
	// Components can call telemetry functions directly:
	//   - telemetry.GetPodDNSMetrics()
	//   - telemetry.GetPodRTTMetrics()
	//   - telemetry.GlobalRegistry.Get(type).Subscribe()
	// No HTTP, no ports, just simple function calls!

	// Start API server for external consumers (dashboard, Prometheus, etc.)
	go api.StartServer()

	log.Println("[Main] eBPF Daemon is running. Press Ctrl+C to exit.")

	// Wait for termination signal
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Println("[Main] Received shutdown signal, cleaning up...")
}
