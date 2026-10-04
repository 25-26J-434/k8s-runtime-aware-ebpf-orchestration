package health

import (
	"math"
	"sort"
	"time"
)

// StaleAfter is how long a node may go without reporting before it is marked
// stale and treated as critical.
const StaleAfter = 30 * time.Second

// Classify returns the level a value falls into for a band.
func Classify(v float64, b Band) Level {
	switch {
	case v < b.Excellent:
		return LevelExcellent
	case v < b.Good:
		return LevelGood
	case v < b.Warning:
		return LevelWarning
	}
	return LevelCritical
}

// ScoreMetric maps a value to 0-100 by interpolating within its band:
// excellent 100-90, good 90-70, warning 70-40, critical 40-0 (reaching 0 at
// twice the warning threshold).
func ScoreMetric(v float64, b Band) float64 {
	seg := func(lo, hi, from, to float64) float64 {
		if hi <= lo {
			return to
		}
		return from + (to-from)*(v-lo)/(hi-lo)
	}
	var s float64
	switch {
	case v < b.Excellent:
		s = seg(0, b.Excellent, 100, 90)
	case v < b.Good:
		s = seg(b.Excellent, b.Good, 90, 70)
	case v < b.Warning:
		s = seg(b.Good, b.Warning, 70, 40)
	default:
		s = seg(b.Warning, b.Warning*2, 40, 0)
	}
	return math.Max(0, math.Min(100, s))
}

// EvaluateNode scores one node. samples holds only the metrics that were
// actually measured; missing metrics are skipped rather than assumed healthy.
func EvaluateNode(th map[string]Band, node, ip string, samples map[string]float64, reportedAt, now time.Time) NodeHealth {
	nh := NodeHealth{Node: node, IP: ip, Timestamp: reportedAt, Level: LevelUnknown}

	if !reportedAt.IsZero() && now.Sub(reportedAt) > StaleAfter {
		nh.Stale = true
	}

	worst := LevelUnknown
	var total float64
	for _, info := range Catalog {
		v, ok := samples[info.ID]
		band, hasBand := th[info.ID]
		if !ok || !hasBand || math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		c := Component{
			ID: info.ID, Label: info.Label, Unit: info.Unit,
			Value: v, Level: Classify(v, band), Score: ScoreMetric(v, band), Band: band,
		}
		nh.Components = append(nh.Components, c)
		total += c.Score
		if c.Level.severity() > worst.severity() {
			worst = c.Level
		}
	}

	if len(nh.Components) > 0 {
		nh.Score = total / float64(len(nh.Components))
		nh.Level = worst
		// One bad metric must not be averaged away.
		switch worst {
		case LevelCritical:
			nh.Score = math.Min(nh.Score, 40)
		case LevelWarning:
			nh.Score = math.Min(nh.Score, 70)
		}
	}

	if nh.Stale {
		nh.Level = LevelCritical
		nh.Score = math.Min(nh.Score, 20)
	}
	nh.Score = math.Round(nh.Score*10) / 10
	return nh
}

// EvaluateCluster combines per-node results. The cluster level is the worst
// node level; the score is the mean node score.
func EvaluateCluster(nodes []NodeHealth, now time.Time) ClusterHealth {
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].Node < nodes[j].Node })
	ch := ClusterHealth{
		Nodes:     nodes,
		Level:     LevelUnknown,
		Counts:    map[Level]int{},
		Timestamp: now,
	}
	var total float64
	scored := 0
	for _, n := range nodes {
		ch.Counts[n.Level]++
		if n.Level.severity() > ch.Level.severity() {
			ch.Level = n.Level
		}
		if n.Level != LevelUnknown {
			total += n.Score
			scored++
		}
	}
	if scored > 0 {
		ch.Score = math.Round(total/float64(scored)*10) / 10
	}
	return ch
}
