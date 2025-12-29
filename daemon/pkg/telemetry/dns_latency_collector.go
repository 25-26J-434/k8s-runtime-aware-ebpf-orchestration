package telemetry

import (
	"encoding/binary"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/loader"
	"github.com/cilium/ebpf/ringbuf"
)

// DNSEvent represents a DNS latency measurement from the kernel
type DNSEvent struct {
	TimestampNs uint64
	Pid         uint32
	SourceIP    uint32 // Source IP address for pod identification
	LatencyNs   uint32
	Domain      [256]byte
}

// DNSMetrics holds aggregated DNS metrics for Prometheus
type DNSMetrics struct {
	TotalEvents    uint64
	TotalLatencyNs uint64
	LastLatencyNs  uint64
	MaxLatencyNs   uint64
	MinLatencyNs   uint64
}

// PodDNSMetrics holds per-pod DNS metrics
type PodDNSMetrics struct {
	PodName        string
	Namespace      string
	TotalEvents    uint64
	TotalLatencyNs uint64
	LastLatencyNs  uint64
	MaxLatencyNs   uint64
	MinLatencyNs   uint64
}

// ContainerDNSMetrics holds per-container DNS metrics
type ContainerDNSMetrics struct {
	ContainerName  string
	ContainerID    string
	PodName        string
	Namespace      string
	TotalEvents    uint64
	TotalLatencyNs uint64
	LastLatencyNs  uint64
	MaxLatencyNs   uint64
	MinLatencyNs   uint64
}

var dnsMetrics DNSMetrics
var podDNSMetrics = make(map[string]*PodDNSMetrics)            // keyed by "namespace/podname"
var containerDNSMetrics = make(map[string]*ContainerDNSMetrics) // keyed by "namespace/podname/containername"
var podDNSMetricsMutex sync.RWMutex
var containerDNSMetricsMutex sync.RWMutex
var ipToPodMap = make(map[string]string) // IP -> "namespace/podname"
var ipToPodMapMutex sync.RWMutex

func init() {
	dnsMetrics.MinLatencyNs = ^uint64(0) // Max uint64
	// Start periodic pod IP refresh
	go refreshPodIPMapping()
}

// Global DNS collector instance
var globalDNSCollector *DNSCollector
var containerMapper *ContainerMapper

// InitDNSCollector initializes the global DNS collector
func InitDNSCollector(nodeName string) {
	globalDNSCollector = NewDNSCollector(nodeName)
	// Register with global registry
	GlobalRegistry.Register(globalDNSCollector)
}

// SetContainerMapper sets the container mapper for DNS collector
func SetContainerMapper(cm *ContainerMapper) {
	containerMapper = cm
}

// GetDNSMetrics returns the current DNS metrics
func GetDNSMetrics() DNSMetrics {
	return DNSMetrics{
		TotalEvents:    atomic.LoadUint64(&dnsMetrics.TotalEvents),
		TotalLatencyNs: atomic.LoadUint64(&dnsMetrics.TotalLatencyNs),
		LastLatencyNs:  atomic.LoadUint64(&dnsMetrics.LastLatencyNs),
		MaxLatencyNs:   atomic.LoadUint64(&dnsMetrics.MaxLatencyNs),
		MinLatencyNs:   atomic.LoadUint64(&dnsMetrics.MinLatencyNs),
	}
}

// GetPodDNSMetrics returns a copy of all per-pod DNS metrics
func GetPodDNSMetrics() map[string]PodDNSMetrics {
	podDNSMetricsMutex.RLock()
	defer podDNSMetricsMutex.RUnlock()

	result := make(map[string]PodDNSMetrics)
	for key, metrics := range podDNSMetrics {
		result[key] = PodDNSMetrics{
			PodName:        metrics.PodName,
			Namespace:      metrics.Namespace,
			TotalEvents:    atomic.LoadUint64(&metrics.TotalEvents),
			TotalLatencyNs: atomic.LoadUint64(&metrics.TotalLatencyNs),
			LastLatencyNs:  atomic.LoadUint64(&metrics.LastLatencyNs),
			MaxLatencyNs:   atomic.LoadUint64(&metrics.MaxLatencyNs),
			MinLatencyNs:   atomic.LoadUint64(&metrics.MinLatencyNs),
		}
	}
	return result
}

