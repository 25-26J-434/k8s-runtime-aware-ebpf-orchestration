package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

// DiskIOResponse represents the API response for disk I/O metrics
type DiskIOResponse struct {
	Timestamp       string                                    `json:"timestamp"`
	NodeMetrics     *telemetry.DiskIOMetrics                 `json:"node_metrics"`
	PodMetrics      map[string]*telemetry.DiskIOMetrics      `json:"pod_metrics"`
	ContainerMetrics map[string]*telemetry.DiskIOMetrics     `json:"container_metrics"`
}

// handleDiskIOMetrics returns node-level disk I/O metrics
func handleDiskIOMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	metrics := telemetry.GetDiskIOMetrics()
	
	response := map[string]interface{}{
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"metrics":   metrics,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleDiskIOPods returns per-pod disk I/O metrics
func handleDiskIOPods(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	podMetrics := telemetry.GetPodDiskIOMetrics()
	
	response := map[string]interface{}{
		"timestamp":   time.Now().UTC().Format(time.RFC3339),
		"pod_metrics": podMetrics,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleDiskIOContainers returns per-container disk I/O metrics
func handleDiskIOContainers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	containerMetrics := telemetry.GetContainerDiskIOMetrics()
	
	response := map[string]interface{}{
		"timestamp":         time.Now().UTC().Format(time.RFC3339),
		"container_metrics": containerMetrics,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleDiskIOAll returns all disk I/O metrics (node, pod, container)
func handleDiskIOAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	response := DiskIOResponse{
		Timestamp:        time.Now().UTC().Format(time.RFC3339),
		NodeMetrics:      telemetry.GetDiskIOMetrics(),
		PodMetrics:       telemetry.GetPodDiskIOMetrics(),
		ContainerMetrics: telemetry.GetContainerDiskIOMetrics(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

