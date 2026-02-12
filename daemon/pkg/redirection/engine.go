package redirection

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
)

var lrpGVR = schema.GroupVersionResource{
	Group:    "cilium.io",
	Version:  "v2",
	Resource: "ciliumlocalredirectpolicies",
}

// Engine evaluates telemetry and applies or expires redirect policies.
type Engine struct {
	store  *Store
	dyn    dynamic.Interface
	kube   *kubernetes.Clientset
	logger *log.Logger
}

// ApplyResult mirrors the response we return to the frontend.
type ApplyResult struct {
	Applied       bool     `json:"applied"`
	Message       string   `json:"message"`
	TargetBackend string   `json:"target_backend,omitempty"`
	TTLSeconds    int      `json:"ttl_seconds,omitempty"`
	Details       []string `json:"details,omitempty"`
	Stdout        string   `json:"stdout,omitempty"`
	Stderr        string   `json:"stderr,omitempty"`
	Helper        string   `json:"helper,omitempty"`
	MetricAverage float64  `json:"metric_average,omitempty"`
	Metric        string   `json:"metric,omitempty"`
	Violation     bool     `json:"violation,omitempty"`
	StatusCode    int      `json:"-"`
}

// NewEngine wires storage with Kubernetes access.
func NewEngine(store *Store, dyn dynamic.Interface, kube *kubernetes.Clientset, logger *log.Logger) *Engine {
	if logger == nil {
		logger = log.Default()
	}
	return &Engine{store: store, dyn: dyn, kube: kube, logger: logger}
}

// EvaluateAndApply loads a policy, checks telemetry, and creates the LRP if needed.
func (e *Engine) EvaluateAndApply(ctx context.Context, name string) (*Policy, *ApplyResult, error) {
	policy, err := e.store.GetByName(ctx, name)
	if err != nil {
		return nil, nil, err
	}

	now := time.Now().UTC()
	avgValue, count := e.averageMetric(policy)
	violation := count > 0 && avgValue >= policy.Telemetry.ViolationThreshold

	policy.Status.LastEvaluatedAt = &now
	policy.Status.LastAvgValue = avgValue
	policy.Status.LastViolation = violation

	if policy.Action.Type != "" && policy.Action.Type != "redirect" {
		policy.Status.LastDecision = "SKIPPED"
		policy.AddHistory("SKIPPED", "Policy action type not redirect", map[string]interface{}{"action": policy.Action.Type})
		_ = e.store.Replace(ctx, policy)
		return policy, &ApplyResult{
			Applied:    false,
			Message:    "Action type not redirect; nothing to apply",
			Violation:  violation,
			Metric:     policy.Telemetry.Metric,
			StatusCode: http.StatusOK,
		}, nil
	}

	if !violation {
		policy.Status.LastDecision = "SKIPPED"
		policy.AddHistory("SKIPPED", "No violation detected", map[string]interface{}{
			"metric":    policy.Telemetry.Metric,
			"avg_value": avgValue,
			"threshold": policy.Telemetry.ViolationThreshold,
			"pod_count": count,
		})
		_ = e.store.Replace(ctx, policy)
		return policy, &ApplyResult{
			Applied:       false,
			Message:       "Violation not triggered. No redirect applied.",
			Details:       []string{"No redirect applied"},
			Metric:        policy.Telemetry.Metric,
			MetricAverage: avgValue,
			Violation:     false,
			StatusCode:    http.StatusOK,
		}, nil
	}

	if e.dyn == nil || e.kube == nil {
		return policy, nil, errors.New("kubernetes client not initialized")
	}

	res, err := e.applyRedirect(ctx, policy, avgValue)
	if err != nil {
		policy.Status.LastDecision = "ERROR"
		policy.Status.LastError = err.Error()
		policy.AddHistory("ERROR", "Apply failed", map[string]interface{}{"error": err.Error()})
		_ = e.store.Replace(ctx, policy)
		return policy, nil, err
	}

	policy.Status.LastDecision = "APPLIED"
	policy.Status.LastError = ""
	policy.Status.LastAppliedAt = &now
	policy.Status.LastLRPName = policy.Slug()
	policy.Status.LastHelperStdout = res.Stdout
	policy.Status.LastHelperStderr = res.Stderr
	policy.AddHistory("APPLIED", "LocalRedirectPolicy applied", map[string]interface{}{
		"target_backend": res.TargetBackend,
		"metric":         policy.Telemetry.Metric,
		"avg_value":      avgValue,
	})

	if err := e.store.Replace(ctx, policy); err != nil {
		return policy, nil, err
	}

	res.Applied = true
	res.Metric = policy.Telemetry.Metric
	res.MetricAverage = avgValue
	res.Violation = true
	return policy, res, nil
}

