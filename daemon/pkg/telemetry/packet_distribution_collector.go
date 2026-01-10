package telemetry

import (
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// PacketDistributionMetrics holds packet distribution metrics across pods
type PacketDistributionMetrics struct {
	TotalPackets      uint64            `json:"total_packets"`
	PacketsByPod      map[string]uint64 `json:"packets_by_pod"`
	PacketsByProtocol map[string]uint64 `json:"packets_by_protocol"`
	BytesByPod        map[string]uint64 `json:"bytes_by_pod"`
}

// PodPacketStats holds per-pod packet statistics
type PodPacketStats struct {
	PodName     string
	Namespace   string
	PacketCount uint64
	ByteCount   uint64
	TCPPackets  uint64
	UDPPackets  uint64
	ICMPPackets uint64
}

var packetDistributionMetrics PacketDistributionMetrics
var podPacketStats = make(map[string]*PodPacketStats)
var packetMetricsMutex sync.RWMutex

func init() {
	packetDistributionMetrics.PacketsByPod = make(map[string]uint64)
	packetDistributionMetrics.PacketsByProtocol = make(map[string]uint64)
	packetDistributionMetrics.BytesByPod = make(map[string]uint64)
}

// PacketDistributionCollector implements the Collector interface
type PacketDistributionCollector struct {
	nodeName string
}

// NewPacketDistributionCollector creates a new packet distribution collector
func NewPacketDistributionCollector(nodeName string) *PacketDistributionCollector {
	return &PacketDistributionCollector{
		nodeName: nodeName,
	}
}

// GetType returns the metric type
func (c *PacketDistributionCollector) GetType() MetricType {
	return MetricType("packet_distribution")
}

// GetNodeMetrics returns current node-level packet distribution metrics
func (c *PacketDistributionCollector) GetNodeMetrics() NodeMetric {
	packetMetricsMutex.RLock()
	defer packetMetricsMutex.RUnlock()

	// Create a copy of the maps
	packetsByPod := make(map[string]uint64)
	packetsByProtocol := make(map[string]uint64)
	bytesByPod := make(map[string]uint64)

	for k, v := range packetDistributionMetrics.PacketsByPod {
		packetsByPod[k] = v
	}
	for k, v := range packetDistributionMetrics.PacketsByProtocol {
		packetsByProtocol[k] = v
	}
	for k, v := range packetDistributionMetrics.BytesByPod {
		bytesByPod[k] = v
	}

	value := PacketDistributionMetrics{
		TotalPackets:      atomic.LoadUint64(&packetDistributionMetrics.TotalPackets),
		PacketsByPod:      packetsByPod,
		PacketsByProtocol: packetsByProtocol,
		BytesByPod:        bytesByPod,
	}

	return NodeMetric{
		Type:      c.GetType(),
		Timestamp: time.Now(),
		NodeName:  c.nodeName,
		Value:     value,
	}
}

// GetPodMetrics returns per-pod packet statistics
func (c *PacketDistributionCollector) GetPodMetrics() map[string]PodMetric {
	packetMetricsMutex.RLock()
	defer packetMetricsMutex.RUnlock()

	result := make(map[string]PodMetric)
	for podKey, stats := range podPacketStats {
		parts := strings.Split(podKey, "/")
		if len(parts) != 2 {
			continue
		}

		value := map[string]interface{}{
			"packet_count": stats.PacketCount,
			"byte_count":   stats.ByteCount,
			"tcp_packets":  stats.TCPPackets,
			"udp_packets":  stats.UDPPackets,
			"icmp_packets": stats.ICMPPackets,
		}

		result[podKey] = PodMetric{
			Type:      c.GetType(),
			Timestamp: time.Now(),
			Namespace: parts[0],
			PodName:   parts[1],
			NodeName:  c.nodeName,
			Value:     value,
		}
	}

	return result
}

// Subscribe returns a channel for real-time updates
func (c *PacketDistributionCollector) Subscribe() <-chan Metric {
	ch := make(chan Metric, 100)
	// TODO: Implement event-driven updates
	return ch
}

// Unsubscribe removes a subscription
func (c *PacketDistributionCollector) Unsubscribe(ch <-chan Metric) {
	// Channels are receive-only, cannot close
	// Subscriptions are managed by the collector internally
}

// RecordPacket records a packet event for a pod
func RecordPacket(podKey string, protocol string, bytes uint64) {
	packetMetricsMutex.Lock()
	defer packetMetricsMutex.Unlock()

	atomic.AddUint64(&packetDistributionMetrics.TotalPackets, 1)

	// Update pod stats
	if podPacketStats[podKey] == nil {
		parts := strings.Split(podKey, "/")
		if len(parts) == 2 {
			podPacketStats[podKey] = &PodPacketStats{
				PodName:   parts[1],
				Namespace: parts[0],
			}
		}
	}

	if stats := podPacketStats[podKey]; stats != nil {
		atomic.AddUint64(&stats.PacketCount, 1)
		atomic.AddUint64(&stats.ByteCount, bytes)

		switch protocol {
		case "tcp":
			atomic.AddUint64(&stats.TCPPackets, 1)
		case "udp":
			atomic.AddUint64(&stats.UDPPackets, 1)
		case "icmp":
			atomic.AddUint64(&stats.ICMPPackets, 1)
		}
	}

	// Update distribution maps
	packetDistributionMetrics.PacketsByPod[podKey]++
	packetDistributionMetrics.PacketsByProtocol[protocol]++
	packetDistributionMetrics.BytesByPod[podKey] += bytes
}

// Global packet distribution collector instance
var globalPacketDistributionCollector *PacketDistributionCollector

// InitPacketDistributionCollector initializes the global packet distribution collector
func InitPacketDistributionCollector(nodeName string) {
	globalPacketDistributionCollector = NewPacketDistributionCollector(nodeName)
	GlobalRegistry.Register(globalPacketDistributionCollector)
}

// GetPacketDistributionMetrics returns current packet distribution metrics
func GetPacketDistributionMetrics() PacketDistributionMetrics {
	packetMetricsMutex.RLock()
	defer packetMetricsMutex.RUnlock()
	return packetDistributionMetrics
}
