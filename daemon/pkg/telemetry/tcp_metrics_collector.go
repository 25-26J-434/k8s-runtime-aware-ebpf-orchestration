package telemetry

import (
	"encoding/binary"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/loader"
	"github.com/cilium/ebpf/ringbuf"
)

// TCPMetricsEvent represents a TCP metrics event from the kernel
type TCPMetricsEvent struct {
	Pid          uint32
	SAddr        uint32
	DAddr        uint32
	Sport        uint16
	Dport        uint16
	EventType    uint8 // 1=RTT, 2=Retransmission, 3=CWND, 4=PacketLoss, 5=StateTransition, 6=BadHandshake
	TCPState     uint8
	SRTTUs       uint32 // Smoothed RTT in microseconds
	MinRTTUs     uint32 // Minimum RTT in microseconds
	CWND         uint32 // Congestion window
	RetransCount uint32
	TimestampNs  uint64
}

// TCPEventRecord represents a single TCP event (retransmission or packet loss)
type TCPEventRecord struct {
	Timestamp    time.Time
	PodKey       string
	PodName      string
	Namespace    string
	SourceIP     string
	DestIP       string
	SourcePort   uint16
	DestPort     uint16
	EventType    string // "retransmission" or "packet_loss"
	SRTTUs       uint32
	MinRTTUs     uint32
	CWND         uint32
	RetransCount uint32
}

// TCPMetrics holds aggregated TCP metrics (node-level)
type TCPMetrics struct {
	TotalEvents      uint64
	SmoothedRTTUs    uint64
	MinRTTUs         uint64
	Retransmissions  uint64
	PacketLoss       uint64
	StateTransitions map[string]uint64
	BadHandshakes    uint64
	LastSRTTUs       uint32
	LastMinRTTUs     uint32
	LastCWND         uint32
	RecentEvents     []TCPEventRecord // Recent retransmissions and packet loss events
	mu               sync.RWMutex
}

// PodTCPMetrics holds per-pod TCP metrics
type PodTCPMetrics struct {
	PodName          string
	Namespace        string
	TotalEvents      uint64
	SmoothedRTTUs    uint64
	MinRTTUs         uint64
	Retransmissions  uint64
	PacketLoss       uint64
	BadHandshakes    uint64
	StateTransitions map[string]uint64
	LastSRTTUs       uint32
	LastMinRTTUs     uint32
	LastCWND         uint32
	RecentEvents     []TCPEventRecord // Recent events for this pod
}

// ContainerTCPMetrics holds per-container TCP metrics
type ContainerTCPMetrics struct {
	ContainerName    string
	ContainerID      string
	PodName          string
	Namespace        string
	TotalEvents      uint64
	SmoothedRTTUs    uint64
	MinRTTUs         uint64
	Retransmissions  uint64
	PacketLoss       uint64
	BadHandshakes    uint64
	StateTransitions map[string]uint64
	LastSRTTUs       uint32
	LastMinRTTUs     uint32
	LastCWND         uint32
	RecentEvents     []TCPEventRecord // Recent events for this container
}

var tcpMetrics TCPMetrics
var podTCPMetrics = make(map[string]*PodTCPMetrics)            // keyed by "namespace/podname"
var containerTCPMetrics = make(map[string]*ContainerTCPMetrics) // keyed by "namespace/podname/containername"
var tcpMetricsMutex sync.RWMutex
var containerTCPMetricsMutex sync.RWMutex

func init() {
	tcpMetrics.StateTransitions = make(map[string]uint64)
	tcpMetrics.MinRTTUs = ^uint64(0)                         // Max uint64
	tcpMetrics.RecentEvents = make([]TCPEventRecord, 0, 100) // Keep last 100 events
}

// Global TCP metrics collector instance
var globalTCPMetricsCollector *TCPMetricsCollector
var tcpContainerMapper *ContainerMapper

// InitTCPMetricsCollector initializes the global TCP metrics collector
func InitTCPMetricsCollector(nodeName string) {
	globalTCPMetricsCollector = NewTCPMetricsCollector(nodeName)
	// Register with global registry
	if err := GlobalRegistry.Register(globalTCPMetricsCollector); err != nil {
		log.Printf("[TCP Metrics Collector] WARNING: Failed to register TCP metrics collector: %v", err)
	} else {
		log.Println("[TCP Metrics Collector] Registered with global registry")
	}
}

// SetTCPContainerMapper sets the container mapper for TCP collector
func SetTCPContainerMapper(cm *ContainerMapper) {
	tcpContainerMapper = cm
}

