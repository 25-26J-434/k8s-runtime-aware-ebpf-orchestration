package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/comm"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

const (
	metricsBroadcastInterval = 5 * time.Second
	wsWriteTimeout           = 5 * time.Second
	wsPongWait               = 60 * time.Second
	subscribeAll             = "all"
)

// clientSubscription tracks what metrics a client wants to receive.
type clientSubscription struct {
	conn         *websocket.Conn
	writeMu      *sync.Mutex
	nodeFilter   string
	subscribedAt time.Time
}

// subscriptionMessage is sent by clients to change their subscription.
type subscriptionMessage struct {
	Action string `json:"action"`
	Node   string `json:"node"`
}

type clusterSnapshotMessage struct {
	Type  string                            `json:"type"`
	Nodes map[string]UnifiedMetricsResponse `json:"nodes"`
}

type clusterNodeUpdateMessage struct {
	Type    string                 `json:"type"`
	Node    string                 `json:"node"`
	Metrics UnifiedMetricsResponse `json:"metrics"`
}

var (
	metricsStreamOnce sync.Once

	wsUpgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(_ *http.Request) bool {
			return true
		},
	}

	clientsMu           sync.RWMutex
	clientSubscriptions = make(map[*websocket.Conn]*clientSubscription)

	clusterMetricsMu sync.RWMutex
	clusterMetrics   = make(map[string]UnifiedMetricsResponse)
)

func initMetricsStreaming() {
	metricsStreamOnce.Do(func() {
		http.HandleFunc("/api/metrics/ws", corsMiddleware(metricsWebSocketHandler))
		comm.RegisterMessageHandler(comm.EventMetricUpdate, handleRemoteMetricUpdate)
		go metricsBroadcastLoop()
	})
}

func metricsBroadcastLoop() {
	publishLocalMetrics()

	ticker := time.NewTicker(metricsBroadcastInterval)
	defer ticker.Stop()

	for range ticker.C {
		publishLocalMetrics()
	}
}

func publishLocalMetrics() {
	metrics := buildUnifiedMetricsResponse("", "")
	nodeKey := metricsNodeKey(metrics)
	if nodeKey == "" {
		log.Printf("[API] Skipping local metrics broadcast: missing node identifier")
		return
	}

	if metrics.Health == nil {
		localHealth := collectLocalNodeHealth()
		healthCopy := localHealth
		metrics.Health = &healthCopy

		healthKey := localHealth.NodeName
		if healthKey == "" {
			healthKey = localHealth.NodeIP
		}
		if healthKey != "" {
			storeNodeHealth(healthKey, localHealth)
		}
	}

	storeClusterMetrics(nodeKey, metrics)
	broadcastClusterUpdate(nodeKey, metrics)

	comm.BroadcastMessage(comm.Message{
		Event:   comm.EventMetricUpdate,
		Payload: map[string]any{"metrics": metrics},
	})
}

func handleRemoteMetricUpdate(msg comm.Message) {
	payload, ok := msg.Payload["metrics"]
	if !ok || payload == nil {
		return
	}

	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[API] Failed to marshal remote metrics payload: %v", err)
		return
	}

	var metrics UnifiedMetricsResponse
	if err := json.Unmarshal(data, &metrics); err != nil {
		log.Printf("[API] Failed to decode remote metrics payload: %v", err)
		return
	}

	nodeKey := metricsNodeKey(metrics)
	if nodeKey == "" {
		nodeKey = msg.Sender
		if nodeKey == "" {
			nodeKey = msg.SenderIP
		}
	}
	if nodeKey == "" {
		log.Printf("[API] Received metrics update without identifiable node")
		return
	}

	if metrics.Health == nil {
		if health, ok := getNodeHealthForMetrics(metrics.NodeName, metrics.NodeIP, nodeKey); ok {
			healthCopy := health
			metrics.Health = &healthCopy
		}
	}

	storeClusterMetrics(nodeKey, metrics)
	broadcastClusterUpdate(nodeKey, metrics)
}

func metricsWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[API] Failed to upgrade metrics websocket: %v", err)
		return
	}

	nodeFilter := r.URL.Query().Get("node")
	if nodeFilter == "" {
		nodeFilter = subscribeAll
	}

	sub := addClient(conn, nodeFilter)
	log.Printf("[API] WebSocket client connected, subscribed to node: %s", nodeFilter)

	if err := sendClusterSnapshot(conn, sub.nodeFilter); err != nil {
		log.Printf("[API] Failed to send cluster snapshot: %v", err)
		removeClient(conn)
		return
	}

	go readPump(conn)
}

