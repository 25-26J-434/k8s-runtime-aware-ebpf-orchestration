package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// UnifiedMetricsRequest represents query parameters for metrics endpoint
type UnifiedMetricsRequest struct {
	Type  string `query:"type"`  // Optional: filter by metric type (dns, rtt, etc.)
	Level string `query:"level"` // Optional: filter by level (node, pod)
}

// UnifiedMetricsResponse represents the unified metrics response
type UnifiedMetricsResponse struct {
	Timestamp string                            `json:"timestamp"`
	NodeName  string                            `json:"node_name,omitempty"`
	NodeIP    string                            `json:"node_ip,omitempty"`
	Node      map[string]interface{}            `json:"node,omitempty"`
	Pods      map[string]map[string]interface{} `json:"pods,omitempty"`
}

// handleUnifiedMetrics returns metrics from all collectors
func handleUnifiedMetrics(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters
	metricType := r.URL.Query().Get("type")
	level := r.URL.Query().Get("level")

	// Get node name from environment
	nodeName := os.Getenv("NODE_NAME")
	if nodeName == "" {
		nodeName = "unknown"
	}

	// Get node IP from Kubernetes API (try to get even if nodeName is unknown)
	nodeIP := getNodeIP(nodeName)
	if nodeIP == "" && nodeName == "unknown" {
		// Try to get node IP from pod's node name or hostname
		nodeIP = getNodeIPFromPod()
	}

	response := UnifiedMetricsResponse{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		NodeName:  nodeName,
		NodeIP:    nodeIP,
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

	// Collect node-level metrics (always for this node only)
	if level == "" || level == "node" {
		for _, collector := range collectors {
			nodeMetric := collector.GetNodeMetrics()
			// Ensure node metrics are tagged with the correct node name
			if nodeMetric.NodeName == "" {
				nodeMetric.NodeName = nodeName
			}
			// Only include node metrics if they match this node (or if NodeName is not set, assume it's for this node)
			if nodeMetric.NodeName == "" || nodeMetric.NodeName == nodeName {
				response.Node[string(nodeMetric.Type)] = nodeMetric.Value
			}
		}
	}

	// Collect pod-level metrics (only for pods on this node)
	if level == "" || level == "pod" {
		podCount := 0
		filteredCount := 0
		for _, collector := range collectors {
			podMetrics := collector.GetPodMetrics()
			for podKey, podMetric := range podMetrics {
				podCount++
				// STRICT FILTERING: Only include pods that match this node exactly
				// If NodeName is empty, skip it (should not happen if collectors are properly initialized)
				if podMetric.NodeName != "" && podMetric.NodeName == nodeName {
					filteredCount++
					if response.Pods[podKey] == nil {
						response.Pods[podKey] = make(map[string]interface{})
					}
					response.Pods[podKey][string(podMetric.Type)] = podMetric.Value
				}
			}
		}
		// Log filtering stats (only if there's a mismatch to avoid spam)
		if podCount > 0 && filteredCount != podCount {
			log.Printf("[API] Pod filtering: %d total pod metrics, %d filtered for node %s", podCount, filteredCount, nodeName)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// getNodeIP retrieves the node IP address from Kubernetes API
func getNodeIP(nodeName string) string {
	if k8sClient == nil || nodeName == "" || nodeName == "unknown" {
		return ""
	}

	ctx := context.Background()
	node, err := k8sClient.CoreV1().Nodes().Get(ctx, nodeName, metav1.GetOptions{})
	if err != nil {
		log.Printf("[API] Failed to get node %s for IP: %v", nodeName, err)
		return ""
	}

	// Get node IP from addresses
	for _, addr := range node.Status.Addresses {
		if addr.Type == corev1.NodeInternalIP {
			return addr.Address
		}
	}

	return ""
}

// getNodeIPFromPod tries to get node IP from the pod's node name
func getNodeIPFromPod() string {
	if k8sClient == nil {
		return ""
	}

	// Get pod name from environment (set by Kubernetes)
	podName := os.Getenv("POD_NAME")
	if podName == "" {
		// Try to get from hostname
		hostname, _ := os.Hostname()
		podName = hostname
	}

	namespace := os.Getenv("POD_NAMESPACE")
	if namespace == "" {
		namespace = "ebpf-telemetry" // Default namespace
	}

	if podName == "" {
		return ""
	}

	ctx := context.Background()
	pod, err := k8sClient.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		log.Printf("[API] Failed to get pod %s/%s for node IP: %v", namespace, podName, err)
		return ""
	}

	// Get the node name from the pod
	nodeName := pod.Spec.NodeName
	if nodeName == "" {
		return ""
	}

	// Now get the node IP
	return getNodeIP(nodeName)
}

// Example usage:
// GET /api/metrics              - All metrics, all levels
// GET /api/metrics?type=dns     - Only DNS metrics
// GET /api/metrics?level=pod    - Only pod-level metrics
// GET /api/metrics?type=dns&level=pod - DNS metrics, pod-level only