// GetTCPMetrics returns the current node-level TCP metrics
func GetTCPMetrics() TCPMetrics {
	tcpMetricsMutex.RLock()
	defer tcpMetricsMutex.RUnlock()

	stateTransitions := make(map[string]uint64)
	for k, v := range tcpMetrics.StateTransitions {
		stateTransitions[k] = v
	}

	// Copy recent events (last 100)
	recentEvents := make([]TCPEventRecord, len(tcpMetrics.RecentEvents))
	if len(tcpMetrics.RecentEvents) > 0 {
		copy(recentEvents, tcpMetrics.RecentEvents)
	}

	return TCPMetrics{
		TotalEvents:      atomic.LoadUint64(&tcpMetrics.TotalEvents),
		SmoothedRTTUs:    atomic.LoadUint64(&tcpMetrics.SmoothedRTTUs),
		MinRTTUs:         atomic.LoadUint64(&tcpMetrics.MinRTTUs),
		Retransmissions:  atomic.LoadUint64(&tcpMetrics.Retransmissions),
		PacketLoss:       atomic.LoadUint64(&tcpMetrics.PacketLoss),
		StateTransitions: stateTransitions,
		BadHandshakes:    atomic.LoadUint64(&tcpMetrics.BadHandshakes),
		LastSRTTUs:       atomic.LoadUint32(&tcpMetrics.LastSRTTUs),
		LastMinRTTUs:     atomic.LoadUint32(&tcpMetrics.LastMinRTTUs),
		LastCWND:         atomic.LoadUint32(&tcpMetrics.LastCWND),
		RecentEvents:     recentEvents,
	}
}

// GetPodTCPMetrics returns a copy of all per-pod TCP metrics
func GetPodTCPMetrics() map[string]PodTCPMetrics {
	tcpMetricsMutex.RLock()
	defer tcpMetricsMutex.RUnlock()

	result := make(map[string]PodTCPMetrics)
	for key, metrics := range podTCPMetrics {
		stateTransitions := make(map[string]uint64)
		for k, v := range metrics.StateTransitions {
			stateTransitions[k] = atomic.LoadUint64(&v)
		}

		podStateTransitions := make(map[string]uint64)
		if metrics.StateTransitions != nil {
			for k, v := range metrics.StateTransitions {
				podStateTransitions[k] = v
			}
		}

		// Copy recent events for this pod (lock already held)
		podRecentEvents := make([]TCPEventRecord, 0)
		if metrics.RecentEvents != nil {
			podRecentEvents = make([]TCPEventRecord, len(metrics.RecentEvents))
			copy(podRecentEvents, metrics.RecentEvents)
		}

		result[key] = PodTCPMetrics{
			PodName:          metrics.PodName,
			Namespace:        metrics.Namespace,
			TotalEvents:      atomic.LoadUint64(&metrics.TotalEvents),
			SmoothedRTTUs:    atomic.LoadUint64(&metrics.SmoothedRTTUs),
			MinRTTUs:         atomic.LoadUint64(&metrics.MinRTTUs),
			Retransmissions:  atomic.LoadUint64(&metrics.Retransmissions),
			PacketLoss:       atomic.LoadUint64(&metrics.PacketLoss),
			BadHandshakes:    atomic.LoadUint64(&metrics.BadHandshakes),
			StateTransitions: podStateTransitions,
			LastSRTTUs:       atomic.LoadUint32(&metrics.LastSRTTUs),
			LastMinRTTUs:     atomic.LoadUint32(&metrics.LastMinRTTUs),
			LastCWND:         atomic.LoadUint32(&metrics.LastCWND),
			RecentEvents:     podRecentEvents,
		}
	}
	return result
}

// GetContainerTCPMetrics returns a copy of all per-container TCP metrics
func GetContainerTCPMetrics() map[string]ContainerTCPMetrics {
	containerTCPMetricsMutex.RLock()
	defer containerTCPMetricsMutex.RUnlock()

	result := make(map[string]ContainerTCPMetrics)
	for key, metrics := range containerTCPMetrics {
		containerStateTransitions := make(map[string]uint64)
		if metrics.StateTransitions != nil {
			for k, v := range metrics.StateTransitions {
				containerStateTransitions[k] = v
			}
		}

		// Copy recent events for this container (lock already held)
		containerRecentEvents := make([]TCPEventRecord, 0)
		if metrics.RecentEvents != nil {
			containerRecentEvents = make([]TCPEventRecord, len(metrics.RecentEvents))
			copy(containerRecentEvents, metrics.RecentEvents)
		}

		result[key] = ContainerTCPMetrics{
			ContainerName:    metrics.ContainerName,
			ContainerID:      metrics.ContainerID,
			PodName:          metrics.PodName,
			Namespace:        metrics.Namespace,
			TotalEvents:      atomic.LoadUint64(&metrics.TotalEvents),
			SmoothedRTTUs:    atomic.LoadUint64(&metrics.SmoothedRTTUs),
			MinRTTUs:         atomic.LoadUint64(&metrics.MinRTTUs),
			Retransmissions:  atomic.LoadUint64(&metrics.Retransmissions),
			PacketLoss:       atomic.LoadUint64(&metrics.PacketLoss),
			BadHandshakes:    atomic.LoadUint64(&metrics.BadHandshakes),
			StateTransitions: containerStateTransitions,
			LastSRTTUs:       atomic.LoadUint32(&metrics.LastSRTTUs),
			LastMinRTTUs:     atomic.LoadUint32(&metrics.LastMinRTTUs),
			LastCWND:         atomic.LoadUint32(&metrics.LastCWND),
			RecentEvents:     containerRecentEvents,
		}
	}
	return result
}

