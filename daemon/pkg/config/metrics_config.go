package config

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
)

// MetricsConfig holds configurable thresholds for health scoring
type MetricsConfig struct {
	DNSLatencyThreshold    float64 `json:"dns_latency_threshold"`    // ms
	DNSLatencyPenalty      int     `json:"dns_latency_penalty"`
	TCPRetransThreshold    float64 `json:"tcp_retrans_threshold"`
	TCPRetransPenalty      int     `json:"tcp_retrans_penalty"`
	PacketLossThreshold    float64 `json:"packet_loss_threshold"`    // %
	PacketLossPenalty      int     `json:"packet_loss_penalty"`
	RTTThreshold           float64 `json:"rtt_threshold"`            // ms
	RTTPenalty             int     `json:"rtt_penalty"`
	RestartCountThreshold  int32   `json:"restart_count_threshold"`
	RestartCountPenalty    int     `json:"restart_count_penalty"`
}

var (
	currentMetricsConfig = MetricsConfig{
		// Default values matching current hardcoded thresholds
		DNSLatencyThreshold:   20.0,
		DNSLatencyPenalty:     20,
		TCPRetransThreshold:   50.0,
		TCPRetransPenalty:     20,
		PacketLossThreshold:   20.0,
		PacketLossPenalty:     20,
		RTTThreshold:          200.0,
		RTTPenalty:            20,
		RestartCountThreshold: 5,
		RestartCountPenalty:   30,
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

	// Validate penalties (must be positive)
	if newConfig.DNSLatencyPenalty <= 0 || newConfig.TCPRetransPenalty <= 0 ||
		newConfig.PacketLossPenalty <= 0 || newConfig.RTTPenalty <= 0 ||
		newConfig.RestartCountPenalty <= 0 {
		http.Error(w, "Penalties must be positive", http.StatusBadRequest)
		return
	}

	configMutex.Lock()
	currentMetricsConfig = newConfig
	configMutex.Unlock()

	log.Printf("[Config] Metrics configuration updated: DNS=%vms/%dpts, TCP=%v/%dpts, Loss=%v%%/%dpts, RTT=%vms/%dpts, Restarts=%d/%dpts",
		newConfig.DNSLatencyThreshold, newConfig.DNSLatencyPenalty,
		newConfig.TCPRetransThreshold, newConfig.TCPRetransPenalty,
		newConfig.PacketLossThreshold, newConfig.PacketLossPenalty,
		newConfig.RTTThreshold, newConfig.RTTPenalty,
		newConfig.RestartCountThreshold, newConfig.RestartCountPenalty)

	w.Header().Set("Content-Type", "application/json")
	response := map[string]string{
		"status":  "success",
		"message": "Metrics configuration updated successfully",
	}
	json.NewEncoder(w).Encode(response)
}
