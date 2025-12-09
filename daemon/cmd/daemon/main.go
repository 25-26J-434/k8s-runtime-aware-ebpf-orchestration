package main

import (
	"log"

	"k8s-runtime-aware-ebpf-orchestration/daemon/pkg/api"
	"k8s-runtime-aware-ebpf-orchestration/daemon/pkg/loader"
)

// main boots the daemon by loading eBPF programs and starting the API server.
func main() {
	if err := loader.LoadAll(); err != nil {
		log.Fatalf("failed to load eBPF programs: %v", err)
	}

	const addr = ":8080"
	if err := api.StartServer(addr); err != nil {
		log.Fatalf("http server error: %v", err)
	}
}
