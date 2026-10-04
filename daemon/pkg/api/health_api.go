package api

// health_api.go
//
// Cluster health monitoring API. Every daemon already receives every other
// node's metrics (via the METRIC_UPDATE broadcast, see metrics_stream.go), so
// any daemon can score the whole cluster. A background loop evaluates all
// nodes every few seconds, records history and drives the alert engine.
//
//   GET    /api/health/cluster     cluster + per-node scores, peers, alert count
//   GET    /api/health/history     score history (?node=&limit=)
//   GET    /api/health/alerts      alerts (?status=firing|resolved)
//   GET    /api/health/thresholds  standard, custom and active thresholds
//   PUT    /api/health/thresholds  set custom thresholds {"thresholds":{id:band}}
//   DELETE /api/health/thresholds  reset one (?metric=id) or all custom thresholds

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/comm"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/health"
)

const (
	healthEvalInterval          = 5 * time.Second
	defaultHealthThresholdsFile = "/var/lib/ebpf-daemon/health_thresholds.json"
)

var (
	healthThresholds *health.ThresholdStore
	healthStore      = health.NewStore()

	healthMu     sync.RWMutex
	healthLatest health.ClusterHealth
	healthOnce   sync.Once
)

func registerHealthRoutes() {
	healthOnce.Do(func() {
		path := os.Getenv("HEALTH_CONFIG_PATH")
		if path == "" {
			path = defaultHealthThresholdsFile
		}
		healthThresholds = health.NewThresholdStore(path)

		http.HandleFunc("/api/health/cluster", corsMiddleware(handleHealthCluster))
		http.HandleFunc("/api/health/history", corsMiddleware(handleHealthHistory))
		http.HandleFunc("/api/health/alerts", corsMiddleware(handleHealthAlerts))
		http.HandleFunc("/api/health/thresholds", corsMiddleware(handleHealthThresholds))

		go func() {
			evaluateHealth()
			for range time.Tick(healthEvalInterval) {
				evaluateHealth()
			}
		}()
	})
}

// nodeSnapshot is the subset of a node's unified metrics the health engine
// reads. Decoding through JSON lets it handle both local (typed) and remote
// (map-decoded) metrics identically.
type nodeSnapshot struct {
	DNS struct {
		TotalEvents  float64 `json:"total_events"`
		AvgLatencyNs float64 `json:"avg_latency_ns"`
	} `json:"dns_latency"`
	TCP struct {
		TotalEvents    float64 `json:"total_events"`
		AvgSrttUs      float64 `json:"avg_srtt_us"`
		LastSrttUs     float64 `json:"last_srtt_us"`
		Retransmission float64 `json:"retransmissions"`
		PacketLoss     float64 `json:"packet_loss"`
		BadHandshakes  float64 `json:"bad_handshakes"`
	} `json:"tcp_metrics"`
	Sched struct {
		TotalEvents          float64 `json:"total_events"`
		AvgRunqueueLatencyUs float64 `json:"avg_runqueue_latency_us"`
		CPUStarvationCount   float64 `json:"cpu_starvation_count"`
	} `json:"sched_latency"`
	System *struct {
		CPUUsagePercent    float64 `json:"cpu_usage_percent"`
		MemoryUsagePercent float64 `json:"memory_usage_percent"`
	} `json:"node_system"`
	Services struct {
		Total     float64 `json:"total_services"`
		Unhealthy float64 `json:"unhealthy_services"`
	} `json:"service_health"`
}

// extractSamples reads the measured health metrics out of a node's metrics.
// Metrics with no underlying events are omitted instead of reported as zero.
func extractSamples(m UnifiedMetricsResponse) map[string]float64 {
	samples := map[string]float64{}
	raw, err := json.Marshal(m.Node)
	if err != nil {
		return samples
	}
	var s nodeSnapshot
	if err := json.Unmarshal(raw, &s); err != nil {
		return samples
	}

	if s.DNS.TotalEvents > 0 {
		samples[health.MetricDNSLatency] = s.DNS.AvgLatencyNs / 1e6
	}
	if s.TCP.TotalEvents > 0 {
		srtt := s.TCP.AvgSrttUs
		if srtt <= 0 {
			srtt = s.TCP.LastSrttUs
		}
		samples[health.MetricTCPSrtt] = srtt / 1000
		samples[health.MetricTCPRetransRate] = s.TCP.Retransmission / s.TCP.TotalEvents * 100
		samples[health.MetricTCPLossRate] = s.TCP.PacketLoss / s.TCP.TotalEvents * 100
		samples[health.MetricTCPBadHSRate] = s.TCP.BadHandshakes / s.TCP.TotalEvents * 100
	}
	if s.Sched.TotalEvents > 0 {
		samples[health.MetricRunQueue] = s.Sched.AvgRunqueueLatencyUs / 1000
		samples[health.MetricCPUStarvation] = s.Sched.CPUStarvationCount
	}
	if s.System != nil {
		samples[health.MetricCPUUsage] = s.System.CPUUsagePercent
		samples[health.MetricMemoryUsage] = s.System.MemoryUsagePercent
	}
	if s.Services.Total > 0 {
		samples[health.MetricServiceUnhealthy] = s.Services.Unhealthy / s.Services.Total * 100
	}
	return samples
}

func parseMetricsTime(ts string, fallback time.Time) time.Time {
	if t, err := time.Parse(time.RFC3339, ts); err == nil {
		return t
	}
	return fallback
}

