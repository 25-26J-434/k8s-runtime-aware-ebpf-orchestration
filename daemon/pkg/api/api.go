package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/comm"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

// MetricsResponse represents the JSON response for metrics endpoint
type MetricsResponse struct {
	Timestamp string   `json:"timestamp"`
	DNS       DNSStats `json:"dns"`
	RTT       RTTStats `json:"rtt"`
}

type DNSStats struct {
	TotalEvents   uint64              `json:"total_events"`
	AvgLatencyUs  float64             `json:"avg_latency_us"`
	LastLatencyUs float64             `json:"last_latency_us"`
	MaxLatencyUs  float64             `json:"max_latency_us"`
	MinLatencyUs  float64             `json:"min_latency_us"`
	Pods          map[string]PodStats `json:"pods,omitempty"`
}

type PodStats struct {
	TotalEvents   uint64  `json:"total_events"`
	AvgLatencyUs  float64 `json:"avg_latency_us"`
	LastLatencyUs float64 `json:"last_latency_us"`
	MaxLatencyUs  float64 `json:"max_latency_us"`
	MinLatencyUs  float64 `json:"min_latency_us"`
}

type RTTStats struct {
	TotalEvents uint64              `json:"total_events"`
	AvgRTTUs    float64             `json:"avg_rtt_us"`
	LastRTTUs   float64             `json:"last_rtt_us"`
	MaxRTTUs    float64             `json:"max_rtt_us"`
	MinRTTUs    float64             `json:"min_rtt_us"`
	Pods        map[string]PodStats `json:"pods,omitempty"`
}

