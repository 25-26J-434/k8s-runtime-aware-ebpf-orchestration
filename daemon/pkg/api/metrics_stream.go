package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/comm"
)

const (
	metricsBroadcastInterval = 5 * time.Second
	wsWriteTimeout           = 5 * time.Second
	wsPongWait               = 60 * time.Second
)

var (
	metricsStreamOnce sync.Once

	wsUpgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(_ *http.Request) bool {
			return true
		},
	}

	clientsMu sync.RWMutex
	clients   = make(map[*websocket.Conn]struct{})

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

	storeClusterMetrics(nodeKey, metrics)
	broadcastClusterUpdate(nodeKey, metrics)
}

func metricsWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[API] Failed to upgrade metrics websocket: %v", err)
		return
	}

	addClient(conn)

	if err := sendClusterSnapshot(conn); err != nil {
		log.Printf("[API] Failed to send metrics snapshot: %v", err)
	}

	go readPump(conn)
}

func addClient(conn *websocket.Conn) {
	clientsMu.Lock()
	clients[conn] = struct{}{}
	clientsMu.Unlock()
}

func sendClusterSnapshot(conn *websocket.Conn) error {
	clusterMetricsMu.RLock()
	snapshot := make(map[string]UnifiedMetricsResponse, len(clusterMetrics))
	for node, metrics := range clusterMetrics {
		snapshot[node] = metrics
	}
	clusterMetricsMu.RUnlock()

	message := struct {
		Type  string                            `json:"type"`
		Nodes map[string]UnifiedMetricsResponse `json:"nodes"`
	}{
		Type:  "snapshot",
		Nodes: snapshot,
	}

	conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
	return conn.WriteJSON(message)
}

func readPump(conn *websocket.Conn) {
	defer removeClient(conn)

	conn.SetReadLimit(1 << 20)
	conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(wsPongWait))
		return nil
	})

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[API] Metrics websocket closed unexpectedly: %v", err)
			}
			break
		}
	}
}

func removeClient(conn *websocket.Conn) {
	clientsMu.Lock()
	delete(clients, conn)
	clientsMu.Unlock()
	conn.Close()
}

func broadcastClusterUpdate(nodeKey string, metrics UnifiedMetricsResponse) {
	message := struct {
		Type    string                 `json:"type"`
		Node    string                 `json:"node"`
		Metrics UnifiedMetricsResponse `json:"metrics"`
	}{
		Type:    "node_update",
		Node:    nodeKey,
		Metrics: metrics,
	}

	broadcastToClients(message)
}

func broadcastToClients(message interface{}) {
	clientsMu.RLock()
	conns := make([]*websocket.Conn, 0, len(clients))
	for conn := range clients {
		conns = append(conns, conn)
	}
	clientsMu.RUnlock()

	if len(conns) == 0 {
		return
	}

	for _, conn := range conns {
		conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
		if err := conn.WriteJSON(message); err != nil {
			log.Printf("[API] Failed to write to metrics websocket: %v", err)
			removeClient(conn)
		}
	}
}

func storeClusterMetrics(nodeKey string, metrics UnifiedMetricsResponse) {
	clusterMetricsMu.Lock()
	clusterMetrics[nodeKey] = metrics
	clusterMetricsMu.Unlock()
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
