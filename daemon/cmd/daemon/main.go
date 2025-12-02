package main

import (
    "log"
    "k8s-runtime-aware-ebpf-orchestration/daemon/pkg/api"
    "k8s-runtime-aware-ebpf-orchestration/daemon/pkg/loader"
)

func main() {
    log.Println("[Daemon] Starting eBPF Runtime-Aware Daemon...")

    // Load BPF programs
    loader.LoadAll()

    // Start API Server
    api.StartServer()
}
