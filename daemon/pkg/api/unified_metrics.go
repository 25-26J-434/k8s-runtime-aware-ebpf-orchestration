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
	response := buildUnifiedMetricsResponse(r.URL.Query().Get("type"), r.URL.Query().Get("level"))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// buildUnifiedMetricsResponse constructs a unified metrics payload for this node.
func buildUnifiedMetricsResponse(metricType, level string) UnifiedMetricsResponse {
	nodeName := os.Getenv("NODE_NAME")
	if nodeName == "" {
		nodeName = "unknown"
	}

	nodeIP := getNodeIP(nodeName)
	if nodeIP == "" && nodeName == "unknown" {
		nodeIP = getNodeIPFromPod()
	}

	response := UnifiedMetricsResponse{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		NodeName:  nodeName,
		NodeIP:    nodeIP,
		Node:      make(map[string]interface{}),
		Pods:      make(map[string]map[string]interface{}),
	}

	collectors := selectCollectors(metricType)

	if level == "" || level == "node" {
		populateNodeMetrics(nodeName, collectors, response.Node)
	}

	if level == "" || level == "pod" {
		populatePodMetrics(nodeName, collectors, response.Pods)
	}

	return response
}

func selectCollectors(metricType string) []telemetry.Collector {
	if metricType == "" {
		return telemetry.GlobalRegistry.GetAll()
	}

	collector, ok := telemetry.GlobalRegistry.Get(telemetry.MetricType(metricType))
	if !ok {
		return nil
	}
	return []telemetry.Collector{collector}
}

func populateNodeMetrics(nodeName string, collectors []telemetry.Collector, dest map[string]interface{}) {
	for _, collector := range collectors {
		nodeMetric := collector.GetNodeMetrics()
		if nodeMetric.NodeName == "" {
			nodeMetric.NodeName = nodeName
		}
		if nodeMetric.NodeName == "" || nodeMetric.NodeName == nodeName {
			dest[string(nodeMetric.Type)] = nodeMetric.Value
		}
	}
}

func populatePodMetrics(nodeName string, collectors []telemetry.Collector, dest map[string]map[string]interface{}) {
	podCount := 0
	filteredCount := 0

	for _, collector := range collectors {
		podMetrics := collector.GetPodMetrics()
		for podKey, podMetric := range podMetrics {
			podCount++
			if podMetric.NodeName != "" && podMetric.NodeName == nodeName {
				filteredCount++
				if dest[podKey] == nil {
					dest[podKey] = make(map[string]interface{})
				}
				dest[podKey][string(podMetric.Type)] = podMetric.Value
			}
		}
	}

	if podCount > 0 && filteredCount != podCount {
		log.Printf("[API] Pod filtering: %d total pod metrics, %d filtered for node %s", podCount, filteredCount, nodeName)
	}
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
