package redirection

import (
	"fmt"
	"strings"
)

// NormalizeCreatePayload mirrors the validation logic from the Node backend.
func NormalizeCreatePayload(body map[string]interface{}) (*Policy, error) {
	policyName := str(body["policy_name"])
	namespace := str(body["namespace"])

	frontendService := coalesce(
		nestedStr(body, "frontend", "service"),
		str(body["frontend_service"]),
		str(body["frontend_service_name"]),
	)
	frontendPort, fpSet := intVal(coalesceRaw(
		nested(body, "frontend", "port"),
		body["frontend_port"],
		body["frontend_service_port"],
	))
	scope := coalesce(
		str(body["scope"]),
		"local",
	)

	metric := coalesce(
		nestedStr(body, "telemetry", "metric"),
		str(body["metric"]),
		"rtt_us",
	)
	threshold, thSet := floatVal(coalesceRaw(
		nested(body, "telemetry", "violation_threshold"),
		body["violation_threshold"],
	))
	monitor := coalesce(
		nestedStr(body, "telemetry", "monitor_pod_contains"),
		str(body["monitor_pod_contains"]),
		str(body["monitor_selector"]),
		frontendService,
	)

	actionType := coalesce(
		nestedStr(body, "action", "type"),
		str(body["action"]),
		"redirect",
	)
	backendSelector := coalesce(
		nestedStr(body, "action", "backend_selector"),
		str(body["redirect_backend_label"]),
		str(body["backend_selector"]),
	)
	backendService := coalesce(
		nestedStr(body, "action", "backend_service"),
		str(body["backend_service"]),
	)
	backendPort, bpSet := intVal(coalesceRaw(
		nested(body, "action", "backend_port"),
		body["redirect_backend_port"],
		body["backend_port"],
	))
	protocol := coalesce(
		nestedStr(body, "action", "protocol"),
		str(body["redirect_backend_protocol"]),
		"TCP",
	)
	ttlSeconds, ttlSet := intVal(coalesceRaw(
		nested(body, "action", "ttl_seconds"),
		body["ttl_seconds"],
	))
	strategy := coalesce(
		nestedStr(body, "action", "strategy"),
		str(body["strategy"]),
		"all",
	)
	backendCandidates := coalesce(
		nestedStr(body, "action", "backend_candidates_selector"),
		str(body["backend_candidate_label"]),
	)
	winnerLabel := coalesce(
		nestedStr(body, "action", "winner_label"),
		str(body["redirect_winner_label"]),
		"redirect-winner=yes",
	)
	targetNS := coalesce(
		nestedStr(body, "action", "target_namespace"),
		str(body["action_target_namespace"]),
	)

	missing := []string{}
	if policyName == "" {
		missing = append(missing, "policy_name")
	}
	if namespace == "" {
		missing = append(missing, "namespace")
	}
	if frontendService == "" {
		missing = append(missing, "frontend.service")
	}
	if !fpSet {
		missing = append(missing, "frontend.port")
	}
	if !thSet {
		missing = append(missing, "violation_threshold")
	}
	if backendSelector == "" {
		missing = append(missing, "backend_selector")
	}
	if !bpSet {
		missing = append(missing, "backend_port")
	}
	if !ttlSet {
		missing = append(missing, "ttl_seconds")
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required fields: %s", strings.Join(missing, ", "))
	}

	if err := validateMetric(metric); err != nil {
		return nil, err
	}
	if err := validatePort(frontendPort, "frontend.port"); err != nil {
		return nil, err
	}
	if err := validatePort(backendPort, "backend_port"); err != nil {
		return nil, err
	}
	if threshold <= 0 {
		return nil, fmt.Errorf("violation_threshold must be a positive number")
	}
	if err := validateScope(scope); err != nil {
		return nil, err
	}
	if ttlSeconds <= 0 {
		return nil, fmt.Errorf("ttl_seconds must be a positive number")
	}
	if err := validateStrategy(strategy, backendCandidates, winnerLabel); err != nil {
		return nil, err
	}
	if _, _, err := splitSelector(backendSelector); err != nil {
		return nil, err
	}

	p := &Policy{
		PolicyName: policyName,
		Namespace:  namespace,
		Scope:      scope,
		Frontend: Frontend{
			Service: frontendService,
			Port:    frontendPort,
		},
		Telemetry: TelemetryConfig{
			Metric:             metric,
			ViolationThreshold: threshold,
			MonitorPodContains: monitor,
		},
		Action: ActionConfig{
			Type:                      actionType,
			BackendSelector:           backendSelector,
			BackendService:            backendService,
			BackendPort:               backendPort,
			Protocol:                  strings.ToUpper(protocol),
			TTLSeconds:                ttlSeconds,
			Strategy:                  strategy,
			BackendCandidatesSelector: backendCandidates,
			WinnerLabel:               winnerLabel,
			TargetNamespace:           targetNS,
		},
	}
	applyDefaults(p)
	return p, nil
}