// computeHealth scores every known node against the active thresholds.
func computeHealth(now time.Time) health.ClusterHealth {
	th := healthThresholds.Active()

	clusterMetricsMu.RLock()
	snapshot := make(map[string]UnifiedMetricsResponse, len(clusterMetrics))
	for k, v := range clusterMetrics {
		snapshot[k] = v
	}
	clusterMetricsMu.RUnlock()

	nodes := make([]health.NodeHealth, 0, len(snapshot))
	for key, m := range snapshot {
		name := m.NodeName
		if name == "" || name == "unknown" {
			name = key
		}
		reported := parseMetricsTime(m.Timestamp, now)
		nodes = append(nodes, health.EvaluateNode(th, name, m.NodeIP, extractSamples(m), reported, now))
	}
	return health.EvaluateCluster(nodes, now)
}

// buildFindings derives alertable problems from an evaluation and peer state.
func buildFindings(ch health.ClusterHealth, peers []comm.PeerStatus) []health.Finding {
	var findings []health.Finding
	for _, n := range ch.Nodes {
		if n.Stale {
			findings = append(findings, health.Finding{
				Key: n.Node + "/node_stale", Node: n.Node, Metric: "node_stale",
				Severity: health.LevelCritical,
				Message:  fmt.Sprintf("%s has not reported metrics for over %s", n.Node, health.StaleAfter),
			})
		}
		for _, c := range n.Components {
			if c.Level != health.LevelWarning && c.Level != health.LevelCritical {
				continue
			}
			findings = append(findings, health.Finding{
				Key: n.Node + "/" + c.ID, Node: n.Node, Metric: c.ID, Severity: c.Level, Value: c.Value,
				Message: fmt.Sprintf("%s: %s is %.2f %s (%s)", n.Node, c.Label, c.Value, c.Unit, c.Level),
			})
		}
	}
	for _, p := range peers {
		if p.Status != "down" {
			continue
		}
		label := p.Name
		if label == "" {
			label = p.IP
		}
		findings = append(findings, health.Finding{
			Key: "peer/" + p.IP, Node: label, Metric: "peer_unreachable",
			Severity: health.LevelCritical,
			Message:  fmt.Sprintf("peer %s (%s) is unreachable: %s", label, p.IP, p.LastError),
		})
	}
	return findings
}

// evaluateHealth runs one cycle: score, record history, update alerts.
func evaluateHealth() {
	now := time.Now()
	ch := computeHealth(now)

	healthMu.Lock()
	healthLatest = ch
	healthMu.Unlock()

	healthStore.Record(ch.Nodes, now)
	healthStore.Update(buildFindings(ch, comm.PeerStatuses()), now)
}

func writeHealthJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeHealthError(w http.ResponseWriter, status int, msg string) {
	writeHealthJSON(w, status, map[string]string{"error": msg})
}

func handleHealthCluster(w http.ResponseWriter, r *http.Request) {
	healthMu.RLock()
	ch := healthLatest
	healthMu.RUnlock()
	if ch.Nodes == nil {
		ch.Nodes = []health.NodeHealth{}
	}

	writeHealthJSON(w, http.StatusOK, map[string]any{
		"cluster":       ch,
		"peers":         comm.PeerStatuses(),
		"firing_alerts": len(healthStore.Alerts("firing")),
	})
}

func handleHealthHistory(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if node := r.URL.Query().Get("node"); node != "" {
		writeHealthJSON(w, http.StatusOK, map[string]any{
			"history": map[string][]health.Point{node: healthStore.History(node, limit)},
		})
		return
	}
	writeHealthJSON(w, http.StatusOK, map[string]any{"history": healthStore.HistoryAll(limit)})
}

func handleHealthAlerts(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	if status != "" && status != "firing" && status != "resolved" {
		writeHealthError(w, http.StatusBadRequest, "status must be firing or resolved")
		return
	}
	alerts := healthStore.Alerts(status)
	if alerts == nil {
		alerts = []health.Alert{}
	}
	writeHealthJSON(w, http.StatusOK, map[string]any{"alerts": alerts})
}

type thresholdView struct {
	health.MetricInfo
	Standard health.Band  `json:"standard"`
	Custom   *health.Band `json:"custom,omitempty"`
	Active   health.Band  `json:"active"`
	IsCustom bool         `json:"is_custom"`
}

func thresholdsPayload() map[string]any {
	standard := health.Standard()
	custom := healthThresholds.Custom()
	views := make([]thresholdView, 0, len(health.Catalog))
	for _, info := range health.Catalog {
		v := thresholdView{MetricInfo: info, Standard: standard[info.ID], Active: standard[info.ID]}
		if band, ok := custom[info.ID]; ok {
			b := band
			v.Custom, v.Active, v.IsCustom = &b, band, true
		}
		views = append(views, v)
	}
	return map[string]any{"metrics": views}
}

func handleHealthThresholds(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeHealthJSON(w, http.StatusOK, thresholdsPayload())

	case http.MethodPut:
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<16))
		if err != nil {
			writeHealthError(w, http.StatusBadRequest, "failed to read request body")
			return
		}
		var req struct {
			Thresholds map[string]health.Band `json:"thresholds"`
		}
		if err := json.Unmarshal(body, &req); err != nil || len(req.Thresholds) == 0 {
			writeHealthError(w, http.StatusBadRequest, `body must be {"thresholds":{"<metric>":{"excellent":n,"good":n,"warning":n}}}`)
			return
		}
		if err := healthThresholds.Set(req.Thresholds); err != nil {
			writeHealthError(w, http.StatusBadRequest, err.Error())
			return
		}
		evaluateHealth() // apply immediately instead of waiting for the next tick
		writeHealthJSON(w, http.StatusOK, thresholdsPayload())

	case http.MethodDelete:
		metric := r.URL.Query().Get("metric")
		healthThresholds.Reset(metric)
		evaluateHealth()
		writeHealthJSON(w, http.StatusOK, thresholdsPayload())

	default:
		writeHealthError(w, http.StatusMethodNotAllowed, "GET, PUT or DELETE required")
	}
}
