package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

// SchedLatencyResponse represents the scheduling latency API response
type SchedLatencyResponse struct {
	NodeMetrics      telemetry.SchedLatencyMetrics                      `json:"node_metrics"`
	PodMetrics       map[string]*telemetry.PodSchedLatencyMetrics       `json:"pod_metrics"`
	ContainerMetrics map[string]*telemetry.ContainerSchedLatencyMetrics  `json:"container_metrics,omitempty"`
	Records          []telemetry.SchedLatencyRecord                     `json:"recent_records,omitempty"`
}

// handleSchedLatencyMetrics returns scheduling latency metrics
func handleSchedLatencyMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get limit parameter for recent records
	limitStr := r.URL.Query().Get("limit")
	limit := 50 // default
	if limitStr != "" {
		if parsedLimit, err := strconv.Atoi(limitStr); err == nil && parsedLimit > 0 {
			limit = parsedLimit
		}
	}

	// Get metrics
	nodeMetrics := telemetry.GetSchedLatencyMetrics()
	podMetrics := telemetry.GetPodSchedLatencyMetrics()
	containerMetrics := telemetry.GetContainerSchedLatencyMetrics()
	records := telemetry.GetSchedLatencyRecords(limit)

	response := SchedLatencyResponse{
		NodeMetrics:      nodeMetrics,
		PodMetrics:       podMetrics,
		ContainerMetrics: containerMetrics,
		Records:          records,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		log.Printf("[API] Error encoding scheduling latency response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
}

// handleSchedLatencyPods returns per-pod scheduling latency metrics
func handleSchedLatencyPods(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	podMetrics := telemetry.GetPodSchedLatencyMetrics()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(podMetrics); err != nil {
		log.Printf("[API] Error encoding pod scheduling latency response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
}

// handleSchedLatencyRecords returns recent scheduling latency records
func handleSchedLatencyRecords(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get limit parameter
	limitStr := r.URL.Query().Get("limit")
	limit := 100 // default
	if limitStr != "" {
		if parsedLimit, err := strconv.Atoi(limitStr); err == nil && parsedLimit > 0 {
			limit = parsedLimit
		}
	}

	records := telemetry.GetSchedLatencyRecords(limit)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(records); err != nil {
		log.Printf("[API] Error encoding scheduling latency records: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
}

