package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/comm"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/config"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const nodeHealthBroadcastInterval = 5 * time.Second

type AlertSeverity string

const (
	AlertCritical AlertSeverity = "critical"
	AlertWarning  AlertSeverity = "warning"
	AlertInfo     AlertSeverity = "info"
)

// Health is now a simple boolean: true = healthy, false = unhealthy

type HealthAlert struct {
	Timestamp   string        `json:"timestamp"`
	Severity    AlertSeverity `json:"severity"`
	Source      string        `json:"source"` // "node" or "pod"
	NodeName    string        `json:"node_name"`
	PodName     string        `json:"pod_name,omitempty"`
	Namespace   string        `json:"namespace,omitempty"`
	Message     string        `json:"message"`
	Details     interface{}   `json:"details,omitempty"`
}

type PodHealth struct {
	Name          string   `json:"name"`
	Namespace     string   `json:"namespace"`
	Node          string   `json:"node"`
	Phase         string   `json:"phase"`
	Ready         bool     `json:"ready"`
	RestartCount  int32    `json:"restart_count"`
	Healthy       bool     `json:"healthy"`           // true = healthy, false = unhealthy
	HealthScore   int      `json:"health_score,omitempty"`
	HealthReasons []string `json:"health_reasons,omitempty"`
}

type NodeHealthUpdate struct {
	Timestamp     string      `json:"timestamp"`
	NodeName      string      `json:"node_name"`
	NodeIP        string      `json:"node_ip,omitempty"`
	Status        string      `json:"status"`
	Healthy       bool        `json:"healthy"`          // true = healthy, false = unhealthy
	HealthScore   int         `json:"health_score,omitempty"`
	HealthReasons []string    `json:"health_reasons,omitempty"`
	TotalPods     int         `json:"total_pods"`
	HealthyPods   int         `json:"healthy_pods"`
	UnhealthyPods int         `json:"unhealthy_pods"`
	UnknownPods   int         `json:"unknown_pods"`
	Pods          []PodHealth `json:"pods"`
	Error         string      `json:"error,omitempty"`
}

type ClusterNodeHealthResponse struct {
	Timestamp string                      `json:"timestamp"`
	Nodes     map[string]NodeHealthUpdate `json:"nodes"`
	Alerts    []HealthAlert               `json:"alerts,omitempty"`
}

var (
	nodeHealthStreamOnce sync.Once

	clusterNodeHealthMu sync.RWMutex
	clusterNodeHealth   = make(map[string]NodeHealthUpdate)

	// Track previous health state to detect changes
	previousNodeHealth = make(map[string]NodeHealthUpdate)
	previousHealthMu   sync.RWMutex

	// Active alerts
	activeAlerts   = make(map[string]HealthAlert) // key: alertID (node-pod combination)
	activeAlertsMu sync.RWMutex
)

func initNodeHealthStreaming() {
	nodeHealthStreamOnce.Do(func() {
		comm.RegisterMessageHandler(comm.EventNodeHealth, handleRemoteNodeHealthUpdate)
		http.HandleFunc("/api/cluster/node-health", corsMiddleware(handleClusterNodeHealth))
		http.HandleFunc("/ws/node-health", corsMiddleware(handleWebSocketNodeHealth))
		http.HandleFunc("/api/test-alert", corsMiddleware(handleTestAlert))
		go nodeHealthBroadcastLoop()
		go nodeHealthWebSocketBroadcaster()
	})
}

func nodeHealthBroadcastLoop() {
	publishLocalNodeHealth()

	ticker := time.NewTicker(nodeHealthBroadcastInterval)
	defer ticker.Stop()

	for range ticker.C {
		publishLocalNodeHealth()
	}
}

func publishLocalNodeHealth() {
	health := collectLocalNodeHealth()
	nodeKey := health.NodeName
	if nodeKey == "" {
		nodeKey = health.NodeIP
	}
	if nodeKey == "" {
		log.Printf("[API] Skipping node health broadcast: missing node identity")
		return
	}

	// Detect alerts before storing
	alerts := detectHealthAlerts(nodeKey, health)

	storeNodeHealth(nodeKey, health)

	// Broadcast alerts if any
	if len(alerts) > 0 {
		for _, alert := range alerts {
			broadcastAlert(alert)
		}
	}

	comm.BroadcastMessage(comm.Message{
		Event:   comm.EventNodeHealth,
		Payload: map[string]any{"node_health": health},
	})
}