// StartTCPMetricsCollector reads TCP metrics events from the eBPF ring buffer
func StartTCPMetricsCollector() {
	log.Println("[TCP Metrics Collector] Starting TCP Metrics Collector...")

	// Wait for loader to initialize
	for loader.TCPMetricsObjs == nil {
		log.Println("[TCP Metrics Collector] Waiting for TCP Metrics BPF objects to load...")
		time.Sleep(100 * time.Millisecond)
	}

	// Check if TCP metrics events map exists
	rbMap := loader.TCPMetricsObjs.Maps["tcp_metrics_events"]
	if rbMap == nil {
		log.Println("[TCP Metrics Collector] NOTICE: tcp_metrics_events map not found - TCP metrics collection not enabled")
		return
	}

	rd, err := ringbuf.NewReader(rbMap)
	if err != nil {
		log.Printf("[TCP Metrics Collector] ERROR: Failed to open ringbuf reader: %v", err)
		return
	}
	defer rd.Close()

	log.Println("[TCP Metrics Collector] Successfully attached to tcp_metrics_events ringbuf")
	log.Println("[TCP Metrics Collector] Listening for TCP metrics events...")

	for {
		record, err := rd.Read()
		if err != nil {
			if err == ringbuf.ErrClosed {
				log.Println("[TCP Metrics Collector] Ring buffer closed, exiting")
				return
			}
			log.Printf("[TCP Metrics Collector] Error reading record: %v", err)
			continue
		}

		if len(record.RawSample) < 40 { // Minimum size for TCP metrics event
			log.Printf("[TCP Metrics Collector] Record too small: %d bytes", len(record.RawSample))
			continue
		}

		// Parse the event
		event := parseTCPMetricsEvent(record.RawSample)

		// Update metrics
		updateTCPMetrics(event)

		srcIP := intToIP(event.SAddr)
		dstIP := intToIP(event.DAddr)
		eventTypeStr := getEventTypeString(event.EventType)
		stateStr := getTCPStateString(event.TCPState)

		if event.EventType == 2 || event.EventType == 4 {
			log.Printf("[TCP Metrics] PID=%d %s:%d -> %s:%d Type=%s State=%s SRTT=%dμs MinRTT=%dμs CWND=%d Retrans=%d [IMPORTANT]",
				event.Pid, srcIP, event.Sport, dstIP, event.Dport, eventTypeStr, stateStr,
				event.SRTTUs, event.MinRTTUs, event.CWND, event.RetransCount)
		} else {
			log.Printf("[TCP Metrics] PID=%d %s:%d -> %s:%d Type=%s State=%s SRTT=%dμs MinRTT=%dμs CWND=%d Retrans=%d",
				event.Pid, srcIP, event.Sport, dstIP, event.Dport, eventTypeStr, stateStr,
				event.SRTTUs, event.MinRTTUs, event.CWND, event.RetransCount)
		}
	}
}

func parseTCPMetricsEvent(data []byte) TCPMetricsEvent {
	var event TCPMetricsEvent
	event.Pid = binary.LittleEndian.Uint32(data[0:4])
	event.SAddr = binary.LittleEndian.Uint32(data[4:8])
	event.DAddr = binary.LittleEndian.Uint32(data[8:12])
	event.Sport = binary.LittleEndian.Uint16(data[12:14])
	event.Dport = binary.LittleEndian.Uint16(data[14:16])
	event.EventType = data[16]
	event.TCPState = data[17]
	event.SRTTUs = binary.LittleEndian.Uint32(data[18:22])
	event.MinRTTUs = binary.LittleEndian.Uint32(data[22:26])
	event.CWND = binary.LittleEndian.Uint32(data[26:30])
	event.RetransCount = binary.LittleEndian.Uint32(data[30:34])
	event.TimestampNs = binary.LittleEndian.Uint64(data[34:42])
	return event
}

