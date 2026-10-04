// Package health turns raw node/cluster telemetry into health scores, status
// levels and alerts. It has no dependency on eBPF or Kubernetes so the logic
// can be unit-tested anywhere.
//
// Concepts:
//   - A Band is a set of upper bounds for one metric. A value below Excellent
//     is "excellent", below Good is "good", below Warning is "warning", and
//     anything at or above Warning is "critical".
//   - Thresholds map a metric ID to a Band. A "standard" set ships with the
//     daemon; users may override any metric with a "custom" band and reset it
//     at any time.
//   - Samples are the measured values for one node, keyed by metric ID.
package health

import "time"

type Level string

const (
	LevelExcellent Level = "excellent"
	LevelGood      Level = "good"
	LevelWarning   Level = "warning"
	LevelCritical  Level = "critical"
	LevelUnknown   Level = "unknown"
)

// severity orders levels so the worst can be picked; unknown ranks lowest.
func (l Level) severity() int {
	switch l {
	case LevelExcellent:
		return 1
	case LevelGood:
		return 2
	case LevelWarning:
		return 3
	case LevelCritical:
		return 4
	}
	return 0
}

// Band holds the upper bounds for the excellent, good and warning levels.
type Band struct {
	Excellent float64 `json:"excellent"`
	Good      float64 `json:"good"`
	Warning   float64 `json:"warning"` // values >= Warning are critical
}

// Metric IDs understood by the evaluator.
const (
	MetricDNSLatency       = "dns_latency_ms"
	MetricTCPSrtt          = "tcp_srtt_ms"
	MetricRunQueue         = "runqueue_latency_ms"
	MetricCPUStarvation    = "cpu_starvation_events"
	MetricTCPRetransRate   = "tcp_retrans_rate_pct"
	MetricTCPLossRate      = "tcp_loss_rate_pct"
	MetricTCPBadHSRate     = "tcp_badhs_rate_pct"
	MetricCPUUsage         = "cpu_usage_pct"
	MetricMemoryUsage      = "memory_usage_pct"
	MetricServiceUnhealthy = "services_unhealthy_pct"
)

// MetricInfo describes a metric for display.
type MetricInfo struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Unit  string `json:"unit"`
}

// Catalog lists every metric in display order.
var Catalog = []MetricInfo{
	{MetricDNSLatency, "DNS Latency", "ms"},
	{MetricTCPSrtt, "TCP SRTT", "ms"},
	{MetricRunQueue, "Run Queue Latency", "ms"},
	{MetricCPUStarvation, "CPU Starvation", "events"},
	{MetricTCPRetransRate, "TCP Retransmission Rate", "%"},
	{MetricTCPLossRate, "TCP Packet Loss Rate", "%"},
	{MetricTCPBadHSRate, "TCP Bad Handshake Rate", "%"},
	{MetricCPUUsage, "CPU Usage", "%"},
	{MetricMemoryUsage, "Memory Usage", "%"},
	{MetricServiceUnhealthy, "Unhealthy Services", "%"},
}

func metricInfo(id string) (MetricInfo, bool) {
	for _, m := range Catalog {
		if m.ID == id {
			return m, true
		}
	}
	return MetricInfo{}, false
}

// Component is the evaluated state of one metric on one node.
type Component struct {
	ID    string  `json:"id"`
	Label string  `json:"label"`
	Unit  string  `json:"unit"`
	Value float64 `json:"value"`
	Level Level   `json:"level"`
	Score float64 `json:"score"` // 0-100 for this metric alone
	Band  Band    `json:"band"`
}

// NodeHealth is the evaluated health of a single node.
type NodeHealth struct {
	Node       string      `json:"node"`
	IP         string      `json:"ip,omitempty"`
	Score      float64     `json:"score"` // 0-100
	Level      Level       `json:"level"`
	Stale      bool        `json:"stale"`
	Components []Component `json:"components"`
	Timestamp  time.Time   `json:"timestamp"`
}

// ClusterHealth aggregates every node.
type ClusterHealth struct {
	Score     float64       `json:"score"`
	Level     Level         `json:"level"`
	Nodes     []NodeHealth  `json:"nodes"`
	Counts    map[Level]int `json:"counts"`
	Timestamp time.Time     `json:"timestamp"`
}
