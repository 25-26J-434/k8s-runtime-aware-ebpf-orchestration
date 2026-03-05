package redirection

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/netip"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/loader"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
	"github.com/cilium/ebpf"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
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

	syncNamespace string
	dnatSyncMu    sync.Mutex
	dnatSyncKeys  map[string]dnatKey // configmap-key -> applied map key
	localNodeName string
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
	syncNS := os.Getenv("POD_NAMESPACE")
	if syncNS == "" {
		syncNS = "ebpf-telemetry"
	}
	localNode := os.Getenv("NODE_NAME")
	if localNode == "" {
		if host, err := os.Hostname(); err == nil {
			localNode = host
		}
	}
	return &Engine{
		store:         store,
		dyn:           dyn,
		kube:          kube,
		logger:        logger,
		syncNamespace: syncNS,
		dnatSyncKeys:  map[string]dnatKey{},
		localNodeName: localNode,
	}
}

// EvaluateAndApply loads a policy, checks telemetry, and creates the LRP if needed.
func (e *Engine) EvaluateAndApply(ctx context.Context, name string) (*Policy, *ApplyResult, error) {
	policy, err := e.store.GetByName(ctx, name)
	if err != nil {
		return nil, nil, err
	}

	now := time.Now().UTC()
	metricUsed := healthMetricForScope(policy.Scope)
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
			Metric:     metricUsed,
			StatusCode: http.StatusOK,
		}, nil
	}

	if !violation {
		policy.Status.LastDecision = "SKIPPED"
		policy.AddHistory("SKIPPED", "No violation detected", map[string]interface{}{
			"metric":    metricUsed,
			"avg_value": avgValue,
			"threshold": policy.Telemetry.ViolationThreshold,
			"pod_count": count,
		})
		_ = e.store.Replace(ctx, policy)
		return policy, &ApplyResult{
			Applied:       false,
			Message:       "Violation not triggered. No redirect applied.",
			Details:       []string{"No redirect applied"},
			Metric:        metricUsed,
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
		"metric":         metricUsed,
		"avg_value":      avgValue,
	})

	if err := e.store.Replace(ctx, policy); err != nil {
		return policy, nil, err
	}

	res.Applied = true
	res.Metric = metricUsed
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
	if strings.EqualFold(p.Scope, "cluster") {
		return e.applyClusterRedirect(ctx, p, avgValue)
	}

	appliedLabelKey, appliedLabelVal, winnerPod, err := e.selectBackend(ctx, p)
	if err != nil {
		return nil, err
	}

	targetNS := p.Namespace
	if p.Action.TargetNamespace != "" {
		targetNS = p.Action.TargetNamespace
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
	backendName := appliedLabelVal
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

func (e *Engine) applyClusterRedirect(ctx context.Context, p *Policy, avgValue float64) (*ApplyResult, error) {
	_, _, winnerPod, err := e.selectBackend(ctx, p)
	if err != nil {
		return nil, err
	}

	targetNS := p.Namespace
	if p.Action.TargetNamespace != "" {
		targetNS = p.Action.TargetNamespace
	}

	if winnerPod == "" {
		if winnerPod, err = e.pickAnyPod(ctx, targetNS, p.Action.BackendSelector); err != nil {
			return nil, err
		}
	}
	if winnerPod == "" {
		return nil, fmt.Errorf("no backend pod found for selector %q", p.Action.BackendSelector)
	}

	winner, err := e.kube.CoreV1().Pods(targetNS).Get(ctx, winnerPod, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("load winner pod: %w", err)
	}
	if winner.Status.PodIP == "" {
		return nil, fmt.Errorf("winner pod has no IP: %s", winnerPod)
	}

	frontendSvc, err := e.resolveFrontendService(ctx, p.Namespace, p.Frontend.Service)
	if err != nil {
		return nil, err
	}
	if err := ensureServicePortExists(frontendSvc, p.Frontend.Port); err != nil {
		return nil, err
	}

	// For cluster scope, distribute the redirect decision to every node and let each node program
	// its local DNAT map. This avoids fighting Kubernetes EndpointSlice reconciliation.
	if err := e.publishClusterDNAT(ctx, p, frontendSvc, winner); err != nil {
		e.logger.Printf("[Routing] cluster DNAT publish failed for %s/%s: %v", p.Namespace, frontendSvc.Name, err)
	}

	if err := e.applyDNATRedirectWithPorts(ctx, frontendSvc, winner, uint16(p.Frontend.Port), uint16(p.Action.BackendPort)); err != nil {
		return nil, err
	}

	msg := "Violation triggered. Cluster redirection applied via eBPF DNAT."
	return &ApplyResult{
		Applied:       true,
		Message:       msg,
		TargetBackend: winnerPod,
		TTLSeconds:    p.Action.TTLSeconds,
		Details: []string{
			"DNAT map updated",
			"Redirect published to all nodes",
			fmt.Sprintf("Target backend: %s", winnerPod),
			fmt.Sprintf("Metric avg: %.2f (threshold %.2f)", avgValue, p.Telemetry.ViolationThreshold),
		},
		Stdout: fmt.Sprintf("DNAT map updated for service %s", frontendSvc.Name),
	}, nil
}

func (e *Engine) selectBackend(ctx context.Context, p *Policy) (string, string, string, error) {
	labelKey, labelVal, err := splitSelector(p.Action.BackendSelector)
	if err != nil {
		return "", "", "", err
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

		winner, _, err := e.pickBestPod(ctx, targetNS, candidateSelector, podHealthMetric(), p.Scope)
		if err != nil {
			return "", "", "", fmt.Errorf("choose best pod: %w", err)
		}

		if winner != "" && p.Action.WinnerLabel != "" {
			winKey, winVal, err := splitSelector(p.Action.WinnerLabel)
			if err != nil {
				return "", "", "", fmt.Errorf("winner label: %w", err)
			}
			if err := e.applyWinnerLabel(ctx, targetNS, candidateSelector, winner, winKey, winVal); err != nil {
				return "", "", "", fmt.Errorf("apply winner label: %w", err)
			}
			appliedLabelKey, appliedLabelVal = winKey, winVal
			winnerPod = winner
		}
	}

	return appliedLabelKey, appliedLabelVal, winnerPod, nil
}

func (e *Engine) deleteRedirect(ctx context.Context, p *Policy, clearWinner bool) error {
	if strings.EqualFold(p.Scope, "cluster") {
		return e.restoreClusterRedirect(ctx, p, clearWinner)
	}

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

func (e *Engine) restoreClusterRedirect(ctx context.Context, p *Policy, clearWinner bool) error {
	targetNS := p.Namespace
	if p.Action.TargetNamespace != "" {
		targetNS = p.Action.TargetNamespace
	}

	frontendSvc, err := e.resolveFrontendService(ctx, p.Namespace, p.Frontend.Service)
	if err != nil {
		return err
	}

	if err := e.removeClusterDNAT(ctx, p); err != nil {
		e.logger.Printf("[Routing] cluster DNAT remove failed for %s/%s: %v", p.Namespace, frontendSvc.Name, err)
	}
	if err := e.deleteDNATRedirectWithPort(frontendSvc, uint16(p.Frontend.Port)); err != nil {
		e.logger.Printf("[Routing] cluster DNAT map delete failed for %s/%s: %v", p.Namespace, frontendSvc.Name, err)
	}

	if clearWinner && strings.ToLower(p.Action.Strategy) == "best_pod" && p.Action.WinnerLabel != "" {
		if err := e.clearWinnerLabel(ctx, targetNS, p.Action); err != nil {
			e.logger.Printf("[Routing] failed to clear winner labels: %v", err)
		}
	}
	return nil
}

func (e *Engine) resolveBackendService(ctx context.Context, ns string, action ActionConfig) (*corev1.Service, error) {
	if action.BackendService != "" {
		return e.kube.CoreV1().Services(ns).Get(ctx, action.BackendService, metav1.GetOptions{})
	}

	if action.BackendSelector == "" {
		return nil, fmt.Errorf("backend_selector is required to resolve backend service")
	}
	key, val, err := splitSelector(action.BackendSelector)
	if err != nil {
		return nil, err
	}

	services, err := e.kube.CoreV1().Services(ns).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	candidates := []corev1.Service{}
	for _, svc := range services.Items {
		if svc.Spec.Selector == nil {
			continue
		}
		if svc.Spec.Selector[key] != val {
			continue
		}
		candidates = append(candidates, svc)
	}

	if len(candidates) == 1 {
		return &candidates[0], nil
	}
	if len(candidates) == 0 {
		return nil, fmt.Errorf("no backend service matches selector %s=%s", key, val)
	}

	if action.BackendPort > 0 {
		filtered := []corev1.Service{}
		for _, svc := range candidates {
			for _, port := range svc.Spec.Ports {
				if int(port.Port) == action.BackendPort {
					filtered = append(filtered, svc)
					break
				}
				if port.TargetPort.IntVal != 0 && int(port.TargetPort.IntVal) == action.BackendPort {
					filtered = append(filtered, svc)
					break
				}
			}
		}
		if len(filtered) == 1 {
			return &filtered[0], nil
		}
		if len(filtered) > 1 {
			names := make([]string, 0, len(filtered))
			for _, svc := range filtered {
				names = append(names, svc.Name)
			}
			return nil, fmt.Errorf("multiple backend services match selector and port: %s", strings.Join(names, ", "))
		}
	}

	names := make([]string, 0, len(candidates))
	for _, svc := range candidates {
		names = append(names, svc.Name)
	}
	return nil, fmt.Errorf("multiple backend services match selector: %s", strings.Join(names, ", "))
}

func (e *Engine) resolveFrontendService(ctx context.Context, ns, name string) (*corev1.Service, error) {
	if name == "" {
		return nil, fmt.Errorf("frontend service is required")
	}
	return e.kube.CoreV1().Services(ns).Get(ctx, name, metav1.GetOptions{})
}

func ensureServicePortExists(svc *corev1.Service, port int) error {
	if svc == nil {
		return fmt.Errorf("service is nil")
	}
	if port <= 0 {
		return fmt.Errorf("frontend port must be a positive number")
	}
	for _, p := range svc.Spec.Ports {
		if int(p.Port) == port {
			return nil
		}
	}
	return fmt.Errorf("service %s does not expose port %d", svc.Name, port)
}

func (e *Engine) updateEndpointSlicesForService(ctx context.Context, ns string, svc *corev1.Service, winner *corev1.Pod, targetPort int, policyName string) error {
	if targetPort <= 0 {
		return fmt.Errorf("target port must be a positive number")
	}

	endpoint := discoveryv1.Endpoint{
		Addresses: []string{winner.Status.PodIP},
		Conditions: discoveryv1.EndpointConditions{
			Ready: boolPtr(true),
		},
		TargetRef: &corev1.ObjectReference{
			Kind:      "Pod",
			Namespace: winner.Namespace,
			Name:      winner.Name,
			UID:       winner.UID,
		},
	}
	return e.updateEndpointSlicesWithEndpointsAndPort(ctx, ns, svc, []discoveryv1.Endpoint{endpoint}, targetPort, policyName)
}

func (e *Engine) updateEndpointSlicesWithEndpoints(ctx context.Context, ns string, svc *corev1.Service, endpoints []discoveryv1.Endpoint, policyName string) error {
	if svc == nil || len(svc.Spec.Ports) == 0 {
		return fmt.Errorf("service has no ports")
	}
	targetPort := int(resolveTargetPort(svc.Spec.Ports[0]))
	return e.updateEndpointSlicesWithEndpointsAndPort(ctx, ns, svc, endpoints, targetPort, policyName)
}

func (e *Engine) updateEndpointSlicesWithEndpointsAndPort(ctx context.Context, ns string, svc *corev1.Service, endpoints []discoveryv1.Endpoint, targetPort int, policyName string) error {
	if svc == nil {
		return fmt.Errorf("service is nil")
	}

	selector := labels.Set(map[string]string{
		"kubernetes.io/service-name": svc.Name,
	}).AsSelector().String()

	slices, err := e.kube.DiscoveryV1().EndpointSlices(ns).List(ctx, metav1.ListOptions{
		LabelSelector: selector,
	})
	if err != nil {
		return err
	}
	if len(slices.Items) == 0 {
		return fmt.Errorf("no EndpointSlices found for service %s", svc.Name)
	}

	for i := range slices.Items {
		slice := slices.Items[i]
		if slice.Labels == nil {
			slice.Labels = map[string]string{}
		}
		slice.Labels["ebpf-daemon/redirect-policy"] = policyName

		// EndpointSlice ports represent the backend port that kube-proxy forwards to. This enables
		// service-port (frontend) -> pod-port (backend) translation.
		tp := int32(targetPort)
		for j := range slice.Ports {
			slice.Ports[j].Port = &tp
		}

		slice.Endpoints = endpoints
		if _, err := e.kube.DiscoveryV1().EndpointSlices(ns).Update(ctx, &slice, metav1.UpdateOptions{}); err != nil {
			return err
		}
	}
	return nil
}

type dnatKey struct {
	DstIP   uint32
	DstPort uint16
	Pad     uint16
}

type dnatVal struct {
	TargetIP   uint32
	TargetPort uint16
	Pad        uint16
}

func (e *Engine) applyDNATRedirect(ctx context.Context, svc *corev1.Service, winner *corev1.Pod, p *Policy) error {
	dnatMap := loader.DNATMapHandle()
	if dnatMap == nil {
		return fmt.Errorf("dnat map not available")
	}
	if svc == nil || winner == nil {
		return fmt.Errorf("service or winner pod is nil")
	}
	if svc.Spec.ClusterIP == "" || svc.Spec.ClusterIP == "None" {
		return fmt.Errorf("service %s has no cluster IP", svc.Name)
	}
	if winner.Status.PodIP == "" {
		return fmt.Errorf("winner pod has no IP")
	}

	servicePort, targetPort, err := resolveServicePorts(svc, p.Action)
	if err != nil {
		return err
	}

	serviceIP, err := parseIPv4NetOrder(svc.Spec.ClusterIP)
	if err != nil {
		return err
	}
	targetIP, err := parseIPv4NetOrder(winner.Status.PodIP)
	if err != nil {
		return err
	}

	key := dnatKey{
		DstIP:   serviceIP,
		DstPort: htons(servicePort),
	}
	val := dnatVal{
		TargetIP:   targetIP,
		TargetPort: htons(targetPort),
	}

	return dnatMap.Update(&key, &val, ebpf.UpdateAny)
}

func (e *Engine) applyDNATRedirectWithPorts(ctx context.Context, svc *corev1.Service, winner *corev1.Pod, servicePort, targetPort uint16) error {
	dnatMap := loader.DNATMapHandle()
	if dnatMap == nil {
		return fmt.Errorf("dnat map not available")
	}
	if svc == nil || winner == nil {
		return fmt.Errorf("service or winner pod is nil")
	}
	if svc.Spec.ClusterIP == "" || svc.Spec.ClusterIP == "None" {
		return fmt.Errorf("service %s has no cluster IP", svc.Name)
	}
	if winner.Status.PodIP == "" {
		return fmt.Errorf("winner pod has no IP")
	}
	if servicePort == 0 || targetPort == 0 {
		return fmt.Errorf("service and target ports must be set")
	}

	serviceIP, err := parseIPv4NetOrder(svc.Spec.ClusterIP)
	if err != nil {
		return err
	}
	targetIP, err := parseIPv4NetOrder(winner.Status.PodIP)
	if err != nil {
		return err
	}

	key := dnatKey{
		DstIP:   serviceIP,
		DstPort: htons(servicePort),
	}
	val := dnatVal{
		TargetIP:   targetIP,
		TargetPort: htons(targetPort),
	}

	return dnatMap.Update(&key, &val, ebpf.UpdateAny)
}

func (e *Engine) deleteDNATRedirect(svc *corev1.Service, p *Policy) error {
	dnatMap := loader.DNATMapHandle()
	if dnatMap == nil {
		return fmt.Errorf("dnat map not available")
	}
	if svc == nil {
		return fmt.Errorf("service is nil")
	}
	if svc.Spec.ClusterIP == "" || svc.Spec.ClusterIP == "None" {
		return fmt.Errorf("service %s has no cluster IP", svc.Name)
	}

	servicePort, _, err := resolveServicePorts(svc, p.Action)
	if err != nil {
		return err
	}

	serviceIP, err := parseIPv4NetOrder(svc.Spec.ClusterIP)
	if err != nil {
		return err
	}

	key := dnatKey{
		DstIP:   serviceIP,
		DstPort: htons(servicePort),
	}
	if err := dnatMap.Delete(&key); err != nil && !errors.Is(err, ebpf.ErrKeyNotExist) {
		return err
	}
	return nil
}

func (e *Engine) deleteDNATRedirectWithPort(svc *corev1.Service, servicePort uint16) error {
	dnatMap := loader.DNATMapHandle()
	if dnatMap == nil {
		return fmt.Errorf("dnat map not available")
	}
	if svc == nil {
		return fmt.Errorf("service is nil")
	}
	if svc.Spec.ClusterIP == "" || svc.Spec.ClusterIP == "None" {
		return fmt.Errorf("service %s has no cluster IP", svc.Name)
	}
	if servicePort == 0 {
		return fmt.Errorf("service port must be set")
	}

	serviceIP, err := parseIPv4NetOrder(svc.Spec.ClusterIP)
	if err != nil {
		return err
	}

	key := dnatKey{
		DstIP:   serviceIP,
		DstPort: htons(servicePort),
	}
	if err := dnatMap.Delete(&key); err != nil && !errors.Is(err, ebpf.ErrKeyNotExist) {
		return err
	}
	return nil
}

func resolveServicePorts(svc *corev1.Service, action ActionConfig) (uint16, uint16, error) {
	if svc == nil {
		return 0, 0, fmt.Errorf("service is nil")
	}
	if len(svc.Spec.Ports) == 0 {
		return 0, 0, fmt.Errorf("service %s has no ports", svc.Name)
	}

	if action.BackendPort > 0 {
		for _, port := range svc.Spec.Ports {
			if int(port.Port) == action.BackendPort || (port.TargetPort.IntVal != 0 && int(port.TargetPort.IntVal) == action.BackendPort) {
				return uint16(port.Port), resolveTargetPort(port), nil
			}
		}
	}

	port := svc.Spec.Ports[0]
	return uint16(port.Port), resolveTargetPort(port), nil
}

func resolveTargetPort(port corev1.ServicePort) uint16 {
	if port.TargetPort.IntVal != 0 {
		return uint16(port.TargetPort.IntVal)
	}
	return uint16(port.Port)
}

func parseIPv4NetOrder(ip string) (uint32, error) {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return 0, fmt.Errorf("invalid IP %q: %w", ip, err)
	}
	if !addr.Is4() {
		return 0, fmt.Errorf("non-IPv4 address: %s", ip)
	}
	b := addr.As4()
	return uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3]), nil
}

