package telemetry

import (
	"encoding/binary"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/loader"
	"github.com/cilium/ebpf/ringbuf"
)

// SchedLatencyEvent represents a scheduling latency event from the kernel
type SchedLatencyEvent struct {
	Pid                uint32
	Tid                uint32
	CPU                uint32
	WakeupTimeNs       uint64
	ScheduleTimeNs     uint64
	RunqueueLatencyNs  uint64
	CPUTimeNs          uint64
	PrevState          uint8
	Comm               [16]byte
}

// SchedLatencyRecord represents a single scheduling latency record
type SchedLatencyRecord struct {
	Timestamp          time.Time
	PodKey             string
	PodName            string
	Namespace          string
	Pid                uint32
	Comm               string
	CPU                uint32
	RunqueueLatencyUs  uint64 // Run queue latency in microseconds
	CPUTimeUs          uint64 // CPU execution time in microseconds
}

// SchedLatencyMetrics holds aggregated scheduling latency metrics (node-level)
type SchedLatencyMetrics struct {
	TotalEvents         uint64    `json:"total_events"`
	AvgRunqueueLatencyUs float64   `json:"avg_runqueue_latency_us"`
	MaxRunqueueLatencyUs uint64    `json:"max_runqueue_latency_us"`
	MinRunqueueLatencyUs uint64    `json:"min_runqueue_latency_us"`
	P50RunqueueLatencyUs uint64    `json:"p50_runqueue_latency_us"`
	P95RunqueueLatencyUs uint64    `json:"p95_runqueue_latency_us"`
	P99RunqueueLatencyUs uint64    `json:"p99_runqueue_latency_us"`
	AvgCPUTimeUs        float64    `json:"avg_cpu_time_us"`
	CPUStarvationCount  uint64    `json:"cpu_starvation_count"` // Count of high latency events (>10ms)
	LastUpdate          time.Time `json:"last_update"`
}

// Per-pod scheduling latency metrics
type PodSchedLatencyMetrics struct {
	PodKey              string    `json:"pod_key"`
	PodName             string    `json:"pod_name"`
	Namespace           string    `json:"namespace"`
	EventCount          uint64    `json:"event_count"`
	AvgRunqueueLatencyUs float64   `json:"avg_runqueue_latency_us"`
	MaxRunqueueLatencyUs uint64    `json:"max_runqueue_latency_us"`
	AvgCPUTimeUs        float64    `json:"avg_cpu_time_us"`
	CPUStarvationCount  uint64    `json:"cpu_starvation_count"`
	LastSeen            time.Time `json:"last_seen"`
}

// Per-container scheduling latency metrics
type ContainerSchedLatencyMetrics struct {
	ContainerKey        string    `json:"container_key"` // namespace/pod/container
	ContainerName       string    `json:"container_name"`
	PodKey              string    `json:"pod_key"`
	PodName             string    `json:"pod_name"`
	Namespace           string    `json:"namespace"`
	EventCount          uint64    `json:"event_count"`
	AvgRunqueueLatencyUs float64   `json:"avg_runqueue_latency_us"`
	MaxRunqueueLatencyUs uint64    `json:"max_runqueue_latency_us"`
	AvgCPUTimeUs        float64    `json:"avg_cpu_time_us"`
	CPUStarvationCount  uint64    `json:"cpu_starvation_count"`
	LastSeen            time.Time `json:"last_seen"`
}

var (
	schedLatencyMetrics       SchedLatencyMetrics
	schedLatencyMu            sync.RWMutex
	schedLatencyRecords       []SchedLatencyRecord
	schedLatencyRecordsMu     sync.RWMutex
	podSchedMetrics           = make(map[string]*PodSchedLatencyMetrics)
	podSchedMetricsMu         sync.RWMutex
	containerSchedMetrics    = make(map[string]*ContainerSchedLatencyMetrics)
	containerSchedMetricsMu  sync.RWMutex
	schedLatencyHistogram     []uint64 // For percentile calculation
	schedHistogramMu          sync.Mutex
	schedContainerMapper      *ContainerMapper
)

// GetSchedLatencyMetrics returns the current node-level scheduling latency metrics
func GetSchedLatencyMetrics() SchedLatencyMetrics {
	schedLatencyMu.RLock()
	defer schedLatencyMu.RUnlock()
	return schedLatencyMetrics
}

