package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

// UnifiedMetricsRequest represents query parameters for metrics endpoint
type UnifiedMetricsRequest struct {
	Type  string `query:"type"`  // Optional: filter by metric type (dns, rtt, etc.)
	Level string `query:"level"` // Optional: filter by level (node, pod)
}

// UnifiedMetricsResponse represents the unified metrics response
type UnifiedMetricsResponse struct {
	Timestamp string                            `json:"timestamp"`
	Node      map[string]interface{}            `json:"node,omitempty"`
	Pods      map[string]map[string]interface{} `json:"pods,omitempty"`
}

// handleUnifiedMetrics returns metrics from all collectors
func handleUnifiedMetrics(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters
	metricType := r.URL.Query().Get("type")
	level := r.URL.Query().Get("level")

	response := UnifiedMetricsResponse{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Node:      make(map[string]interface{}),
		Pods:      make(map[string]map[string]interface{}),
	}

	// Get collectors based on filter
	var collectors []telemetry.Collector
	if metricType != "" {
		// Filter by specific type
		collector, ok := telemetry.GlobalRegistry.Get(telemetry.MetricType(metricType))
		if ok {
			collectors = []telemetry.Collector{collector}
		}
	} else {
		// Get all collectors
		collectors = telemetry.GlobalRegistry.GetAll()
	}

	// Collect node-level metrics
	if level == "" || level == "node" {
		for _, collector := range collectors {
			nodeMetric := collector.GetNodeMetrics()
			response.Node[string(nodeMetric.Type)] = nodeMetric.Value
		}
	}

	// Collect pod-level metrics
	if level == "" || level == "pod" {
		for _, collector := range collectors {
			podMetrics := collector.GetPodMetrics()
			for podKey, podMetric := range podMetrics {
				if response.Pods[podKey] == nil {
					response.Pods[podKey] = make(map[string]interface{})
				}
				response.Pods[podKey][string(podMetric.Type)] = podMetric.Value
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// Example usage:
// GET /api/metrics              - All metrics, all levels
// GET /api/metrics?type=dns     - Only DNS metrics
// GET /api/metrics?level=pod    - Only pod-level metrics
// GET /api/metrics?type=dns&level=pod - DNS metrics, pod-level only
