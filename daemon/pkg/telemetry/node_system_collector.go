package telemetry

import (
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// NodeSystemMetrics holds node-level system metrics (CPU, RAM)
type NodeSystemMetrics struct {
	CPUUsagePercent    float64 `json:"cpu_usage_percent"`
	MemoryTotalMB      uint64  `json:"memory_total_mb"`
	MemoryUsedMB       uint64  `json:"memory_used_mb"`
	MemoryFreeMB       uint64  `json:"memory_free_mb"`
	MemoryUsagePercent float64 `json:"memory_usage_percent"`
	LoadAvg1min        float64 `json:"load_avg_1min"`
	LoadAvg5min        float64 `json:"load_avg_5min"`
	LoadAvg15min       float64 `json:"load_avg_15min"`
}

var nodeSystemMetrics NodeSystemMetrics
var nodeSystemMetricsMutex sync.RWMutex
var lastCPUIdle uint64
var lastCPUTotal uint64

// NodeSystemCollector implements the Collector interface for node system metrics
type NodeSystemCollector struct {
	nodeName string
}

// NewNodeSystemCollector creates a new node system metrics collector
func NewNodeSystemCollector(nodeName string) *NodeSystemCollector {
	return &NodeSystemCollector{
		nodeName: nodeName,
	}
}

// GetType returns the metric type
func (c *NodeSystemCollector) GetType() MetricType {
	return MetricType("node_system")
}

// GetNodeMetrics returns current node-level system metrics
func (c *NodeSystemCollector) GetNodeMetrics() NodeMetric {
	nodeSystemMetricsMutex.RLock()
	defer nodeSystemMetricsMutex.RUnlock()

	return NodeMetric{
		Type:      c.GetType(),
		Timestamp: time.Now(),
		NodeName:  c.nodeName,
		Value:     nodeSystemMetrics,
	}
}

// GetPodMetrics returns empty map (system metrics are node-level only)
func (c *NodeSystemCollector) GetPodMetrics() map[string]PodMetric {
	return make(map[string]PodMetric)
}

// Subscribe returns a channel for real-time updates (not implemented for system metrics)
func (c *NodeSystemCollector) Subscribe() <-chan Metric {
	ch := make(chan Metric, 10)
	// System metrics are polled, not event-driven
	return ch
}

// Unsubscribe removes a subscription
func (c *NodeSystemCollector) Unsubscribe(ch <-chan Metric) {
	// Channels are receive-only, cannot close
	// Subscriptions are managed by the collector internally
}

// StartNodeSystemCollector starts collecting node system metrics
func StartNodeSystemCollector() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	// Initial collection
	collectSystemMetrics()

	for range ticker.C {
		collectSystemMetrics()
	}
}

// collectSystemMetrics reads system metrics from /proc
func collectSystemMetrics() {
	// Read CPU stats from /proc/stat
	cpuUsage, err := getCPUUsage()
	if err != nil {
		log.Printf("[NodeSystem] Failed to get CPU usage: %v", err)
	} else {
		nodeSystemMetricsMutex.Lock()
		nodeSystemMetrics.CPUUsagePercent = cpuUsage
		nodeSystemMetricsMutex.Unlock()
	}

	// Read memory stats from /proc/meminfo
	memStats, err := getMemoryStats()
	if err != nil {
		log.Printf("[NodeSystem] Failed to get memory stats: %v", err)
	} else {
		nodeSystemMetricsMutex.Lock()
		nodeSystemMetrics.MemoryTotalMB = memStats.TotalMB
		nodeSystemMetrics.MemoryUsedMB = memStats.UsedMB
		nodeSystemMetrics.MemoryFreeMB = memStats.FreeMB
		nodeSystemMetrics.MemoryUsagePercent = memStats.UsagePercent
		nodeSystemMetricsMutex.Unlock()
	}

	// Read load average from /proc/loadavg
	loadAvg, err := getLoadAverage()
	if err != nil {
		log.Printf("[NodeSystem] Failed to get load average: %v", err)
	} else {
		nodeSystemMetricsMutex.Lock()
		nodeSystemMetrics.LoadAvg1min = loadAvg.Load1
		nodeSystemMetrics.LoadAvg5min = loadAvg.Load5
		nodeSystemMetrics.LoadAvg15min = loadAvg.Load15
		nodeSystemMetricsMutex.Unlock()
	}
}

