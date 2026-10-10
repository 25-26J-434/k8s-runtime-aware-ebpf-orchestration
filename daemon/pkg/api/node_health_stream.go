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
	"sync/atomic"
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
	ID         string        `json:"id"`
	State      string        `json:"state"`     // "firing" or "resolved"
	Timestamp  string        `json:"timestamp"` // first seen
	LastSeen   string        `json:"last_seen,omitempty"`
	ResolvedAt string        `json:"resolved_at,omitempty"`
	Severity   AlertSeverity `json:"severity"`
	Source     string        `json:"source"` // "node" or "pod"
	NodeName   string        `json:"node_name"`
	PodName    string        `json:"pod_name,omitempty"`
	Namespace  string        `json:"namespace,omitempty"`
	Message    string        `json:"message"`
	Details    interface{}   `json:"details,omitempty"`
}

type PodHealth struct {
	Name          string   `json:"name"`
	Namespace     string   `json:"namespace"`
	Node          string   `json:"node"`
	Phase         string   `json:"phase"`
	Ready         bool     `json:"ready"`
	RestartCount  int32    `json:"restart_count"`
	Healthy       bool     `json:"healthy"`      // true = healthy, false = unhealthy
	HealthScore   int      `json:"health_score"` // 0 is a valid (worst) score
	HealthReasons []string `json:"health_reasons,omitempty"`
}

type NodeHealthUpdate struct {
	Timestamp     string      `json:"timestamp"`
	NodeName      string      `json:"node_name"`
	NodeIP        string      `json:"node_ip,omitempty"`
	Status        string      `json:"status"`
	Healthy       bool        `json:"healthy"`      // true = healthy, false = unhealthy
	HealthScore   int         `json:"health_score"` // 0 is a valid (worst) score
	HealthReasons []string    `json:"health_reasons,omitempty"`
	TotalPods     int         `json:"total_pods"`
	HealthyPods   int         `json:"healthy_pods"`
	UnhealthyPods int         `json:"unhealthy_pods"`
	UnknownPods   int         `json:"unknown_pods"`
	Pods          []PodHealth `json:"pods"`
	Error         string      `json:"error,omitempty"`

	// Set by the receiving daemon, never trusted from the sender.
	LastSeen   string `json:"last_seen,omitempty"` // when this daemon last heard from the node
	AgeSeconds int    `json:"age_seconds"`         // seconds since LastSeen
	Freshness  string `json:"freshness,omitempty"` // "live", "stale" or "offline"
}

type ClusterHealthSummary struct {
	NodesLive      int `json:"nodes_live"`
	NodesStale     int `json:"nodes_stale"`
	NodesOffline   int `json:"nodes_offline"`
	CriticalAlerts int `json:"critical_alerts"`
	WarningAlerts  int `json:"warning_alerts"`
	InfoAlerts     int `json:"info_alerts"`
}

type ClusterNodeHealthResponse struct {
	Timestamp string                      `json:"timestamp"`
	Seq       uint64                      `json:"seq"`
	Summary   ClusterHealthSummary        `json:"summary"`
	Nodes     map[string]NodeHealthUpdate `json:"nodes"`
	Alerts    []HealthAlert               `json:"alerts"`
}

var (
	nodeHealthStreamOnce sync.Once

	clusterNodeHealthMu sync.RWMutex
	clusterNodeHealth   = make(map[string]NodeHealthUpdate)

	// Track previous health state to detect changes
	previousNodeHealth = make(map[string]NodeHealthUpdate)
	previousHealthMu   sync.RWMutex

	// healthVersion increments whenever the cluster health snapshot changes.
	healthVersion atomic.Uint64
)

const (
	// Peers broadcast every nodeHealthBroadcastInterval; allow a few missed beats.
	nodeStaleAfter   = 3 * nodeHealthBroadcastInterval
	nodeOfflineAfter = 6 * nodeHealthBroadcastInterval
	nodePruneAfter   = 10 * time.Minute
)

func bumpHealthVersion() { healthVersion.Add(1) }