func updateTCPMetrics(event TCPMetricsEvent) {
	// Track active connections
	if globalConnectionTracker != nil {
		globalConnectionTracker.TrackConnection(event)
	}
	
	// Update node-level metrics
	atomic.AddUint64(&tcpMetrics.TotalEvents, 1)

	if event.SRTTUs > 0 {
		atomic.StoreUint32(&tcpMetrics.LastSRTTUs, event.SRTTUs)
		atomic.AddUint64(&tcpMetrics.SmoothedRTTUs, uint64(event.SRTTUs))
	}

	if event.MinRTTUs > 0 {
		if uint64(event.MinRTTUs) < atomic.LoadUint64(&tcpMetrics.MinRTTUs) {
			atomic.StoreUint64(&tcpMetrics.MinRTTUs, uint64(event.MinRTTUs))
		}
		atomic.StoreUint32(&tcpMetrics.LastMinRTTUs, event.MinRTTUs)
	}

	if event.CWND > 0 {
		atomic.StoreUint32(&tcpMetrics.LastCWND, event.CWND)
	}

	switch event.EventType {
	case 2: // Retransmission
		atomic.AddUint64(&tcpMetrics.Retransmissions, 1)
		// Record retransmission event with details
		recordRetransmissionEvent(event)
	case 4: // Packet Loss
		atomic.AddUint64(&tcpMetrics.PacketLoss, 1)
		// Record packet loss event with details
		recordPacketLossEvent(event)
	case 5: // State Transition
		stateStr := getTCPStateString(event.TCPState)
		tcpMetricsMutex.Lock()
		if tcpMetrics.StateTransitions[stateStr] == 0 {
			tcpMetrics.StateTransitions[stateStr] = 0
		}
		tcpMetrics.StateTransitions[stateStr]++
		tcpMetricsMutex.Unlock()
	case 6: // Bad Handshake
		atomic.AddUint64(&tcpMetrics.BadHandshakes, 1)
	}

	// Try PID-based mapping first (more reliable)
	var podKey string
	if tcpContainerMapper != nil {
		containerInfo, err := tcpContainerMapper.GetContainerForPID(int32(event.Pid))
		if err == nil && containerInfo != nil {
			podKey = fmt.Sprintf("%s/%s", containerInfo.PodNamespace, containerInfo.PodName)
		}
	}

	// Fallback to IP-based mapping if PID mapping failed
	if podKey == "" {
		ipStr := intToIP(event.SAddr)
		ipToPodMapMutex.RLock()
		podKey = ipToPodMap[ipStr]
		ipToPodMapMutex.RUnlock()
	}

	if podKey != "" {
		tcpMetricsMutex.Lock()
		if podTCPMetrics[podKey] == nil {
			parts := strings.Split(podKey, "/")
			podTCPMetrics[podKey] = &PodTCPMetrics{
				Namespace:        parts[0],
				PodName:          parts[1],
				StateTransitions: make(map[string]uint64),
				MinRTTUs:         ^uint64(0),
			}
		}
		podMetrics := podTCPMetrics[podKey]
		tcpMetricsMutex.Unlock()

		atomic.AddUint64(&podMetrics.TotalEvents, 1)

		if event.SRTTUs > 0 {
			atomic.StoreUint32(&podMetrics.LastSRTTUs, event.SRTTUs)
			atomic.AddUint64(&podMetrics.SmoothedRTTUs, uint64(event.SRTTUs))
		}

		if event.MinRTTUs > 0 {
			if uint64(event.MinRTTUs) < atomic.LoadUint64(&podMetrics.MinRTTUs) {
				atomic.StoreUint64(&podMetrics.MinRTTUs, uint64(event.MinRTTUs))
			}
			atomic.StoreUint32(&podMetrics.LastMinRTTUs, event.MinRTTUs)
		}

		if event.CWND > 0 {
			atomic.StoreUint32(&podMetrics.LastCWND, event.CWND)
		}

		switch event.EventType {
		case 2: // Retransmission
			atomic.AddUint64(&podMetrics.Retransmissions, 1)
			// Record pod-level retransmission event
			recordPodRetransmissionEvent(podKey, podMetrics, event)
		case 4: // Packet Loss
			atomic.AddUint64(&podMetrics.PacketLoss, 1)
			// Record pod-level packet loss event
			recordPodPacketLossEvent(podKey, podMetrics, event)
		case 5: // State Transition
			stateStr := getTCPStateString(event.TCPState)
			tcpMetricsMutex.Lock()
			if podMetrics.StateTransitions == nil {
				podMetrics.StateTransitions = make(map[string]uint64)
			}
			if podMetrics.StateTransitions[stateStr] == 0 {
				podMetrics.StateTransitions[stateStr] = 0
			}
			podMetrics.StateTransitions[stateStr]++
			tcpMetricsMutex.Unlock()
		case 6: // Bad Handshake
			atomic.AddUint64(&podMetrics.BadHandshakes, 1)
		}
	}

	// Update per-container metrics if container mapper is available
	if tcpContainerMapper != nil {
		containerInfo, err := tcpContainerMapper.GetContainerForPID(int32(event.Pid))
		if err == nil {
			// Successfully identified container
			containerKey := fmt.Sprintf("%s/%s/%s", containerInfo.PodNamespace, containerInfo.PodName, containerInfo.ContainerName)

			containerTCPMetricsMutex.Lock()
			if containerTCPMetrics[containerKey] == nil {
				containerTCPMetrics[containerKey] = &ContainerTCPMetrics{
					ContainerName:    containerInfo.ContainerName,
					ContainerID:      containerInfo.ContainerID,
					PodName:          containerInfo.PodName,
					Namespace:        containerInfo.PodNamespace,
					StateTransitions: make(map[string]uint64),
					MinRTTUs:         ^uint64(0),
				}
			}
			containerMetrics := containerTCPMetrics[containerKey]
			containerTCPMetricsMutex.Unlock()

			atomic.AddUint64(&containerMetrics.TotalEvents, 1)

			if event.SRTTUs > 0 {
				atomic.StoreUint32(&containerMetrics.LastSRTTUs, event.SRTTUs)
				atomic.AddUint64(&containerMetrics.SmoothedRTTUs, uint64(event.SRTTUs))
			}

			if event.MinRTTUs > 0 {
				if uint64(event.MinRTTUs) < atomic.LoadUint64(&containerMetrics.MinRTTUs) {
					atomic.StoreUint64(&containerMetrics.MinRTTUs, uint64(event.MinRTTUs))
				}
				atomic.StoreUint32(&containerMetrics.LastMinRTTUs, event.MinRTTUs)
			}

			if event.CWND > 0 {
				atomic.StoreUint32(&containerMetrics.LastCWND, event.CWND)
			}

			switch event.EventType {
			case 2: // Retransmission
				atomic.AddUint64(&containerMetrics.Retransmissions, 1)
				// Record container-level retransmission event
				recordContainerRetransmissionEvent(containerKey, containerMetrics, event)
			case 4: // Packet Loss
				atomic.AddUint64(&containerMetrics.PacketLoss, 1)
				// Record container-level packet loss event
				recordContainerPacketLossEvent(containerKey, containerMetrics, event)
			case 5: // State Transition
				stateStr := getTCPStateString(event.TCPState)
				containerTCPMetricsMutex.Lock()
				if containerMetrics.StateTransitions == nil {
					containerMetrics.StateTransitions = make(map[string]uint64)
				}
				if containerMetrics.StateTransitions[stateStr] == 0 {
					containerMetrics.StateTransitions[stateStr] = 0
				}
				containerMetrics.StateTransitions[stateStr]++
				containerTCPMetricsMutex.Unlock()
			case 6: // Bad Handshake
				atomic.AddUint64(&containerMetrics.BadHandshakes, 1)
			}
		}
	}
}