func collectLocalNodeHealth() NodeHealthUpdate {
	nodeName := getLocalNodeName()

	update := NodeHealthUpdate{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		NodeName:  nodeName,
		NodeIP:    getNodeIP(nodeName),
		Status:    "unknown",
		Pods:      []PodHealth{},
	}

	if k8sClient == nil {
		update.Error = "kubernetes client not initialized"
		return update
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	pods, err := k8sClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{
		FieldSelector: "spec.nodeName=" + nodeName,
	})
	if err != nil {
		update.Error = err.Error()
		return update
	}

	for _, pod := range pods.Items {
		podHealth := buildPodHealth(pod)
		update.Pods = append(update.Pods, podHealth)
		update.TotalPods++

		switch {
		case isPodHealthy(pod):
			update.HealthyPods++
		case isPodUnhealthy(pod):
			update.UnhealthyPods++
		default:
			update.UnknownPods++
		}
	}

	switch {
	case update.UnhealthyPods > 0:
		update.Status = "unhealthy"
	case update.UnknownPods > 0:
		update.Status = "degraded"
	default:
		update.Status = "healthy"
	}

	applyMetricsBasedHealthLevels(&update, buildUnifiedMetricsResponse("", ""))

	return update
}

func getLocalNodeName() string {
	if nodeName := os.Getenv("NODE_NAME"); nodeName != "" {
		return nodeName
	}

	if hostname, err := os.Hostname(); err == nil && hostname != "" {
		return hostname
	}

	return "unknown"
}

func buildPodHealth(pod corev1.Pod) PodHealth {
	var restartCount int32
	for _, cs := range pod.Status.ContainerStatuses {
		restartCount += cs.RestartCount
	}

	return PodHealth{
		Name:         pod.Name,
		Namespace:    pod.Namespace,
		Node:         pod.Spec.NodeName,
		Phase:        string(pod.Status.Phase),
		Ready:        isPodReadyStatus(pod),
		RestartCount: restartCount,
	}
}

func isPodReadyStatus(pod corev1.Pod) bool {
	for _, condition := range pod.Status.Conditions {
		if condition.Type == corev1.PodReady {
			return condition.Status == corev1.ConditionTrue
		}
	}
	return false
}

func isPodHealthy(pod corev1.Pod) bool {
	return pod.Status.Phase == corev1.PodRunning && isPodReadyStatus(pod)
}

func isPodUnhealthy(pod corev1.Pod) bool {
	if pod.Status.Phase == corev1.PodFailed {
		return true
	}
	if pod.Status.Phase == corev1.PodRunning && !isPodReadyStatus(pod) {
		return true
	}
	return false
}

func handleRemoteNodeHealthUpdate(msg comm.Message) {
	payload, ok := msg.Payload["node_health"]
	if !ok || payload == nil {
		return
	}

	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[API] Failed to marshal remote node health payload: %v", err)
		return
	}

	var update NodeHealthUpdate
	if err := json.Unmarshal(data, &update); err != nil {
		log.Printf("[API] Failed to decode remote node health payload: %v", err)
		return
	}

	nodeKey := update.NodeName
	if nodeKey == "" || nodeKey == "unknown" {
		nodeKey = update.NodeIP
	}
	if nodeKey == "" {
		nodeKey = msg.Sender
	}
	if nodeKey == "" {
		nodeKey = msg.SenderIP
	}
	if nodeKey == "" {
		log.Printf("[API] Received node health update without identifiable node")
		return
	}

	storeNodeHealth(nodeKey, update)
}

func storeNodeHealth(nodeKey string, update NodeHealthUpdate) {
	clusterNodeHealthMu.Lock()
	clusterNodeHealth[nodeKey] = update
	clusterNodeHealthMu.Unlock()
}

func getNodeHealthForMetrics(nodeName, nodeIP, explicitKey string) (NodeHealthUpdate, bool) {
	clusterNodeHealthMu.RLock()
	defer clusterNodeHealthMu.RUnlock()

	if explicitKey != "" {
		if h, ok := clusterNodeHealth[explicitKey]; ok {
			return h, true
		}
	}
	if nodeName != "" {
		if h, ok := clusterNodeHealth[nodeName]; ok {
			return h, true
		}
	}
	if nodeIP != "" {
		if h, ok := clusterNodeHealth[nodeIP]; ok {
			return h, true
		}
	}
	return NodeHealthUpdate{}, false
}

