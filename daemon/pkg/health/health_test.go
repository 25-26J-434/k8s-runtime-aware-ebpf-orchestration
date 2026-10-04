package health

import (
	"path/filepath"
	"testing"
	"time"
)

func TestClassifyBoundaries(t *testing.T) {
	b := Band{Excellent: 5, Good: 10, Warning: 50}
	cases := map[float64]Level{
		0: LevelExcellent, 4.99: LevelExcellent,
		5: LevelGood, 9.99: LevelGood,
		10: LevelWarning, 49.9: LevelWarning,
		50: LevelCritical, 1000: LevelCritical,
	}
	for v, want := range cases {
		if got := Classify(v, b); got != want {
			t.Errorf("Classify(%v)=%s, want %s", v, got, want)
		}
	}
}

func TestScoreMetricIsMonotonicAndBounded(t *testing.T) {
	b := Band{Excellent: 5, Good: 10, Warning: 50}
	prev := 101.0
	for v := 0.0; v <= 120; v += 0.5 {
		s := ScoreMetric(v, b)
		if s < 0 || s > 100 {
			t.Fatalf("score %v out of range at %v", s, v)
		}
		if s > prev+1e-9 {
			t.Fatalf("score rose from %v to %v at %v", prev, s, v)
		}
		prev = s
	}
	if ScoreMetric(0, b) != 100 || ScoreMetric(100, b) != 0 {
		t.Fatal("expected 100 at zero and 0 at twice the warning threshold")
	}
}

func TestEvaluateNodeWorstMetricWins(t *testing.T) {
	now := time.Now()
	nh := EvaluateNode(Standard(), "n1", "10.0.0.1", map[string]float64{
		MetricDNSLatency: 1,  // excellent
		MetricCPUUsage:   95, // critical
		MetricTCPSrtt:    10, // excellent
	}, now, now)
	if nh.Level != LevelCritical {
		t.Fatalf("level=%s, want critical", nh.Level)
	}
	if nh.Score > 40 {
		t.Fatalf("score=%v should be capped at 40 with a critical metric", nh.Score)
	}
}

func TestEvaluateNodeNoDataIsUnknown(t *testing.T) {
	now := time.Now()
	nh := EvaluateNode(Standard(), "n1", "", nil, now, now)
	if nh.Level != LevelUnknown || len(nh.Components) != 0 {
		t.Fatalf("expected unknown with no components, got %+v", nh)
	}
}

func TestEvaluateNodeStaleIsCritical(t *testing.T) {
	now := time.Now()
	nh := EvaluateNode(Standard(), "n1", "", map[string]float64{MetricDNSLatency: 1}, now.Add(-2*StaleAfter), now)
	if !nh.Stale || nh.Level != LevelCritical {
		t.Fatalf("expected stale+critical, got %+v", nh)
	}
}

func TestCustomThresholdsOverrideAndReset(t *testing.T) {
	path := filepath.Join(t.TempDir(), "th.json")
	s := NewThresholdStore(path)

	std := Standard()[MetricDNSLatency]
	if got := s.Active()[MetricDNSLatency]; got != std {
		t.Fatalf("active should equal standard before overrides, got %+v", got)
	}

	custom := Band{Excellent: 1, Good: 2, Warning: 3}
	if err := s.Set(map[string]Band{MetricDNSLatency: custom}); err != nil {
		t.Fatal(err)
	}
	if got := s.Active()[MetricDNSLatency]; got != custom {
		t.Fatalf("custom not applied, got %+v", got)
	}
	// Other metrics keep the standard values.
	if got := s.Active()[MetricTCPSrtt]; got != Standard()[MetricTCPSrtt] {
		t.Fatalf("untouched metric changed: %+v", got)
	}

	// Persisted across a reload.
	if got := NewThresholdStore(path).Active()[MetricDNSLatency]; got != custom {
		t.Fatalf("custom not persisted, got %+v", got)
	}

	if err := s.Reset(MetricDNSLatency); err != nil {
		t.Fatal(err)
	}
	if got := s.Active()[MetricDNSLatency]; got != std {
		t.Fatalf("reset did not restore standard, got %+v", got)
	}
}

func TestSetRejectsInvalid(t *testing.T) {
	s := NewThresholdStore("")
	bad := []map[string]Band{
		{"nope": {Excellent: 1, Good: 2, Warning: 3}},
		{MetricDNSLatency: {Excellent: 5, Good: 2, Warning: 3}},
		{MetricDNSLatency: {Excellent: -1, Good: 2, Warning: 3}},
		{MetricDNSLatency: {}},
	}
	for i, u := range bad {
		if err := s.Set(u); err == nil {
			t.Errorf("case %d: expected error", i)
		}
	}
	if len(s.Custom()) != 0 {
		t.Fatal("rejected updates must not be applied")
	}
}

func TestAlertLifecycle(t *testing.T) {
	st := NewStore()
	t0 := time.Now()
	f := Finding{Key: "n1/dns", Node: "n1", Metric: MetricDNSLatency, Severity: LevelWarning, Message: "slow", Value: 20}

	st.Update([]Finding{f}, t0)
	if a := st.Alerts("firing"); len(a) != 1 || a[0].Severity != LevelWarning {
		t.Fatalf("expected 1 firing warning, got %+v", a)
	}

	f.Severity = LevelCritical
	st.Update([]Finding{f}, t0.Add(time.Second))
	a := st.Alerts("firing")
	if len(a) != 1 || a[0].Severity != LevelCritical || !a[0].FiredAt.Equal(t0) {
		t.Fatalf("expected severity update without re-fire, got %+v", a)
	}

	st.Update(nil, t0.Add(2*time.Second))
	if len(st.Alerts("firing")) != 0 {
		t.Fatal("alert should have resolved")
	}
	r := st.Alerts("resolved")
	if len(r) != 1 || r[0].Status != "resolved" || r[0].ResolvedAt == nil {
		t.Fatalf("expected 1 resolved alert, got %+v", r)
	}
}

func TestHistoryRingBuffer(t *testing.T) {
	st := NewStore()
	now := time.Now()
	for i := 0; i < historyCapacity+50; i++ {
		st.Record([]NodeHealth{{Node: "n1", Score: float64(i), Level: LevelGood}}, now)
	}
	pts := st.History("n1", 0)
	if len(pts) != historyCapacity {
		t.Fatalf("len=%d, want %d", len(pts), historyCapacity)
	}
	if pts[len(pts)-1].Score != float64(historyCapacity+49) {
		t.Fatal("newest point missing")
	}
	st.Record(nil, now) // node left
	if len(st.History("n1", 0)) != 0 {
		t.Fatal("history for departed node should be dropped")
	}
}
