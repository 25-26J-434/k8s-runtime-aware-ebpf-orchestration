package telemetry

import (
	"fmt"
	"log"
	"sync"
	"time"
)

// Connection represents an active TCP connection
type Connection struct {
	SourceIP     string    `json:"source_ip"`
	SourcePort   uint16    `json:"source_port"`
	SourcePod    string    `json:"source_pod"`     // namespace/pod-name
	DestIP       string    `json:"dest_ip"`
	DestPort     uint16    `json:"dest_port"`
	DestPod      string    `json:"dest_pod"`       // namespace/pod-name
	State        string    `json:"state"`          // TCP state
	LastSRTTUs   uint32    `json:"last_srtt_us"`   // Last smoothed RTT
	LastMinRTTUs uint32    `json:"last_min_rtt_us"`// Last minimum RTT
	CWND         uint32    `json:"cwnd"`           // Congestion window
	EventCount   uint64    `json:"event_count"`    // Number of events seen
	FirstSeen    time.Time `json:"first_seen"`
	LastSeen     time.Time `json:"last_seen"`
	IsEstablished bool     `json:"is_established"`
}

// ConnectionKey uniquely identifies a connection
type ConnectionKey struct {
	SAddr uint32
	DAddr uint32
	Sport uint16
	Dport uint16
}

// ConnectionTracker tracks active TCP connections
type ConnectionTracker struct {
	connections map[ConnectionKey]*Connection
	mu          sync.RWMutex
	podIPMap    map[string]string // IP -> namespace/pod-name
	podMapMu    sync.RWMutex
}

var globalConnectionTracker *ConnectionTracker

func init() {
	globalConnectionTracker = &ConnectionTracker{
		connections: make(map[ConnectionKey]*Connection),
		podIPMap:    make(map[string]string),
	}
	
	// Start cleanup goroutine to remove stale connections
	go globalConnectionTracker.cleanupStaleConnections()
}

// GetConnectionTracker returns the global connection tracker
func GetConnectionTracker() *ConnectionTracker {
	return globalConnectionTracker
}

// UpdatePodIPMapping updates the IP-to-Pod mapping
func (ct *ConnectionTracker) UpdatePodIPMapping(mapping map[string]string) {
	ct.podMapMu.Lock()
	defer ct.podMapMu.Unlock()
	ct.podIPMap = mapping
	log.Printf("[Connection Tracker] Updated pod IP mapping: %d pods", len(mapping))
}

// getPodForIP looks up the pod for an IP address
func (ct *ConnectionTracker) getPodForIP(ip string) string {
	ct.podMapMu.RLock()
	defer ct.podMapMu.RUnlock()
	if pod, ok := ct.podIPMap[ip]; ok {
		return pod
	}
	return "" // External or unknown
}

// TrackConnection updates or creates a connection entry
func (ct *ConnectionTracker) TrackConnection(event TCPMetricsEvent) {
	key := ConnectionKey{
		SAddr: event.SAddr,
		DAddr: event.DAddr,
		Sport: event.Sport,
		Dport: event.Dport,
	}
	
	srcIP := intToIP(event.SAddr)
	dstIP := intToIP(event.DAddr)
	srcPod := ct.getPodForIP(srcIP)
	dstPod := ct.getPodForIP(dstIP)
	
	// Skip connections where we can't identify at least one pod
	if srcPod == "" && dstPod == "" {
		return
	}
	
	stateStr := getTCPStateString(event.TCPState)
	isEstablished := stateStr == "ESTABLISHED"
	
	ct.mu.Lock()
	defer ct.mu.Unlock()
	
	conn, exists := ct.connections[key]
	if exists {
		// Update existing connection
		conn.State = stateStr
		conn.LastSRTTUs = event.SRTTUs
		conn.LastMinRTTUs = event.MinRTTUs
		conn.CWND = event.CWND
		conn.EventCount++
		conn.LastSeen = time.Now()
		conn.IsEstablished = isEstablished
		
		// Update pod info if it changed (might have been resolved)
		if srcPod != "" {
			conn.SourcePod = srcPod
		}
		if dstPod != "" {
			conn.DestPod = dstPod
		}
	} else {
		// Create new connection
		now := time.Now()
		ct.connections[key] = &Connection{
			SourceIP:      srcIP,
			SourcePort:    event.Sport,
			SourcePod:     srcPod,
			DestIP:        dstIP,
			DestPort:      event.Dport,
			DestPod:       dstPod,
			State:         stateStr,
			LastSRTTUs:    event.SRTTUs,
			LastMinRTTUs:  event.MinRTTUs,
			CWND:          event.CWND,
			EventCount:    1,
			FirstSeen:     now,
			LastSeen:      now,
			IsEstablished: isEstablished,
		}
	}
}

// GetActiveConnections returns all active connections
func (ct *ConnectionTracker) GetActiveConnections(filter string) []Connection {
	ct.mu.RLock()
	defer ct.mu.RUnlock()
	
	connections := make([]Connection, 0, len(ct.connections))
	for _, conn := range ct.connections {
		// Apply filter
		switch filter {
		case "established":
			if !conn.IsEstablished {
				continue
			}
		case "pod-to-pod":
			if conn.SourcePod == "" || conn.DestPod == "" {
				continue
			}
		case "all":
			// No filtering
		default:
			// Default to established
			if !conn.IsEstablished {
				continue
			}
		}
		
		connections = append(connections, *conn)
	}
	
	return connections
}

// GetConnectionStats returns statistics about tracked connections
func (ct *ConnectionTracker) GetConnectionStats() map[string]interface{} {
	ct.mu.RLock()
	defer ct.mu.RUnlock()
	
	totalConns := len(ct.connections)
	establishedConns := 0
	podToPodConns := 0
	
	for _, conn := range ct.connections {
		if conn.IsEstablished {
			establishedConns++
		}
		if conn.SourcePod != "" && conn.DestPod != "" {
			podToPodConns++
		}
	}
	
	return map[string]interface{}{
		"total_connections":       totalConns,
		"established_connections": establishedConns,
		"pod_to_pod_connections":  podToPodConns,
		"pods_tracked":            len(ct.podIPMap),
	}
}

// cleanupStaleConnections removes connections that haven't been seen in a while
func (ct *ConnectionTracker) cleanupStaleConnections() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for range ticker.C {
		ct.mu.Lock()
		now := time.Now()
		staleThreshold := 2 * time.Minute
		removedCount := 0
		
		for key, conn := range ct.connections {
			if now.Sub(conn.LastSeen) > staleThreshold {
				delete(ct.connections, key)
				removedCount++
			}
		}
		
		if removedCount > 0 {
			log.Printf("[Connection Tracker] Cleaned up %d stale connections (total: %d)", removedCount, len(ct.connections))
		}
		ct.mu.Unlock()
	}
}

// GetPodConnections returns connections for a specific pod
func (ct *ConnectionTracker) GetPodConnections(namespace, podName string) []Connection {
	podKey := fmt.Sprintf("%s/%s", namespace, podName)
	
	ct.mu.RLock()
	defer ct.mu.RUnlock()
	
	connections := make([]Connection, 0)
	for _, conn := range ct.connections {
		if conn.SourcePod == podKey || conn.DestPod == podKey {
			connections = append(connections, *conn)
		}
	}
	
	return connections
}