// GetContainerDNSMetrics returns a copy of all per-container DNS metrics
func GetContainerDNSMetrics() map[string]ContainerDNSMetrics {
	containerDNSMetricsMutex.RLock()
	defer containerDNSMetricsMutex.RUnlock()

	result := make(map[string]ContainerDNSMetrics)
	for key, metrics := range containerDNSMetrics {
		result[key] = ContainerDNSMetrics{
			ContainerName:  metrics.ContainerName,
			ContainerID:    metrics.ContainerID,
			PodName:        metrics.PodName,
			Namespace:      metrics.Namespace,
			TotalEvents:    atomic.LoadUint64(&metrics.TotalEvents),
			TotalLatencyNs: atomic.LoadUint64(&metrics.TotalLatencyNs),
			LastLatencyNs:  atomic.LoadUint64(&metrics.LastLatencyNs),
			MaxLatencyNs:   atomic.LoadUint64(&metrics.MaxLatencyNs),
			MinLatencyNs:   atomic.LoadUint64(&metrics.MinLatencyNs),
		}
	}
	return result
}

// StartDNSLatencyCollector reads DNS latency events from the eBPF ring buffer
func StartDNSLatencyCollector() {
	log.Println("[DNS Collector] Starting DNS Latency Collector...")

	// Wait for loader to initialize
	for loader.DNSObjs == nil {
		log.Println("[DNS Collector] Waiting for BPF objects to load...")
		time.Sleep(100 * time.Millisecond)
	}

	rbMap := loader.DNSObjs.Maps["dns_events"]
	if rbMap == nil {
		log.Println("[DNS Collector] ERROR: ringbuf map 'dns_events' not found")
		return
	}

	rd, err := ringbuf.NewReader(rbMap)
	if err != nil {
		log.Printf("[DNS Collector] ERROR: Failed to open ringbuf reader: %v", err)
		return
	}
	defer rd.Close()

	log.Println("[DNS Collector] Successfully attached to dns_events ringbuf")
	log.Println("[DNS Collector] Listening for DNS events...")

	for {
		record, err := rd.Read()
		if err != nil {
			if err == ringbuf.ErrClosed {
				log.Println("[DNS Collector] Ring buffer closed, exiting")
				return
			}
			log.Printf("[DNS Collector] Error reading record: %v", err)
			continue
		}

		if len(record.RawSample) < int(unsafe.Sizeof(DNSEvent{})) {
			log.Printf("[DNS Collector] Record too small: %d bytes", len(record.RawSample))
			continue
		}

		// Parse the event
		event := parseDNSEvent(record.RawSample)

		// Update metrics
		updateDNSMetrics(event)

		// Log the event
		latencyUs := float64(event.LatencyNs) / 1000.0
		latencyMs := latencyUs / 1000.0

		log.Printf("[DNS] PID=%d Latency=%.2fμs (%.3fms) Timestamp=%d",
			event.Pid, latencyUs, latencyMs, event.TimestampNs)
	}
}

// DNSCollector implements the Collector interface for DNS latency metrics
// This is kept in the same file for consistency with RTT pattern
// Components can use either:
//   - Direct functions: GetPodDNSMetrics(), GetDNSMetrics()
//   - Collector interface: GlobalRegistry.Get(MetricTypeDNS).Subscribe()
type DNSCollector struct {
	subscribers []chan Metric
	subMutex    sync.RWMutex
	nodeName    string
}