func StartServer() {
	if err := InitKubernetesClient(); err != nil {
		log.Printf("[API] Warning: Kubernetes client initialization failed: %v", err)
		log.Println("[API] Cluster topology endpoints will not be available")
	} else {
		go refreshPodIPMappingPeriodically()
	}
	initRoutingBackend()

	initMetricsStreaming()

	// Initialize WebSocket hub
	InitWebSocket()

	// Start metrics broadcaster
	ctx := context.Background()
	go StartMetricsBroadcaster(ctx, 2*time.Second) // Broadcast every 2 seconds

	http.HandleFunc("/health", corsMiddleware(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, "OK")
	}))
	http.HandleFunc("/whoami", corsMiddleware(handleWhoAmI))

	http.HandleFunc("/ready", corsMiddleware(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, "Ready")
	}))

	// REST API endpoints (kept for backwards compatibility)
	http.HandleFunc("/metrics/json", corsMiddleware(handleJSONMetrics))
	http.HandleFunc("/metrics", corsMiddleware(handlePrometheusMetrics))
	http.HandleFunc("/api/metrics", corsMiddleware(handleUnifiedMetrics))
	http.HandleFunc("/api/dns/pods", corsMiddleware(handlePodDNSMetrics))
	http.HandleFunc("/api/rtt/pods", corsMiddleware(handlePodRTTMetrics))
	http.HandleFunc("/api/cluster/topology", corsMiddleware(handleClusterTopology))
	http.HandleFunc("/api/cluster/services", corsMiddleware(handleClusterServices))

	initMetricsStreaming()

	// Register in-process communication handlers (broadcast/unicast/multicast/stats/health).
	comm.RegisterHandlers(nil, corsMiddleware)
	http.HandleFunc("/api/pod/action", corsMiddleware(handlePodAction))
	http.HandleFunc("/api/pod/logs", corsMiddleware(handlePodLogs))
	http.HandleFunc("/api/pod/ebpf-action", corsMiddleware(handleEBPFAction))
	http.HandleFunc("/api/pod/details", corsMiddleware(handlePodDetails))

	// Connection topology endpoints
	http.HandleFunc("/api/connections/topology", corsMiddleware(handleConnectionTopology))
	http.HandleFunc("/api/connections/pod", corsMiddleware(handlePodConnections))

	// Scheduling latency endpoints
	http.HandleFunc("/api/sched/metrics", corsMiddleware(handleSchedLatencyMetrics))
	http.HandleFunc("/api/sched/pods", corsMiddleware(handleSchedLatencyPods))
	http.HandleFunc("/api/sched/containers", corsMiddleware(handleSchedLatencyContainers))

	// Disk I/O metrics endpoints
	http.HandleFunc("/api/disk/metrics", corsMiddleware(handleDiskIOMetrics))
	http.HandleFunc("/api/disk/pods", corsMiddleware(handleDiskIOPods))
	http.HandleFunc("/api/disk/containers", corsMiddleware(handleDiskIOContainers))
	http.HandleFunc("/api/disk/all", corsMiddleware(handleDiskIOAll))
	http.HandleFunc("/api/sched/records", corsMiddleware(handleSchedLatencyRecords))

	// Scaling endpoints
	http.HandleFunc("/api/scaling/rules", corsMiddleware(handleScalingRules))
	http.HandleFunc("/api/scaling/rules/", corsMiddleware(handleScalingRuleByID))
	http.HandleFunc("/api/scaling/deployments", corsMiddleware(handleScalingDeployments))
	http.HandleFunc("/api/scaling/namespaces", corsMiddleware(handleScalingNamespaces))
	http.HandleFunc("/api/scaling/metrics/latest", corsMiddleware(handleScalingLatestMetrics))
	http.HandleFunc("/api/scaling/pods", corsMiddleware(handleScalingPods))

	// Component 2 (routing) endpoints
	http.HandleFunc("/api/probe/", corsMiddleware(handleProbe))
	http.HandleFunc("/api/policies", corsMiddleware(handlePolicies))
	http.HandleFunc("/api/policies/", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/evaluate"):
			handlePolicyEvaluate(w, r)
		case strings.HasSuffix(r.URL.Path, "/expire"):
			handlePolicyExpire(w, r)
		default:
			handlePolicyByName(w, r)
		}
	}))
	http.HandleFunc("/api/cluster/summary", corsMiddleware(handleClusterSummary))

	// WebSocket endpoints
	http.HandleFunc("/ws/metrics", corsMiddleware(handleWebSocketMetrics))
	http.HandleFunc("/ws/topology", corsMiddleware(handleWebSocketClusterTopology))
	http.HandleFunc("/ws/pod-details", corsMiddleware(handleWebSocketPodDetails))

	log.Println("[API] Starting HTTP server on :8080")
	log.Println("[API]   GET /api/connections/topology    - Real TCP connections")
	log.Println("[API]   GET /api/connections/pod         - Pod-specific connections")
	log.Println("[API]   POST /api/pod/action             - Perform pod actions")
	log.Println("[API]   POST /api/pod/ebpf-action        - eBPF-based pod actions")
	log.Println("[API]   GET /api/pod/details             - Pod details")
	log.Println("[API]   GET /api/scaling/rules           - Scaling rules (list)")
	log.Println("[API]   POST /api/scaling/rules          - Scaling rules (create)")
	log.Println("[API]   PUT /api/scaling/rules/{id}      - Scaling rules (update)")
	log.Println("[API]   POST /api/scaling/rules/{id}/toggle - Scaling rules (toggle enabled)")
	log.Println("[API]   GET /api/scaling/deployments     - Deployment replica info")
	log.Println("[API]   GET /api/scaling/namespaces      - Cluster namespaces")
	log.Println("[API]   GET /api/scaling/metrics/latest  - Latest per-deployment metrics")
	log.Println("[API]   GET /api/scaling/pods            - Pod placement for a deployment")
	log.Println("[API] WebSocket Endpoints:")
	log.Println("[API]   WS /ws/metrics                   - Real-time metrics stream")
	log.Println("[API]   WS /ws/topology                  - Real-time topology stream")
	log.Println("[API]   WS /ws/pod-details               - Real-time pod details stream")
	log.Println("[API] Endpoints:")
	log.Println("[API]   GET /health                  - Health check")
	log.Println("[API]   GET /ready                   - Readiness check")
	log.Println("[API]   GET /metrics                 - Prometheus metrics")
	log.Println("[API]   GET /metrics/json            - JSON metrics")
	log.Println("[API]   GET /api/metrics             - Unified metrics (extensible)")
	log.Println("[API]   GET /api/dns/pods            - Per-pod DNS metrics")
	log.Println("[API]   GET /api/rtt/pods            - Per-pod RTT metrics")
	log.Println("[API]   GET /api/cluster/topology    - Cluster topology")
	log.Println("[API]   GET /api/cluster/services    - Services info")

	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("[API] Server failed: %v", err)
	}
}