// ApplyUpdatePayload merges provided fields into an existing policy.
func ApplyUpdatePayload(p *Policy, body map[string]interface{}) error {
	if ns := str(body["namespace"]); ns != "" {
		p.Namespace = ns
	}
	if scope := str(body["scope"]); scope != "" {
		if err := validateScope(scope); err != nil {
			return err
		}
		p.Scope = scope
	}

	// frontend
	fp, fpSet := intVal(coalesceRaw(
		nested(body, "frontend", "port"),
		body["frontend_port"],
		body["frontend_service_port"],
	))
	if fs := coalesce(
		nestedStr(body, "frontend", "service"),
		str(body["frontend_service"]),
	); fs != "" {
		p.Frontend.Service = fs
	}
	if fpSet {
		if err := validatePort(fp, "frontend.port"); err != nil {
			return err
		}
		p.Frontend.Port = fp
	}

	// telemetry
	if m := coalesce(
		nestedStr(body, "telemetry", "metric"),
		str(body["metric"]),
	); m != "" {
		if err := validateMetric(m); err != nil {
			return err
		}
		p.Telemetry.Metric = m
	}
	if thRaw := coalesceRaw(
		nested(body, "telemetry", "violation_threshold"),
		body["violation_threshold"],
	); thRaw != nil {
		th, ok := floatVal(thRaw)
		if !ok || th <= 0 {
			return fmt.Errorf("violation_threshold must be a positive number")
		}
		p.Telemetry.ViolationThreshold = th
	}
	if monitor := coalesce(
		nestedStr(body, "telemetry", "monitor_pod_contains"),
		str(body["monitor_pod_contains"]),
		str(body["monitor_selector"]),
	); monitor != "" {
		p.Telemetry.MonitorPodContains = monitor
	}

	// action
	if at := coalesce(
		nestedStr(body, "action", "type"),
		str(body["action"]),
	); at != "" {
		p.Action.Type = at
	}
	if bs := coalesce(
		nestedStr(body, "action", "backend_selector"),
		str(body["redirect_backend_label"]),
		str(body["backend_selector"]),
	); bs != "" {
		if _, _, err := splitSelector(bs); err != nil {
			return err
		}
		p.Action.BackendSelector = bs
	}
	if bs := coalesce(
		nestedStr(body, "action", "backend_service"),
		str(body["backend_service"]),
	); bs != "" {
		p.Action.BackendService = bs
	}
	if bpRaw := coalesceRaw(
		nested(body, "action", "backend_port"),
		body["redirect_backend_port"],
		body["backend_port"],
	); bpRaw != nil {
		bp, ok := intVal(bpRaw)
		if !ok {
			return fmt.Errorf("backend_port must be an integer")
		}
		if err := validatePort(bp, "backend_port"); err != nil {
			return err
		}
		p.Action.BackendPort = bp
	}
	if proto := coalesce(
		nestedStr(body, "action", "protocol"),
		str(body["redirect_backend_protocol"]),
	); proto != "" {
		p.Action.Protocol = strings.ToUpper(proto)
	}
	if ttlRaw := coalesceRaw(
		nested(body, "action", "ttl_seconds"),
		body["ttl_seconds"],
	); ttlRaw != nil {
		ttl, ok := intVal(ttlRaw)
		if !ok || ttl <= 0 {
			return fmt.Errorf("ttl_seconds must be a positive integer")
		}
		p.Action.TTLSeconds = ttl
	}
	if strat := coalesce(
		nestedStr(body, "action", "strategy"),
		str(body["strategy"]),
	); strat != "" {
		p.Action.Strategy = strat
	}
	if cand := coalesce(
		nestedStr(body, "action", "backend_candidates_selector"),
		str(body["backend_candidate_label"]),
	); cand != "" {
		p.Action.BackendCandidatesSelector = cand
	}
	if win := coalesce(
		nestedStr(body, "action", "winner_label"),
		str(body["redirect_winner_label"]),
	); win != "" {
		p.Action.WinnerLabel = win
	}
	if tgt := coalesce(
		nestedStr(body, "action", "target_namespace"),
		str(body["action_target_namespace"]),
	); tgt != "" {
		p.Action.TargetNamespace = tgt
	}

	if err := validateStrategy(p.Action.Strategy, p.Action.BackendCandidatesSelector, p.Action.WinnerLabel); err != nil {
		return err
	}

	applyDefaults(p)
	return nil
}

