package telemetry

import (
	"encoding/binary"
	"fmt"
	"log"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/loader"
	"github.com/cilium/ebpf/ringbuf"
)

// RTTEvent represents a TCP RTT measurement from the kernel
type RTTEvent struct {
	Pid     uint32
	SAddr   uint32 // Source IP (network byte order)
	DAddr   uint32 // Destination IP (network byte order)
	RTTNs   uint64 // Round-trip time in nanoseconds
}

// RTTMetrics holds aggregated RTT metrics (node-level)
type RTTMetrics struct {
	TotalEvents   uint64
	TotalRTTNs    uint64
	LastRTTNs     uint64
	MaxRTTNs      uint64
	MinRTTNs      uint64
}

// PodRTTMetrics holds per-pod RTT metrics
type PodRTTMetrics struct {
	PodName      string
	Namespace    string
	TotalEvents  uint64
	TotalRTTNs   uint64
	LastRTTNs    uint64
	MaxRTTNs     uint64
	MinRTTNs     uint64
}

var rttMetrics RTTMetrics
var podRTTMetrics = make(map[string]*PodRTTMetrics) // keyed by "namespace/podname"
var podRTTMetricsMutex sync.RWMutex

func init() {
	rttMetrics.MinRTTNs = ^uint64(0) // Max uint64
}

// GetRTTMetrics returns the current node-level RTT metrics
func GetRTTMetrics() RTTMetrics {
	return RTTMetrics{
		TotalEvents: atomic.LoadUint64(&rttMetrics.TotalEvents),
		TotalRTTNs:  atomic.LoadUint64(&rttMetrics.TotalRTTNs),
		LastRTTNs:   atomic.LoadUint64(&rttMetrics.LastRTTNs),
		MaxRTTNs:    atomic.LoadUint64(&rttMetrics.MaxRTTNs),
		MinRTTNs:    atomic.LoadUint64(&rttMetrics.MinRTTNs),
	}
}

// GetPodRTTMetrics returns a copy of all per-pod RTT metrics
func GetPodRTTMetrics() map[string]PodRTTMetrics {
	podRTTMetricsMutex.RLock()
	defer podRTTMetricsMutex.RUnlock()

	result := make(map[string]PodRTTMetrics)
	for key, metrics := range podRTTMetrics {
		result[key] = PodRTTMetrics{
			PodName:     metrics.PodName,
			Namespace:   metrics.Namespace,
			TotalEvents: atomic.LoadUint64(&metrics.TotalEvents),
			TotalRTTNs:  atomic.LoadUint64(&metrics.TotalRTTNs),
			LastRTTNs:   atomic.LoadUint64(&metrics.LastRTTNs),
			MaxRTTNs:    atomic.LoadUint64(&metrics.MaxRTTNs),
			MinRTTNs:    atomic.LoadUint64(&metrics.MinRTTNs),
		}
	}
	return result
}

// StartRTTCollector reads RTT events from the eBPF ring buffer
func StartRTTCollector() {
	log.Println("[RTT Collector] Starting RTT Collector...")

	// Wait for loader to initialize
	for loader.DNSObjs == nil {
		log.Println("[RTT Collector] Waiting for BPF objects to load...")
		time.Sleep(100 * time.Millisecond)
	}

	// Check if RTT events map exists (will be added later)
	rbMap := loader.DNSObjs.Maps["rtt_events"]
	if rbMap == nil {
		log.Println("[RTT Collector] NOTICE: rtt_events map not found - RTT collection not enabled")
		log.Println("[RTT Collector] RTT collection requires separate BPF program with TCP tracing")
		return
	}

	rd, err := ringbuf.NewReader(rbMap)
	if err != nil {
		log.Printf("[RTT Collector] ERROR: Failed to open ringbuf reader: %v", err)
		return
	}
	defer rd.Close()

	log.Println("[RTT Collector] Successfully attached to rtt_events ringbuf")
	log.Println("[RTT Collector] Listening for RTT events...")

	for {
		record, err := rd.Read()
		if err != nil {
			if err == ringbuf.ErrClosed {
				log.Println("[RTT Collector] Ring buffer closed, exiting")
				return
			}
			log.Printf("[RTT Collector] Error reading record: %v", err)
			continue
		}

		if len(record.RawSample) < 20 { // 4+4+4+8 = 20 bytes
			log.Printf("[RTT Collector] Record too small: %d bytes", len(record.RawSample))
			continue
		}

		// Parse the event
		event := parseRTTEvent(record.RawSample)

		// Update metrics
		updateRTTMetrics(event)

		// Convert IPs to readable format
		srcIP := intToIP(event.SAddr)
		dstIP := intToIP(event.DAddr)
		rttUs := float64(event.RTTNs) / 1000.0
		rttMs := rttUs / 1000.0

		log.Printf("[RTT] PID=%d %s -> %s RTT=%.2fμs (%.3fms)",
			event.Pid, srcIP, dstIP, rttUs, rttMs)
	}
}

func parseRTTEvent(data []byte) RTTEvent {
	var event RTTEvent
	event.Pid = binary.LittleEndian.Uint32(data[0:4])
	event.SAddr = binary.LittleEndian.Uint32(data[4:8])
	event.DAddr = binary.LittleEndian.Uint32(data[8:12])
	event.RTTNs = binary.LittleEndian.Uint64(data[12:20])
	return event
}

func updateRTTMetrics(event RTTEvent) {
	// Update node-level metrics
	atomic.AddUint64(&rttMetrics.TotalEvents, 1)
	atomic.AddUint64(&rttMetrics.TotalRTTNs, event.RTTNs)
	atomic.StoreUint64(&rttMetrics.LastRTTNs, event.RTTNs)

	if event.RTTNs > atomic.LoadUint64(&rttMetrics.MaxRTTNs) {
		atomic.StoreUint64(&rttMetrics.MaxRTTNs, event.RTTNs)
	}

	if event.RTTNs < atomic.LoadUint64(&rttMetrics.MinRTTNs) {
		atomic.StoreUint64(&rttMetrics.MinRTTNs, event.RTTNs)
	}

	// Update per-pod metrics (using source IP)
	ipStr := intToIP(event.SAddr)
	ipToPodMapMutex.RLock()
	podKey := ipToPodMap[ipStr]
	ipToPodMapMutex.RUnlock()

	if podKey != "" {
		podRTTMetricsMutex.Lock()
		if podRTTMetrics[podKey] == nil {
			// Initialize new pod metrics
			parts := strings.Split(podKey, "/")
			podRTTMetrics[podKey] = &PodRTTMetrics{
				Namespace: parts[0],
				PodName:   parts[1],
				MinRTTNs:  ^uint64(0),
			}
		}
		podMetrics := podRTTMetrics[podKey]
		podRTTMetricsMutex.Unlock()

		// Update pod-specific metrics
		atomic.AddUint64(&podMetrics.TotalEvents, 1)
		atomic.AddUint64(&podMetrics.TotalRTTNs, event.RTTNs)
		atomic.StoreUint64(&podMetrics.LastRTTNs, event.RTTNs)

		if event.RTTNs > atomic.LoadUint64(&podMetrics.MaxRTTNs) {
			atomic.StoreUint64(&podMetrics.MaxRTTNs, event.RTTNs)
		}
		if event.RTTNs < atomic.LoadUint64(&podMetrics.MinRTTNs) {
			atomic.StoreUint64(&podMetrics.MinRTTNs, event.RTTNs)
		}
	}
}

func intToIP(ip uint32) string {
	return fmt.Sprintf("%s", net.IPv4(byte(ip), byte(ip>>8), byte(ip>>16), byte(ip>>24)))
}

