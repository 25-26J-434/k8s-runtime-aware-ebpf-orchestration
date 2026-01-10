package telemetry

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
)

const (
	IOTypeRead  = 0
	IOTypeWrite = 1
	IOTypeOpen  = 2
	IOTypeClose = 3
)

type DiskIOEvent struct {
	PID         uint32
	TGID        uint32
	TimestampNs uint64
	LatencyNs   uint64
	SizeBytes   uint32
	IOType      uint8
	Comm        [16]byte
	Filename    [64]byte
}

type DiskIOMetrics struct {
	// Read metrics
	TotalReads       uint64  `json:"total_reads"`
	AvgReadLatencyNs uint64  `json:"avg_read_latency_ns"`
	MaxReadLatencyNs uint64  `json:"max_read_latency_ns"`
	TotalReadBytes   uint64  `json:"total_read_bytes"`
	
	// Write metrics
	TotalWrites       uint64  `json:"total_writes"`
	AvgWriteLatencyNs uint64  `json:"avg_write_latency_ns"`
	MaxWriteLatencyNs uint64  `json:"max_write_latency_ns"`
	TotalWriteBytes   uint64  `json:"total_write_bytes"`
	
	// File operations
	TotalOpens  uint64 `json:"total_opens"`
	TotalCloses uint64 `json:"total_closes"`
	
	// Queue depth
	CurrentQueueDepth uint64 `json:"current_queue_depth"`
	MaxQueueDepth     uint64 `json:"max_queue_depth"`
	AvgQueueDepth     float64 `json:"avg_queue_depth"`
	
	// Summary
	TotalIOOperations uint64  `json:"total_io_operations"`
	TotalIOBytes      uint64  `json:"total_io_bytes"`
	AvgIOLatencyNs    uint64  `json:"avg_io_latency_ns"`
	
	// Recent events
	RecentEvents []DiskIORecord `json:"recent_events,omitempty"`
}

type DiskIORecord struct {
	Timestamp   string `json:"timestamp"`
	IOType      string `json:"io_type"`
	LatencyUs   uint64 `json:"latency_us"`
	SizeBytes   uint32 `json:"size_bytes"`
	Filename    string `json:"filename,omitempty"`
	PodName     string `json:"pod_name,omitempty"`
	Namespace   string `json:"namespace,omitempty"`
	ContainerName string `json:"container_name,omitempty"`
}

var (
	diskIOSpec         *ebpf.CollectionSpec
	diskIOCollection   *ebpf.Collection
	diskIOLinks        []link.Link
	diskIOReader       *ringbuf.Reader
	diskIOMetrics      = &DiskIOMetrics{}
	diskIOPodMetrics   = make(map[string]*DiskIOMetrics)
	diskIOContainerMetrics = make(map[string]*DiskIOMetrics)
	diskIOMutex        sync.RWMutex
	diskIOContainerMapper *ContainerMapper
	
	// For queue depth tracking
	queueDepthSamples []uint64
	queueDepthMutex   sync.Mutex
)

func SetDiskIOContainerMapper(mapper *ContainerMapper) {
	diskIOContainerMapper = mapper
}

func LoadDiskIOBPF(spec *ebpf.CollectionSpec) error {
	diskIOSpec = spec
	
	var err error
	diskIOCollection, err = ebpf.NewCollection(spec)
	if err != nil {
		return fmt.Errorf("failed to create disk I/O eBPF collection: %w", err)
	}
	
	log.Println("[DiskIO] Disk I/O eBPF programs loaded successfully")
	return nil
}