// recordRetransmissionEvent records a retransmission event with details
func recordRetransmissionEvent(event TCPMetricsEvent) {
	tcpMetricsMutex.Lock()
	defer tcpMetricsMutex.Unlock()

	ipStr := intToIP(event.SAddr)
	ipToPodMapMutex.RLock()
	podKey := ipToPodMap[ipStr]
	ipToPodMapMutex.RUnlock()

	parts := strings.Split(podKey, "/")
	podName := "unknown"
	namespace := "unknown"
	if len(parts) == 2 {
		namespace = parts[0]
		podName = parts[1]
	}

	record := TCPEventRecord{
		Timestamp:    time.Now(),
		PodKey:       podKey,
		PodName:      podName,
		Namespace:    namespace,
		SourceIP:     intToIP(event.SAddr),
		DestIP:       intToIP(event.DAddr),
		SourcePort:   event.Sport,
		DestPort:     event.Dport,
		EventType:    "retransmission",
		SRTTUs:       event.SRTTUs,
		MinRTTUs:     event.MinRTTUs,
		CWND:         event.CWND,
		RetransCount: event.RetransCount,
	}

	// Initialize RecentEvents if nil
	if tcpMetrics.RecentEvents == nil {
		tcpMetrics.RecentEvents = make([]TCPEventRecord, 0, 100)
	}

	// Keep only last 100 events
	if len(tcpMetrics.RecentEvents) >= 100 {
		tcpMetrics.RecentEvents = tcpMetrics.RecentEvents[1:]
	}
	tcpMetrics.RecentEvents = append(tcpMetrics.RecentEvents, record)

	log.Printf("[TCP Events] Recorded retransmission: Pod=%s IP=%s:%d->%s:%d", podName, intToIP(event.SAddr), event.Sport, intToIP(event.DAddr), event.Dport)
}

