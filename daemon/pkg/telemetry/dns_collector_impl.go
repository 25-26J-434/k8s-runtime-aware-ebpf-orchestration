package telemetry

import (
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// DNSCollector implements the Collector interface for DNS latency metrics
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