func htons(port uint16) uint16 {
	return (port<<8)&0xff00 | port>>8
}

func (e *Engine) buildEndpointsForService(ctx context.Context, ns string, svc *corev1.Service) ([]discoveryv1.Endpoint, error) {
	if svc == nil || len(svc.Spec.Selector) == 0 {
		return nil, fmt.Errorf("service has no selector")
	}

	selector := labels.Set(svc.Spec.Selector).AsSelector().String()
	pods, err := e.kube.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, err
	}

	endpoints := make([]discoveryv1.Endpoint, 0, len(pods.Items))
	for _, pod := range pods.Items {
		if pod.Status.PodIP == "" {
			continue
		}
		ready := isPodReady(&pod)
		endpoints = append(endpoints, discoveryv1.Endpoint{
			Addresses: []string{pod.Status.PodIP},
			Conditions: discoveryv1.EndpointConditions{
				Ready: &ready,
			},
			TargetRef: &corev1.ObjectReference{
				Kind:      "Pod",
				Namespace: pod.Namespace,
				Name:      pod.Name,
				UID:       pod.UID,
			},
		})
	}

	if len(endpoints) == 0 {
		return nil, fmt.Errorf("no ready endpoints for service %s", svc.Name)
	}
	return endpoints, nil
}

func (e *Engine) pickAnyPod(ctx context.Context, ns, selector string) (string, error) {
	if selector == "" {
		return "", nil
	}
	pods, err := e.kube.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return "", err
	}
	for _, pod := range pods.Items {
		if pod.Status.PodIP != "" {
			return pod.Name, nil
		}
	}
	return "", nil
}