func handleClusterNodeHealth(w http.ResponseWriter, _ *http.Request) {
	clusterNodeHealthMu.RLock()
	resp := ClusterNodeHealthResponse{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Nodes:     make(map[string]NodeHealthUpdate, len(clusterNodeHealth)),
	}
	for node, health := range clusterNodeHealth {
		resp.Nodes[node] = health
	}
	clusterNodeHealthMu.RUnlock()

	// Include active alerts
	activeAlertsMu.RLock()
	for _, alert := range activeAlerts {
		resp.Alerts = append(resp.Alerts, alert)
	}
	activeAlertsMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// detectHealthAlerts detects changes in node/pod health and generates alerts
func detectHealthAlerts(nodeKey string, current NodeHealthUpdate) []HealthAlert {
	var alerts []HealthAlert
	
	// Get current metrics configuration for threshold-based alerts
	cfg := config.GetCurrentMetricsConfig()

	previousHealthMu.RLock()
	previous, hadPrevious := previousNodeHealth[nodeKey]
	previousHealthMu.RUnlock()

	// Node unavailable alert
	if current.Error != "" {
		alertID := "node:" + nodeKey
		alert := HealthAlert{
			Timestamp: current.Timestamp,
			Severity:  AlertCritical,
			Source:    "node",
			NodeName:  current.NodeName,
			Message:   "Node is unavailable or experiencing errors",
			Details:   map[string]interface{}{"error": current.Error},
		}
		storeAlert(alertID, alert)
		alerts = append(alerts, alert)
	}

	// Node status degraded
	if hadPrevious && previous.Status == "healthy" && current.Status == "degraded" {
		alertID := "node:" + nodeKey + ":degraded"
		alert := HealthAlert{
			Timestamp: current.Timestamp,
			Severity:  AlertWarning,
			Source:    "node",
			NodeName:  current.NodeName,
			Message:   fmt.Sprintf("Node status degraded: %d unknown pods", current.UnknownPods),
			Details: map[string]interface{}{
				"unknown_pods": current.UnknownPods,
				"total_pods":   current.TotalPods,
			},
		}
		storeAlert(alertID, alert)
		alerts = append(alerts, alert)
	}

	// Node status unhealthy
	if hadPrevious && previous.Status != "unhealthy" && current.Status == "unhealthy" {
		alertID := "node:" + nodeKey + ":unhealthy"
		alert := HealthAlert{
			Timestamp: current.Timestamp,
			Severity:  AlertCritical,
			Source:    "node",
			NodeName:  current.NodeName,
			Message:   fmt.Sprintf("Node is unhealthy: %d unhealthy pods", current.UnhealthyPods),
			Details: map[string]interface{}{
				"unhealthy_pods": current.UnhealthyPods,
				"total_pods":     current.TotalPods,
			},
		}
		storeAlert(alertID, alert)
		alerts = append(alerts, alert)
	}

	// Check individual pods
	if hadPrevious {
		previousPods := make(map[string]PodHealth)
		for _, pod := range previous.Pods {
			previousPods[pod.Namespace+"/"+pod.Name] = pod
		}

		for _, pod := range current.Pods {
			podKey := pod.Namespace + "/" + pod.Name
			prevPod, existed := previousPods[podKey]

			// CRITICAL: Pod became unhealthy (not ready)
			if existed && prevPod.Ready && !pod.Ready {
				alertID := "pod:" + nodeKey + ":" + podKey
				alert := HealthAlert{
					Timestamp: current.Timestamp,
					Severity:  AlertCritical,  // 🔴 CRITICAL - pod lost ready status
					Source:    "pod",
					NodeName:  current.NodeName,
					PodName:   pod.Name,
					Namespace: pod.Namespace,
					Message:   fmt.Sprintf("Pod %s/%s became UNHEALTHY (NOT READY)", pod.Namespace, pod.Name),
					Details: map[string]interface{}{
						"phase":         pod.Phase,
						"ready":         pod.Ready,
						"restart_count": pod.RestartCount,
					},
				}
				storeAlert(alertID, alert)
				alerts = append(alerts, alert)
			}

			// Pod failed
			if pod.Phase == "Failed" {
				alertID := "pod:" + nodeKey + ":" + podKey + ":failed"
				alert := HealthAlert{
					Timestamp: current.Timestamp,
					Severity:  AlertCritical,
					Source:    "pod",
					NodeName:  current.NodeName,
					PodName:   pod.Name,
					Namespace: pod.Namespace,
					Message:   fmt.Sprintf("Pod %s/%s has failed", pod.Namespace, pod.Name),
					Details: map[string]interface{}{
						"phase":         pod.Phase,
						"restart_count": pod.RestartCount,
					},
				}
				storeAlert(alertID, alert)
				alerts = append(alerts, alert)
			}

			// High restart count
			if existed && pod.RestartCount > prevPod.RestartCount && pod.RestartCount >= cfg.RestartCountThreshold {
				alertID := "pod:" + nodeKey + ":" + podKey + ":restarts"
				alert := HealthAlert{
					Timestamp: current.Timestamp,
					Severity:  AlertWarning,
					Source:    "pod",
					NodeName:  current.NodeName,
					PodName:   pod.Name,
					Namespace: pod.Namespace,
					Message:   fmt.Sprintf("Pod %s/%s has high restart count: %d", pod.Namespace, pod.Name, pod.RestartCount),
					Details: map[string]interface{}{
						"restart_count":          pod.RestartCount,
						"previous_restart_count": prevPod.RestartCount,
					},
				}
				storeAlert(alertID, alert)
				alerts = append(alerts, alert)
			}

			// Generate WARNING alerts for metrics issues (packet loss, retransmissions, latency)
			// These trigger even if pod is Running+Ready
			for _, reason := range pod.HealthReasons {
				var alertID string
				var shouldAlert bool

				// High packet loss
				if contains(reason, "packet loss high") {
					alertID = "pod:" + nodeKey + ":" + podKey + ":packet-loss"
					shouldAlert = true
				}
				// High retransmissions
				if contains(reason, "retransmissions high") {
					alertID = "pod:" + nodeKey + ":" + podKey + ":retransmissions"
					shouldAlert = true
				}
				// High DNS latency
				if contains(reason, "dns latency high") {
					alertID = "pod:" + nodeKey + ":" + podKey + ":dns-latency"
					shouldAlert = true
				}
				// High RTT
				if contains(reason, "rtt high") {
					alertID = "pod:" + nodeKey + ":" + podKey + ":rtt"
					shouldAlert = true
				}
				// High disk I/O latency
				if contains(reason, "disk I/O latency high") {
					alertID = "pod:" + nodeKey + ":" + podKey + ":disk-io"
					shouldAlert = true
				}

				if shouldAlert {
					alert := HealthAlert{
						Timestamp: current.Timestamp,
						Severity:  AlertWarning,  // WARNING for metrics issues
						Source:    "pod",
						NodeName:  current.NodeName,
						PodName:   pod.Name,
						Namespace: pod.Namespace,
						Message:   fmt.Sprintf("Pod %s/%s: %s", pod.Namespace, pod.Name, reason),
						Details: map[string]interface{}{
							"reason": reason,
							"phase":  pod.Phase,
							"ready":  pod.Ready,
						},
					}
					storeAlert(alertID, alert)
					alerts = append(alerts, alert)
				}
			}
		}

		// Check for missing pods (disappeared)
		for _, prevPod := range previous.Pods {
			podKey := prevPod.Namespace + "/" + prevPod.Name
			found := false
			for _, currentPod := range current.Pods {
				if currentPod.Namespace+"/"+currentPod.Name == podKey {
					found = true
					break
				}
			}
			if !found && prevPod.Ready {
				alertID := "pod:" + nodeKey + ":" + podKey + ":disappeared"
				alert := HealthAlert{
					Timestamp: current.Timestamp,
					Severity:  AlertWarning,
					Source:    "pod",
					NodeName:  current.NodeName,
					PodName:   prevPod.Name,
					Namespace: prevPod.Namespace,
					Message:   fmt.Sprintf("Pod %s/%s disappeared from node", prevPod.Namespace, prevPod.Name),
				}
				storeAlert(alertID, alert)
				alerts = append(alerts, alert)
			}
		}
	} else {
		// First time seeing this node - check for immediate issues
		for _, pod := range current.Pods {
			podKey := pod.Namespace + "/" + pod.Name
			
			// Alert on failed pods even on first detection
			if pod.Phase == "Failed" {
				alertID := "pod:" + nodeKey + ":" + podKey + ":failed"
				alert := HealthAlert{
					Timestamp: current.Timestamp,
					Severity:  AlertCritical,
					Source:    "pod",
					NodeName:  current.NodeName,
					PodName:   pod.Name,
					Namespace: pod.Namespace,
					Message:   fmt.Sprintf("Pod %s/%s has failed", pod.Namespace, pod.Name),
					Details: map[string]interface{}{
						"phase":         pod.Phase,
						"restart_count": pod.RestartCount,
					},
				}
				storeAlert(alertID, alert)
				alerts = append(alerts, alert)
			}
			
			// Alert on high restart count on first detection
			if pod.RestartCount >= cfg.RestartCountThreshold {
				alertID := "pod:" + nodeKey + ":" + podKey + ":restarts"
				alert := HealthAlert{
					Timestamp: current.Timestamp,
					Severity:  AlertWarning,
					Source:    "pod",
					NodeName:  current.NodeName,
					PodName:   pod.Name,
					Namespace: pod.Namespace,
					Message:   fmt.Sprintf("Pod %s/%s has high restart count: %d", pod.Namespace, pod.Name, pod.RestartCount),
					Details: map[string]interface{}{
						"restart_count": pod.RestartCount,
					},
				}
				storeAlert(alertID, alert)
				alerts = append(alerts, alert)
			}
			
			// CRITICAL: Alert on not-ready pods (highest priority)
			if !pod.Ready {
				alertID := "pod:" + nodeKey + ":" + podKey + ":notready"
				alert := HealthAlert{
					Timestamp: current.Timestamp,
					Severity:  AlertCritical,  // 🔴 CRITICAL - pod not ready is highest priority
					Source:    "pod",
					NodeName:  current.NodeName,
					PodName:   pod.Name,
					Namespace: pod.Namespace,
					Message:   fmt.Sprintf("Pod %s/%s is NOT READY (phase: %s)", pod.Namespace, pod.Name, pod.Phase),
					Details: map[string]interface{}{
						"phase": pod.Phase,
						"ready": pod.Ready,
					},
				}
				storeAlert(alertID, alert)
				alerts = append(alerts, alert)
			}

			// CRITICAL: Alert on any pod not in Running phase (except Succeeded)
			if pod.Phase != "Running" && pod.Phase != "Succeeded" {
				alertID := "pod:" + nodeKey + ":" + podKey + ":badphase"
				alert := HealthAlert{
					Timestamp: current.Timestamp,
					Severity:  AlertCritical,  // 🔴 CRITICAL - non-running phases are unhealthy
					Source:    "pod",
					NodeName:  current.NodeName,
					PodName:   pod.Name,
					Namespace: pod.Namespace,
					Message:   fmt.Sprintf("Pod %s/%s is in %s state (unhealthy)", pod.Namespace, pod.Name, pod.Phase),
					Details: map[string]interface{}{
						"phase":         pod.Phase,
						"ready":         pod.Ready,
						"restart_count": pod.RestartCount,
					},
				}
				storeAlert(alertID, alert)
				alerts = append(alerts, alert)
			}
		}
	}

	// Update previous state
	previousHealthMu.Lock()
	previousNodeHealth[nodeKey] = current
	previousHealthMu.Unlock()

	// Log alert count for debugging
	if len(alerts) > 0 {
		log.Printf("[Alerts] Generated %d alerts for node %s", len(alerts), nodeKey)
	}

	return alerts
}

func storeAlert(alertID string, alert HealthAlert) {
	activeAlertsMu.Lock()
	activeAlerts[alertID] = alert
	activeAlertsMu.Unlock()
}

func broadcastAlert(alert HealthAlert) {
	log.Printf("[API] Alert [%s]: %s - %s", alert.Severity, alert.Source, alert.Message)

	// Broadcast to WebSocket clients
	BroadcastMessage("node_health_alert", alert)

	// Broadcast across cluster
	comm.BroadcastMessage(comm.Message{
		Event:   "HEALTH_ALERT",
		Payload: map[string]any{"alert": alert},
	})
}

// handleTestAlert generates a test alert for debugging (GET /api/test-alert)
func handleTestAlert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	nodeName := r.URL.Query().Get("node")
	if nodeName == "" {
		nodeName = getLocalNodeName()
	}

	severity := r.URL.Query().Get("severity")
	if severity == "" {
		severity = "warning"
	}

	alertSeverity := AlertWarning
	if severity == "critical" {
		alertSeverity = AlertCritical
	} else if severity == "info" {
		alertSeverity = AlertInfo
	}

	testAlert := HealthAlert{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Severity:  alertSeverity,
		Source:    "test",
		NodeName:  nodeName,
		PodName:   "test-pod",
		Namespace: "default",
		Message:   fmt.Sprintf("Test alert generated at %s", time.Now().Format(time.RFC3339)),
		Details: map[string]interface{}{
			"test": true,
			"type": "manual",
		},
	}

	// Store and broadcast the test alert
	alertID := fmt.Sprintf("test:alert:%d", time.Now().Unix())
	storeAlert(alertID, testAlert)
	broadcastAlert(testAlert)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "success",
		"alert":  testAlert,
	})

	log.Printf("[API] Test alert generated: %s", testAlert.Message)
}

