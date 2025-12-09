package telemetry

import (
	"sync"
	"time"
)

// MetricType identifies the type of metric being collected
type MetricType string

const (
	MetricTypeDNS         MetricType = "dns_latency"
	MetricTypeRTT         MetricType = "rtt"
	MetricTypeSocketCount MetricType = "socket_count"
	MetricTypePacketDrop  MetricType = "packet_drop"
)

// MetricLevel defines the aggregation level
type MetricLevel string

const (
	MetricLevelNode MetricLevel = "node"
	MetricLevelPod  MetricLevel = "pod"
)

// Metric is the base interface all metrics implement
type Metric interface {
	GetType() MetricType
	GetLevel() MetricLevel
	GetTimestamp() time.Time
	GetValue() interface{}
}

// NodeMetric represents node-level aggregated metrics
type NodeMetric struct {
	Type      MetricType  `json:"type"`
	Timestamp time.Time   `json:"timestamp"`
	NodeName  string      `json:"node_name"`
	Value     interface{} `json:"value"`
}

func (m NodeMetric) GetType() MetricType     { return m.Type }
func (m NodeMetric) GetLevel() MetricLevel   { return MetricLevelNode }
func (m NodeMetric) GetTimestamp() time.Time { return m.Timestamp }
func (m NodeMetric) GetValue() interface{}   { return m.Value }

// PodMetric represents pod-level metrics
type PodMetric struct {
	Type      MetricType  `json:"type"`
	Timestamp time.Time   `json:"timestamp"`
	Namespace string      `json:"namespace"`
	PodName   string      `json:"pod_name"`
	PodIP     string      `json:"pod_ip,omitempty"`
	NodeName  string      `json:"node_name,omitempty"`
	Value     interface{} `json:"value"`
}

func (m PodMetric) GetType() MetricType     { return m.Type }
func (m PodMetric) GetLevel() MetricLevel   { return MetricLevelPod }
func (m PodMetric) GetTimestamp() time.Time { return m.Timestamp }
func (m PodMetric) GetValue() interface{}   { return m.Value }

// DNSMetricValue contains DNS latency statistics
type DNSMetricValue struct {
	TotalEvents    uint64  `json:"total_events"`
	TotalLatencyNs uint64  `json:"total_latency_ns"`
	AvgLatencyNs   float64 `json:"avg_latency_ns"`
	MinLatencyNs   uint64  `json:"min_latency_ns"`
	MaxLatencyNs   uint64  `json:"max_latency_ns"`
	LastLatencyNs  uint64  `json:"last_latency_ns"`
}

// RTTMetricValue contains RTT statistics
type RTTMetricValue struct {
	TotalEvents uint64  `json:"total_events"`
	TotalRTTNs  uint64  `json:"total_rtt_ns"`
	AvgRTTNs    float64 `json:"avg_rtt_ns"`
	MinRTTNs    uint64  `json:"min_rtt_ns"`
	MaxRTTNs    uint64  `json:"max_rtt_ns"`
	LastRTTNs   uint64  `json:"last_rtt_ns"`
}

// SocketCountMetricValue contains socket count statistics
type SocketCountMetricValue struct {
	TCPSockets   uint64 `json:"tcp_sockets"`
	UDPSockets   uint64 `json:"udp_sockets"`
	TotalSockets uint64 `json:"total_sockets"`
}

// Collector is the interface all eBPF collectors must implement
type Collector interface {
	// GetType returns the metric type this collector produces
	GetType() MetricType

	// GetNodeMetrics returns current node-level metrics
	GetNodeMetrics() NodeMetric

	// GetPodMetrics returns current pod-level metrics
	// Key format: "namespace/podname"
	GetPodMetrics() map[string]PodMetric

	// Subscribe allows components to receive real-time metric updates
	Subscribe() <-chan Metric

	// Unsubscribe removes a subscription
	Unsubscribe(ch <-chan Metric)
}

// CollectorRegistry manages all active collectors
type CollectorRegistry struct {
	collectors map[MetricType]Collector
	mu         sync.RWMutex
}

// NewCollectorRegistry creates a new collector registry
func NewCollectorRegistry() *CollectorRegistry {
	return &CollectorRegistry{
		collectors: make(map[MetricType]Collector),
	}
}

// Register adds a collector to the registry
func (r *CollectorRegistry) Register(collector Collector) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	metricType := collector.GetType()
	r.collectors[metricType] = collector
	return nil
}

// Get retrieves a collector by metric type
func (r *CollectorRegistry) Get(metricType MetricType) (Collector, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	collector, ok := r.collectors[metricType]
	return collector, ok
}

// GetAll returns all registered collectors
func (r *CollectorRegistry) GetAll() []Collector {
	r.mu.RLock()
	defer r.mu.RUnlock()

	collectors := make([]Collector, 0, len(r.collectors))
	for _, collector := range r.collectors {
		collectors = append(collectors, collector)
	}
	return collectors
}

// GetNodeMetrics retrieves node-level metrics for a specific type
func (r *CollectorRegistry) GetNodeMetrics(metricType MetricType) (NodeMetric, bool) {
	collector, ok := r.Get(metricType)
	if !ok {
		return NodeMetric{}, false
	}
	return collector.GetNodeMetrics(), true
}

// GetAllNodeMetrics retrieves node-level metrics for all collectors
func (r *CollectorRegistry) GetAllNodeMetrics() map[MetricType]NodeMetric {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make(map[MetricType]NodeMetric)
	for metricType, collector := range r.collectors {
		result[metricType] = collector.GetNodeMetrics()
	}
	return result
}

// GetPodMetrics retrieves pod-level metrics for a specific type
func (r *CollectorRegistry) GetPodMetrics(metricType MetricType) (map[string]PodMetric, bool) {
	collector, ok := r.Get(metricType)
	if !ok {
		return nil, false
	}
	return collector.GetPodMetrics(), true
}

// GetAllPodMetrics retrieves pod-level metrics for all collectors
// Returns: map[podKey]map[metricType]PodMetric
func (r *CollectorRegistry) GetAllPodMetrics() map[string]map[MetricType]PodMetric {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make(map[string]map[MetricType]PodMetric)

	for metricType, collector := range r.collectors {
		podMetrics := collector.GetPodMetrics()
		for podKey, metric := range podMetrics {
			if result[podKey] == nil {
				result[podKey] = make(map[MetricType]PodMetric)
			}
			result[podKey][metricType] = metric
		}
	}

	return result
}

// Global registry instance
var GlobalRegistry = NewCollectorRegistry()
