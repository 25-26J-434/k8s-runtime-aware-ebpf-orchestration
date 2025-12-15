package scaling

import (
	"errors"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

func GetMetricValue(metricType, level string) (float64, error) {

	switch metricType {

	case "dns_latency":
		m := telemetry.GetDNSMetrics()
		if level == "node" {
			if m.TotalEvents == 0 {
				return 0, nil
			}
			return float64(m.TotalLatencyNs) / float64(m.TotalEvents), nil
		}

	case "rtt":
		m := telemetry.GetRTTMetrics()
		if level == "node" {
			if m.TotalEvents == 0 {
				return 0, nil
			}
			return float64(m.TotalRTTNs) / float64(m.TotalEvents), nil
		}
	}

	return 0, errors.New("unsupported metric type or level")
}
