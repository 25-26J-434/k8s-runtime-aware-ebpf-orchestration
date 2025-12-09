package telemetry

import (
	"encoding/binary"
	"fmt"
	"log"
	"net"
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

// RTTMetrics holds aggregated RTT metrics
type RTTMetrics struct {
	TotalEvents   uint64
	TotalRTTNs    uint64
	LastRTTNs     uint64
	MaxRTTNs      uint64
	MinRTTNs      uint64
}

var rttMetrics RTTMetrics

func init() {
	rttMetrics.MinRTTNs = ^uint64(0) // Max uint64
}

// GetRTTMetrics returns the current RTT metrics
func GetRTTMetrics() RTTMetrics {
	return RTTMetrics{
		TotalEvents: atomic.LoadUint64(&rttMetrics.TotalEvents),
		TotalRTTNs:  atomic.LoadUint64(&rttMetrics.TotalRTTNs),
		LastRTTNs:   atomic.LoadUint64(&rttMetrics.LastRTTNs),
		MaxRTTNs:    atomic.LoadUint64(&rttMetrics.MaxRTTNs),
		MinRTTNs:    atomic.LoadUint64(&rttMetrics.MinRTTNs),
	}
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
	atomic.AddUint64(&rttMetrics.TotalEvents, 1)
	atomic.AddUint64(&rttMetrics.TotalRTTNs, event.RTTNs)
	atomic.StoreUint64(&rttMetrics.LastRTTNs, event.RTTNs)

	if event.RTTNs > atomic.LoadUint64(&rttMetrics.MaxRTTNs) {
		atomic.StoreUint64(&rttMetrics.MaxRTTNs, event.RTTNs)
	}

	if event.RTTNs < atomic.LoadUint64(&rttMetrics.MinRTTNs) {
		atomic.StoreUint64(&rttMetrics.MinRTTNs, event.RTTNs)
	}
}

func intToIP(ip uint32) string {
	return fmt.Sprintf("%s", net.IPv4(byte(ip), byte(ip>>8), byte(ip>>16), byte(ip>>24)))
}