// GetSchedLatencyRecords returns recent scheduling latency records
func GetSchedLatencyRecords(limit int) []SchedLatencyRecord {
	schedLatencyRecordsMu.RLock()
	defer schedLatencyRecordsMu.RUnlock()
	
	if len(schedLatencyRecords) == 0 {
		return []SchedLatencyRecord{}
	}
	
	if limit <= 0 || limit > len(schedLatencyRecords) {
		limit = len(schedLatencyRecords)
	}
	
	// Return most recent records
	start := len(schedLatencyRecords) - limit
	result := make([]SchedLatencyRecord, limit)
	copy(result, schedLatencyRecords[start:])
	return result
}

// GetPodSchedLatencyMetrics returns per-pod scheduling latency metrics
func GetPodSchedLatencyMetrics() map[string]*PodSchedLatencyMetrics {
	podSchedMetricsMu.RLock()
	defer podSchedMetricsMu.RUnlock()
	
	result := make(map[string]*PodSchedLatencyMetrics)
	for k, v := range podSchedMetrics {
		metricsCopy := *v
		result[k] = &metricsCopy
	}
	return result
}

// GetContainerSchedLatencyMetrics returns per-container scheduling latency metrics
func GetContainerSchedLatencyMetrics() map[string]*ContainerSchedLatencyMetrics {
	containerSchedMetricsMu.RLock()
	defer containerSchedMetricsMu.RUnlock()
	
	result := make(map[string]*ContainerSchedLatencyMetrics)
	for k, v := range containerSchedMetrics {
		metricsCopy := *v
		result[k] = &metricsCopy
	}
	return result
}

// SetSchedContainerMapper sets the container mapper for PID to pod mapping
func SetSchedContainerMapper(mapper *ContainerMapper) {
	schedContainerMapper = mapper
}

// StartSchedLatencyCollector starts collecting scheduling latency metrics
func StartSchedLatencyCollector() error {
	log.Println("[SchedLatency] Starting scheduling latency collector...")
	
	if loader.SchedLatencyObjs == nil {
		return fmt.Errorf("scheduling latency BPF objects not loaded")
	}
	
	ringbufMap := loader.SchedLatencyObjs.Maps["sched_events"]
	if ringbufMap == nil {
		return fmt.Errorf("sched_events ring buffer not found")
	}
	
	rd, err := ringbuf.NewReader(ringbufMap)
	if err != nil {
		return fmt.Errorf("failed to create ring buffer reader: %w", err)
	}
	
	log.Println("[SchedLatency] Scheduling latency collector started, listening for events...")
	
	go func() {
		defer rd.Close()
		
		for {
			record, err := rd.Read()
			if err != nil {
				log.Printf("[SchedLatency] Error reading from ring buffer: %v", err)
				continue
			}
			
			if len(record.RawSample) < 64 { // Minimum expected size
				continue
			}
			
			var event SchedLatencyEvent
			event.Pid = binary.LittleEndian.Uint32(record.RawSample[0:4])
			event.Tid = binary.LittleEndian.Uint32(record.RawSample[4:8])
			event.CPU = binary.LittleEndian.Uint32(record.RawSample[8:12])
			// 4 bytes padding
			event.WakeupTimeNs = binary.LittleEndian.Uint64(record.RawSample[16:24])
			event.ScheduleTimeNs = binary.LittleEndian.Uint64(record.RawSample[24:32])
			event.RunqueueLatencyNs = binary.LittleEndian.Uint64(record.RawSample[32:40])
			event.CPUTimeNs = binary.LittleEndian.Uint64(record.RawSample[40:48])
			event.PrevState = record.RawSample[48]
			copy(event.Comm[:], record.RawSample[49:65])
			
			updateSchedLatencyMetrics(&event)
		}
	}()
	
	return nil
}

