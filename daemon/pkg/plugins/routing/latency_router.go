package routing

import (
	"log"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

// LatencyBasedRouter demonstrates how other components can use telemetry data
// This is a simple example showing direct function calls - no HTTP needed!
type LatencyBasedRouter struct {
	nodeName    string
	stopChan    chan struct{}
	updatesChan <-chan telemetry.Metric
}

// NewRouter creates a new latency-based routing component
func NewRouter(nodeName string) *LatencyBasedRouter {
	log.Println("[Routing] Initializing Latency-Based Router...")
	return &LatencyBasedRouter{
		nodeName: nodeName,
		stopChan: make(chan struct{}),
	}
}

// Start begins the routing logic with real-time metric monitoring
func (r *LatencyBasedRouter) Start() {
	log.Println("[Routing] Starting latency-based router...")

	// Example 1: Subscribe to real-time DNS metric updates
	if collector, ok := telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS); ok {
		r.updatesChan = collector.Subscribe()
		log.Println("[Routing] Subscribed to DNS metrics - will receive real-time updates")

		// Process updates in background
		go r.handleMetricUpdates()
	}

	// Example 2: Periodic polling for combined analysis
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			// Analyze all metrics periodically
			r.analyzeMetrics()

		case <-r.stopChan:
			log.Println("[Routing] Router stopped")
			return
		}
	}
}

// handleMetricUpdates processes real-time metric updates
func (r *LatencyBasedRouter) handleMetricUpdates() {
	for metric := range r.updatesChan {
		// Receive push notifications for every metric update
		// This is ideal for immediate reaction to latency changes

		if podMetric, ok := metric.(telemetry.PodMetric); ok {
			if dnsValue, ok := podMetric.Value.(telemetry.DNSMetricValue); ok {
				// React immediately to latency changes
				if dnsValue.AvgLatencyNs > 10000000 { // > 10ms
					log.Printf("[Routing] WARNING: High latency detected for %s: %.2fms",
						podMetric.PodName, dnsValue.AvgLatencyNs/1e6)

					// Take action: reroute traffic, alert, etc.
					// r.rerouteTraffic(podMetric.PodName)
				}
			}
		}
	}
}

// analyzeMetrics periodically analyzes all metrics
func (r *LatencyBasedRouter) analyzeMetrics() {
	// Direct function calls - no HTTP overhead!
	podDNS := telemetry.GetPodDNSMetrics()
	podRTT := telemetry.GetPodRTTMetrics()

	if len(podDNS) == 0 {
		log.Println("[Routing] No pods with DNS metrics yet")
		return
	}

	log.Printf("[Routing] Analyzing %d pods...", len(podDNS))

	// Find best and worst performing pods
	bestPod := ""
	worstPod := ""
	minLatency := float64(999999999)
	maxLatency := float64(0)

	for podKey, dns := range podDNS {
		if dns.TotalEvents == 0 {
			continue
		}

		// Calculate combined latency (DNS + RTT)
		avgDNS := float64(dns.TotalLatencyNs) / float64(dns.TotalEvents)
		avgRTT := float64(0)

		if rtt, exists := podRTT[podKey]; exists && rtt.TotalEvents > 0 {
			avgRTT = float64(rtt.TotalRTTNs) / float64(rtt.TotalEvents)
		}

		combinedLatency := avgDNS + avgRTT

		if combinedLatency < minLatency {
			minLatency = combinedLatency
			bestPod = podKey
		}
		if combinedLatency > maxLatency {
			maxLatency = combinedLatency
			worstPod = podKey
		}

		log.Printf("[Routing] Pod %s: DNS=%.2fms, RTT=%.2fms, Combined=%.2fms",
			podKey, avgDNS/1e6, avgRTT/1e6, combinedLatency/1e6)
	}

	if bestPod != "" {
		log.Printf("[Routing] BEST: %s (%.2fms)", bestPod, minLatency/1e6)
		log.Printf("[Routing] WORST: %s (%.2fms)", worstPod, maxLatency/1e6)
	}
}

// SelectEndpoint selects the best endpoint for a service based on latency
// This is a simple example - real routing would be more sophisticated
func (r *LatencyBasedRouter) SelectEndpoint(serviceName string) string {
	// Direct function call - no network overhead
	podDNS := telemetry.GetPodDNSMetrics()
	podRTT := telemetry.GetPodRTTMetrics()

	bestPod := ""
	minLatency := float64(999999999)

	for podKey, dns := range podDNS {
		if dns.TotalEvents == 0 {
			continue
		}

		// Calculate combined latency
		avgDNS := float64(dns.TotalLatencyNs) / float64(dns.TotalEvents)
		avgRTT := float64(0)

		if rtt, exists := podRTT[podKey]; exists && rtt.TotalEvents > 0 {
			avgRTT = float64(rtt.TotalRTTNs) / float64(rtt.TotalEvents)
		}

		combinedLatency := avgDNS + avgRTT

		if combinedLatency < minLatency {
			minLatency = combinedLatency
			bestPod = podKey
		}
	}

	if bestPod != "" {
		log.Printf("[Routing] Selected endpoint: %s (latency: %.2fms)", bestPod, minLatency/1e6)
	}

	return bestPod
}

// Stop gracefully stops the router
func (r *LatencyBasedRouter) Stop() {
	close(r.stopChan)
}

