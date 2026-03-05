package telemetry

import (
	"strings"
	"sync"
	"time"
)

var (
	clusterPodMetricsMu  sync.RWMutex
	clusterPodMetrics    = make(map[string]map[MetricType]PodMetric)
	clusterNodeMetricsMu sync.RWMutex
	clusterNodeMetrics   = make(map[string]map[MetricType]NodeMetric)
)

// StoreClusterPodMetric stores a pod-level metric coming from any node.
func StoreClusterPodMetric(podKey string, metricType MetricType, nodeName string, value interface{}) {
	if podKey == "" || metricType == "" {
		return
	}

	namespace := ""
	podName := ""
	if parts := strings.SplitN(podKey, "/", 2); len(parts) == 2 {
		namespace = parts[0]
		podName = parts[1]
	}

	metric := PodMetric{
		Type:      metricType,
		Timestamp: time.Now().UTC(),
		Namespace: namespace,
		PodName:   podName,
		NodeName:  nodeName,
		Value:     value,
	}

	clusterPodMetricsMu.Lock()
	entry := clusterPodMetrics[podKey]
	if entry == nil {
		entry = make(map[MetricType]PodMetric)
		clusterPodMetrics[podKey] = entry
	}
	entry[metricType] = metric
	clusterPodMetricsMu.Unlock()
}

// GetClusterPodMetric returns the most recent cluster-wide pod metric.
func GetClusterPodMetric(podKey string, metricType MetricType) (PodMetric, bool) {
	clusterPodMetricsMu.RLock()
	entry := clusterPodMetrics[podKey]
	if entry == nil {
		clusterPodMetricsMu.RUnlock()
		return PodMetric{}, false
	}
	metric, ok := entry[metricType]
	clusterPodMetricsMu.RUnlock()
	return metric, ok
}

// StoreClusterNodeMetric stores a node-level metric coming from any node.
func StoreClusterNodeMetric(nodeName string, metricType MetricType, value interface{}) {
	if nodeName == "" || metricType == "" {
		return
	}

	metric := NodeMetric{
		Type:      metricType,
		Timestamp: time.Now().UTC(),
		NodeName:  nodeName,
		Value:     value,
	}

	clusterNodeMetricsMu.Lock()
	entry := clusterNodeMetrics[nodeName]
	if entry == nil {
		entry = make(map[MetricType]NodeMetric)
		clusterNodeMetrics[nodeName] = entry
	}
	entry[metricType] = metric
	clusterNodeMetricsMu.Unlock()
}

// GetClusterNodeMetric returns the most recent cluster-wide node metric.
func GetClusterNodeMetric(nodeName string, metricType MetricType) (NodeMetric, bool) {
	clusterNodeMetricsMu.RLock()
	entry := clusterNodeMetrics[nodeName]
	if entry == nil {
		clusterNodeMetricsMu.RUnlock()
		return NodeMetric{}, false
	}
	metric, ok := entry[metricType]
	clusterNodeMetricsMu.RUnlock()
	return metric, ok
}