// NewDNSCollector creates a new DNS collector
func NewDNSCollector(nodeName string) *DNSCollector {
	return &DNSCollector{
		subscribers: make([]chan Metric, 0),
		nodeName:    nodeName,
	}
}

// GetType returns the metric type
func (c *DNSCollector) GetType() MetricType {
	return MetricTypeDNS
}

// GetNodeMetrics returns current node-level DNS metrics
func (c *DNSCollector) GetNodeMetrics() NodeMetric {
	metrics := GetDNSMetrics()

	avgLatency := float64(0)
	if metrics.TotalEvents > 0 {
		avgLatency = float64(metrics.TotalLatencyNs) / float64(metrics.TotalEvents)
	}

	value := DNSMetricValue{
		TotalEvents:    metrics.TotalEvents,
		TotalLatencyNs: metrics.TotalLatencyNs,
		AvgLatencyNs:   avgLatency,
		MinLatencyNs:   metrics.MinLatencyNs,
		MaxLatencyNs:   metrics.MaxLatencyNs,
		LastLatencyNs:  metrics.LastLatencyNs,
	}

	return NodeMetric{
		Type:      MetricTypeDNS,
		Timestamp: time.Now(),
		NodeName:  c.nodeName,
		Value:     value,
	}
}

// GetPodMetrics returns current pod-level DNS metrics
func (c *DNSCollector) GetPodMetrics() map[string]PodMetric {
	podMetrics := GetPodDNSMetrics()
	result := make(map[string]PodMetric)

	for podKey, metrics := range podMetrics {
		parts := strings.Split(podKey, "/")
		if len(parts) != 2 {
			continue
		}

		avgLatency := float64(0)
		if metrics.TotalEvents > 0 {
			avgLatency = float64(metrics.TotalLatencyNs) / float64(metrics.TotalEvents)
		}

		value := DNSMetricValue{
			TotalEvents:    metrics.TotalEvents,
			TotalLatencyNs: metrics.TotalLatencyNs,
			AvgLatencyNs:   avgLatency,
			MinLatencyNs:   metrics.MinLatencyNs,
			MaxLatencyNs:   metrics.MaxLatencyNs,
			LastLatencyNs:  metrics.LastLatencyNs,
		}

		result[podKey] = PodMetric{
			Type:      MetricTypeDNS,
			Timestamp: time.Now(),
			Namespace: parts[0],
			PodName:   parts[1],
			NodeName:  c.nodeName,
			Value:     value,
		}
	}

	return result
}

// Subscribe allows components to receive real-time metric updates
func (c *DNSCollector) Subscribe() <-chan Metric {
	c.subMutex.Lock()
	defer c.subMutex.Unlock()

	ch := make(chan Metric, 100)
	c.subscribers = append(c.subscribers, ch)
	return ch
}

// Unsubscribe removes a subscription
func (c *DNSCollector) Unsubscribe(ch <-chan Metric) {
	c.subMutex.Lock()
	defer c.subMutex.Unlock()

	for i, sub := range c.subscribers {
		if sub == ch {
			c.subscribers = append(c.subscribers[:i], c.subscribers[i+1:]...)
			close(sub)
			break
		}
	}
}

// notifySubscribers sends a metric update to all subscribers
func (c *DNSCollector) notifySubscribers(metric Metric) {
	c.subMutex.RLock()
	defer c.subMutex.RUnlock()

	for _, ch := range c.subscribers {
		select {
		case ch <- metric:
		default:
			// Channel full, skip
		}
	}
}

