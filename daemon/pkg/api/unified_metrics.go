package api

import (
	"context"
	"encoding/json"
	"fmt"
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
	Timestamp  string                            `json:"timestamp"`
	NodeName   string                            `json:"node_name,omitempty"`
	NodeIP     string                            `json:"node_ip,omitempty"`
	Node       map[string]interface{}            `json:"node,omitempty"`
	Pods       map[string]map[string]interface{} `json:"pods,omitempty"`
	Containers map[string]map[string]interface{} `json:"containers,omitempty"` // Container-level metrics
}

// handleUnifiedMetrics returns metrics from all collectors
func handleUnifiedMetrics(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters
	metricType := r.URL.Query().Get("type")
	level := r.URL.Query().Get("level")

	response := buildUnifiedMetricsResponse(metricType, level)

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

// buildUnifiedMetricsResponse builds the unified metrics response
func buildUnifiedMetricsResponse(metricType, level string) UnifiedMetricsResponse {
	// Get node name from environment
	nodeName := os.Getenv("NODE_NAME")
	if nodeName == "" {
		nodeName = "unknown"
	}

	// Get node IP from Kubernetes API
	nodeIP := getNodeIP(nodeName)
	if nodeIP == "" && nodeName == "unknown" {
		nodeIP = getNodeIPFromPod()
	}

	response := UnifiedMetricsResponse{
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		NodeName:   nodeName,
		NodeIP:     nodeIP,
		Node:       make(map[string]interface{}),
		Pods:       make(map[string]map[string]interface{}),
		Containers: make(map[string]map[string]interface{}),
	}

	// Get collectors based on filter
	var collectors []telemetry.Collector
	if metricType != "" {
		collector, ok := telemetry.GlobalRegistry.Get(telemetry.MetricType(metricType))
		if ok {
			collectors = []telemetry.Collector{collector}
		}
	} else {
		collectors = telemetry.GlobalRegistry.GetAll()
	}

	// Collect node-level metrics
	if level == "" || level == "node" {
		for _, collector := range collectors {
			nodeMetric := collector.GetNodeMetrics()
			if nodeMetric.NodeName == "" {
				nodeMetric.NodeName = nodeName
			}
			if nodeMetric.NodeName == "" || nodeMetric.NodeName == nodeName {
				response.Node[string(nodeMetric.Type)] = nodeMetric.Value
			}
		}
	}

	// Collect pod-level metrics
	if level == "" || level == "pod" {
		// First, get ALL pods from current node and pre-populate with zero metrics
		// This ensures pods appear immediately, even before they generate eBPF events
		if k8sClient != nil {
			ctx := context.Background()
			var allPods *corev1.PodList
			var err error
			
			if nodeName != "" && nodeName != "unknown" {
				allPods, err = k8sClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{
					FieldSelector: fmt.Sprintf("spec.nodeName=%s", nodeName),
				})
			} else {
				allPods, err = k8sClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
			}
			
			if err == nil {
				// System namespaces to exclude
				systemNamespaces := map[string]bool{
					"kube-system":          true,
					"local-path-storage":   true,
					"ebpf-telemetry":       true,
					"kube-public":          true,
					"kube-node-lease":      true,
				}
				
				// Pre-populate all non-system pods with empty metrics
				for _, pod := range allPods.Items {
					if !systemNamespaces[pod.Namespace] && pod.Status.PodIP != "" {
						podKey := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)
						if response.Pods[podKey] == nil {
							response.Pods[podKey] = make(map[string]interface{})
						}
					}
				}
			}
		}
		
		// Now add actual eBPF metrics for pods that have generated events
		for _, collector := range collectors {
			podMetrics := collector.GetPodMetrics()
			for podKey, podMetric := range podMetrics {
				// Include ALL pods with metrics - no NodeName filtering here
				// The frontend will filter system namespaces
				// This ensures pods appear immediately when they generate events
				if response.Pods[podKey] == nil {
					response.Pods[podKey] = make(map[string]interface{})
				}
				response.Pods[podKey][string(podMetric.Type)] = podMetric.Value
			}
		}
	}

	// Collect container-level metrics
	if level == "" || level == "container" {
		// Get container DNS metrics
		dnsContainerMetrics := telemetry.GetContainerDNSMetrics()
		for containerKey, metrics := range dnsContainerMetrics {
			if response.Containers[containerKey] == nil {
				response.Containers[containerKey] = make(map[string]interface{})
			}
			
			avgLatency := float64(0)
			if metrics.TotalEvents > 0 {
				avgLatency = float64(metrics.TotalLatencyNs) / float64(metrics.TotalEvents)
			}
			
			response.Containers[containerKey]["dns_latency"] = map[string]interface{}{
				"container_name":   metrics.ContainerName,
				"container_id":     metrics.ContainerID,
				"pod_name":         metrics.PodName,
				"namespace":        metrics.Namespace,
				"total_events":     metrics.TotalEvents,
				"total_latency_ns": metrics.TotalLatencyNs,
				"avg_latency_ns":   avgLatency,
				"avg_latency_us":   avgLatency / 1000.0,
				"min_latency_ns":   metrics.MinLatencyNs,
				"max_latency_ns":   metrics.MaxLatencyNs,
				"last_latency_ns":  metrics.LastLatencyNs,
			}
		}
		
		// Get container TCP metrics
		tcpContainerMetrics := telemetry.GetContainerTCPMetrics()
		for containerKey, metrics := range tcpContainerMetrics {
			if response.Containers[containerKey] == nil {
				response.Containers[containerKey] = make(map[string]interface{})
			}
			
			avgSRTT := float64(0)
			if metrics.TotalEvents > 0 && metrics.SmoothedRTTUs > 0 {
				avgSRTT = float64(metrics.SmoothedRTTUs) / float64(metrics.TotalEvents)
			}
			
			// Convert recent events to API format
			recentEventsAPI := make([]map[string]interface{}, 0, len(metrics.RecentEvents))
			for _, evt := range metrics.RecentEvents {
				recentEventsAPI = append(recentEventsAPI, map[string]interface{}{
					"timestamp":     evt.Timestamp.Format(time.RFC3339),
					"pod_key":       evt.PodKey,
					"pod_name":      evt.PodName,
					"namespace":     evt.Namespace,
					"source_ip":     evt.SourceIP,
					"dest_ip":       evt.DestIP,
					"source_port":   evt.SourcePort,
					"dest_port":     evt.DestPort,
					"event_type":    evt.EventType,
					"srtt_us":       evt.SRTTUs,
					"min_rtt_us":    evt.MinRTTUs,
					"cwnd":          evt.CWND,
					"retrans_count": evt.RetransCount,
				})
			}
			
			response.Containers[containerKey]["tcp_metrics"] = map[string]interface{}{
				"container_name":    metrics.ContainerName,
				"container_id":      metrics.ContainerID,
				"pod_name":          metrics.PodName,
				"namespace":         metrics.Namespace,
				"total_events":      metrics.TotalEvents,
				"smoothed_rtt_us":   metrics.SmoothedRTTUs,
				"avg_srtt_us":       avgSRTT,
				"min_rtt_us":        metrics.MinRTTUs,
				"retransmissions":   metrics.Retransmissions,
				"packet_loss":       metrics.PacketLoss,
				"bad_handshakes":    metrics.BadHandshakes,
				"state_transitions": metrics.StateTransitions,
				"last_srtt_us":      metrics.LastSRTTUs,
				"last_min_rtt_us":   metrics.LastMinRTTUs,
				"last_cwnd":         metrics.LastCWND,
				"recent_events":     recentEventsAPI,
			}
		}
	}

	return response
}

// Example usage:
// GET /api/metrics              - All metrics, all levels
// GET /api/metrics?type=dns     - Only DNS metrics
// GET /api/metrics?level=pod    - Only pod-level metrics
// GET /api/metrics?type=dns&level=pod - DNS metrics, pod-level only
