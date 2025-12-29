package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

// ConnectionTopologyResponse represents the response for connection topology
type ConnectionTopologyResponse struct {
	Timestamp   string                   `json:"timestamp"`
	Connections []telemetry.Connection   `json:"connections"`
	Stats       map[string]interface{}   `json:"stats"`
}

// handleConnectionTopology returns active TCP connections for topology visualization
func handleConnectionTopology(w http.ResponseWriter, r *http.Request) {
	// Get filter parameter (default to "established")
	filter := r.URL.Query().Get("filter")
	if filter == "" {
		filter = "established"
	}
	
	tracker := telemetry.GetConnectionTracker()
	if tracker == nil {
		http.Error(w, "Connection tracker not available", http.StatusServiceUnavailable)
		return
	}
	
	// Get connections based on filter
	connections := tracker.GetActiveConnections(filter)
	
	// Get stats
	stats := tracker.GetConnectionStats()
	
	response := ConnectionTopologyResponse{
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Connections: connections,
		Stats:       stats,
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handlePodConnections returns connections for a specific pod
func handlePodConnections(w http.ResponseWriter, r *http.Request) {
	namespace := r.URL.Query().Get("namespace")
	podName := r.URL.Query().Get("pod")
	
	if namespace == "" || podName == "" {
		http.Error(w, "namespace and pod parameters required", http.StatusBadRequest)
		return
	}
	
	tracker := telemetry.GetConnectionTracker()
	if tracker == nil {
		http.Error(w, "Connection tracker not available", http.StatusServiceUnavailable)
		return
	}
	
	connections := tracker.GetPodConnections(namespace, podName)
	
	response := map[string]interface{}{
		"timestamp":   time.Now().UTC().Format(time.RFC3339),
		"namespace":   namespace,
		"pod":         podName,
		"connections": connections,
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

