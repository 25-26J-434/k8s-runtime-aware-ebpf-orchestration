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

var dnsMetrics DNSMetrics
var podDNSMetrics = make(map[string]*PodDNSMetrics) // keyed by "namespace/podname"
var podDNSMetricsMutex sync.RWMutex
var ipToPodMap = make(map[string]string) // IP -> "namespace/podname"
var ipToPodMapMutex sync.RWMutex

func init() {
	dnsMetrics.MinLatencyNs = ^uint64(0) // Max uint64
	// Start periodic pod IP refresh
	go refreshPodIPMapping()
}

// Global DNS collector instance
var globalDNSCollector *DNSCollector

// InitDNSCollector initializes the global DNS collector
func InitDNSCollector(nodeName string) {
	globalDNSCollector = NewDNSCollector(nodeName)
	// Register with global registry
	GlobalRegistry.Register(globalDNSCollector)
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

	// Update per-pod metrics
	ipStr := ipToString(event.SourceIP)
	ipToPodMapMutex.RLock()
	podKey := ipToPodMap[ipStr]
	ipToPodMapMutex.RUnlock()

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
