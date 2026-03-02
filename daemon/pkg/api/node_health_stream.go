package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/comm"
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
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	Node         string `json:"node"`
	Phase        string `json:"phase"`
	Ready        bool   `json:"ready"`
	RestartCount int32  `json:"restart_count"`
}

type NodeHealthUpdate struct {
	Timestamp     string      `json:"timestamp"`
	NodeName      string      `json:"node_name"`
	NodeIP        string      `json:"node_ip,omitempty"`
	Status        string      `json:"status"`
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
		Ready:        isPodReady(pod),
		RestartCount: restartCount,
	}
}

func isPodReady(pod corev1.Pod) bool {
	for _, condition := range pod.Status.Conditions {
		if condition.Type == corev1.PodReady {
			return condition.Status == corev1.ConditionTrue
		}
	}
	return false
}

func isPodHealthy(pod corev1.Pod) bool {
	return pod.Status.Phase == corev1.PodRunning && isPodReady(pod)
}

func isPodUnhealthy(pod corev1.Pod) bool {
	if pod.Status.Phase == corev1.PodFailed {
		return true
	}
	if pod.Status.Phase == corev1.PodRunning && !isPodReady(pod) {
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

			// Pod became unhealthy
			if existed && prevPod.Ready && !pod.Ready {
				alertID := "pod:" + nodeKey + ":" + podKey
				alert := HealthAlert{
					Timestamp: current.Timestamp,
					Severity:  AlertWarning,
					Source:    "pod",
					NodeName:  current.NodeName,
					PodName:   pod.Name,
					Namespace: pod.Namespace,
					Message:   fmt.Sprintf("Pod %s/%s became unhealthy", pod.Namespace, pod.Name),
					Details: map[string]interface{}{
						"phase":         pod.Phase,
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
			if existed && pod.RestartCount > prevPod.RestartCount && pod.RestartCount >= 5 {
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
	}

	// Update previous state
	previousHealthMu.Lock()
	previousNodeHealth[nodeKey] = current
	previousHealthMu.Unlock()

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