// recordPacketLossEvent records a packet loss event with details
func recordPacketLossEvent(event TCPMetricsEvent) {
	tcpMetricsMutex.Lock()
	defer tcpMetricsMutex.Unlock()

	ipStr := intToIP(event.SAddr)
	ipToPodMapMutex.RLock()
	podKey := ipToPodMap[ipStr]
	ipToPodMapMutex.RUnlock()

	parts := strings.Split(podKey, "/")
	podName := "unknown"
	namespace := "unknown"
	if len(parts) == 2 {
		namespace = parts[0]
		podName = parts[1]
	}

	record := TCPEventRecord{
		Timestamp:    time.Now(),
		PodKey:       podKey,
		PodName:      podName,
		Namespace:    namespace,
		SourceIP:     intToIP(event.SAddr),
		DestIP:       intToIP(event.DAddr),
		SourcePort:   event.Sport,
		DestPort:     event.Dport,
		EventType:    "packet_loss",
		SRTTUs:       event.SRTTUs,
		MinRTTUs:     event.MinRTTUs,
		CWND:         event.CWND,
		RetransCount: event.RetransCount,
	}

	// Initialize RecentEvents if nil
	if tcpMetrics.RecentEvents == nil {
		tcpMetrics.RecentEvents = make([]TCPEventRecord, 0, 100)
	}

	// Keep only last 100 events
	if len(tcpMetrics.RecentEvents) >= 100 {
		tcpMetrics.RecentEvents = tcpMetrics.RecentEvents[1:]
	}
	tcpMetrics.RecentEvents = append(tcpMetrics.RecentEvents, record)

	log.Printf("[TCP Events] Recorded packet loss: Pod=%s IP=%s:%d->%s:%d", podName, intToIP(event.SAddr), event.Sport, intToIP(event.DAddr), event.Dport)
}

// recordPodRetransmissionEvent records a pod-level retransmission event
func recordPodRetransmissionEvent(podKey string, podMetrics *PodTCPMetrics, event TCPMetricsEvent) {
	tcpMetricsMutex.Lock()
	defer tcpMetricsMutex.Unlock()

	if podMetrics.RecentEvents == nil {
		podMetrics.RecentEvents = make([]TCPEventRecord, 0, 50)
	}

	record := TCPEventRecord{
		Timestamp:    time.Now(),
		PodKey:       podKey,
		PodName:      podMetrics.PodName,
		Namespace:    podMetrics.Namespace,
		SourceIP:     intToIP(event.SAddr),
		DestIP:       intToIP(event.DAddr),
		SourcePort:   event.Sport,
		DestPort:     event.Dport,
		EventType:    "retransmission",
		SRTTUs:       event.SRTTUs,
		MinRTTUs:     event.MinRTTUs,
		CWND:         event.CWND,
		RetransCount: event.RetransCount,
	}

	// Keep only last 50 events per pod
	if len(podMetrics.RecentEvents) >= 50 {
		podMetrics.RecentEvents = podMetrics.RecentEvents[1:]
	}
	podMetrics.RecentEvents = append(podMetrics.RecentEvents, record)
}

// recordPodPacketLossEvent records a pod-level packet loss event
func recordPodPacketLossEvent(podKey string, podMetrics *PodTCPMetrics, event TCPMetricsEvent) {
	tcpMetricsMutex.Lock()
	defer tcpMetricsMutex.Unlock()

	if podMetrics.RecentEvents == nil {
		podMetrics.RecentEvents = make([]TCPEventRecord, 0, 50)
	}

	record := TCPEventRecord{
		Timestamp:    time.Now(),
		PodKey:       podKey,
		PodName:      podMetrics.PodName,
		Namespace:    podMetrics.Namespace,
		SourceIP:     intToIP(event.SAddr),
		DestIP:       intToIP(event.DAddr),
		SourcePort:   event.Sport,
		DestPort:     event.Dport,
		EventType:    "packet_loss",
		SRTTUs:       event.SRTTUs,
		MinRTTUs:     event.MinRTTUs,
		CWND:         event.CWND,
		RetransCount: event.RetransCount,
	}

	// Keep only last 50 events per pod
	if len(podMetrics.RecentEvents) >= 50 {
		podMetrics.RecentEvents = podMetrics.RecentEvents[1:]
	}
	podMetrics.RecentEvents = append(podMetrics.RecentEvents, record)
}