// handleWebSocketNodeHealth handles WebSocket connections for node health
func handleWebSocketNodeHealth(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WebSocket] Upgrade error: %v", err)
		return
	}

	client := &Client{hub: hub, conn: conn, send: make(chan []byte, 256)}
	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}

// nodeHealthWebSocketBroadcaster broadcasts node health updates via WebSocket
func nodeHealthWebSocketBroadcaster() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	log.Printf("[WebSocket] Starting node health broadcaster")

	for range ticker.C {
		// Only broadcast if there are connected clients
		if hub == nil {
			continue
		}

		hub.mu.RLock()
		hasClients := len(hub.clients) > 0
		hub.mu.RUnlock()

		if !hasClients {
			continue
		}

		// Gather node health
		clusterNodeHealthMu.RLock()
		resp := ClusterNodeHealthResponse{
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Nodes:     make(map[string]NodeHealthUpdate, len(clusterNodeHealth)),
		}
		for node, health := range clusterNodeHealth {
			resp.Nodes[node] = health
		}
		clusterNodeHealthMu.RUnlock()

		// Include active alerts
		activeAlertsMu.RLock()
		for _, alert := range activeAlerts {
			resp.Alerts = append(resp.Alerts, alert)
		}
		activeAlertsMu.RUnlock()

		BroadcastMessage("node_health", resp)
	}
}