func handleJSONMetrics(w http.ResponseWriter, r *http.Request) {
	dnsMetrics := telemetry.GetDNSMetrics()
	rttMetrics := telemetry.GetRTTMetrics()
	_ = telemetry.GetTCPMetrics()
	podDNSMetrics := telemetry.GetPodDNSMetrics()
	podRTTMetrics := telemetry.GetPodRTTMetrics()
	_ = telemetry.GetPodTCPMetrics()

	// Build per-pod DNS stats
	podDNSStats := make(map[string]PodStats)
	for podKey, metrics := range podDNSMetrics {
		avgLatency := float64(0)
		if metrics.TotalEvents > 0 {
			avgLatency = float64(metrics.TotalLatencyNs) / float64(metrics.TotalEvents) / 1000
		}
		podDNSStats[podKey] = PodStats{
			TotalEvents:   metrics.TotalEvents,
			AvgLatencyUs:  avgLatency,
			LastLatencyUs: float64(metrics.LastLatencyNs) / 1000,
			MaxLatencyUs:  float64(metrics.MaxLatencyNs) / 1000,
			MinLatencyUs:  safeMinValue(metrics.MinLatencyNs) / 1000,
		}
	}

	// Build per-pod RTT stats
	podRTTStats := make(map[string]PodStats)
	for podKey, metrics := range podRTTMetrics {
		avgRTT := float64(0)
		if metrics.TotalEvents > 0 {
			avgRTT = float64(metrics.TotalRTTNs) / float64(metrics.TotalEvents) / 1000
		}
		podRTTStats[podKey] = PodStats{
			TotalEvents:   metrics.TotalEvents,
			AvgLatencyUs:  avgRTT,
			LastLatencyUs: float64(metrics.LastRTTNs) / 1000,
			MaxLatencyUs:  float64(metrics.MaxRTTNs) / 1000,
			MinLatencyUs:  safeMinValue(metrics.MinRTTNs) / 1000,
		}
	}

	response := MetricsResponse{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		DNS: DNSStats{
			TotalEvents:   dnsMetrics.TotalEvents,
			AvgLatencyUs:  calculateAvg(dnsMetrics.TotalLatencyNs, dnsMetrics.TotalEvents) / 1000,
			LastLatencyUs: float64(dnsMetrics.LastLatencyNs) / 1000,
			MaxLatencyUs:  float64(dnsMetrics.MaxLatencyNs) / 1000,
			MinLatencyUs:  safeMinValue(dnsMetrics.MinLatencyNs) / 1000,
			Pods:          podDNSStats,
		},
		RTT: RTTStats{
			TotalEvents: rttMetrics.TotalEvents,
			AvgRTTUs:    calculateAvg(rttMetrics.TotalRTTNs, rttMetrics.TotalEvents) / 1000,
			LastRTTUs:   float64(rttMetrics.LastRTTNs) / 1000,
			MaxRTTUs:    float64(rttMetrics.MaxRTTNs) / 1000,
			MinRTTUs:    safeMinValue(rttMetrics.MinRTTNs) / 1000,
			Pods:        podRTTStats,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func handlePrometheusMetrics(w http.ResponseWriter, r *http.Request) {
	dnsMetrics := telemetry.GetDNSMetrics()
	rttMetrics := telemetry.GetRTTMetrics()
	_ = telemetry.GetTCPMetrics() // TCP metrics available via unified endpoint
	podDNSMetrics := telemetry.GetPodDNSMetrics()
	podRTTMetrics := telemetry.GetPodRTTMetrics()
	_ = telemetry.GetPodTCPMetrics() // TCP metrics available via unified endpoint

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")

	// DNS Metrics
	fmt.Fprintf(w, "# HELP ebpf_dns_events_total Total number of DNS events captured\n")
	fmt.Fprintf(w, "# TYPE ebpf_dns_events_total counter\n")
	fmt.Fprintf(w, "ebpf_dns_events_total %d\n\n", dnsMetrics.TotalEvents)

	fmt.Fprintf(w, "# HELP ebpf_dns_latency_ns DNS latency in nanoseconds\n")
	fmt.Fprintf(w, "# TYPE ebpf_dns_latency_ns gauge\n")
	fmt.Fprintf(w, "ebpf_dns_latency_ns{stat=\"last\"} %d\n", dnsMetrics.LastLatencyNs)
	fmt.Fprintf(w, "ebpf_dns_latency_ns{stat=\"max\"} %d\n", dnsMetrics.MaxLatencyNs)
	fmt.Fprintf(w, "ebpf_dns_latency_ns{stat=\"min\"} %d\n\n", safeMinValueUint(dnsMetrics.MinLatencyNs))

	avgDNS := calculateAvg(dnsMetrics.TotalLatencyNs, dnsMetrics.TotalEvents)
	fmt.Fprintf(w, "ebpf_dns_latency_ns{stat=\"avg\"} %.2f\n\n", avgDNS)

	// Per-pod DNS metrics
	for podKey, metrics := range podDNSMetrics {
		avgPodDNS := float64(0)
		if metrics.TotalEvents > 0 {
			avgPodDNS = float64(metrics.TotalLatencyNs) / float64(metrics.TotalEvents)
		}
		fmt.Fprintf(w, "ebpf_dns_latency_ns{pod=\"%s\",stat=\"avg\"} %.2f\n", podKey, avgPodDNS)
		fmt.Fprintf(w, "ebpf_dns_latency_ns{pod=\"%s\",stat=\"last\"} %d\n", podKey, metrics.LastLatencyNs)
		fmt.Fprintf(w, "ebpf_dns_latency_ns{pod=\"%s\",stat=\"max\"} %d\n", podKey, metrics.MaxLatencyNs)
		fmt.Fprintf(w, "ebpf_dns_latency_ns{pod=\"%s\",stat=\"min\"} %d\n", podKey, safeMinValueUint(metrics.MinLatencyNs))
	}
	fmt.Fprintf(w, "\n")

	// RTT Metrics
	fmt.Fprintf(w, "# HELP ebpf_rtt_events_total Total number of RTT events captured\n")
	fmt.Fprintf(w, "# TYPE ebpf_rtt_events_total counter\n")
	fmt.Fprintf(w, "ebpf_rtt_events_total %d\n\n", rttMetrics.TotalEvents)

	fmt.Fprintf(w, "# HELP ebpf_rtt_ns TCP RTT in nanoseconds\n")
	fmt.Fprintf(w, "# TYPE ebpf_rtt_ns gauge\n")
	fmt.Fprintf(w, "ebpf_rtt_ns{stat=\"last\"} %d\n", rttMetrics.LastRTTNs)
	fmt.Fprintf(w, "ebpf_rtt_ns{stat=\"max\"} %d\n", rttMetrics.MaxRTTNs)
	fmt.Fprintf(w, "ebpf_rtt_ns{stat=\"min\"} %d\n", safeMinValueUint(rttMetrics.MinRTTNs))

	avgRTT := calculateAvg(rttMetrics.TotalRTTNs, rttMetrics.TotalEvents)
	fmt.Fprintf(w, "ebpf_rtt_ns{stat=\"avg\"} %.2f\n\n", avgRTT)

	// Per-pod RTT metrics
	for podKey, metrics := range podRTTMetrics {
		avgPodRTT := float64(0)
		if metrics.TotalEvents > 0 {
			avgPodRTT = float64(metrics.TotalRTTNs) / float64(metrics.TotalEvents)
		}
		fmt.Fprintf(w, "ebpf_rtt_ns{pod=\"%s\",stat=\"avg\"} %.2f\n", podKey, avgPodRTT)
		fmt.Fprintf(w, "ebpf_rtt_ns{pod=\"%s\",stat=\"last\"} %d\n", podKey, metrics.LastRTTNs)
		fmt.Fprintf(w, "ebpf_rtt_ns{pod=\"%s\",stat=\"max\"} %d\n", podKey, metrics.MaxRTTNs)
		fmt.Fprintf(w, "ebpf_rtt_ns{pod=\"%s\",stat=\"min\"} %d\n", podKey, safeMinValueUint(metrics.MinRTTNs))
	}
}

func calculateAvg(total, count uint64) float64 {
	if count == 0 {
		return 0
	}
	return float64(total) / float64(count)
}

func safeMinValue(v uint64) float64 {
	if v == ^uint64(0) {
		return 0
	}
	return float64(v)
}

func safeMinValueUint(v uint64) uint64 {
	if v == ^uint64(0) {
		return 0
	}
	return v
}

// handlePodDNSMetrics returns per-pod DNS metrics
func handlePodDNSMetrics(w http.ResponseWriter, r *http.Request) {
	podDNSMetrics := telemetry.GetPodDNSMetrics()

	// Convert to response format
	response := make(map[string]interface{})
	for podKey, metrics := range podDNSMetrics {
		avgLatency := float64(0)
		if metrics.TotalEvents > 0 {
			avgLatency = float64(metrics.TotalLatencyNs) / float64(metrics.TotalEvents) / 1000
		}
		response[podKey] = map[string]interface{}{
			"namespace":       metrics.Namespace,
			"pod_name":        metrics.PodName,
			"total_events":    metrics.TotalEvents,
			"avg_latency_us":  avgLatency,
			"last_latency_us": float64(metrics.LastLatencyNs) / 1000,
			"max_latency_us":  float64(metrics.MaxLatencyNs) / 1000,
			"min_latency_us":  safeMinValue(metrics.MinLatencyNs) / 1000,
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"pods": response,
	})
}

// handlePodRTTMetrics returns per-pod RTT metrics
func handlePodRTTMetrics(w http.ResponseWriter, r *http.Request) {
	podRTTMetrics := telemetry.GetPodRTTMetrics()

	// Convert to response format
	response := make(map[string]interface{})
	for podKey, metrics := range podRTTMetrics {
		avgRTT := float64(0)
		if metrics.TotalEvents > 0 {
			avgRTT = float64(metrics.TotalRTTNs) / float64(metrics.TotalEvents) / 1000
		}
		response[podKey] = map[string]interface{}{
			"namespace":    metrics.Namespace,
			"pod_name":     metrics.PodName,
			"total_events": metrics.TotalEvents,
			"avg_rtt_us":   avgRTT,
			"last_rtt_us":  float64(metrics.LastRTTNs) / 1000,
			"max_rtt_us":   float64(metrics.MaxRTTNs) / 1000,
			"min_rtt_us":   safeMinValue(metrics.MinRTTNs) / 1000,
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"pods": response,
	})
}

// handleClusterTopology returns cluster topology information
func handleClusterTopology(w http.ResponseWriter, r *http.Request) {
	topology, err := GetClusterTopology()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"error": fmt.Sprintf("Failed to get cluster topology: %v", err),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(topology)
}

// handleClusterServices returns services information
func handleClusterServices(w http.ResponseWriter, r *http.Request) {
	services, err := GetServices()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"error": fmt.Sprintf("Failed to get services: %v", err),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"services": services,
	})
}

// refreshPodIPMappingPeriodically queries K8s API and updates telemetry package with pod IP mappings
func refreshPodIPMappingPeriodically() {
	ticker := time.NewTicker(5 * time.Second) // Refresh every 5 seconds for real-time pod discovery
	defer ticker.Stop()

	// Do initial refresh immediately
	updatePodIPMappingFromK8s()

	for range ticker.C {
		updatePodIPMappingFromK8s()
	}
}

// updatePodIPMappingFromK8s queries K8s API and updates the telemetry package
func updatePodIPMappingFromK8s() {
	if k8sClient == nil {
		return
	}

	// Get node name - only map pods on this node
	nodeName := os.Getenv("NODE_NAME")

	ctx := context.Background()
	var pods *corev1.PodList
	var err error

	if nodeName != "" {
		// Only get pods on this node
		pods, err = k8sClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{
			FieldSelector: fmt.Sprintf("spec.nodeName=%s", nodeName),
		})
		if err != nil {
			log.Printf("[API] Failed to list pods for IP mapping: %v", err)
			return
		}
		log.Printf("[API] Mapping pods for node: %s (%d pods)", nodeName, len(pods.Items))
	} else {
		// Fallback: get all pods if NODE_NAME not set
		log.Printf("[API] Warning: NODE_NAME not set, mapping all pods")
		pods, err = k8sClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
		if err != nil {
			log.Printf("[API] Failed to list pods for IP mapping: %v", err)
			return
		}
	}

	// Build IP -> "namespace/podname" mapping (only for pods on this node)
	mapping := make(map[string]string)
	for _, pod := range pods.Items {
		if pod.Status.PodIP != "" {
			podKey := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)
			mapping[pod.Status.PodIP] = podKey
		}
	}

	// Update the telemetry package
	telemetry.SetPodIPMapping(mapping)

	// Update the connection tracker
	tracker := telemetry.GetConnectionTracker()
	if tracker != nil {
		tracker.UpdatePodIPMapping(mapping)
	}
}
