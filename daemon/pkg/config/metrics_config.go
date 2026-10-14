package config

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
)

// MetricsConfig holds configurable thresholds for health warnings.
type MetricsConfig struct {
	DNSLatencyThreshold   float64 `json:"dns_latency_threshold"` // ms
	TCPRetransThreshold   float64 `json:"tcp_retrans_threshold"`
	PacketLossThreshold   float64 `json:"packet_loss_threshold"` // %
	RTTThreshold          float64 `json:"rtt_threshold"`         // ms
	RestartCountThreshold int32   `json:"restart_count_threshold"`
}

var (
	currentMetricsConfig = MetricsConfig{
		DNSLatencyThreshold:   20.0,
		TCPRetransThreshold:   50.0,
		PacketLossThreshold:   20.0,
		RTTThreshold:          200.0,
		RestartCountThreshold: 5,
	}
	configMutex sync.RWMutex
)

// GetCurrentMetricsConfig returns a copy of the current metrics configuration
func GetCurrentMetricsConfig() MetricsConfig {
	configMutex.RLock()
	defer configMutex.RUnlock()
	return currentMetricsConfig
}

// HandleGetMetricsConfig handles GET /api/metrics-config
func HandleGetMetricsConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	configMutex.RLock()
	defer configMutex.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(currentMetricsConfig); err != nil {
		log.Printf("[Config] Failed to encode metrics config: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
	}
}

// HandleSetMetricsConfig handles POST /api/metrics-config
func HandleSetMetricsConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var newConfig MetricsConfig
	if err := json.NewDecoder(r.Body).Decode(&newConfig); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	// Validate thresholds (must be non-negative)
	if newConfig.DNSLatencyThreshold < 0 || newConfig.RTTThreshold < 0 ||
		newConfig.TCPRetransThreshold < 0 || newConfig.PacketLossThreshold < 0 ||
		newConfig.RestartCountThreshold < 0 {
		http.Error(w, "Thresholds must be non-negative", http.StatusBadRequest)
		return
	}

	configMutex.Lock()
	currentMetricsConfig = newConfig
	configMutex.Unlock()

	log.Printf("[Config] Health warning thresholds updated: DNS=%vms, TCP=%v, Loss=%v%%, RTT=%vms, Restarts=%d",
		newConfig.DNSLatencyThreshold, newConfig.TCPRetransThreshold,
		newConfig.PacketLossThreshold, newConfig.RTTThreshold,
		newConfig.RestartCountThreshold)

	w.Header().Set("Content-Type", "application/json")
	response := map[string]string{
		"status":  "success",
		"message": "Metrics configuration updated successfully",
	}
	json.NewEncoder(w).Encode(response)
}