// ExpirePolicy deletes the LRP and updates status/history.
func (e *Engine) ExpirePolicy(ctx context.Context, name string, reason string, clearWinner bool) (*Policy, error) {
	policy, err := e.store.GetByName(ctx, name)
	if err != nil {
		return nil, err
	}

	if e.dyn != nil {
		if err := e.deleteRedirect(ctx, policy, clearWinner); err != nil {
			policy.Status.LastError = err.Error()
			policy.AddHistory("ERROR", "Expire failed", map[string]interface{}{"error": err.Error()})
			_ = e.store.Replace(ctx, policy)
			return policy, err
		}
	}

	now := time.Now().UTC()
	policy.Status.LastDecision = "EXPIRED"
	policy.Status.LastExpiredAt = &now
	policy.AddHistory("EXPIRED", "LocalRedirectPolicy deleted", map[string]interface{}{"reason": reason})
	return policy, e.store.Replace(ctx, policy)
}

// StartTTLSweeper periodically deletes expired LRPs based on policy TTL.
func (e *Engine) StartTTLSweeper(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		return
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				e.sweepTTL(context.Background())
			case <-ctx.Done():
				return
			}
		}
	}()
}

// sweepTTL checks all policies with TTL and expires overdue ones.
func (e *Engine) sweepTTL(ctx context.Context) {
	policies, err := e.store.List(ctx)
	if err != nil {
		e.logger.Printf("[Routing] TTL sweep list failed: %v", err)
		return
	}

	now := time.Now()
	for _, p := range policies {
		if p.Action.TTLSeconds <= 0 {
			continue
		}
		var anchor time.Time
		switch {
		case p.Status.LastAppliedAt != nil:
			anchor = *p.Status.LastAppliedAt
		case p.Status.LastEvaluatedAt != nil:
			anchor = *p.Status.LastEvaluatedAt
		case !p.UpdatedAt.IsZero():
			anchor = p.UpdatedAt
		default:
			anchor = p.CreatedAt
		}

		if anchor.IsZero() {
			continue
		}

		if anchor.Add(time.Duration(p.Action.TTLSeconds)*time.Second).Before(now) &&
			strings.ToUpper(p.Status.LastDecision) != "EXPIRED" {
			if _, err := e.ExpirePolicy(ctx, p.PolicyName, "auto-ttl", true); err != nil {
				e.logger.Printf("[Routing] TTL expire failed for %s: %v", p.PolicyName, err)
			} else {
				e.logger.Printf("[Routing] TTL expired for %s", p.PolicyName)
			}
		}
	}
}