func addClient(conn *websocket.Conn, nodeFilter string) *clientSubscription {
	if nodeFilter == "" {
		nodeFilter = subscribeAll
	}

	sub := &clientSubscription{
		conn:         conn,
		writeMu:      &sync.Mutex{},
		nodeFilter:   nodeFilter,
		subscribedAt: time.Now(),
	}

	clientsMu.Lock()
	clientSubscriptions[conn] = sub
	clientsMu.Unlock()

	return sub
}

func removeClient(conn *websocket.Conn) {
	clientsMu.Lock()
	delete(clientSubscriptions, conn)
	clientsMu.Unlock()

	_ = conn.Close()
}

func readPump(conn *websocket.Conn) {
	defer removeClient(conn)

	conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(wsPongWait))
		return nil
	})

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[API] Metrics websocket closed unexpectedly: %v", err)
			}
			break
		}

		var subMsg subscriptionMessage
		if err := json.Unmarshal(message, &subMsg); err != nil {
			log.Printf("[API] Failed to parse subscription message: %v", err)
			continue
		}

		if subMsg.Action == "subscribe" {
			updateClientSubscription(conn, subMsg.Node)
		}
	}
}

func updateClientSubscription(conn *websocket.Conn, nodeFilter string) {
	if nodeFilter == "" {
		nodeFilter = subscribeAll
	}

	clientsMu.Lock()
	if sub, ok := clientSubscriptions[conn]; ok {
		oldFilter := sub.nodeFilter
		sub.nodeFilter = nodeFilter
		log.Printf("[API] Client subscription updated from '%s' to '%s'", oldFilter, nodeFilter)
	}
	clientsMu.Unlock()

	if err := sendClusterSnapshot(conn, nodeFilter); err != nil {
		log.Printf("[API] Failed to send snapshot after subscription update: %v", err)
	}
}

func sendClusterSnapshot(conn *websocket.Conn, nodeFilter string) error {
	clientsMu.RLock()
	sub := clientSubscriptions[conn]
	clientsMu.RUnlock()

	if sub == nil {
		return errors.New("no subscription found for connection")
	}

	if nodeFilter == "" {
		nodeFilter = sub.nodeFilter
	}

	clusterMetricsMu.RLock()
	snapshot := make(map[string]UnifiedMetricsResponse)
	if nodeFilter == subscribeAll {
		for node, metrics := range clusterMetrics {
			snapshot[node] = metrics
		}
	} else {
		if metrics, ok := clusterMetrics[nodeFilter]; ok {
			snapshot[nodeFilter] = metrics
		}
	}
	clusterMetricsMu.RUnlock()

	message := clusterSnapshotMessage{
		Type:  "snapshot",
		Nodes: snapshot,
	}

	sub.writeMu.Lock()
	defer sub.writeMu.Unlock()

	conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
	return conn.WriteJSON(message)
}

func broadcastClusterUpdate(nodeKey string, metrics UnifiedMetricsResponse) {
	clientsMu.RLock()
	subs := make([]*clientSubscription, 0, len(clientSubscriptions))
	for _, sub := range clientSubscriptions {
		subs = append(subs, sub)
	}
	clientsMu.RUnlock()

	if len(subs) == 0 {
		return
	}

	message := clusterNodeUpdateMessage{
		Type:    "node_update",
		Node:    nodeKey,
		Metrics: metrics,
	}

	for _, sub := range subs {
		if sub.nodeFilter != subscribeAll && sub.nodeFilter != nodeKey {
			continue
		}

		sub.writeMu.Lock()
		sub.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
		if err := sub.conn.WriteJSON(message); err != nil {
			sub.writeMu.Unlock()
			log.Printf("[API] Failed to write to metrics websocket: %v", err)
			removeClient(sub.conn)
			continue
		}
		sub.writeMu.Unlock()
	}
}

func storeClusterMetrics(nodeKey string, metrics UnifiedMetricsResponse) {
	clusterMetricsMu.Lock()
	clusterMetrics[nodeKey] = metrics
	clusterMetricsMu.Unlock()

	storeClusterPodMetrics(metrics)
}

func storeClusterPodMetrics(metrics UnifiedMetricsResponse) {
	if len(metrics.Pods) == 0 {
		return
	}

	for podKey, metricMap := range metrics.Pods {
		for metricName, value := range metricMap {
			telemetry.StoreClusterPodMetric(podKey, telemetry.MetricType(metricName), metrics.NodeName, value)
		}
	}
}

func metricsNodeKey(metrics UnifiedMetricsResponse) string {
	if metrics.NodeName != "" && metrics.NodeName != "unknown" {
		return metrics.NodeName
	}
	if metrics.NodeIP != "" {
		return metrics.NodeIP
	}
	if metrics.NodeName != "" {
		return metrics.NodeName
	}
	return ""
}