func updateSchedLatencyMetrics(event *SchedLatencyEvent) {
	runqueueLatencyUs := event.RunqueueLatencyNs / 1000
	cpuTimeUs := event.CPUTimeNs / 1000
	
	// Skip if latency is unreasonably high (stale entry)
	if runqueueLatencyUs > 10000000 { // > 10 seconds
		return
	}
	
	// Extract command name
	comm := string(event.Comm[:])
	for i, c := range comm {
		if c == 0 {
			comm = comm[:i]
			break
		}
	}
	
	// Try to get pod and container information from container mapper
	// Following the guide: Map PID -> cgroup -> Kubernetes metadata (Pod/Container)
	podName := ""
	podNamespace := ""
	containerName := ""
	if schedContainerMapper != nil && event.Pid > 0 && event.Pid < 1000000 { // Valid PID range
		containerInfo, err := schedContainerMapper.GetContainerForPID(int32(event.Pid))
		if err == nil && containerInfo != nil {
			podName = containerInfo.PodName
			podNamespace = containerInfo.PodNamespace
			containerName = containerInfo.ContainerName
			
			// Log successful mappings occasionally for debugging
			if event.Pid%1000 == 0 {
				log.Printf("[SchedLatency] ✅ Mapped PID %d to %s/%s/%s", 
					event.Pid, podNamespace, podName, containerName)
			}
		} else {
			// Log failed mappings occasionally for debugging
			if event.Pid%1000 == 0 {
				log.Printf("[SchedLatency] ⚠️ Failed to map PID %d to container: %v", event.Pid, err)
			}
		}
	} else if event.Pid == 0 {
		// Skip PID 0 (kernel thread or invalid)
		return
	} else if event.Pid >= 1000000 {
		// PID looks invalid (too large), might be TGID - skip
		if event.Pid%10000 == 0 {
			log.Printf("[SchedLatency] Skipping invalid-looking PID %d (might be TGID)", event.Pid)
		}
		return
	}
	podKey := fmt.Sprintf("%s/%s", podNamespace, podName)
	containerKey := fmt.Sprintf("%s/%s/%s", podNamespace, podName, containerName)
	
	// Create record
	record := SchedLatencyRecord{
		Timestamp:         time.Now(),
		PodKey:            podKey,
		PodName:           podName,
		Namespace:         podNamespace,
		Pid:               event.Pid,
		Comm:              comm,
		CPU:               event.CPU,
		RunqueueLatencyUs: runqueueLatencyUs,
		CPUTimeUs:         cpuTimeUs,
	}
	
	// Store record
	schedLatencyRecordsMu.Lock()
	schedLatencyRecords = append(schedLatencyRecords, record)
	if len(schedLatencyRecords) > 1000 {
		schedLatencyRecords = schedLatencyRecords[len(schedLatencyRecords)-1000:]
	}
	schedLatencyRecordsMu.Unlock()
	
	// Update histogram for percentile calculation
	schedHistogramMu.Lock()
	schedLatencyHistogram = append(schedLatencyHistogram, runqueueLatencyUs)
	if len(schedLatencyHistogram) > 10000 {
		schedLatencyHistogram = schedLatencyHistogram[len(schedLatencyHistogram)-10000:]
	}
	schedHistogramMu.Unlock()
	
	// Update node-level metrics
	schedLatencyMu.Lock()
	schedLatencyMetrics.TotalEvents++
	
	// Update average latency
	if schedLatencyMetrics.TotalEvents == 1 {
		schedLatencyMetrics.AvgRunqueueLatencyUs = float64(runqueueLatencyUs)
		schedLatencyMetrics.AvgCPUTimeUs = float64(cpuTimeUs)
		schedLatencyMetrics.MinRunqueueLatencyUs = runqueueLatencyUs
	} else {
		schedLatencyMetrics.AvgRunqueueLatencyUs = (schedLatencyMetrics.AvgRunqueueLatencyUs*float64(schedLatencyMetrics.TotalEvents-1) + float64(runqueueLatencyUs)) / float64(schedLatencyMetrics.TotalEvents)
		schedLatencyMetrics.AvgCPUTimeUs = (schedLatencyMetrics.AvgCPUTimeUs*float64(schedLatencyMetrics.TotalEvents-1) + float64(cpuTimeUs)) / float64(schedLatencyMetrics.TotalEvents)
		
		if runqueueLatencyUs < schedLatencyMetrics.MinRunqueueLatencyUs {
			schedLatencyMetrics.MinRunqueueLatencyUs = runqueueLatencyUs
		}
	}
	
	if runqueueLatencyUs > schedLatencyMetrics.MaxRunqueueLatencyUs {
		schedLatencyMetrics.MaxRunqueueLatencyUs = runqueueLatencyUs
	}
	
	// Count CPU starvation events (>10ms runqueue latency)
	if runqueueLatencyUs > 10000 {
		schedLatencyMetrics.CPUStarvationCount++
	}
	
	schedLatencyMetrics.LastUpdate = time.Now()
	
	// Calculate percentiles every 100 events
	if schedLatencyMetrics.TotalEvents%100 == 0 {
		calculateSchedLatencyPercentiles()
	}
	
	schedLatencyMu.Unlock()
	
	// Update per-pod metrics
	if podName != "" {
		podSchedMetricsMu.Lock()
		podMetrics, exists := podSchedMetrics[podKey]
		if !exists {
			podMetrics = &PodSchedLatencyMetrics{
				PodKey:    podKey,
				PodName:   podName,
				Namespace: podNamespace,
			}
			podSchedMetrics[podKey] = podMetrics
		}
		
		podMetrics.EventCount++
		if podMetrics.EventCount == 1 {
			podMetrics.AvgRunqueueLatencyUs = float64(runqueueLatencyUs)
			podMetrics.AvgCPUTimeUs = float64(cpuTimeUs)
		} else {
			podMetrics.AvgRunqueueLatencyUs = (podMetrics.AvgRunqueueLatencyUs*float64(podMetrics.EventCount-1) + float64(runqueueLatencyUs)) / float64(podMetrics.EventCount)
			podMetrics.AvgCPUTimeUs = (podMetrics.AvgCPUTimeUs*float64(podMetrics.EventCount-1) + float64(cpuTimeUs)) / float64(podMetrics.EventCount)
		}
		
		if runqueueLatencyUs > podMetrics.MaxRunqueueLatencyUs {
			podMetrics.MaxRunqueueLatencyUs = runqueueLatencyUs
		}
		
		if runqueueLatencyUs > 10000 {
			podMetrics.CPUStarvationCount++
		}
		
		podMetrics.LastSeen = time.Now()
		podSchedMetricsMu.Unlock()
	}

	// Update per-container metrics
	if containerName != "" && podName != "" {
		containerSchedMetricsMu.Lock()
		containerMetrics, exists := containerSchedMetrics[containerKey]
		if !exists {
			containerMetrics = &ContainerSchedLatencyMetrics{
				ContainerKey:  containerKey,
				ContainerName: containerName,
				PodKey:        podKey,
				PodName:       podName,
				Namespace:     podNamespace,
			}
			containerSchedMetrics[containerKey] = containerMetrics
		}
		
		containerMetrics.EventCount++
		if containerMetrics.EventCount == 1 {
			containerMetrics.AvgRunqueueLatencyUs = float64(runqueueLatencyUs)
			containerMetrics.AvgCPUTimeUs = float64(cpuTimeUs)
		} else {
			containerMetrics.AvgRunqueueLatencyUs = (containerMetrics.AvgRunqueueLatencyUs*float64(containerMetrics.EventCount-1) + float64(runqueueLatencyUs)) / float64(containerMetrics.EventCount)
			containerMetrics.AvgCPUTimeUs = (containerMetrics.AvgCPUTimeUs*float64(containerMetrics.EventCount-1) + float64(cpuTimeUs)) / float64(containerMetrics.EventCount)
		}
		
		if runqueueLatencyUs > containerMetrics.MaxRunqueueLatencyUs {
			containerMetrics.MaxRunqueueLatencyUs = runqueueLatencyUs
		}
		
		if runqueueLatencyUs > 10000 {
			containerMetrics.CPUStarvationCount++
		}
		
		containerMetrics.LastSeen = time.Now()
		containerSchedMetricsMu.Unlock()
	}
}

func calculateSchedLatencyPercentiles() {
	schedHistogramMu.Lock()
	defer schedHistogramMu.Unlock()
	
	if len(schedLatencyHistogram) == 0 {
		return
	}
	
	// Create a copy and sort
	sorted := make([]uint64, len(schedLatencyHistogram))
	copy(sorted, schedLatencyHistogram)
	
	// Simple bubble sort (good enough for small datasets)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[i] > sorted[j] {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	
	// Calculate percentiles
	p50Idx := len(sorted) * 50 / 100
	p95Idx := len(sorted) * 95 / 100
	p99Idx := len(sorted) * 99 / 100
	
	schedLatencyMetrics.P50RunqueueLatencyUs = sorted[p50Idx]
	schedLatencyMetrics.P95RunqueueLatencyUs = sorted[p95Idx]
	schedLatencyMetrics.P99RunqueueLatencyUs = sorted[p99Idx]
}

