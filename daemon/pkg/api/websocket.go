package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var (
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true // Allow all origins for development
		},
	}

	// Hub maintains the set of active clients and broadcasts messages to them
	hub *Hub
)

// Client represents a WebSocket client connection
type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

// Hub maintains the set of active clients and broadcasts messages to them
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

// NewHub creates a new Hub
func NewHub() *Hub {
	return &Hub{
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
	}
}

// Run starts the hub
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("[WebSocket] Client connected. Total clients: %d", len(h.clients))

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			log.Printf("[WebSocket] Client disconnected. Total clients: %d", len(h.clients))

		case message := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					// Client's send channel is full, close it
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// readPump pumps messages from the websocket connection to the hub
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	
	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[WebSocket] Error: %v", err)
			}
			break
		}
	}
}

// writePump pumps messages from the hub to the websocket connection
func (c *Client) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	
	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				// The hub closed the channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			
			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)
			
			if err := w.Close(); err != nil {
				return
			}
			
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// handleWebSocketMetrics handles WebSocket connections for metrics
func handleWebSocketMetrics(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WebSocket] Upgrade error: %v", err)
		return
	}
	
	client := &Client{hub: hub, conn: conn, send: make(chan []byte, 256)}
	client.hub.register <- client
	
	// Allow collection of memory referenced by the caller by doing all work in new goroutines
	go client.writePump()
	go client.readPump()
}

// handleWebSocketClusterTopology handles WebSocket connections for cluster topology
func handleWebSocketClusterTopology(w http.ResponseWriter, r *http.Request) {
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

// handleWebSocketPodDetails handles WebSocket connections for pod details
func handleWebSocketPodDetails(w http.ResponseWriter, r *http.Request) {
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

// BroadcastMessage broadcasts a message to all connected clients
func BroadcastMessage(messageType string, data interface{}) {
	if hub == nil {
		return
	}
	
	message := map[string]interface{}{
		"type": messageType,
		"data": data,
	}
	
	jsonData, err := json.Marshal(message)
	if err != nil {
		log.Printf("[WebSocket] Failed to marshal message: %v", err)
		return
	}
	
	hub.broadcast <- jsonData
}

// StartMetricsBroadcaster starts a goroutine that periodically broadcasts metrics
func StartMetricsBroadcaster(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	
	log.Printf("[WebSocket] Starting metrics broadcaster with interval: %v", interval)
	
	for {
		select {
		case <-ctx.Done():
			log.Println("[WebSocket] Metrics broadcaster stopped")
			return
		case <-ticker.C:
			// Only broadcast if there are connected clients
			hub.mu.RLock()
			hasClients := len(hub.clients) > 0
			hub.mu.RUnlock()
			
			if !hasClients {
				continue
			}
			
			// Gather all metrics
			metrics := gatherAllMetrics()
			BroadcastMessage("metrics", metrics)
			
			// Gather cluster topology
			topology, err := GetClusterTopology()
			if err == nil {
				BroadcastMessage("topology", topology)
			}
			
			// Gather pod details
			podDetails := gatherPodDetails()
			BroadcastMessage("pod_details", podDetails)
		}
	}
}

// gatherAllMetrics gathers all metrics data
func gatherAllMetrics() interface{} {
	// Create a temporary response writer to capture the unified metrics
	metricType := ""
	level := ""
	
	return buildUnifiedMetricsResponse(metricType, level)
}

// gatherPodDetails gathers pod details data
func gatherPodDetails() interface{} {
	podDetails, err := GetPodDetails()
	if err != nil {
		log.Printf("[WebSocket] Failed to gather pod details: %v", err)
		return nil
	}
	return podDetails
}

// InitWebSocket initializes the WebSocket hub
func InitWebSocket() {
	hub = NewHub()
	go hub.Run()
	log.Println("[WebSocket] Hub initialized")
}