func (e *Engine) applyRedirect(ctx context.Context, p *Policy, avgValue float64) (*ApplyResult, error) {
	labelKey, labelVal, err := splitSelector(p.Action.BackendSelector)
	if err != nil {
		return nil, err
	}

	targetNS := p.Namespace
	if p.Action.TargetNamespace != "" {
		targetNS = p.Action.TargetNamespace
	}

	appliedLabelKey, appliedLabelVal := labelKey, labelVal
	var winnerPod string

	if strings.ToLower(p.Action.Strategy) == "best_pod" {
		candidateSelector := p.Action.BackendCandidatesSelector
		if candidateSelector == "" {
			candidateSelector = p.Action.BackendSelector
		}

		winner, err := e.pickBestPod(ctx, targetNS, candidateSelector, p.Telemetry.Metric)
		if err != nil {
			return nil, fmt.Errorf("choose best pod: %w", err)
		}

		if winner != "" && p.Action.WinnerLabel != "" {
			winKey, winVal, err := splitSelector(p.Action.WinnerLabel)
			if err != nil {
				return nil, fmt.Errorf("winner label: %w", err)
			}
			if err := e.applyWinnerLabel(ctx, targetNS, candidateSelector, winner, winKey, winVal); err != nil {
				return nil, fmt.Errorf("apply winner label: %w", err)
			}
			appliedLabelKey, appliedLabelVal = winKey, winVal
			winnerPod = winner
		}
	}

	obj := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "cilium.io/v2",
			"kind":       "CiliumLocalRedirectPolicy",
			"metadata": map[string]interface{}{
				"name":      p.Slug(),
				"namespace": targetNS,
			},
			"spec": map[string]interface{}{
				"redirectFrontend": map[string]interface{}{
					"serviceMatcher": map[string]interface{}{
						"serviceName": p.Frontend.Service,
						"namespace":   p.Namespace,
					},
				},
				"redirectBackend": map[string]interface{}{
					"localEndpointSelector": map[string]interface{}{
						"matchLabels": map[string]interface{}{
							appliedLabelKey: appliedLabelVal,
						},
					},
					"toPorts": []interface{}{
						map[string]interface{}{
							"name":     fmt.Sprintf("redirect-%d", p.Action.BackendPort),
							"port":     fmt.Sprintf("%d", p.Action.BackendPort),
							"protocol": strings.ToUpper(p.Action.Protocol),
						},
					},
				},
				"loadBalancerMode": "localized",
			},
		},
	}

	data, err := obj.MarshalJSON()
	if err != nil {
		return nil, err
	}

	force := true
	_, err = e.dyn.Resource(lrpGVR).Namespace(targetNS).Patch(
		ctx,
		p.Slug(),
		types.ApplyPatchType,
		data,
		metav1.PatchOptions{FieldManager: "ebpf-daemon", Force: &force},
	)
	if err != nil {
		return nil, err
	}

	msg := "Violation triggered. Redirection applied."
	backendName := labelVal
	if winnerPod != "" {
		backendName = winnerPod
	}

	return &ApplyResult{
		Applied:       true,
		Message:       msg,
		TargetBackend: backendName,
		TTLSeconds:    p.Action.TTLSeconds,
		Details: []string{
			"Redirect policy applied",
			fmt.Sprintf("Target backend: %s", backendName),
			fmt.Sprintf("Metric avg: %.2f (threshold %.2f)", avgValue, p.Telemetry.ViolationThreshold),
		},
		Stdout: fmt.Sprintf("Redirect applied to %s=%s", appliedLabelKey, appliedLabelVal),
	}, nil
}

func (e *Engine) deleteRedirect(ctx context.Context, p *Policy, clearWinner bool) error {
	targetNS := p.Namespace
	if p.Action.TargetNamespace != "" {
		targetNS = p.Action.TargetNamespace
	}

	err := e.dyn.Resource(lrpGVR).Namespace(targetNS).Delete(ctx, p.Slug(), metav1.DeleteOptions{})
	if err != nil && !apierrors.IsNotFound(err) {
		return err
	}

	if clearWinner && strings.ToLower(p.Action.Strategy) == "best_pod" && p.Action.WinnerLabel != "" {
		if err := e.clearWinnerLabel(ctx, targetNS, p.Action); err != nil {
			e.logger.Printf("[Routing] failed to clear winner labels: %v", err)
		}
	}
	return nil
}

// clearWinnerLabel removes the winner label from all candidate pods.
func (e *Engine) clearWinnerLabel(ctx context.Context, ns string, action ActionConfig) error {
	selector := action.BackendCandidatesSelector
	if selector == "" {
		selector = action.BackendSelector
	}
	if selector == "" || action.WinnerLabel == "" {
		return nil
	}
	winKey, _, err := splitSelector(action.WinnerLabel)
	if err != nil {
		return err
	}

	pods, err := e.kube.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return err
	}

	for _, pod := range pods.Items {
		patch := map[string]interface{}{
			"metadata": map[string]interface{}{
				"labels": map[string]interface{}{
					winKey: nil,
				},
			},
		}
		patchData, _ := json.Marshal(patch)
		_, _ = e.kube.CoreV1().Pods(ns).Patch(ctx, pod.Name, types.MergePatchType, patchData, metav1.PatchOptions{})
	}
	return nil
}

