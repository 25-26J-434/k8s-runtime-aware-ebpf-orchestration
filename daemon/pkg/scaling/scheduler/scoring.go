package scheduler

import (
	"math"
	"sort"
	"time"
)

type CandidateNode struct {
	Name       string
	PodCount   int
	Inflight   int
	Telemetry  NodeTelemetry
	HasMetrics bool
}

type NodeScore struct {
	Name            string
	Score           float64
	BaseScore       float64
	PodPenalty      float64
	InflightPenalty float64
	HasMetrics      bool
}

type metricBounds struct {
	min float64
	max float64
	set bool
}

func scoreCandidates(candidates []CandidateNode, cfg Config, now time.Time) []NodeScore {
	bounds := map[string]metricBounds{
		"dns":        {},
		"rtt":        {},
		"tcp":        {},
		"disk_read":  {},
		"disk_write": {},
	}

	for _, candidate := range candidates {
		if !candidate.HasMetrics || !candidate.Telemetry.Complete || now.Sub(candidate.Telemetry.LastUpdated) > cfg.MetricsStaleAfter {
			continue
		}

		bounds["dns"] = extendBounds(bounds["dns"], candidate.Telemetry.DNSLatencyAvgNs)
		bounds["rtt"] = extendBounds(bounds["rtt"], candidate.Telemetry.RTTAvgNs)
		bounds["tcp"] = extendBounds(bounds["tcp"], candidate.Telemetry.TCPRetransmissions)
		bounds["disk_read"] = extendBounds(bounds["disk_read"], candidate.Telemetry.DiskReadLatencyAvgNs)
		bounds["disk_write"] = extendBounds(bounds["disk_write"], candidate.Telemetry.DiskWriteLatencyAvgNs)
	}

	scores := make([]NodeScore, 0, len(candidates))
	for _, candidate := range candidates {
		base := cfg.UnknownScore
		hasMetrics := candidate.HasMetrics && candidate.Telemetry.Complete && now.Sub(candidate.Telemetry.LastUpdated) <= cfg.MetricsStaleAfter
		if hasMetrics {
			base = weightedAverage(
				normalizeLowerIsBetter(candidate.Telemetry.DNSLatencyAvgNs, bounds["dns"])*0.30,
				normalizeLowerIsBetter(candidate.Telemetry.RTTAvgNs, bounds["rtt"])*0.30,
				normalizeLowerIsBetter(candidate.Telemetry.TCPRetransmissions, bounds["tcp"])*0.20,
				normalizeLowerIsBetter(candidate.Telemetry.DiskReadLatencyAvgNs, bounds["disk_read"])*0.10,
				normalizeLowerIsBetter(candidate.Telemetry.DiskWriteLatencyAvgNs, bounds["disk_write"])*0.10,
			)
		}

		podPenalty := math.Min(12, float64(candidate.PodCount)*0.35)
		inflightPenalty := math.Min(15, float64(candidate.Inflight)*5)
		finalScore := clamp(base-podPenalty-inflightPenalty, 0, 100)

		scores = append(scores, NodeScore{
			Name:            candidate.Name,
			Score:           finalScore,
			BaseScore:       base,
			PodPenalty:      podPenalty,
			InflightPenalty: inflightPenalty,
			HasMetrics:      hasMetrics,
		})
	}

	sort.Slice(scores, func(i, j int) bool {
		if scores[i].Score == scores[j].Score {
			return scores[i].Name < scores[j].Name
		}
		return scores[i].Score > scores[j].Score
	})

	return scores
}

func extendBounds(bounds metricBounds, value float64) metricBounds {
	if !bounds.set {
		return metricBounds{min: value, max: value, set: true}
	}
	if value < bounds.min {
		bounds.min = value
	}
	if value > bounds.max {
		bounds.max = value
	}
	return bounds
}

func normalizeLowerIsBetter(value float64, bounds metricBounds) float64 {
	if !bounds.set {
		return 100
	}
	if bounds.max == bounds.min {
		return 100
	}
	return clamp(100*(bounds.max-value)/(bounds.max-bounds.min), 0, 100)
}

func weightedAverage(values ...float64) float64 {
	var total float64
	for _, value := range values {
		total += value
	}
	return clamp(total, 0, 100)
}

func clamp(value, low, high float64) float64 {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}
