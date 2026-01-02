package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/api"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/comm"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/loader"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/plugins/routing"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

func main() {
	log.Println("========================================")
	log.Println("  eBPF Daemon - Runtime-Aware Telemetry")
	log.Println("  Component 1: Sidecar-less Orchestration")
	log.Println("========================================")

	if os.Geteuid() != 0 {
		log.Println("[WARN] Not running as root - eBPF operations may fail")
	}

	log.Println("[Main] Loading eBPF programs...")
	if err := loader.LoadDNSLatencyBPF(); err != nil {
		log.Fatalf("[Main] Failed to load DNS latency BPF: %v", err)
	}

	log.Println("[Main] Loading RTT BPF program...")
	if err := loader.LoadRTTBPF(); err != nil {
		log.Printf("[Main] WARNING: Failed to load RTT BPF: %v", err)
		log.Println("[Main] Continuing without RTT collection...")
	} else {
		if err := loader.AttachRTTProbes(); err != nil {
			log.Printf("[Main] WARNING: Failed to attach RTT probes: %v", err)
		}
	}

	log.Println("[Main] Loading TCP Metrics BPF program...")
	if err := loader.LoadTCPMetricsBPF(); err != nil {
		log.Printf("[Main] WARNING: Failed to load TCP Metrics BPF: %v", err)
		log.Println("[Main] Continuing without TCP metrics collection...")
	} else {
		if err := loader.AttachTCPMetricsProbes(); err != nil {
			log.Printf("[Main] WARNING: Failed to attach TCP Metrics probes: %v", err)
		}
	}

	log.Println("[Main] Loading Scheduling Latency BPF program...")
	if err := loader.LoadSchedLatencyBPF(); err != nil {
		log.Printf("[Main] WARNING: Failed to load Scheduling Latency BPF: %v", err)
		log.Println("[Main] Continuing without scheduling latency collection...")
	} else {
		if err := loader.AttachSchedLatencyProbes(); err != nil {
			log.Printf("[Main] WARNING: Failed to attach Scheduling Latency probes: %v", err)
		}
	}

	nodeName := os.Getenv("NODE_NAME")
	if nodeName == "" {
		nodeName = "unknown"
		log.Println("[Main] Warning: NODE_NAME not set, using 'unknown'")
	}

	nodeIP := os.Getenv("NODE_IP")
	if nodeIP == "" {
		log.Println("[Main] Warning: NODE_IP not set - communication subsystem will rely on discovery results")
	}

	commShutdown := comm.Init(comm.Config{NodeName: nodeName, NodeIP: nodeIP})
	defer commShutdown()

	log.Println("[Main] Initializing DNS collector...")
	telemetry.InitDNSCollector(nodeName)

	log.Println("[Main] Initializing RTT collector...")
	telemetry.InitRTTCollector(nodeName)

	log.Println("[Main] Initializing TCP Metrics collector...")
	telemetry.InitTCPMetricsCollector(nodeName)

	log.Println("[Main] Initializing Scheduling Latency collector...")
	telemetry.InitSchedLatencyCollector(nodeName)

	log.Println("[Main] Initializing Node System collector...")
	telemetry.InitNodeSystemCollector(nodeName)

	log.Println("[Main] Initializing Packet Distribution collector...")
	telemetry.InitPacketDistributionCollector(nodeName)

	log.Println("[Main] Initializing Kubernetes client...")
	if err := api.InitKubernetesClient(); err != nil {
		log.Printf("[Main] WARNING: Failed to initialize K8s client: %v", err)
		log.Println("[Main] Container-level metrics will not be available")
	}
	k8sClient := api.GetK8sClient()

	log.Println("[Main] Initializing Service Health collector...")
	telemetry.InitServiceHealthCollector(nodeName, k8sClient)

	log.Println("[Main] Initializing NAT Metadata collector...")
	telemetry.InitNATMetadataCollector(nodeName)

	// Initialize Container Mapper for container-level metrics
	log.Println("[Main] Initializing Container Mapper...")
	if k8sClient == nil {
		log.Println("[Main] WARNING: k8sClient is nil! Container-level metrics will not work.")
	} else {
		log.Println("[Main] k8sClient is valid, proceeding with ContainerMapper initialization")
	}
	containerMapper := telemetry.NewContainerMapper(k8sClient)
	telemetry.SetContainerMapper(containerMapper)
	telemetry.SetTCPContainerMapper(containerMapper)
	telemetry.SetSchedContainerMapper(containerMapper)
	telemetry.SetDiskIOContainerMapper(containerMapper)
	log.Println("[Main] Container Mapper initialized successfully")

	if err := loader.AttachDNSProbes(); err != nil {
		log.Fatalf("[FATAL] Failed to attach DNS probes: %v", err)
	}

	defer loader.Close()

	// Load and start Disk I/O eBPF
	log.Println("[Main] Loading Disk I/O eBPF...")
	diskIOSpec, err := loader.LoadDiskIOBPF()
	if err != nil {
		log.Printf("[Main] WARNING: Failed to load Disk I/O BPF: %v", err)
		log.Println("[Main] Continuing without Disk I/O collection...")
	} else {
		if err := telemetry.LoadDiskIOBPF(diskIOSpec); err != nil {
			log.Printf("[Main] WARNING: Failed to initialize Disk I/O: %v", err)
		} else if err := telemetry.AttachDiskIOProbes(); err != nil {
			log.Printf("[Main] WARNING: Failed to attach Disk I/O probes: %v", err)
		} else {
			log.Println("[Main] Disk I/O eBPF loaded and attached successfully")
		}
	}

	go telemetry.StartDNSLatencyCollector()
	go telemetry.StartRTTCollector()
	go telemetry.StartTCPMetricsCollector()
	go telemetry.StartSchedLatencyCollector()
	go telemetry.StartDiskIOCollector()

	// Start the sample latency-based router (Component 2) so routing decisions can
	// consume telemetry directly in-process.
	router := routing.NewRouter(nodeName)
	go router.Start()

	// Components can call telemetry functions directly:
	//   - telemetry.GetPodDNSMetrics()
	//   - telemetry.GetPodRTTMetrics()
	//   - telemetry.GlobalRegistry.Get(type).Subscribe()
	// No HTTP, no ports, just simple function calls!

	// Start API server for external consumers (dashboard, Prometheus, etc.)
	go api.StartServer()

	log.Println("[Main] eBPF Daemon is running. Press Ctrl+C to exit.")

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Println("[Main] Received shutdown signal, cleaning up...")
}