// applyDefaults fills missing optional fields with sensible defaults.
func applyDefaults(p *Policy) {
	if p.Telemetry.MonitorPodContains == "" {
		p.Telemetry.MonitorPodContains = p.Frontend.Service
	}
	if p.Action.Protocol == "" {
		p.Action.Protocol = "TCP"
	}
	if p.Action.WinnerLabel == "" {
		p.Action.WinnerLabel = "redirect-winner=yes"
	}
	if p.Action.Strategy == "" {
		p.Action.Strategy = "all"
	}
	if p.Scope == "" {
		p.Scope = "local"
	}
}

func validateMetric(metric string) error {
	switch strings.ToLower(metric) {
	case "rtt_us", "dns_us", "sched_latency_us", "sched_us", "rtt":
		return nil
	default:
		return fmt.Errorf("metric must be one of: rtt_us, dns_us, sched_latency_us")
	}
}

func validatePort(port int, field string) error {
	if port < 1 || port > 65535 {
		return fmt.Errorf("%s must be between 1 and 65535", field)
	}
	return nil
}

func validateStrategy(strategy, candidates, winner string) error {
	if strategy == "" {
		return nil
	}
	switch strings.ToLower(strategy) {
	case "all":
		return nil
	case "best_pod":
		if candidates == "" {
			return fmt.Errorf("backend_candidates_selector is required when strategy=best_pod")
		}
		if _, _, err := splitSelector(winner); err != nil {
			return fmt.Errorf("winner_label must be key=value when strategy=best_pod")
		}
		return nil
	default:
		return fmt.Errorf("strategy must be one of: all, best_pod")
	}
}

func validateScope(scope string) error {
	switch strings.ToLower(strings.TrimSpace(scope)) {
	case "", "local", "cluster":
		return nil
	default:
		return fmt.Errorf("scope must be one of: local, cluster")
	}
}

// Helpers for decoding loosely-typed JSON payloads
func str(v interface{}) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case fmt.Stringer:
		return strings.TrimSpace(t.String())
	case float64:
		if t == float64(int64(t)) {
			return fmt.Sprintf("%d", int64(t))
		}
		return fmt.Sprintf("%f", t)
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func nested(body map[string]interface{}, path ...string) interface{} {
	cur := body
	for i, key := range path {
		v, ok := cur[key]
		if !ok {
			return nil
		}
		if i == len(path)-1 {
			return v
		}
		next, ok := v.(map[string]interface{})
		if !ok {
			return nil
		}
		cur = next
	}
	return nil
}

func nestedStr(body map[string]interface{}, path ...string) string {
	if v := nested(body, path...); v != nil {
		return str(v)
	}
	return ""
}

func coalesce(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func coalesceRaw(values ...interface{}) interface{} {
	for _, v := range values {
		if v != nil && str(v) != "" {
			return v
		}
	}
	return nil
}

func intVal(v interface{}) (int, bool) {
	if v == nil {
		return 0, false
	}
	switch t := v.(type) {
	case int:
		return t, true
	case int32:
		return int(t), true
	case int64:
		return int(t), true
	case float64:
		if t != float64(int64(t)) {
			return 0, false
		}
		return int(t), true
	case float32:
		if t != float32(int64(t)) {
			return 0, false
		}
		return int(t), true
	case string:
		if strings.TrimSpace(t) == "" {
			return 0, false
		}
		var out int
		_, err := fmt.Sscanf(t, "%d", &out)
		if err == nil {
			return out, true
		}
		return 0, false
	default:
		return 0, false
	}
}

func floatVal(v interface{}) (float64, bool) {
	if v == nil {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int32:
		return float64(t), true
	case int64:
		return float64(t), true
	case string:
		if strings.TrimSpace(t) == "" {
			return 0, false
		}
		var out float64
		_, err := fmt.Sscanf(t, "%f", &out)
		if err == nil {
			return out, true
		}
		return 0, false
	default:
		return 0, false
	}
}