func AttachDiskIOProbes() error {
	if diskIOCollection == nil {
		return fmt.Errorf("disk I/O eBPF collection not loaded")
	}
	
	// Attach kprobes/kretprobes for VFS operations
	probes := []struct {
		name     string
		progName string
	}{
		{"vfs_read", "kprobe_vfs_read"},
		{"vfs_read", "kretprobe_vfs_read"},
		{"vfs_write", "kprobe_vfs_write"},
		{"vfs_write", "kretprobe_vfs_write"},
		{"vfs_open", "kprobe_vfs_open"},
		{"filp_close", "kprobe_filp_close"},
	}
	
	for _, p := range probes {
		prog := diskIOCollection.Programs[p.progName]
		if prog == nil {
			log.Printf("[DiskIO] Warning: Program %s not found", p.progName)
			continue
		}
		
		var lnk link.Link
		var err error
		
		if p.progName[:8] == "kretprobe" {
			lnk, err = link.Kretprobe(p.name, prog, nil)
		} else {
			lnk, err = link.Kprobe(p.name, prog, nil)
		}
		
		if err != nil {
			log.Printf("[DiskIO] Warning: Failed to attach %s: %v", p.progName, err)
			continue
		}
		
		diskIOLinks = append(diskIOLinks, lnk)
		log.Printf("[DiskIO] Attached %s to %s", p.progName, p.name)
	}
	
	// Attach tracepoints for block layer
	tpProbes := []struct {
		group    string
		name     string
		progName string
	}{
		{"block", "block_rq_issue", "trace_block_rq_issue"},
		{"block", "block_rq_complete", "trace_block_rq_complete"},
	}
	
	for _, tp := range tpProbes {
		prog := diskIOCollection.Programs[tp.progName]
		if prog == nil {
			log.Printf("[DiskIO] Warning: Program %s not found", tp.progName)
			continue
		}
		
		lnk, err := link.Tracepoint(tp.group, tp.name, prog, nil)
		
		if err != nil {
			log.Printf("[DiskIO] Warning: Failed to attach tracepoint %s/%s: %v", tp.group, tp.name, err)
			continue
		}
		
		diskIOLinks = append(diskIOLinks, lnk)
		log.Printf("[DiskIO] Attached tracepoint %s/%s", tp.group, tp.name)
	}
	
	log.Printf("[DiskIO] Total probes attached: %d", len(diskIOLinks))
	
	// Open ring buffer
	ringBuf, ok := diskIOCollection.Maps["disk_io_events"]
	if !ok {
		return fmt.Errorf("disk_io_events ring buffer not found")
	}
	
	var err error
	diskIOReader, err = ringbuf.NewReader(ringBuf)
	if err != nil {
		return fmt.Errorf("failed to create ring buffer reader: %w", err)
	}
	
	log.Println("[DiskIO] Disk I/O ring buffer reader created")
	return nil
}

func StartDiskIOCollector() {
	log.Println("[DiskIO] Starting Disk I/O collector...")
	
	// Register with global registry
	GlobalRegistry.Register(diskIOMetrics)
	log.Println("[DiskIO] Registered disk_io collector with GlobalRegistry")
	
	// Start queue depth sampler
	go sampleQueueDepth()
	
	for {
		record, err := diskIOReader.Read()
		if err != nil {
			log.Printf("[DiskIO] Error reading from ring buffer: %v", err)
			time.Sleep(1 * time.Second)
			continue
		}
		
		var event DiskIOEvent
		if err := binary.Read(bytes.NewBuffer(record.RawSample), binary.LittleEndian, &event); err != nil {
			log.Printf("[DiskIO] Error parsing event: %v", err)
			continue
		}
		
		updateDiskIOMetrics(&event)
	}
}

func sampleQueueDepth() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	
	for range ticker.C {
		if diskIOCollection == nil {
			continue
		}
		
		queueDepthMap, ok := diskIOCollection.Maps["queue_depth_map"]
		if !ok {
			continue
		}
		
		var dev uint32 = 0
		var depth uint64
		
		err := queueDepthMap.Lookup(&dev, &depth)
		if err != nil {
			continue
		}
		
		queueDepthMutex.Lock()
		queueDepthSamples = append(queueDepthSamples, depth)
		if len(queueDepthSamples) > 100 {
			queueDepthSamples = queueDepthSamples[1:]
		}
		queueDepthMutex.Unlock()
		
		// Update current queue depth in metrics
		diskIOMutex.Lock()
		diskIOMetrics.CurrentQueueDepth = depth
		if depth > diskIOMetrics.MaxQueueDepth {
			diskIOMetrics.MaxQueueDepth = depth
		}
		diskIOMutex.Unlock()
	}
}

