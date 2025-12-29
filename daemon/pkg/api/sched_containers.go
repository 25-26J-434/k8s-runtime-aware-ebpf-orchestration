package api

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

// handleSchedLatencyContainers returns per-container scheduling latency metrics
func handleSchedLatencyContainers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	containerMetrics := telemetry.GetContainerSchedLatencyMetrics()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(containerMetrics); err != nil {
		log.Printf("[API] Error encoding container scheduling latency response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
}