func applyMetricsBasedHealthLevels(update *NodeHealthUpdate, metrics UnifiedMetricsResponse) {
	for i := range update.Pods {
		podKey := update.Pods[i].Namespace + "/" + update.Pods[i].Name
		healthy, score, reasons := evaluatePodHealthLevel(update.Pods[i], metrics.Pods[podKey])
		update.Pods[i].Healthy = healthy
		update.Pods[i].HealthScore = score
		update.Pods[i].HealthReasons = reasons
	}

	nodeHealthy, nodeScore, nodeReasons := evaluateNodeHealthLevel(*update, metrics.Node)
	update.Healthy = nodeHealthy
	update.HealthScore = nodeScore
	update.HealthReasons = nodeReasons
}

func evaluatePodHealthLevel(pod PodHealth, podMetrics map[string]interface{}) (bool, int, []string) {
	// Get current metrics configuration
	cfg := config.GetCurrentMetricsConfig()
	
	if pod.Phase == string(corev1.PodFailed) {
		return false, 0, []string{"pod phase is Failed"}
	}

	score := 100
	reasons := make([]string, 0, 8)

	if pod.Phase == string(corev1.PodPending) {
		score -= 20
		reasons = append(reasons, "pod phase is Pending")
	}
	if pod.Phase == string(corev1.PodUnknown) {
		score -= 40
		reasons = append(reasons, "pod phase is Unknown")
	}
	if pod.Phase == string(corev1.PodRunning) && !pod.Ready {
		score -= 35
		reasons = append(reasons, "pod is running but not Ready")
	}

	// Restart count - now using configurable thresholds
	switch {
	case pod.RestartCount >= cfg.RestartCountThreshold:
		score -= cfg.RestartCountPenalty
		reasons = append(reasons, fmt.Sprintf("high restart count: %d", pod.RestartCount))
	case pod.RestartCount >= cfg.RestartCountThreshold/2:
		score -= cfg.RestartCountPenalty / 2
		reasons = append(reasons, fmt.Sprintf("restart count elevated: %d", pod.RestartCount))
	}

	tcpMetrics := asMap(podMetrics["tcp_metrics"])
	if tcpMetrics != nil {
		retrans := asFloat64(tcpMetrics["retransmissions"])
		packetLoss := asFloat64(tcpMetrics["packet_loss"])
		badHandshakes := asFloat64(tcpMetrics["bad_handshakes"])

		// TCP Retransmissions - now using configurable thresholds
		switch {
		case retrans >= cfg.TCPRetransThreshold:
			score -= cfg.TCPRetransPenalty
			reasons = append(reasons, fmt.Sprintf("high retransmissions: %.0f", retrans))
		case retrans >= cfg.TCPRetransThreshold/5:
			score -= cfg.TCPRetransPenalty / 2
			reasons = append(reasons, fmt.Sprintf("retransmissions elevated: %.0f", retrans))
		}

		// Packet Loss - now using configurable thresholds
		switch {
		case packetLoss >= cfg.PacketLossThreshold:
			score -= cfg.PacketLossPenalty
			reasons = append(reasons, fmt.Sprintf("high packet loss: %.0f", packetLoss))
		case packetLoss >= cfg.PacketLossThreshold/4:
			score -= cfg.PacketLossPenalty / 2
			reasons = append(reasons, fmt.Sprintf("packet loss elevated: %.0f", packetLoss))
		}

		switch {
		case badHandshakes >= 5:
			score -= 15
			reasons = append(reasons, fmt.Sprintf("bad handshakes high: %.0f", badHandshakes))
		case badHandshakes > 0:
			score -= 8
			reasons = append(reasons, fmt.Sprintf("bad handshakes detected: %.0f", badHandshakes))
		}
	}

	dnsMetrics := asMap(podMetrics["dns_latency"])
	if dnsMetrics != nil {
		avgDNSNs := asFloat64(dnsMetrics["avg_latency_ns"])
		avgDNSMs := avgDNSNs / 1_000_000 // Convert to milliseconds
		
		// DNS Latency - now using configurable thresholds
		switch {
		case avgDNSMs >= cfg.DNSLatencyThreshold*5:
			score -= cfg.DNSLatencyPenalty
			reasons = append(reasons, fmt.Sprintf("dns latency high: %.1fms", avgDNSMs))
		case avgDNSMs >= cfg.DNSLatencyThreshold:
			score -= cfg.DNSLatencyPenalty / 2
			reasons = append(reasons, fmt.Sprintf("dns latency elevated: %.1fms", avgDNSMs))
		}
	}

	rttMetrics := asMap(podMetrics["rtt"])
	if rttMetrics != nil {
		avgRTTNs := asFloat64(rttMetrics["avg_rtt_ns"])
		avgRTTMs := avgRTTNs / 1_000_000 // Convert to milliseconds
		
		// RTT - now using configurable thresholds
		switch {
		case avgRTTMs >= cfg.RTTThreshold:
			score -= cfg.RTTPenalty
			reasons = append(reasons, fmt.Sprintf("rtt high: %.1fms", avgRTTMs))
		case avgRTTMs >= cfg.RTTThreshold/4:
			score -= cfg.RTTPenalty / 2
			reasons = append(reasons, fmt.Sprintf("rtt elevated: %.1fms", avgRTTMs))
		}
	}

	schedMetrics := asMap(podMetrics["sched_latency"])
	if schedMetrics != nil {
		avgRunqueueUs := asFloat64(schedMetrics["avg_runqueue_latency_us"])
		starvationCount := asFloat64(schedMetrics["cpu_starvation_count"])
		switch {
		case avgRunqueueUs >= 15_000:
			score -= 20
			reasons = append(reasons, fmt.Sprintf("runqueue latency high: %.0fus", avgRunqueueUs))
		case avgRunqueueUs >= 5_000:
			score -= 10
			reasons = append(reasons, fmt.Sprintf("runqueue latency elevated: %.0fus", avgRunqueueUs))
		}
		if starvationCount >= 5 {
			score -= 15
			reasons = append(reasons, fmt.Sprintf("cpu starvation events high: %.0f", starvationCount))
		} else if starvationCount > 0 {
			score -= 8
			reasons = append(reasons, fmt.Sprintf("cpu starvation events detected: %.0f", starvationCount))
		}
	}

	diskIOMetrics := asMap(podMetrics["disk_io"])
	if diskIOMetrics != nil {
		avgIOLatencyNs := asFloat64(diskIOMetrics["avg_io_latency_ns"])
		switch {
		case avgIOLatencyNs >= 200_000_000: // 200ms
			score -= 15
			reasons = append(reasons, fmt.Sprintf("disk I/O latency high: %.1fms", avgIOLatencyNs/1_000_000))
		case avgIOLatencyNs >= 50_000_000: // 50ms
			score -= 8
			reasons = append(reasons, fmt.Sprintf("disk I/O latency elevated: %.1fms", avgIOLatencyNs/1_000_000))
		}
	}

	// HEALTHY = Kubernetes API status ONLY (Running + Ready)
	// Score and metrics are used ONLY for alerts and informational purposes
	healthy := pod.Phase == string(corev1.PodRunning) && pod.Ready
	return healthy, clampScore(score), reasons
}