func initNodeHealthStreaming() {
	nodeHealthStreamOnce.Do(func() {
		comm.RegisterMessageHandler(comm.EventNodeHealth, handleRemoteNodeHealthUpdate)
		http.HandleFunc("/api/cluster/node-health", corsMiddleware(handleClusterNodeHealth))
		http.HandleFunc("/ws/node-health", corsMiddleware(handleWebSocketNodeHealth))
		http.HandleFunc("/api/cluster/health-alerts", corsMiddleware(handleHealthAlertHistory))
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

	storeNodeHealth(nodeKey, health)
	dispatchAlertChanges(detectHealthAlerts(nodeKey, health))

	// Peers evaluate alerts themselves from this report, so only the state is sent.
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
		case isPodHealthy(pod) || pod.Status.Phase == corev1.PodSucceeded:
			update.HealthyPods++ // completed Jobs are not a problem
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
	dispatchAlertChanges(detectHealthAlerts(nodeKey, update))
}

func storeNodeHealth(nodeKey string, update NodeHealthUpdate) {
	update.LastSeen = time.Now().UTC().Format(time.RFC3339)
	update.AgeSeconds = 0
	update.Freshness = "live"
	clusterNodeHealthMu.Lock()
	clusterNodeHealth[nodeKey] = update
	clusterNodeHealthMu.Unlock()
	bumpHealthVersion()
}

func freshnessForAge(age time.Duration) string {
	switch {
	case age >= nodeOfflineAfter:
		return "offline"
	case age >= nodeStaleAfter:
		return "stale"
	default:
		return "live"
	}
}

// sweepNodeFreshness re-evaluates how recently each node was heard from. Nodes that went
// offline raise a critical alert, nodes that stay offline too long are pruned. It returns
// whether any node changed freshness state.
func sweepNodeFreshness() bool {
	now := time.Now().UTC()
	localKey := getLocalNodeName()
	changed := false
	type offlineNode struct {
		key string
		h   NodeHealthUpdate
	}
	var offline []offlineNode
	var pruned []string

	clusterNodeHealthMu.Lock()
	for key, h := range clusterNodeHealth {
		if key == localKey {
			continue
		}
		seen, err := time.Parse(time.RFC3339, h.LastSeen)
		if err != nil {
			continue
		}
		age := now.Sub(seen)
		if age >= nodePruneAfter {
			delete(clusterNodeHealth, key)
			pruned = append(pruned, key)
			changed = true
			continue
		}
		if f := freshnessForAge(age); f != h.Freshness {
			h.Freshness = f
			clusterNodeHealth[key] = h
			changed = true
		}
		if h.Freshness == "offline" {
			offline = append(offline, offlineNode{key, h})
		}
	}
	clusterNodeHealthMu.Unlock()

	for _, key := range pruned {
		previousHealthMu.Lock()
		delete(previousNodeHealth, key)
		previousHealthMu.Unlock()
		dispatchAlertChanges(nil, resolveNodeAlerts(key))
	}
	for _, o := range offline {
		key, h := o.key, o.h
		a := alertFor("node:"+key+":offline", AlertCritical, "node", h,
			fmt.Sprintf("Node %s stopped reporting (last seen %s)", key, h.LastSeen),
			map[string]interface{}{"last_seen": h.LastSeen})
		fired, resolved := reconcileNodeAlerts(key, []HealthAlert{a}, nil)
		dispatchAlertChanges(fired, resolved)
	}
	return changed
}

// buildClusterHealthResponse assembles the snapshot served over REST and WebSocket.
func buildClusterHealthResponse() ClusterNodeHealthResponse {
	now := time.Now().UTC()
	resp := ClusterNodeHealthResponse{
		Timestamp: now.Format(time.RFC3339),
		Seq:       healthVersion.Load(),
	}

	clusterNodeHealthMu.RLock()
	resp.Nodes = make(map[string]NodeHealthUpdate, len(clusterNodeHealth))
	for key, h := range clusterNodeHealth {
		if seen, err := time.Parse(time.RFC3339, h.LastSeen); err == nil {
			age := now.Sub(seen)
			h.AgeSeconds = int(age.Seconds())
			h.Freshness = freshnessForAge(age)
		}
		switch h.Freshness {
		case "offline":
			resp.Summary.NodesOffline++
		case "stale":
			resp.Summary.NodesStale++
		default:
			resp.Summary.NodesLive++
		}
		resp.Nodes[key] = h
	}
	clusterNodeHealthMu.RUnlock()

	resp.Alerts = activeAlertsSnapshot()
	resp.Summary.CriticalAlerts, resp.Summary.WarningAlerts, resp.Summary.InfoAlerts = countAlertsBySeverity(resp.Alerts)
	return resp
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
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(buildClusterHealthResponse())
}

// alertFor builds a HealthAlert skeleton for a node-scoped condition.
func alertFor(id string, sev AlertSeverity, source string, current NodeHealthUpdate, msg string, details map[string]interface{}) HealthAlert {
	return HealthAlert{
		ID:       id,
		Severity: sev,
		Source:   source,
		NodeName: current.NodeName,
		Message:  msg,
		Details:  details,
	}
}

func podAlertFor(id string, sev AlertSeverity, current NodeHealthUpdate, pod PodHealth, msg string, details map[string]interface{}) HealthAlert {
	a := alertFor(id, sev, "pod", current, msg, details)
	a.PodName = pod.Name
	a.Namespace = pod.Namespace
	return a
}

// detectHealthAlerts evaluates a node report. Conditions that currently hold are
// level-triggered (they stay active until they clear, then resolve); restarts and
// disappeared pods are one-shot events with a TTL. Returns alerts that newly fired
// and alerts that resolved during this evaluation.
func detectHealthAlerts(nodeKey string, current NodeHealthUpdate) (fired, resolved []HealthAlert) {
	cfg := config.GetCurrentMetricsConfig()

	previousHealthMu.RLock()
	previous, hadPrevious := previousNodeHealth[nodeKey]
	previousHealthMu.RUnlock()

	var desired, events []HealthAlert
	nodeID := "node:" + nodeKey

	switch {
	case current.Error != "":
		desired = append(desired, alertFor(nodeID+":error", AlertCritical, "node", current,
			"Node is unavailable or experiencing errors", map[string]interface{}{"error": current.Error}))
	case current.Status == "unhealthy":
		desired = append(desired, alertFor(nodeID+":unhealthy", AlertCritical, "node", current,
			fmt.Sprintf("Node is unhealthy: %d of %d pods unhealthy", current.UnhealthyPods, current.TotalPods),
			map[string]interface{}{"unhealthy_pods": current.UnhealthyPods, "total_pods": current.TotalPods}))
	case current.Status == "degraded":
		desired = append(desired, alertFor(nodeID+":degraded", AlertWarning, "node", current,
			fmt.Sprintf("Node degraded: %d pods in unknown state", current.UnknownPods),
			map[string]interface{}{"unknown_pods": current.UnknownPods, "total_pods": current.TotalPods}))
	}

	for _, reason := range current.HealthReasons {
		if !isHighReason(reason) || strings.HasPrefix(reason, "unhealthy pods") || strings.HasPrefix(reason, "node error") {
			continue
		}
		desired = append(desired, alertFor(nodeID+":metric:"+slugify(reason), AlertWarning, "node", current,
			fmt.Sprintf("Node %s: %s", current.NodeName, reason), map[string]interface{}{"reason": reason}))
	}

	previousPods := make(map[string]PodHealth, len(previous.Pods))
	for _, p := range previous.Pods {
		previousPods[p.Namespace+"/"+p.Name] = p
	}
	currentPods := make(map[string]struct{}, len(current.Pods))

	for _, pod := range current.Pods {
		podKey := pod.Namespace + "/" + pod.Name
		currentPods[podKey] = struct{}{}
		id := "pod:" + nodeKey + ":" + podKey
		base := map[string]interface{}{"phase": pod.Phase, "ready": pod.Ready, "restart_count": pod.RestartCount}

		switch {
		case pod.Phase == "Failed":
			desired = append(desired, podAlertFor(id+":failed", AlertCritical, current, pod,
				fmt.Sprintf("Pod %s has failed", podKey), base))
		case pod.Phase == "Running" && !pod.Ready:
			desired = append(desired, podAlertFor(id+":notready", AlertCritical, current, pod,
				fmt.Sprintf("Pod %s is running but NOT READY", podKey), base))
		case pod.Phase == "Pending":
			desired = append(desired, podAlertFor(id+":pending", AlertWarning, current, pod,
				fmt.Sprintf("Pod %s is Pending", podKey), base))
		case pod.Phase == "Unknown":
			desired = append(desired, podAlertFor(id+":unknown", AlertCritical, current, pod,
				fmt.Sprintf("Pod %s is in Unknown state", podKey), base))
		}

		// Restarts are an event: first sight at/over threshold, or an increase at/over threshold.
		prevPod, existed := previousPods[podKey]
		if pod.RestartCount >= cfg.RestartCountThreshold &&
			((hadPrevious && existed && pod.RestartCount > prevPod.RestartCount) || !hadPrevious) {
			events = append(events, podAlertFor(id+":restarts", AlertWarning, current, pod,
				fmt.Sprintf("Pod %s has high restart count: %d", podKey, pod.RestartCount), base))
		}

		for _, reason := range pod.HealthReasons {
			if !isHighReason(reason) || strings.Contains(reason, "restart") {
				continue
			}
			desired = append(desired, podAlertFor(id+":metric:"+slugify(reason), AlertWarning, current, pod,
				fmt.Sprintf("Pod %s: %s", podKey, reason), map[string]interface{}{"reason": reason, "phase": pod.Phase, "ready": pod.Ready}))
		}
	}

	if hadPrevious {
		for podKey, prevPod := range previousPods {
			if _, ok := currentPods[podKey]; !ok && prevPod.Ready {
				events = append(events, podAlertFor("pod:"+nodeKey+":"+podKey+":disappeared", AlertWarning, current, prevPod,
					fmt.Sprintf("Pod %s disappeared from node", podKey), nil))
			}
		}
	}

	previousHealthMu.Lock()
	previousNodeHealth[nodeKey] = current
	previousHealthMu.Unlock()

	fired, resolved = reconcileNodeAlerts(nodeKey, desired, events)
	if len(fired) > 0 || len(resolved) > 0 {
		bumpHealthVersion()
		log.Printf("[Alerts] node %s: %d fired, %d resolved", nodeKey, len(fired), len(resolved))
	}
	return fired, resolved
}

// isHighReason reports whether a health reason denotes a high (alert-worthy) condition
// rather than an elevated (informational) one.
func isHighReason(reason string) bool {
	r := strings.ToLower(reason)
	return strings.Contains(r, " high") || strings.HasPrefix(r, "high ")
}

func broadcastAlert(alert HealthAlert) {
	log.Printf("[API] Alert [%s]: %s - %s", alert.Severity, alert.Source, alert.Message)
	BroadcastMessage("node_health_alert", alert)
}

func broadcastAlertResolved(alert HealthAlert) {
	BroadcastMessage("node_health_alert_resolved", alert)
}

func dispatchAlertChanges(fired, resolved []HealthAlert) {
	for _, a := range fired {
		broadcastAlert(a)
	}
	for _, a := range resolved {
		broadcastAlertResolved(a)
	}
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

	alertSeverity := AlertWarning
	switch r.URL.Query().Get("severity") {
	case "critical":
		alertSeverity = AlertCritical
	case "info":
		alertSeverity = AlertInfo
	}

	now := time.Now()
	testAlert := addManualAlert(HealthAlert{
		ID:        fmt.Sprintf("test:alert:%d", now.UnixNano()),
		Severity:  alertSeverity,
		Source:    "test",
		NodeName:  nodeName,
		PodName:   "test-pod",
		Namespace: "default",
		Message:   fmt.Sprintf("Test alert generated at %s", now.Format(time.RFC3339)),
		Details:   map[string]interface{}{"test": true, "type": "manual"},
	})
	bumpHealthVersion()
	broadcastAlert(testAlert)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "alert": testAlert})
}