// OnMetricUpdate should be called when a new DNS event is processed
// This allows the collector to notify subscribers
func (c *DNSCollector) OnMetricUpdate(event DNSEvent) {
	// Get the pod key for this event
	ipStr := ipToString(event.SourceIP)
	ipToPodMapMutex.RLock()
	podKey := ipToPodMap[ipStr]
	ipToPodMapMutex.RUnlock()

	if podKey != "" {
		// Send pod-level metric update
		parts := strings.Split(podKey, "/")
		if len(parts) == 2 {
			podDNSMetricsMutex.RLock()
			podMetrics := podDNSMetrics[podKey]
			podDNSMetricsMutex.RUnlock()

			if podMetrics != nil {
				avgLatency := float64(0)
				totalEvents := atomic.LoadUint64(&podMetrics.TotalEvents)
				if totalEvents > 0 {
					avgLatency = float64(atomic.LoadUint64(&podMetrics.TotalLatencyNs)) / float64(totalEvents)
				}

				value := DNSMetricValue{
					TotalEvents:    totalEvents,
					TotalLatencyNs: atomic.LoadUint64(&podMetrics.TotalLatencyNs),
					AvgLatencyNs:   avgLatency,
					MinLatencyNs:   atomic.LoadUint64(&podMetrics.MinLatencyNs),
					MaxLatencyNs:   atomic.LoadUint64(&podMetrics.MaxLatencyNs),
					LastLatencyNs:  atomic.LoadUint64(&podMetrics.LastLatencyNs),
				}

				metric := PodMetric{
					Type:      MetricTypeDNS,
					Timestamp: time.Now(),
					Namespace: parts[0],
					PodName:   parts[1],
					NodeName:  c.nodeName,
					Value:     value,
				}

				c.notifySubscribers(metric)
			}
		}
	}
}

func parseDNSEvent(data []byte) DNSEvent {
	var event DNSEvent
	event.TimestampNs = binary.LittleEndian.Uint64(data[0:8])
	event.Pid = binary.LittleEndian.Uint32(data[8:12])
	event.SourceIP = binary.LittleEndian.Uint32(data[12:16])
	event.LatencyNs = binary.LittleEndian.Uint32(data[16:20])
	// Domain is at offset 20
	copy(event.Domain[:], data[20:])
	return event
}

