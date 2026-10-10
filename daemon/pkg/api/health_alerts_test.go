package api

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func resetHealthState() {
	alertMgrMu.Lock()
	alertMgr = make(map[string]*managedAlert)
	alertHistory = nil
	alertMgrMu.Unlock()

	previousHealthMu.Lock()
	previousNodeHealth = make(map[string]NodeHealthUpdate)
	previousHealthMu.Unlock()

	clusterNodeHealthMu.Lock()
	clusterNodeHealth = make(map[string]NodeHealthUpdate)
	clusterNodeHealthMu.Unlock()
}

func nodeWithPod(phase string, ready bool, reasons ...string) NodeHealthUpdate {
	return NodeHealthUpdate{
		NodeName: "node-a", Status: "healthy", TotalPods: 1,
		Pods: []PodHealth{{Name: "web", Namespace: "default", Phase: phase, Ready: ready, HealthReasons: reasons}},
	}
}

func TestAlertFiresOnceThenResolves(t *testing.T) {
	resetHealthState()

	bad := nodeWithPod("Running", false)
	fired, resolved := detectHealthAlerts("node-a", bad)
	if len(fired) != 1 || len(resolved) != 0 {
		t.Fatalf("first cycle: fired=%d resolved=%d, want 1/0", len(fired), len(resolved))
	}
	if fired[0].Severity != AlertCritical || fired[0].State != alertStateFiring {
		t.Fatalf("unexpected alert: %+v", fired[0])
	}

	// Same condition on the next cycles must not re-alert.
	for i := 0; i < 3; i++ {
		if fired, _ := detectHealthAlerts("node-a", bad); len(fired) != 0 {
			t.Fatalf("cycle %d re-fired %d alerts", i, len(fired))
		}
	}
	if n := len(activeAlertsSnapshot()); n != 1 {
		t.Fatalf("active alerts = %d, want 1", n)
	}

	fired, resolved = detectHealthAlerts("node-a", nodeWithPod("Running", true))
	if len(fired) != 0 || len(resolved) != 1 || resolved[0].State != alertStateResolved {
		t.Fatalf("recovery: fired=%d resolved=%v", len(fired), resolved)
	}
	if n := len(activeAlertsSnapshot()); n != 0 {
		t.Fatalf("active alerts after recovery = %d, want 0", n)
	}
}

func TestMetricReasonsRaiseAlerts(t *testing.T) {
	resetHealthState()

	n := nodeWithPod("Running", true,
		"high packet loss: 12", "high retransmissions: 80", "dns latency high: 300.0ms",
		"rtt elevated: 40.0ms") // elevated is informational only
	fired, _ := detectHealthAlerts("node-a", n)
	if len(fired) != 3 {
		t.Fatalf("fired %d alerts, want 3: %+v", len(fired), fired)
	}
	for _, a := range fired {
		if a.Severity != AlertWarning || !strings.Contains(a.ID, ":metric:") {
			t.Fatalf("unexpected alert %+v", a)
		}
	}
}

func TestAlertsSortedSeverityThenNewest(t *testing.T) {
	resetHealthState()
	detectHealthAlerts("node-a", nodeWithPod("Pending", false))
	detectHealthAlerts("node-b", NodeHealthUpdate{NodeName: "node-b", Error: "boom"})

	list := activeAlertsSnapshot()
	if len(list) < 2 || list[0].Severity != AlertCritical {
		t.Fatalf("critical alert should sort first: %+v", list)
	}
}

func TestOfflineNodeRaisesAlertAndRecovers(t *testing.T) {
	resetHealthState()

	storeNodeHealth("peer-1", NodeHealthUpdate{NodeName: "peer-1", Status: "healthy"})
	clusterNodeHealthMu.Lock()
	h := clusterNodeHealth["peer-1"]
	h.LastSeen = time.Now().UTC().Add(-2 * nodeOfflineAfter).Format(time.RFC3339)
	clusterNodeHealth["peer-1"] = h
	clusterNodeHealthMu.Unlock()

	if !sweepNodeFreshness() {
		t.Fatal("sweep should report a change")
	}
	resp := buildClusterHealthResponse()
	if resp.Nodes["peer-1"].Freshness != "offline" || resp.Summary.NodesOffline != 1 {
		t.Fatalf("freshness = %q, summary = %+v", resp.Nodes["peer-1"].Freshness, resp.Summary)
	}
	if resp.Summary.CriticalAlerts != 1 {
		t.Fatalf("expected an offline critical alert, got %+v", resp.Alerts)
	}

	// The node reports again: offline alert resolves.
	update := NodeHealthUpdate{NodeName: "peer-1", Status: "healthy"}
	storeNodeHealth("peer-1", update)
	detectHealthAlerts("peer-1", update)
	if n := len(activeAlertsSnapshot()); n != 0 {
		t.Fatalf("offline alert should resolve, still %d active", n)
	}
}

func TestZeroHealthScoreIsSerialized(t *testing.T) {
	b, _ := json.Marshal(NodeHealthUpdate{NodeName: "n", HealthScore: 0})
	if !strings.Contains(string(b), `"health_score":0`) {
		t.Fatalf("health_score missing from %s", b)
	}
	b, _ = json.Marshal(PodHealth{Name: "p", HealthScore: 0})
	if !strings.Contains(string(b), `"health_score":0`) {
		t.Fatalf("pod health_score missing from %s", b)
	}
}

func TestSucceededPodIsHealthy(t *testing.T) {
	healthy, score, reasons := evaluatePodHealthLevel(PodHealth{Phase: "Succeeded"}, nil)
	if !healthy || score != 100 || len(reasons) != 0 {
		t.Fatalf("Succeeded pod: healthy=%v score=%d reasons=%v", healthy, score, reasons)
	}
}