func evaluateNodeHealthLevel(update NodeHealthUpdate, nodeMetrics map[string]interface{}) (bool, int, []string) {
	if update.Error != "" {
		return false, 0, []string{fmt.Sprintf("node error: %s", update.Error)}
	}

	score := 100
	reasons := make([]string, 0, 8)

	if update.TotalPods > 0 {
		unhealthyRatio := float64(update.UnhealthyPods) / float64(update.TotalPods)
		switch {
		case update.UnhealthyPods >= 3 || unhealthyRatio >= 0.30:
			score -= 40
			reasons = append(reasons, fmt.Sprintf("unhealthy pods high: %d/%d", update.UnhealthyPods, update.TotalPods))
		case update.UnhealthyPods > 0:
			score -= 20
			reasons = append(reasons, fmt.Sprintf("unhealthy pods detected: %d/%d", update.UnhealthyPods, update.TotalPods))
		}

		if update.UnknownPods > 0 {
			score -= 8
			reasons = append(reasons, fmt.Sprintf("pods in unknown state: %d", update.UnknownPods))
		}
	}

	nodeSystem := asMap(nodeMetrics["node_system"])
	if nodeSystem != nil {
		cpuUsage := asFloat64(nodeSystem["cpu_usage_percent"])
		memUsage := asFloat64(nodeSystem["memory_usage_percent"])

		switch {
		case cpuUsage >= 92:
			score -= 25
			reasons = append(reasons, fmt.Sprintf("cpu usage high: %.1f%%", cpuUsage))
		case cpuUsage >= 80:
			score -= 12
			reasons = append(reasons, fmt.Sprintf("cpu usage elevated: %.1f%%", cpuUsage))
		}

		switch {
		case memUsage >= 95:
			score -= 25
			reasons = append(reasons, fmt.Sprintf("memory usage high: %.1f%%", memUsage))
		case memUsage >= 85:
			score -= 12
			reasons = append(reasons, fmt.Sprintf("memory usage elevated: %.1f%%", memUsage))
		}
	}

	nodeTCP := asMap(nodeMetrics["tcp_metrics"])
	if nodeTCP != nil {
		retrans := asFloat64(nodeTCP["retransmissions"])
		packetLoss := asFloat64(nodeTCP["packet_loss"])

		if retrans >= 100 {
			score -= 15
			reasons = append(reasons, fmt.Sprintf("node retransmissions high: %.0f", retrans))
		}
		if packetLoss >= 20 {
			score -= 15
			reasons = append(reasons, fmt.Sprintf("node packet loss high: %.0f", packetLoss))
		}
	}

	nodeSched := asMap(nodeMetrics["sched_latency"])
	if nodeSched != nil {
		avgRunqueueUs := asFloat64(nodeSched["avg_runqueue_latency_us"])
		starvationCount := asFloat64(nodeSched["cpu_starvation_count"])

		if avgRunqueueUs >= 15_000 {
			score -= 15
			reasons = append(reasons, fmt.Sprintf("node runqueue latency high: %.0fus", avgRunqueueUs))
		}
		if starvationCount >= 10 {
			score -= 15
			reasons = append(reasons, fmt.Sprintf("node CPU starvation high: %.0f", starvationCount))
		}
	}

	// HEALTHY = Node has no unhealthy pods (based on Kubernetes API)
	// Score and metrics are used ONLY for alerts and informational purposes
	healthy := update.Status != "unhealthy"
	return healthy, clampScore(score), reasons
}

// levelFromScore removed - now using boolean health (healthy = Kubernetes status only)

func clampScore(score int) int {
	switch {
	case score < 0:
		return 0
	case score > 100:
		return 100
	default:
		return score
	}
}

// contains checks if a string contains a substring
func contains(s, substr string) bool {
	return strings.Contains(s, substr)
}


func asMap(v interface{}) map[string]interface{} {
	if v == nil {
		return nil
	}
	if m, ok := v.(map[string]interface{}); ok {
		return m
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		return nil
	}
	return out
}

func asFloat64(v interface{}) float64 {
	switch value := v.(type) {
	case float64:
		return value
	case float32:
		return float64(value)
	case int:
		return float64(value)
	case int32:
		return float64(value)
	case int64:
		return float64(value)
	case uint:
		return float64(value)
	case uint32:
		return float64(value)
	case uint64:
		return float64(value)
	default:
		return 0
	}
}
