package telemetry

import (
	"bufio"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// NATMetadataMetrics holds NAT translation metadata
type NATMetadataMetrics struct {
	TotalConnections  uint64            `json:"total_connections"`
	ActiveConnections uint64            `json:"active_connections"`
	ConnectionsByPod  map[string]uint64 `json:"connections_by_pod"`
	SNATTranslations  uint64            `json:"snat_translations"`
	DNATTranslations  uint64            `json:"dnat_translations"`
	TranslationErrors uint64            `json:"translation_errors"`
}

var natMetadataMetrics NATMetadataMetrics
var natMetricsMutex sync.RWMutex

func init() {
	natMetadataMetrics.ConnectionsByPod = make(map[string]uint64)
}

// NATMetadataCollector implements the Collector interface
type NATMetadataCollector struct {
	nodeName string
}

// NewNATMetadataCollector creates a new NAT metadata collector
func NewNATMetadataCollector(nodeName string) *NATMetadataCollector {
	return &NATMetadataCollector{
		nodeName: nodeName,
	}
}

// GetType returns the metric type
func (c *NATMetadataCollector) GetType() MetricType {
	return MetricType("nat_metadata")
}

// GetNodeMetrics returns current node-level NAT metadata
func (c *NATMetadataCollector) GetNodeMetrics() NodeMetric {
	natMetricsMutex.RLock()
	defer natMetricsMutex.RUnlock()

	// Create a copy of the connections by pod map
	connectionsByPod := make(map[string]uint64)
	for k, v := range natMetadataMetrics.ConnectionsByPod {
		connectionsByPod[k] = v
	}

	value := NATMetadataMetrics{
		TotalConnections:  natMetadataMetrics.TotalConnections,
		ActiveConnections: natMetadataMetrics.ActiveConnections,
		ConnectionsByPod:  connectionsByPod,
		SNATTranslations:  natMetadataMetrics.SNATTranslations,
		DNATTranslations:  natMetadataMetrics.DNATTranslations,
		TranslationErrors: natMetadataMetrics.TranslationErrors,
	}

	return NodeMetric{
		Type:      c.GetType(),
		Timestamp: time.Now(),
		NodeName:  c.nodeName,
		Value:     value,
	}
}

// GetPodMetrics returns empty map (NAT metadata is node-level)
func (c *NATMetadataCollector) GetPodMetrics() map[string]PodMetric {
	return make(map[string]PodMetric)
}

// Subscribe returns a channel for real-time updates
func (c *NATMetadataCollector) Subscribe() <-chan Metric {
	ch := make(chan Metric, 100)
	// TODO: Implement event-driven updates
	return ch
}

// Unsubscribe removes a subscription
func (c *NATMetadataCollector) Unsubscribe(ch <-chan Metric) {
	// Channels are receive-only, cannot close
	// Subscriptions are managed by the collector internally
}

// StartNATMetadataCollector starts collecting NAT metadata
func StartNATMetadataCollector() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	// Initial collection
	collectNATMetadata()

	for range ticker.C {
		collectNATMetadata()
	}
}

// collectNATMetadata reads NAT connection tracking from /proc/net/nf_conntrack or /proc/net/ip_conntrack
func collectNATMetadata() {
	// Try to read from conntrack
	// This requires conntrack-tools or access to /proc/net/nf_conntrack
	// For now, we'll parse /proc/net/stat/nf_conntrack if available

	// Try /proc/net/stat/nf_conntrack first (newer kernels)
	stats, err := readConntrackStats("/proc/net/stat/nf_conntrack")
	if err != nil {
		// Fallback: try to count active connections from /proc/net/nf_conntrack
		active, err2 := countActiveConnections()
		if err2 != nil {
			log.Printf("[NATMetadata] Failed to collect NAT metadata: %v, %v", err, err2)
			return
		}

		natMetricsMutex.Lock()
		natMetadataMetrics.ActiveConnections = active
		natMetricsMutex.Unlock()
		return
	}

	natMetricsMutex.Lock()
	natMetadataMetrics.ActiveConnections = stats.Active
	natMetadataMetrics.TotalConnections = stats.Searched
	natMetricsMutex.Unlock()
}

type ConntrackStats struct {
	Active        uint64
	Searched      uint64
	Found         uint64
	New           uint64
	Invalid       uint64
	Ignore        uint64
	Delete        uint64
	DeleteList    uint64
	Insert        uint64
	InsertFailed  uint64
	Drop          uint64
	EarlyDrop     uint64
	ICMPError     uint64
	ExpectNew     uint64
	ExpectCreate  uint64
	ExpectDelete  uint64
	SearchRestart uint64
}

// readConntrackStats reads conntrack statistics
func readConntrackStats(path string) (ConntrackStats, error) {
	var stats ConntrackStats

	file, err := os.Open(path)
	if err != nil {
		return stats, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "entries") {
			// Parse entries line: entries 12345
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				if val, err := strconv.ParseUint(fields[1], 10, 64); err == nil {
					stats.Active = val
				}
			}
		}
	}

	return stats, nil
}

// countActiveConnections counts active connections from /proc/net/nf_conntrack
func countActiveConnections() (uint64, error) {
	file, err := os.Open("/proc/net/nf_conntrack")
	if err != nil {
		// Try alternative path
		file, err = os.Open("/proc/net/ip_conntrack")
		if err != nil {
			return 0, err
		}
	}
	defer file.Close()

	count := uint64(0)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		count++
	}

	return count, scanner.Err()
}

// Global NAT metadata collector instance
var globalNATMetadataCollector *NATMetadataCollector

// InitNATMetadataCollector initializes the global NAT metadata collector
func InitNATMetadataCollector(nodeName string) {
	globalNATMetadataCollector = NewNATMetadataCollector(nodeName)
	GlobalRegistry.Register(globalNATMetadataCollector)
	// Start collecting metrics
	go StartNATMetadataCollector()
}

// GetNATMetadataMetrics returns current NAT metadata
func GetNATMetadataMetrics() NATMetadataMetrics {
	natMetricsMutex.RLock()
	defer natMetricsMutex.RUnlock()
	return natMetadataMetrics
}