func isPodReady(pod *corev1.Pod) bool {
	for _, cond := range pod.Status.Conditions {
		if cond.Type == corev1.PodReady {
			return cond.Status == corev1.ConditionTrue
		}
	}
	return false
}

func boolPtr(v bool) *bool {
	return &v
}

func healthMetricForScope(scope string) string {
	if strings.EqualFold(scope, "cluster") {
		return nodeHealthMetric()
	}
	return podHealthMetric()
}

func podHealthMetric() string {
	return "dns_latency"
}

func nodeHealthMetric() string {
	return "disk_io"
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
func (e *Engine) pickBestPod(ctx context.Context, ns, selector, metric, scope string) (string, string, error) {
	if selector == "" {
		return "", "", nil
	}
	pods, err := e.kube.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return "", "", err
	}
	if len(pods.Items) == 0 {
		return "", "", nil
	}

	best := ""
	bestNode := ""
	bestValue := math.MaxFloat64
	bestNodeValue := math.MaxFloat64
	for _, pod := range pods.Items {
		nodeValue := bestNodeValue
		if strings.EqualFold(scope, "cluster") {
			if value, ok := e.nodeMetricValue(nodeHealthMetric(), pod.Spec.NodeName, "cluster"); ok {
				nodeValue = value
			}
		}

		value, ok := metricValueForPodWithScope(metric, ns, pod.Name, scope)
		if !ok {
			continue
		}
		if strings.EqualFold(scope, "cluster") {
			if nodeValue < bestNodeValue || (nodeValue == bestNodeValue && value < bestValue) {
				bestNodeValue = nodeValue
				bestValue = value
				best = pod.Name
				bestNode = pod.Spec.NodeName
			}
			continue
		}

		if value < bestValue {
			bestValue = value
			best = pod.Name
			bestNode = pod.Spec.NodeName
		}
	}
	return best, bestNode, nil
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
	metric := healthMetricForScope(p.Scope)
	if metric == nodeHealthMetric() {
		return e.averageNodeMetric(metric)
	}

	monitor := p.Telemetry.MonitorPodContains
	if monitor == "" {
		monitor = p.Frontend.Service
	}
	namespace := p.Namespace
	if strings.EqualFold(p.Scope, "cluster") {
		return e.averageMetricForPodsCluster(metric, namespace, monitor)
	}
	return averageMetricForPods(metric, namespace, monitor)
}

