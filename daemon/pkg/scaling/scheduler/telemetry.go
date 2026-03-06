package scheduler

import (
	"context"
	"encoding/json"
	"log"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type NodeTelemetry struct {
	DNSLatencyAvgNs       float64
	RTTAvgNs              float64
	TCPRetransmissions    float64
	DiskReadLatencyAvgNs  float64
	DiskWriteLatencyAvgNs float64
	Complete              bool
	LastUpdated           time.Time
}

type telemetryManager struct {
	cfg Config

	mu    sync.RWMutex
	nodes map[string]NodeTelemetry
	subs  map[string]context.CancelFunc
}

func newTelemetryManager(cfg Config) *telemetryManager {
	return &telemetryManager{
		cfg:   cfg,
		nodes: make(map[string]NodeTelemetry),
		subs:  make(map[string]context.CancelFunc),
	}
}

func (m *telemetryManager) EnsureNode(ctx context.Context, nodeName string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.subs[nodeName]; exists {
		return
	}

	nodeCtx, cancel := context.WithCancel(ctx)
	m.subs[nodeName] = cancel
	go m.subscribeNode(nodeCtx, nodeName)
}

func (m *telemetryManager) RemoveNode(nodeName string) {
	m.mu.Lock()
	cancel := m.subs[nodeName]
	delete(m.subs, nodeName)
	delete(m.nodes, nodeName)
	m.mu.Unlock()

	if cancel != nil {
		cancel()
	}
}

func (m *telemetryManager) Snapshot(nodeName string) (NodeTelemetry, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	telemetry, ok := m.nodes[nodeName]
	return telemetry, ok
}

func (m *telemetryManager) subscribeNode(ctx context.Context, nodeName string) {
	backoff := time.Second

	for {
		if ctx.Err() != nil {
			return
		}

		wsURL := m.nodeURL(nodeName)
		conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
		if err != nil {
			log.Printf("[Scheduler] Metrics websocket connect failed for node %s: %v", nodeName, err)
			if !sleepWithContext(ctx, backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}

		log.Printf("[Scheduler] Subscribed to metrics for node %s", nodeName)
		backoff = time.Second

		if err := m.readNodeMetrics(ctx, conn, nodeName); err != nil && ctx.Err() == nil {
			log.Printf("[Scheduler] Metrics websocket closed for node %s: %v", nodeName, err)
		}
		_ = conn.Close()

		if !sleepWithContext(ctx, backoff) {
			return
		}
		backoff = nextBackoff(backoff)
	}
}

func (m *telemetryManager) readNodeMetrics(ctx context.Context, conn *websocket.Conn, nodeName string) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		var payload map[string]interface{}
		if err := conn.ReadJSON(&payload); err != nil {
			return err
		}

		if snapshot, ok := payload["nodes"].(map[string]interface{}); ok {
			if raw, found := snapshot[nodeName]; found {
				m.updateNode(nodeName, raw)
			}
			continue
		}

		if rawMetrics, ok := payload["metrics"]; ok {
			targetNode := nodeName
			if receivedNode := strings.TrimSpace(toString(payload["node"])); receivedNode != "" {
				targetNode = receivedNode
			}
			m.updateNode(targetNode, rawMetrics)
		}
	}
}

func (m *telemetryManager) updateNode(nodeName string, raw interface{}) {
	data, err := json.Marshal(raw)
	if err != nil {
		return
	}

	var decoded struct {
		Node map[string]interface{} `json:"node"`
	}
	if err := json.Unmarshal(data, &decoded); err != nil {
		return
	}

	dns, dnsOK := nestedFloat(decoded.Node, "dns_latency", "avg_latency_ns")
	rtt, rttOK := nestedFloat(decoded.Node, "rtt", "avg_rtt_ns")
	tcp, tcpOK := nestedFloat(decoded.Node, "tcp_metrics", "retransmissions")
	diskRead, diskReadOK := nestedFloat(decoded.Node, "disk_io", "avg_read_latency_ns")
	diskWrite, diskWriteOK := nestedFloat(decoded.Node, "disk_io", "avg_write_latency_ns")

	telemetry := NodeTelemetry{
		DNSLatencyAvgNs:       dns,
		RTTAvgNs:              rtt,
		TCPRetransmissions:    tcp,
		DiskReadLatencyAvgNs:  diskRead,
		DiskWriteLatencyAvgNs: diskWrite,
		Complete:              dnsOK && rttOK && tcpOK && diskReadOK && diskWriteOK,
		LastUpdated:           time.Now().UTC(),
	}

	m.mu.Lock()
	m.nodes[nodeName] = telemetry
	m.mu.Unlock()
}

func (m *telemetryManager) nodeURL(nodeName string) string {
	base := m.cfg.MetricsWSURL
	separator := "?"
	if strings.Contains(base, "?") {
		separator = "&"
	}
	return base + separator + "node=" + url.QueryEscape(nodeName)
}

func nestedFloat(data map[string]interface{}, keys ...string) (float64, bool) {
	var current interface{} = data
	for _, key := range keys {
		next, ok := current.(map[string]interface{})
		if !ok {
			return 0, false
		}
		value, ok := next[key]
		if !ok {
			return 0, false
		}
		current = value
	}
	return toFloat(current)
}

func toFloat(value interface{}) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int32:
		return float64(v), true
	case int64:
		return float64(v), true
	case uint32:
		return float64(v), true
	case uint64:
		return float64(v), true
	case json.Number:
		f, err := v.Float64()
		if err == nil {
			return f, true
		}
	}
	return 0, false
}

func toString(value interface{}) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}

func nextBackoff(current time.Duration) time.Duration {
	if current >= 15*time.Second {
		return 15 * time.Second
	}
	return current * 2
}

func sleepWithContext(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
