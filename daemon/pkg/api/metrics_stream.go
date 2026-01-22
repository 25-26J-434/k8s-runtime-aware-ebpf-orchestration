package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	// metrics_stream.go
	//
	// This file implements the metrics streaming subsystem for the daemon.
	// It provides a WebSocket endpoint for clients to subscribe to live cluster metrics updates.
	// Metrics are collected, stored, and broadcast to all connected clients at regular intervals.

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

	clientsMu    sync.RWMutex
	clients      = make(map[*websocket.Conn]struct{})
	clientWrites = make(map[*websocket.Conn]*sync.Mutex)

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

	// Initializes metrics streaming: registers HTTP handler and message handler, starts broadcast loop.
	ticker := time.NewTicker(metricsBroadcastInterval)
	defer ticker.Stop()

	for range ticker.C {
		publishLocalMetrics()
	}
}

// Periodically collects and broadcasts local metrics to all clients.
func publishLocalMetrics() {
	metrics := buildUnifiedMetricsResponse("", "")
	nodeKey := metricsNodeKey(metrics)
	if nodeKey == "" {
		log.Printf("[API] Skipping local metrics broadcast: missing node identifier")
		return
	}

	       storeClusterMetrics(nodeKey, metrics)
	       // No longer broadcast to WebSocket clients. Only respond to explicit requests.
	       // comm.BroadcastMessage(comm.Message{
	       //      Event:   comm.EventMetricUpdate,
	       //      Payload: map[string]any{"metrics": metrics},
	       // })
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
       // Handles incoming metric updates from other nodes (via comm subsystem).
       // Updates local cluster metrics only. No broadcast to clients.

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
       // No broadcast to WebSocket clients here.
}

func metricsWebSocketHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[API] Failed to upgrade metrics websocket: %v", err)
		return
	}

	addClient(conn)
	// Do NOT send cluster snapshot on connect. Only respond to explicit requests.
	go readPump(conn)
}

func addClient(conn *websocket.Conn) {
	clientsMu.Lock()
	clients[conn] = struct{}{}
	clientWrites[conn] = &sync.Mutex{}
	clientsMu.Unlock()
}

func sendClusterSnapshot(conn *websocket.Conn) error {
	clusterMetricsMu.RLock()
	snapshot := make(map[string]UnifiedMetricsResponse, len(clusterMetrics))
	for node, metrics := range clusterMetrics {
		snapshot[node] = metrics
		// Adds a WebSocket client to the set of connected clients.
	}
	clusterMetricsMu.RUnlock()

	message := struct {
		Type  string                            `json:"type"`
		Nodes map[string]UnifiedMetricsResponse `json:"nodes"`
		// Sends the current cluster metrics snapshot to a single client.
	}{
		Type:  "snapshot",
		Nodes: snapshot,
	}

	// Get the write mutex for this connection
	clientsMu.RLock()
	writeMu := clientWrites[conn]
	clientsMu.RUnlock()

	if writeMu == nil {
		log.Printf("[API] No write mutex found for connection")
		return nil
	}

	writeMu.Lock()
	defer writeMu.Unlock()

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
		// Wait for a message from the client
		mt, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[API] Metrics websocket closed unexpectedly: %v", err)
			}
			break
		}

		// Only handle text/binary messages
		if mt != websocket.TextMessage && mt != websocket.BinaryMessage {
			continue
		}

		// Try to parse the message as a node ID request
		var req struct {
			Type   string `json:"type"`
			NodeID string `json:"node_id"`
		}
		if err := json.Unmarshal(message, &req); err != nil {
			log.Printf("[API] Failed to parse websocket message: %v", err)
			continue
		}

		if req.Type == "get_pods" && req.NodeID != "" {
			// Fetch pod details for the requested node
			pods := getPodDetailsForNode(req.NodeID)
			resp := struct {
				Type   string      `json:"type"`
				NodeID string      `json:"node_id"`
				Pods   interface{} `json:"pods"`
			}{
				Type:   "pod_details",
				NodeID: req.NodeID,
				Pods:   pods,
			}

			// Get the write mutex for this connection
			clientsMu.RLock()
			writeMu := clientWrites[conn]
			clientsMu.RUnlock()
			if writeMu != nil {
				writeMu.Lock()
				conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
				_ = conn.WriteJSON(resp)
				writeMu.Unlock()
			}
		}
	}
}

// getPodDetailsForNode returns pod details for a given node ID.
// Replace this stub with actual logic to fetch pod details from your cluster or cache.
func getPodDetailsForNode(nodeID string) interface{} {
	topology, err := GetClusterTopology()
	if err != nil {
		log.Printf("[API] Failed to get cluster topology: %v", err)
		return []interface{}{}
	}
	for _, node := range topology.Nodes {
		if node.Name == nodeID || node.IP == nodeID {
			return node.Pods
		}
	}
	return []interface{}{}
}

func removeClient(conn *websocket.Conn) {
	clientsMu.Lock()
	delete(clients, conn)
	delete(clientWrites, conn)
	clientsMu.Unlock()
	conn.Close()
}

// broadcastClusterUpdate is now disabled. No cluster-wide broadcasts to WebSocket clients.
// func broadcastClusterUpdate(nodeKey string, metrics UnifiedMetricsResponse) {}

// broadcastToClients is now disabled. No cluster-wide broadcasts to WebSocket clients.
// func broadcastToClients(message interface{}) {}

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
		// Stores the latest metrics for a node in the cluster metrics map.
		return metrics.NodeIP
	}
	if metrics.NodeName != "" {
		return metrics.NodeName
	}
	return ""
	// Returns a unique key for a node based on metrics (prefer name, fallback to IP).
}