// recordContainerRetransmissionEvent records a container-level retransmission event
func recordContainerRetransmissionEvent(containerKey string, containerMetrics *ContainerTCPMetrics, event TCPMetricsEvent) {
	containerTCPMetricsMutex.Lock()
	defer containerTCPMetricsMutex.Unlock()

	if containerMetrics.RecentEvents == nil {
		containerMetrics.RecentEvents = make([]TCPEventRecord, 0, 30)
	}

	record := TCPEventRecord{
		Timestamp:    time.Now(),
		PodKey:       fmt.Sprintf("%s/%s", containerMetrics.Namespace, containerMetrics.PodName),
		PodName:      containerMetrics.PodName,
		Namespace:    containerMetrics.Namespace,
		SourceIP:     intToIP(event.SAddr),
		DestIP:       intToIP(event.DAddr),
		SourcePort:   event.Sport,
		DestPort:     event.Dport,
		EventType:    "retransmission",
		SRTTUs:       event.SRTTUs,
		MinRTTUs:     event.MinRTTUs,
		CWND:         event.CWND,
		RetransCount: event.RetransCount,
	}

	// Keep only last 30 events per container
	if len(containerMetrics.RecentEvents) >= 30 {
		containerMetrics.RecentEvents = containerMetrics.RecentEvents[1:]
	}
	containerMetrics.RecentEvents = append(containerMetrics.RecentEvents, record)
}

// recordContainerPacketLossEvent records a container-level packet loss event
func recordContainerPacketLossEvent(containerKey string, containerMetrics *ContainerTCPMetrics, event TCPMetricsEvent) {
	containerTCPMetricsMutex.Lock()
	defer containerTCPMetricsMutex.Unlock()

	if containerMetrics.RecentEvents == nil {
		containerMetrics.RecentEvents = make([]TCPEventRecord, 0, 30)
	}

	record := TCPEventRecord{
		Timestamp:    time.Now(),
		PodKey:       fmt.Sprintf("%s/%s", containerMetrics.Namespace, containerMetrics.PodName),
		PodName:      containerMetrics.PodName,
		Namespace:    containerMetrics.Namespace,
		SourceIP:     intToIP(event.SAddr),
		DestIP:       intToIP(event.DAddr),
		SourcePort:   event.Sport,
		DestPort:     event.Dport,
		EventType:    "packet_loss",
		SRTTUs:       event.SRTTUs,
		MinRTTUs:     event.MinRTTUs,
		CWND:         event.CWND,
		RetransCount: event.RetransCount,
	}

	// Keep only last 30 events per container
	if len(containerMetrics.RecentEvents) >= 30 {
		containerMetrics.RecentEvents = containerMetrics.RecentEvents[1:]
	}
	containerMetrics.RecentEvents = append(containerMetrics.RecentEvents, record)
}

func getEventTypeString(eventType uint8) string {
	switch eventType {
	case 1:
		return "RTT"
	case 2:
		return "Retransmission"
	case 3:
		return "CWND"
	case 4:
		return "PacketLoss"
	case 5:
		return "StateTransition"
	case 6:
		return "BadHandshake"
	default:
		return "Unknown"
	}
}

func getTCPStateString(state uint8) string {
	switch state {
	case 1:
		return "ESTABLISHED"
	case 2:
		return "SYN_SENT"
	case 3:
		return "SYN_RECV"
	case 4:
		return "FIN_WAIT1"
	case 5:
		return "FIN_WAIT2"
	case 6:
		return "TIME_WAIT"
	case 7:
		return "CLOSE"
	case 8:
		return "CLOSE_WAIT"
	case 9:
		return "LAST_ACK"
	case 10:
		return "LISTEN"
	case 11:
		return "CLOSING"
	default:
		return "UNKNOWN"
	}
}

// TCPMetricsCollector implements the Collector interface for TCP metrics
type TCPMetricsCollector struct {
	nodeName string
	mu       sync.RWMutex
}

// NewTCPMetricsCollector creates a new TCP metrics collector
func NewTCPMetricsCollector(nodeName string) *TCPMetricsCollector {
	return &TCPMetricsCollector{
		nodeName: nodeName,
	}
}

// GetType returns the metric type
func (c *TCPMetricsCollector) GetType() MetricType {
	return MetricTypeTCP
}