// handleHealthAlertHistory serves recent alert events (GET /api/cluster/health-alerts).
func handleHealthAlertHistory(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"active":    activeAlertsSnapshot(),
		"history":   alertHistorySnapshot(),
	})
}

// handleWebSocketNodeHealth handles WebSocket connections for node health.
// The current snapshot is queued before registration so the first frame arrives immediately.
func handleWebSocketNodeHealth(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WebSocket] Upgrade error: %v", err)
		return
	}

	client := &Client{hub: hub, conn: conn, send: make(chan []byte, 256)}
	if snapshot, err := json.Marshal(map[string]interface{}{"type": "node_health", "data": buildClusterHealthResponse()}); err == nil {
		client.send <- snapshot
	}
	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}

// nodeHealthWebSocketBroadcaster pushes the cluster health snapshot whenever it changes,
// with a periodic heartbeat so clients can detect a silent connection.
func nodeHealthWebSocketBroadcaster() {
	const heartbeat = 10 * time.Second
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	log.Printf("[WebSocket] Starting node health broadcaster")

	var lastVersion uint64
	lastSent := time.Time{}

	for range ticker.C {
		if hub == nil {
			continue
		}

		changed := sweepNodeFreshness()
		if expired := expireEventAlerts(); len(expired) > 0 {
			dispatchAlertChanges(nil, expired)
			changed = true
		}
		if changed {
			bumpHealthVersion()
		}

		hub.mu.RLock()
		hasClients := len(hub.clients) > 0
		hub.mu.RUnlock()
		if !hasClients {
			continue
		}

		version := healthVersion.Load()
		if version == lastVersion && time.Since(lastSent) < heartbeat {
			continue
		}
		lastVersion, lastSent = version, time.Now()
		BroadcastMessage("node_health", buildClusterHealthResponse())
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
	if pod.Phase == string(corev1.PodSucceeded) {
		return true, 100, nil // completed Job
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