func updateDiskIOMetrics(event *DiskIOEvent) {
	diskIOMutex.Lock()
	defer diskIOMutex.Unlock()
	
	// Get container info from PID
	var podKey, containerKey string
	var podName, namespace, containerName string
	
	if diskIOContainerMapper != nil && event.PID > 0 && event.PID < 1000000 {
		containerInfo, err := diskIOContainerMapper.GetContainerForPID(int32(event.PID))
		if err == nil && containerInfo != nil {
			podName = containerInfo.PodName
			namespace = containerInfo.PodNamespace
			containerName = containerInfo.ContainerName
			podKey = fmt.Sprintf("%s/%s", namespace, podName)
			containerKey = fmt.Sprintf("%s/%s/%s", namespace, podName, containerName)
		}
	}
	
	// Update node-level metrics
	updateMetricsForEvent(diskIOMetrics, event)
	
	// Update pod-level metrics
	if podKey != "" {
		if diskIOPodMetrics[podKey] == nil {
			diskIOPodMetrics[podKey] = &DiskIOMetrics{}
		}
		updateMetricsForEvent(diskIOPodMetrics[podKey], event)
	}
	
	// Update container-level metrics
	if containerKey != "" {
		if diskIOContainerMetrics[containerKey] == nil {
			diskIOContainerMetrics[containerKey] = &DiskIOMetrics{}
		}
		updateMetricsForEvent(diskIOContainerMetrics[containerKey], event)
	}
	
	// Add to recent events (keep last 50)
	ioType := getIOTypeName(event.IOType)
	filename := string(bytes.TrimRight(event.Filename[:], "\x00"))
	
	record := DiskIORecord{
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
		IOType:        ioType,
		LatencyUs:     event.LatencyNs / 1000,
		SizeBytes:     event.SizeBytes,
		Filename:      filename,
		PodName:       podName,
		Namespace:     namespace,
		ContainerName: containerName,
	}
	
	diskIOMetrics.RecentEvents = append(diskIOMetrics.RecentEvents, record)
	if len(diskIOMetrics.RecentEvents) > 50 {
		diskIOMetrics.RecentEvents = diskIOMetrics.RecentEvents[1:]
	}
}

func updateMetricsForEvent(metrics *DiskIOMetrics, event *DiskIOEvent) {
	metrics.TotalIOOperations++
	
	switch event.IOType {
	case IOTypeRead:
		metrics.TotalReads++
		metrics.TotalReadBytes += uint64(event.SizeBytes)
		metrics.TotalIOBytes += uint64(event.SizeBytes)
		
		if event.LatencyNs > metrics.MaxReadLatencyNs {
			metrics.MaxReadLatencyNs = event.LatencyNs
		}
		
		// Update average
		if metrics.TotalReads == 1 {
			metrics.AvgReadLatencyNs = event.LatencyNs
		} else {
			metrics.AvgReadLatencyNs = (metrics.AvgReadLatencyNs*(metrics.TotalReads-1) + event.LatencyNs) / metrics.TotalReads
		}
		
	case IOTypeWrite:
		metrics.TotalWrites++
		metrics.TotalWriteBytes += uint64(event.SizeBytes)
		metrics.TotalIOBytes += uint64(event.SizeBytes)
		
		if event.LatencyNs > metrics.MaxWriteLatencyNs {
			metrics.MaxWriteLatencyNs = event.LatencyNs
		}
		
		// Update average
		if metrics.TotalWrites == 1 {
			metrics.AvgWriteLatencyNs = event.LatencyNs
		} else {
			metrics.AvgWriteLatencyNs = (metrics.AvgWriteLatencyNs*(metrics.TotalWrites-1) + event.LatencyNs) / metrics.TotalWrites
		}
		
	case IOTypeOpen:
		metrics.TotalOpens++
		
	case IOTypeClose:
		metrics.TotalCloses++
	}
	
	// Update overall average I/O latency
	totalLatencyOps := metrics.TotalReads + metrics.TotalWrites
	if totalLatencyOps > 0 {
		totalLatency := metrics.AvgReadLatencyNs*metrics.TotalReads + metrics.AvgWriteLatencyNs*metrics.TotalWrites
		metrics.AvgIOLatencyNs = totalLatency / totalLatencyOps
	}
	
	// Update average queue depth
	queueDepthMutex.Lock()
	if len(queueDepthSamples) > 0 {
		var sum uint64
		for _, d := range queueDepthSamples {
			sum += d
		}
		metrics.AvgQueueDepth = float64(sum) / float64(len(queueDepthSamples))
	}
	queueDepthMutex.Unlock()
}