type MemoryStats struct {
	TotalMB      uint64
	UsedMB       uint64
	FreeMB       uint64
	UsagePercent float64
}

type LoadAverage struct {
	Load1  float64
	Load5  float64
	Load15 float64
}

// getCPUUsage reads CPU usage from /proc/stat
func getCPUUsage() (float64, error) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, err
	}

	lines := strings.Split(string(data), "\n")
	if len(lines) == 0 {
		return 0, nil
	}

	// Parse first line: cpu  user nice system idle iowait irq softirq
	fields := strings.Fields(lines[0])
	if len(fields) < 8 {
		return 0, nil
	}

	user, _ := strconv.ParseUint(fields[1], 10, 64)
	nice, _ := strconv.ParseUint(fields[2], 10, 64)
	system, _ := strconv.ParseUint(fields[3], 10, 64)
	idle, _ := strconv.ParseUint(fields[4], 10, 64)
	iowait, _ := strconv.ParseUint(fields[5], 10, 64)
	irq, _ := strconv.ParseUint(fields[6], 10, 64)
	softirq, _ := strconv.ParseUint(fields[7], 10, 64)

	total := user + nice + system + idle + iowait + irq + softirq
	idleTotal := idle + iowait

	// Calculate usage percentage
	if lastCPUTotal > 0 {
		totalDiff := total - lastCPUTotal
		idleDiff := idleTotal - lastCPUIdle
		if totalDiff > 0 {
			usage := 100.0 * (1.0 - float64(idleDiff)/float64(totalDiff))
			lastCPUIdle = idleTotal
			lastCPUTotal = total
			return usage, nil
		}
	}

	lastCPUIdle = idleTotal
	lastCPUTotal = total
	return 0, nil
}

// getMemoryStats reads memory stats from /proc/meminfo
func getMemoryStats() (MemoryStats, error) {
	var stats MemoryStats

	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return stats, err
	}

	lines := strings.Split(string(data), "\n")
	memTotal := uint64(0)
	memFree := uint64(0)
	memAvailable := uint64(0)
	memBuffers := uint64(0)
	memCached := uint64(0)

	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}

		switch fields[0] {
		case "MemTotal:":
			memTotal = value // in KB
		case "MemFree:":
			memFree = value // in KB
		case "MemAvailable:":
			memAvailable = value // in KB
		case "Buffers:":
			memBuffers = value // in KB
		case "Cached:":
			memCached = value // in KB
		}
	}

	// Convert KB to MB
	stats.TotalMB = memTotal / 1024
	stats.FreeMB = memFree / 1024

	// Calculate used memory
	if memAvailable > 0 {
		stats.UsedMB = (memTotal - memAvailable) / 1024
	} else {
		stats.UsedMB = (memTotal - memFree - memBuffers - memCached) / 1024
	}

	if stats.TotalMB > 0 {
		stats.UsagePercent = (float64(stats.UsedMB) / float64(stats.TotalMB)) * 100.0
	}

	return stats, nil
}

// getLoadAverage reads load average from /proc/loadavg
func getLoadAverage() (LoadAverage, error) {
	var load LoadAverage

	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return load, err
	}

	fields := strings.Fields(string(data))
	if len(fields) >= 3 {
		load.Load1, _ = strconv.ParseFloat(fields[0], 64)
		load.Load5, _ = strconv.ParseFloat(fields[1], 64)
		load.Load15, _ = strconv.ParseFloat(fields[2], 64)
	}

	return load, nil
}

// Global node system collector instance
var globalNodeSystemCollector *NodeSystemCollector

// InitNodeSystemCollector initializes the global node system collector
func InitNodeSystemCollector(nodeName string) {
	globalNodeSystemCollector = NewNodeSystemCollector(nodeName)
	// Register with global registry
	GlobalRegistry.Register(globalNodeSystemCollector)
	// Start collecting metrics
	go StartNodeSystemCollector()
}

// GetNodeSystemMetrics returns the current node system metrics
func GetNodeSystemMetrics() NodeSystemMetrics {
	nodeSystemMetricsMutex.RLock()
	defer nodeSystemMetricsMutex.RUnlock()
	return nodeSystemMetrics
}
