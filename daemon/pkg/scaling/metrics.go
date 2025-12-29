package scaling

import (
	"fmt"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

// GetMetricValue returns the latest metric value used for scaling.
// IMPORTANT: map your telemetry here.
func GetMetricValue(metric string) (float64, error) {
	switch metric {

	// Example metric name you’re using in Mongo:
	// { metric: "dns_latency", threshold: 300000 }
	case "dns_latency":
		// Return the last observed DNS latency in nanoseconds (preferred)
		if nm, ok := telemetry.GlobalRegistry.GetNodeMetrics(telemetry.MetricTypeDNS); ok {
			if v, ok := nm.Value.(telemetry.DNSMetricValue); ok {
				return float64(v.LastLatencyNs), nil
			}
		}
		// Fallback to the direct accessor
		dns := telemetry.GetDNSMetrics()
		return float64(dns.LastLatencyNs), nil

	case "rtt":
		// Return the last observed RTT in nanoseconds
		if nm, ok := telemetry.GlobalRegistry.GetNodeMetrics(telemetry.MetricTypeRTT); ok {
			if v, ok := nm.Value.(telemetry.RTTMetricValue); ok {
				return float64(v.LastRTTNs), nil
			}
		}
		rtt := telemetry.GetRTTMetrics()
		return float64(rtt.LastRTTNs), nil

	case "tcp_retrans":
		// Return the total retransmissions count (node-level)
		if nm, ok := telemetry.GlobalRegistry.GetNodeMetrics(telemetry.MetricTypeTCP); ok {
			if m, ok := nm.Value.(map[string]interface{}); ok {
				if val, found := m["retransmissions"]; found {
					switch t := val.(type) {
					case float64:
						return t, nil
					case int:
						return float64(t), nil
					case int64:
						return float64(t), nil
					case uint64:
						return float64(t), nil
					}
				}
			}
		}
		tcp := telemetry.GetTCPMetrics()
		return float64(tcp.Retransmissions), nil

	default:
		return 0, fmt.Errorf("unknown metric: %s", metric)
	}
}