func (e *Engine) averageMetricForPodsCluster(metric, namespace, nameContains string) (float64, int) {
	if e.kube == nil {
		return averageMetricForPods(metric, namespace, nameContains)
	}

	pods, err := e.kube.CoreV1().Pods(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil || len(pods.Items) == 0 {
		return averageMetricForPods(metric, namespace, nameContains)
	}

	var sum float64
	var count int
	nameContains = strings.ToLower(nameContains)
	for _, pod := range pods.Items {
		if !strings.Contains(strings.ToLower(pod.Name), nameContains) {
			continue
		}
		if value, ok := metricValueForPodWithScope(metric, namespace, pod.Name, "cluster"); ok {
			sum += value
			count++
		}
	}
	if count == 0 {
		return 0, 0
	}
	return sum / float64(count), count
}

func (e *Engine) averageNodeMetric(metric string) (float64, int) {
	if e.localNodeName == "" {
		return 0, 0
	}
	if value, ok := e.nodeMetricValue(metric, e.localNodeName, "cluster"); ok {
		return value, 1
	}
	return 0, 0
}

func (e *Engine) nodeMetricValue(metric, nodeName, scope string) (float64, bool) {
	switch strings.ToLower(metric) {
	case nodeHealthMetric():
		if strings.EqualFold(scope, "cluster") {
			if nodeMetric, ok := telemetry.GetClusterNodeMetric(nodeName, telemetry.MetricType("disk_io")); ok {
				return extractDiskIOValue(nodeMetric.Value)
			}
		}
		if nodeName == "" || !strings.EqualFold(nodeName, e.localNodeName) {
			return 0, false
		}
		return extractDiskIOValue(telemetry.GetDiskIOMetrics())
	default:
		return 0, false
	}
}

// metricValueForPod returns the metric value for a specific pod (microseconds).
func metricValueForPod(metric, namespace, podName string) (float64, bool) {
	key := namespace + "/" + podName
	switch strings.ToLower(metric) {
	case "dns_us", "dns_latency", "dns":
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

func metricValueForPodWithScope(metric, namespace, podName, scope string) (float64, bool) {
	if strings.EqualFold(scope, "cluster") {
		if value, ok := clusterMetricValueForPod(metric, namespace, podName); ok {
			return value, true
		}
	}
	return metricValueForPod(metric, namespace, podName)
}

func clusterMetricValueForPod(metric, namespace, podName string) (float64, bool) {
	key := namespace + "/" + podName
	switch strings.ToLower(metric) {
	case "dns_us", "dns_latency", "dns":
		if podMetric, ok := telemetry.GetClusterPodMetric(key, telemetry.MetricTypeDNS); ok {
			return extractDNSValue(podMetric.Value)
		}
	case "rtt_us", "rtt":
		if podMetric, ok := telemetry.GetClusterPodMetric(key, telemetry.MetricTypeRTT); ok {
			return extractRTTValue(podMetric.Value)
		}
	case "sched_latency_us", "sched_us":
		if podMetric, ok := telemetry.GetClusterPodMetric(key, telemetry.MetricType("sched_latency")); ok {
			return extractSchedLatencyValue(podMetric.Value)
		}
	}
	return 0, false
}

func extractDNSValue(value interface{}) (float64, bool) {
	switch v := value.(type) {
	case telemetry.DNSMetricValue:
		if v.TotalEvents == 0 {
			return 0, false
		}
		return float64(v.TotalLatencyNs) / float64(v.TotalEvents) / 1000.0, true
	case *telemetry.DNSMetricValue:
		if v == nil || v.TotalEvents == 0 {
			return 0, false
		}
		return float64(v.TotalLatencyNs) / float64(v.TotalEvents) / 1000.0, true
	case map[string]interface{}:
		totalEvents, ok1 := toUint64(v["total_events"])
		totalLatency, ok2 := toUint64(v["total_latency_ns"])
		if !ok1 || !ok2 || totalEvents == 0 {
			return 0, false
		}
		return float64(totalLatency) / float64(totalEvents) / 1000.0, true
	default:
		return 0, false
	}
}

func extractRTTValue(value interface{}) (float64, bool) {
	switch v := value.(type) {
	case telemetry.RTTMetricValue:
		if v.TotalEvents == 0 {
			return 0, false
		}
		return float64(v.TotalRTTNs) / float64(v.TotalEvents) / 1000.0, true
	case *telemetry.RTTMetricValue:
		if v == nil || v.TotalEvents == 0 {
			return 0, false
		}
		return float64(v.TotalRTTNs) / float64(v.TotalEvents) / 1000.0, true
	case map[string]interface{}:
		totalEvents, ok1 := toUint64(v["total_events"])
		totalRTT, ok2 := toUint64(v["total_rtt_ns"])
		if !ok1 || !ok2 || totalEvents == 0 {
			return 0, false
		}
		return float64(totalRTT) / float64(totalEvents) / 1000.0, true
	default:
		return 0, false
	}
}

func extractSchedLatencyValue(value interface{}) (float64, bool) {
	switch v := value.(type) {
	case telemetry.PodSchedLatencyMetrics:
		if v.EventCount == 0 {
			return 0, false
		}
		return v.AvgRunqueueLatencyUs, true
	case *telemetry.PodSchedLatencyMetrics:
		if v == nil || v.EventCount == 0 {
			return 0, false
		}
		return v.AvgRunqueueLatencyUs, true
	case map[string]interface{}:
		avg, ok := toFloat64(v["avg_runqueue_latency_us"])
		if !ok {
			return 0, false
		}
		return avg, true
	default:
		return 0, false
	}
}

func extractDiskIOValue(value interface{}) (float64, bool) {
	switch v := value.(type) {
	case telemetry.DiskIOMetrics:
		if v.AvgIOLatencyNs == 0 {
			return 0, false
		}
		return float64(v.AvgIOLatencyNs) / 1000.0, true
	case *telemetry.DiskIOMetrics:
		if v == nil || v.AvgIOLatencyNs == 0 {
			return 0, false
		}
		return float64(v.AvgIOLatencyNs) / 1000.0, true
	case map[string]interface{}:
		avg, ok := toUint64(v["avg_io_latency_ns"])
		if !ok || avg == 0 {
			return 0, false
		}
		return float64(avg) / 1000.0, true
	default:
		return 0, false
	}
}

func toUint64(v interface{}) (uint64, bool) {
	switch t := v.(type) {
	case uint64:
		return t, true
	case uint32:
		return uint64(t), true
	case uint:
		return uint64(t), true
	case int:
		if t < 0 {
			return 0, false
		}
		return uint64(t), true
	case int64:
		if t < 0 {
			return 0, false
		}
		return uint64(t), true
	case float64:
		if t < 0 {
			return 0, false
		}
		return uint64(t), true
	case float32:
		if t < 0 {
			return 0, false
		}
		return uint64(t), true
	default:
		return 0, false
	}
}

func toFloat64(v interface{}) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case uint64:
		return float64(t), true
	case uint32:
		return float64(t), true
	default:
		return 0, false
	}
}

// averageMetricForPods calculates the average metric across all matching pods in a namespace.
func averageMetricForPods(metric, namespace, nameContains string) (float64, int) {
	var sum float64
	var count int
	nameContains = strings.ToLower(nameContains)
	switch strings.ToLower(metric) {
	case "dns_us", "dns_latency", "dns":
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