func updateDNSMetrics(event DNSEvent) {
	// Update aggregated metrics
	atomic.AddUint64(&dnsMetrics.TotalEvents, 1)
	atomic.AddUint64(&dnsMetrics.TotalLatencyNs, uint64(event.LatencyNs))
	atomic.StoreUint64(&dnsMetrics.LastLatencyNs, uint64(event.LatencyNs))

	if uint64(event.LatencyNs) > atomic.LoadUint64(&dnsMetrics.MaxLatencyNs) {
		atomic.StoreUint64(&dnsMetrics.MaxLatencyNs, uint64(event.LatencyNs))
	}
	if uint64(event.LatencyNs) < atomic.LoadUint64(&dnsMetrics.MinLatencyNs) {
		atomic.StoreUint64(&dnsMetrics.MinLatencyNs, uint64(event.LatencyNs))
	}

	// Try PID-based mapping first (more reliable)
	var podKey string
	if containerMapper != nil {
		// Try to get pod from PID using container mapper
		containerInfo, err := containerMapper.GetContainerForPID(int32(event.Pid))
		if err == nil && containerInfo != nil {
			podKey = fmt.Sprintf("%s/%s", containerInfo.PodNamespace, containerInfo.PodName)
		}
	}

	// Fallback to IP-based mapping if PID mapping failed
	if podKey == "" {
		ipStr := ipToString(event.SourceIP)
		ipToPodMapMutex.RLock()
		podKey = ipToPodMap[ipStr]
		ipToPodMapMutex.RUnlock()
	}

	if podKey != "" {
		podDNSMetricsMutex.Lock()
		if podDNSMetrics[podKey] == nil {
			// Initialize new pod metrics
			parts := strings.Split(podKey, "/")
			podDNSMetrics[podKey] = &PodDNSMetrics{
				Namespace:    parts[0],
				PodName:      parts[1],
				MinLatencyNs: ^uint64(0),
			}
		}
		podMetrics := podDNSMetrics[podKey]
		podDNSMetricsMutex.Unlock()

		// Update pod-specific metrics
		atomic.AddUint64(&podMetrics.TotalEvents, 1)
		atomic.AddUint64(&podMetrics.TotalLatencyNs, uint64(event.LatencyNs))
		atomic.StoreUint64(&podMetrics.LastLatencyNs, uint64(event.LatencyNs))

		if uint64(event.LatencyNs) > atomic.LoadUint64(&podMetrics.MaxLatencyNs) {
			atomic.StoreUint64(&podMetrics.MaxLatencyNs, uint64(event.LatencyNs))
		}
		if uint64(event.LatencyNs) < atomic.LoadUint64(&podMetrics.MinLatencyNs) {
			atomic.StoreUint64(&podMetrics.MinLatencyNs, uint64(event.LatencyNs))
		}
	}

	// Update per-container metrics using pod IP and container info
	if containerMapper != nil && podKey != "" {
		// We already have the podKey from the IP mapping above
		containerInfo, err := containerMapper.GetContainerForPodAndPID(podKey, int32(event.Pid))
		if err == nil {
			// Successfully identified container
			containerKey := fmt.Sprintf("%s/%s/%s", containerInfo.PodNamespace, containerInfo.PodName, containerInfo.ContainerName)

			containerDNSMetricsMutex.Lock()
			if containerDNSMetrics[containerKey] == nil {
				// Initialize new container metrics
				containerDNSMetrics[containerKey] = &ContainerDNSMetrics{
					ContainerName: containerInfo.ContainerName,
					ContainerID:   containerInfo.ContainerID,
					PodName:       containerInfo.PodName,
					Namespace:     containerInfo.PodNamespace,
					MinLatencyNs:  ^uint64(0),
				}
			}
			containerMetrics := containerDNSMetrics[containerKey]
			containerDNSMetricsMutex.Unlock()

			// Update container-specific metrics
			atomic.AddUint64(&containerMetrics.TotalEvents, 1)
			atomic.AddUint64(&containerMetrics.TotalLatencyNs, uint64(event.LatencyNs))
			atomic.StoreUint64(&containerMetrics.LastLatencyNs, uint64(event.LatencyNs))

			if uint64(event.LatencyNs) > atomic.LoadUint64(&containerMetrics.MaxLatencyNs) {
				atomic.StoreUint64(&containerMetrics.MaxLatencyNs, uint64(event.LatencyNs))
			}
			if uint64(event.LatencyNs) < atomic.LoadUint64(&containerMetrics.MinLatencyNs) {
				atomic.StoreUint64(&containerMetrics.MinLatencyNs, uint64(event.LatencyNs))
			}
		}
	}

	// Notify subscribers of the update
	if globalDNSCollector != nil {
		globalDNSCollector.OnMetricUpdate(event)
	}
}

// ipToString converts a uint32 IP address to string format
func ipToString(ip uint32) string {
	return fmt.Sprintf("%d.%d.%d.%d",
		byte(ip), byte(ip>>8), byte(ip>>16), byte(ip>>24))
}

// refreshPodIPMapping periodically refreshes the IP-to-pod mapping from Kubernetes API
func refreshPodIPMapping() {
	// Import the K8s client from api package
	// We'll need to add this functionality
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// Do initial refresh
	updatePodIPMapping()

	for range ticker.C {
		updatePodIPMapping()
	}
}

// updatePodIPMapping queries K8s API and updates the IP-to-pod map
func updatePodIPMapping() {
	// This function will be called periodically
	// The actual K8s API call will be done via SetPodIPMapping
	// which is called by the api package to avoid circular dependencies
	log.Println("[DNS Collector] Pod IP mapping refresh triggered")
}

// SetPodIPMapping updates the IP-to-pod mapping (called by api package)
func SetPodIPMapping(mapping map[string]string) {
	ipToPodMapMutex.Lock()
	defer ipToPodMapMutex.Unlock()

	ipToPodMap = mapping
	log.Printf("[DNS Collector] Updated pod IP mapping with %d entries", len(mapping))
}