// pickBestPod chooses the pod with the lowest metric among candidates.
func (e *Engine) pickBestPod(ctx context.Context, ns, selector, metric string) (string, error) {
	if selector == "" {
		return "", nil
	}
	pods, err := e.kube.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return "", err
	}
	if len(pods.Items) == 0 {
		return "", nil
	}

	best := ""
	bestValue := math.MaxFloat64
	for _, pod := range pods.Items {
		value, ok := metricValueForPod(metric, ns, pod.Name)
		if !ok {
			continue
		}
		if value < bestValue {
			bestValue = value
			best = pod.Name
		}
	}
	return best, nil
}

func (e *Engine) applyWinnerLabel(ctx context.Context, ns, selector, winner, labelKey, labelVal string) error {
	if winner == "" {
		return nil
	}

	pods, err := e.kube.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return err
	}

	for _, pod := range pods.Items {
		labels := map[string]interface{}{}
		if pod.Name == winner {
			labels[labelKey] = labelVal
		} else {
			labels[labelKey] = nil
		}
		patch := map[string]interface{}{"metadata": map[string]interface{}{"labels": labels}}
		data, _ := json.Marshal(patch)
		if _, err := e.kube.CoreV1().Pods(ns).Patch(ctx, pod.Name, types.MergePatchType, data, metav1.PatchOptions{}); err != nil {
			return err
		}
	}
	return nil
}

// averageMetric computes the mean microsecond value for pods in the namespace that match the substring.
func (e *Engine) averageMetric(p *Policy) (float64, int) {
	monitor := p.Telemetry.MonitorPodContains
	if monitor == "" {
		monitor = p.Frontend.Service
	}
	namespace := p.Namespace
	return averageMetricForPods(p.Telemetry.Metric, namespace, monitor)
}

// metricValueForPod returns the metric value for a specific pod (microseconds).
func metricValueForPod(metric, namespace, podName string) (float64, bool) {
	key := namespace + "/" + podName
	switch strings.ToLower(metric) {
	case "dns_us":
		if data, ok := telemetry.GetPodDNSMetrics()[key]; ok && data.TotalEvents > 0 {
			return float64(data.TotalLatencyNs) / float64(data.TotalEvents) / 1000.0, true
		}
	case "rtt_us", "rtt":
		if data, ok := telemetry.GetPodRTTMetrics()[key]; ok && data.TotalEvents > 0 {
			return float64(data.TotalRTTNs) / float64(data.TotalEvents) / 1000.0, true
		}
	case "sched_latency_us", "sched_us":
		if data, ok := telemetry.GetPodSchedLatencyMetrics()[key]; ok && data.EventCount > 0 {
			return data.AvgRunqueueLatencyUs, true
		}
	}
	return 0, false
}

// averageMetricForPods calculates the average metric across all matching pods in a namespace.
func averageMetricForPods(metric, namespace, nameContains string) (float64, int) {
	var sum float64
	var count int
	nameContains = strings.ToLower(nameContains)
	switch strings.ToLower(metric) {
	case "dns_us":
		for _, data := range telemetry.GetPodDNSMetrics() {
			if data.Namespace != namespace || !strings.Contains(strings.ToLower(data.PodName), nameContains) {
				continue
			}
			if data.TotalEvents == 0 {
				continue
			}
			sum += float64(data.TotalLatencyNs) / float64(data.TotalEvents) / 1000.0
			count++
		}
	case "rtt_us", "rtt":
		for _, data := range telemetry.GetPodRTTMetrics() {
			if data.Namespace != namespace || !strings.Contains(strings.ToLower(data.PodName), nameContains) {
				continue
			}
			if data.TotalEvents == 0 {
				continue
			}
			sum += float64(data.TotalRTTNs) / float64(data.TotalEvents) / 1000.0
			count++
		}
	case "sched_latency_us", "sched_us":
		for _, data := range telemetry.GetPodSchedLatencyMetrics() {
			if data.Namespace != namespace || !strings.Contains(strings.ToLower(data.PodName), nameContains) {
				continue
			}
			if data.EventCount == 0 {
				continue
			}
			sum += data.AvgRunqueueLatencyUs
			count++
		}
	}

	if count == 0 {
		return 0, 0
	}
	return sum / float64(count), count
}

func splitSelector(selector string) (string, string, error) {
	parts := strings.SplitN(selector, "=", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", "", fmt.Errorf("selector must be key=value")
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), nil
}
