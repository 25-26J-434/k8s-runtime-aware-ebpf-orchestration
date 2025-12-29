package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

type RoutingRule struct {
	ID        string  `json:"id"`
	Intent    string  `json:"intent"`
	Metric    string  `json:"metric"`
	Threshold float64 `json:"threshold"`
	Action    string  `json:"action"`
	Namespace string  `json:"namespace"`
	Service   string  `json:"service"`
	Fallback  string  `json:"fallback"`
	Node      string  `json:"node"`
	CreatedAt string  `json:"created_at"`
}

type RoutingDecision struct {
	RuleID      string  `json:"rule_id"`
	Namespace   string  `json:"namespace"`
	Service     string  `json:"service"`
	Fallback    string  `json:"fallback"`
	TargetPod   string  `json:"target_pod"`
	TargetIP    string  `json:"target_ip"`
	Metric      string  `json:"metric"`
	MetricValue float64 `json:"metric_value"`
	Threshold   float64 `json:"threshold"`
	Violated    bool    `json:"violated"`
	Reason      string  `json:"reason"`
	Timestamp   string  `json:"timestamp"`
}

type ruleStore struct {
	mu        sync.Mutex
	rules     []RoutingRule
	decisions []RoutingDecision
}

var rulesState = &ruleStore{}

func addRoutingRule(rule RoutingRule) RoutingRule {
	rulesState.mu.Lock()
	defer rulesState.mu.Unlock()
	rulesState.rules = append(rulesState.rules, rule)
	return rule
}

func listRoutingRules() []RoutingRule {
	rulesState.mu.Lock()
	defer rulesState.mu.Unlock()
	out := make([]RoutingRule, len(rulesState.rules))
	copy(out, rulesState.rules)
	return out
}

func setDecisions(decisions []RoutingDecision) {
	rulesState.mu.Lock()
	defer rulesState.mu.Unlock()
	rulesState.decisions = decisions
}

func listDecisions() []RoutingDecision {
	rulesState.mu.Lock()
	defer rulesState.mu.Unlock()
	out := make([]RoutingDecision, len(rulesState.decisions))
	copy(out, rulesState.decisions)
	return out
}

func handleRoutingRules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rules := listRoutingRules()
		writeJSON(w, rules)
	case http.MethodPost:
		var req RoutingRule
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		req.ID = strings.ReplaceAll(time.Now().Format("20060102150405.000000000"), ".", "")
		req.CreatedAt = time.Now().UTC().Format(time.RFC3339)
		if req.Metric == "" {
			req.Metric = "dns_latency_us"
		}
		if req.Action == "" {
			req.Action = "reroute"
		}
		rule := addRoutingRule(req)
		writeJSON(w, rule)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func handleRoutingDecisions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, listDecisions())
}

// evaluation loop
func startRoutingEvaluator() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		evaluateRulesOnce()
	}
}

func evaluateRulesOnce() {
	rules := listRoutingRules()
	if len(rules) == 0 {
		return
	}

	topology, err := GetClusterTopology()
	if err != nil {
		log.Printf("[Routing] topology fetch failed: %v", err)
		return
	}

	podDNS := telemetry.GetPodDNSMetrics()

	var decisions []RoutingDecision
	for _, rule := range rules {
		// collect pods for primary and fallback
		primaryPods := podsForService(topology, rule.Namespace, rule.Service)
		fallbackPods := podsForService(topology, rule.Namespace, rule.Fallback)

		// evaluate metric (dns latency only for now)
		metricValue := worstAvgLatency(podDNS, rule.Namespace, primaryPods)
		violated := metricValue > rule.Threshold

		// choose target set
		targetPods := primaryPods
		if violated && len(fallbackPods) > 0 {
			targetPods = fallbackPods
		}
		bestPod, bestIP := bestLatencyPod(podDNS, rule.Namespace, targetPods)

		reason := "within threshold"
		if violated {
			reason = "threshold violated"
		}

		decisions = append(decisions, RoutingDecision{
			RuleID:      rule.ID,
			Namespace:   rule.Namespace,
			Service:     rule.Service,
			Fallback:    rule.Fallback,
			TargetPod:   bestPod,
			TargetIP:    bestIP,
			Metric:      rule.Metric,
			MetricValue: metricValue,
			Threshold:   rule.Threshold,
			Violated:    violated,
			Reason:      reason,
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
		})
	}

	setDecisions(decisions)
}

func podsForService(topology *ClusterTopology, namespace, service string) []PodInfo {
	if topology == nil {
		return nil
	}
	var pods []PodInfo
	for _, n := range topology.Nodes {
		for _, p := range n.Pods {
			if p.Namespace == namespace && (p.Service == service || strings.HasPrefix(p.Name, service)) {
				pods = append(pods, p)
			}
		}
	}
	return pods
}

func worstAvgLatency(podDNS map[string]telemetry.PodDNSMetrics, namespace string, pods []PodInfo) float64 {
	worst := float64(0)
	for _, p := range pods {
		key := namespace + "/" + p.Name
		if stats, ok := podDNS[key]; ok && stats.TotalEvents > 0 {
			avg := float64(stats.TotalLatencyNs) / float64(stats.TotalEvents) / 1000
			if avg > worst {
				worst = avg
			}
		}
	}
	return worst
}

func bestLatencyPod(podDNS map[string]telemetry.PodDNSMetrics, namespace string, pods []PodInfo) (string, string) {
	bestPod := ""
	bestIP := ""
	best := float64(0)
	first := true
	for _, p := range pods {
		key := namespace + "/" + p.Name
		if stats, ok := podDNS[key]; ok && stats.TotalEvents > 0 {
			avg := float64(stats.TotalLatencyNs) / float64(stats.TotalEvents) / 1000
			if first || avg < best {
				first = false
				best = avg
				bestPod = p.Name
				bestIP = p.IP
			}
		}
	}
	return bestPod, bestIP
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