// GetNodeMetrics returns current node-level TCP metrics
func (c *TCPMetricsCollector) GetNodeMetrics() NodeMetric {
	metrics := GetTCPMetrics()

	avgSRTT := float64(0)
	if metrics.TotalEvents > 0 && metrics.SmoothedRTTUs > 0 {
		avgSRTT = float64(metrics.SmoothedRTTUs) / float64(metrics.TotalEvents)
	}

	// Convert recent events to API format
	recentEventsAPI := make([]map[string]interface{}, 0, len(metrics.RecentEvents))
	for _, evt := range metrics.RecentEvents {
		recentEventsAPI = append(recentEventsAPI, map[string]interface{}{
			"timestamp":     evt.Timestamp.Format(time.RFC3339),
			"pod_key":       evt.PodKey,
			"pod_name":      evt.PodName,
			"namespace":     evt.Namespace,
			"source_ip":     evt.SourceIP,
			"dest_ip":       evt.DestIP,
			"source_port":   evt.SourcePort,
			"dest_port":     evt.DestPort,
			"event_type":    evt.EventType,
			"srtt_us":       evt.SRTTUs,
			"min_rtt_us":    evt.MinRTTUs,
			"cwnd":          evt.CWND,
			"retrans_count": evt.RetransCount,
		})
	}

	value := map[string]interface{}{
		"total_events":      metrics.TotalEvents,
		"smoothed_rtt_us":   metrics.SmoothedRTTUs,
		"avg_srtt_us":       avgSRTT,
		"min_rtt_us":        metrics.MinRTTUs,
		"retransmissions":   metrics.Retransmissions,
		"packet_loss":       metrics.PacketLoss,
		"bad_handshakes":    metrics.BadHandshakes,
		"state_transitions": metrics.StateTransitions,
		"last_srtt_us":      metrics.LastSRTTUs,
		"last_min_rtt_us":   metrics.LastMinRTTUs,
		"last_cwnd":         metrics.LastCWND,
		"recent_events":     recentEventsAPI, // Recent retransmissions and packet loss events
	}

	return NodeMetric{
		Type:      MetricTypeTCP,
		Timestamp: time.Now(),
		NodeName:  c.nodeName,
		Value:     value,
	}
}

// GetPodMetrics returns current pod-level TCP metrics
func (c *TCPMetricsCollector) GetPodMetrics() map[string]PodMetric {
	podMetrics := GetPodTCPMetrics()
	result := make(map[string]PodMetric)

	for podKey, metrics := range podMetrics {
		parts := strings.Split(podKey, "/")
		if len(parts) != 2 {
			continue
		}

		avgSRTT := float64(0)
		if metrics.TotalEvents > 0 && metrics.SmoothedRTTUs > 0 {
			avgSRTT = float64(metrics.SmoothedRTTUs) / float64(metrics.TotalEvents)
		}

		// Convert pod recent events to API format
		podRecentEventsAPI := make([]map[string]interface{}, 0, len(metrics.RecentEvents))
		for _, evt := range metrics.RecentEvents {
			podRecentEventsAPI = append(podRecentEventsAPI, map[string]interface{}{
				"timestamp":     evt.Timestamp.Format(time.RFC3339),
				"pod_key":       evt.PodKey,
				"pod_name":      evt.PodName,
				"namespace":     evt.Namespace,
				"source_ip":     evt.SourceIP,
				"dest_ip":       evt.DestIP,
				"source_port":   evt.SourcePort,
				"dest_port":     evt.DestPort,
				"event_type":    evt.EventType,
				"srtt_us":       evt.SRTTUs,
				"min_rtt_us":    evt.MinRTTUs,
				"cwnd":          evt.CWND,
				"retrans_count": evt.RetransCount,
			})
		}

		value := map[string]interface{}{
			"total_events":      metrics.TotalEvents,
			"smoothed_rtt_us":   metrics.SmoothedRTTUs,
			"avg_srtt_us":       avgSRTT,
			"min_rtt_us":        metrics.MinRTTUs,
			"retransmissions":   metrics.Retransmissions,
			"packet_loss":       metrics.PacketLoss,
			"bad_handshakes":    metrics.BadHandshakes,
			"state_transitions": metrics.StateTransitions,
			"last_srtt_us":      metrics.LastSRTTUs,
			"last_min_rtt_us":   metrics.LastMinRTTUs,
			"last_cwnd":         metrics.LastCWND,
			"recent_events":     podRecentEventsAPI, // Recent events for this pod
		}

		result[podKey] = PodMetric{
			Type:      MetricTypeTCP,
			Timestamp: time.Now(),
			Namespace: parts[0],
			PodName:   parts[1],
			NodeName:  c.nodeName,
			Value:     value,
		}
	}

	return result
}

// Subscribe allows components to receive real-time TCP metrics updates
func (c *TCPMetricsCollector) Subscribe() <-chan Metric {
	// Return nil channel for now - can be implemented later if needed
	return nil
}

// Unsubscribe removes a subscription
func (c *TCPMetricsCollector) Unsubscribe(ch <-chan Metric) {
	// No-op for now
}