func getIOTypeName(ioType uint8) string {
	switch ioType {
	case IOTypeRead:
		return "read"
	case IOTypeWrite:
		return "write"
	case IOTypeOpen:
		return "open"
	case IOTypeClose:
		return "close"
	default:
		return "unknown"
	}
}

func GetDiskIOMetrics() *DiskIOMetrics {
	diskIOMutex.RLock()
	defer diskIOMutex.RUnlock()
	
	// Return a copy
	metricsCopy := *diskIOMetrics
	return &metricsCopy
}

func GetPodDiskIOMetrics() map[string]*DiskIOMetrics {
	diskIOMutex.RLock()
	defer diskIOMutex.RUnlock()
	
	// Return a copy
	result := make(map[string]*DiskIOMetrics)
	for k, v := range diskIOPodMetrics {
		metricsCopy := *v
		result[k] = &metricsCopy
	}
	return result
}

func GetContainerDiskIOMetrics() map[string]*DiskIOMetrics {
	diskIOMutex.RLock()
	defer diskIOMutex.RUnlock()
	
	// Return a copy
	result := make(map[string]*DiskIOMetrics)
	for k, v := range diskIOContainerMetrics {
		metricsCopy := *v
		result[k] = &metricsCopy
	}
	return result
}

func CloseDiskIO() {
	if diskIOReader != nil {
		diskIOReader.Close()
	}
	
	for _, lnk := range diskIOLinks {
		lnk.Close()
	}
	
	if diskIOCollection != nil {
		diskIOCollection.Close()
	}
	
	log.Println("[DiskIO] Disk I/O collector closed")
}

// Implement Collector interface
func (m *DiskIOMetrics) GetType() MetricType {
	return "disk_io"
}

func (m *DiskIOMetrics) GetNodeMetrics() NodeMetric {
	return NodeMetric{
		Type:  "disk_io",
		Value: m,
	}
}

func (m *DiskIOMetrics) GetPodMetrics() map[string]PodMetric {
	result := make(map[string]PodMetric)
	
	diskIOMutex.RLock()
	defer diskIOMutex.RUnlock()
	
	for podKey, metrics := range diskIOPodMetrics {
		result[podKey] = PodMetric{
			Type:  "disk_io",
			Value: metrics,
		}
	}
	
	return result
}

func (m *DiskIOMetrics) GetContainerMetrics() map[string]PodMetric {
	result := make(map[string]PodMetric)
	
	diskIOMutex.RLock()
	defer diskIOMutex.RUnlock()
	
	for containerKey, metrics := range diskIOContainerMetrics {
		result[containerKey] = PodMetric{
			Type:  "disk_io",
			Value: metrics,
		}
	}
	
	return result
}

func (m *DiskIOMetrics) Subscribe() <-chan Metric {
	// Disk I/O metrics don't support real-time subscriptions yet
	// Return a dummy channel for now
	ch := make(chan Metric)
	return ch
}

func (m *DiskIOMetrics) Unsubscribe(ch <-chan Metric) {
	// Disk I/O metrics don't support subscriptions yet
	// This is a no-op
}

