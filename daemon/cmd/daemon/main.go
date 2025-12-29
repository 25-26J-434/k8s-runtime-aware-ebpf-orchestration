package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/api"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/loader"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/scaling"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/scheduler"
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

	nodeName := os.Getenv("NODE_NAME")
	if nodeName == "" {
		nodeName = "unknown"
		log.Println("[Main] Warning: NODE_NAME not set, using 'unknown'")
	}

	log.Println("[Main] Initializing DNS collector...")
	telemetry.InitDNSCollector(nodeName)

	log.Println("[Main] Initializing RTT collector...")
	telemetry.InitRTTCollector(nodeName)

	log.Println("[Main] Initializing TCP Metrics collector...")
	telemetry.InitTCPMetricsCollector(nodeName)

	log.Println("[Main] Initializing Node System collector...")
	telemetry.InitNodeSystemCollector(nodeName)

	log.Println("[Main] Initializing Packet Distribution collector...")
	telemetry.InitPacketDistributionCollector(nodeName)

	log.Println("[Main] Initializing Service Health collector...")

	if err := api.InitKubernetesClient(); err != nil {
		log.Fatalf("[Main] Failed to init Kubernetes client: %v", err)
	}
	k8sClient := api.GetK8sClient()
	telemetry.InitServiceHealthCollector(nodeName, k8sClient)

	log.Println("[Main] Starting Intelligent Scheduler...")
	go scheduler.Start(k8sClient)

	log.Println("[Main] Initializing Scaling store (MongoDB)...")
	if err := scaling.InitMongo(); err != nil {
		log.Fatalf("[Scaling] Mongo init failed: %v", err)
	}

	// init scheduler store using same mongo client
	scheduler.InitStore(scaling.MongoDB())

	log.Println("[Main] Starting Scaling Controller...")
	go scaling.StartScalingController(k8sClient)
	log.Println("[Main] Initializing NAT Metadata collector...")
	telemetry.InitNATMetadataCollector(nodeName)

	if err := loader.AttachDNSProbes(); err != nil {
		log.Fatalf("[FATAL] Failed to attach DNS probes: %v", err)
	}

	defer loader.Close()

	go telemetry.StartDNSLatencyCollector()
	go telemetry.StartRTTCollector()
	go telemetry.StartTCPMetricsCollector()

	go api.StartServer()

	log.Println("[Main] eBPF Daemon is running. Press Ctrl+C to exit.")

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Println("[Main] Received shutdown signal, cleaning up...")
}
