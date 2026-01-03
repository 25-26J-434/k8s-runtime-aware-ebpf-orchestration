package scaling

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

const (
	scalingLoopInterval  = 5 * time.Second
	rulesRefreshInterval = 10 * time.Second
)

type scalingController struct {
	k8sClient *kubernetes.Clientset
	rulesMu   sync.RWMutex
	rules     []ScalingRule
}

// subscriber pattern
func StartScalingController(k8sClient *kubernetes.Clientset) {
	if k8sClient == nil {
		log.Println("[Scaling] Controller not started (k8sClient is nil)")
		return
	}

	log.Println("[Scaling] Controller started")

	controller := &scalingController{k8sClient: k8sClient}
	controller.refreshRules()

	trigger := make(chan struct{}, 1)
	go controller.refreshRulesLoop()
	go controller.subscribeMetrics(trigger)
	go controller.watchRuleChanges(trigger)

	ticker := time.NewTicker(scalingLoopInterval)
	defer ticker.Stop()

	for {
		select {
		case <-trigger:
			controller.evaluateOnce()
		case <-ticker.C:
			controller.evaluateOnce()
		}
	}
}

func decideReplicas(current int32, value float64, rule ScalingRule) (int32, string) {
	step := rule.Step

	// clamp defaults just in case
	if step < 1 {
		step = 1
	}

	conditionMet := false

	switch rule.Operator {
	case ">":
		conditionMet = value > rule.Threshold
	case ">=":
		conditionMet = value >= rule.Threshold
	case "<":
		conditionMet = value < rule.Threshold
	case "<=":
		conditionMet = value <= rule.Threshold
	default:
		// unknown operator -> no action
		return current, "noop"
	}

	if !conditionMet {
		return current, "noop"
	}

	action := rule.Action
	if action == "" {
		// legacy fallback based on operator direction
		if rule.Operator == ">" || rule.Operator == ">=" {
			action = "scale_up"
		} else {
			action = "scale_down"
		}
	}

	desired := current
	switch action {
	case "scale_up":
		desired = current + step
	case "scale_down":
		desired = current - step
	default:
		return current, "noop"
	}

	if rule.MinReplicas > 0 && desired < rule.MinReplicas {
		desired = rule.MinReplicas
	}
	if rule.MaxReplicas > 0 {
		maxR := rule.MaxReplicas
		if rule.MinReplicas > 0 && maxR < rule.MinReplicas {
			maxR = rule.MinReplicas
		}
		if desired > maxR {
			desired = maxR
		}
	}

	return desired, action
}

func (c *scalingController) refreshRulesLoop() {
	ticker := time.NewTicker(rulesRefreshInterval)
	defer ticker.Stop()

	for range ticker.C {
		c.refreshRules()
	}
}

func (c *scalingController) refreshRules() {
	rules, err := GetEnabledScalingRules()
	if err != nil {
		log.Printf("[Scaling] Rule read error: %v", err)
		return
	}

	c.rulesMu.Lock()
	c.rules = rules
	c.rulesMu.Unlock()
}

func (c *scalingController) getRules() []ScalingRule {
	c.rulesMu.RLock()
	defer c.rulesMu.RUnlock()

	out := make([]ScalingRule, len(c.rules))
	copy(out, c.rules)
	return out
}

func (c *scalingController) subscribeMetrics(trigger chan struct{}) {
	collectors := telemetry.GlobalRegistry.GetAll()
	if len(collectors) == 0 {
		return
	}

	for _, collector := range collectors {
		ch := collector.Subscribe()
		go func(events <-chan telemetry.Metric) {
			for range events {
				select {
				case trigger <- struct{}{}:
				default:
				}
			}
		}(ch)
	}
}

func (c *scalingController) watchRuleChanges(trigger chan struct{}) {
	ctx := context.Background()
	changes, err := WatchRuleChanges(ctx)
	if err != nil {
		log.Printf("[Scaling] Rule watch disabled: %v", err)
		return
	}

	for range changes {
		c.refreshRules()
		select {
		case trigger <- struct{}{}:
		default:
		}
	}
}

func (c *scalingController) evaluateOnce() {
	rules := c.getRules()
	if len(rules) == 0 {
		return
	}

	for _, rule := range rules {
		value, err := GetDeploymentMetricValue(c.k8sClient, rule)
		if err != nil {
			// don’t spam logs
			continue
		}

		dep, err := c.k8sClient.AppsV1().
			Deployments(rule.Namespace).
			Get(context.Background(), rule.Deployment, metav1.GetOptions{})
		if err != nil {
			continue
		}

		current := int32(1)
		if dep.Spec.Replicas != nil {
			current = *dep.Spec.Replicas
		}

		desired, action := decideReplicas(current, value, rule)
		if desired == current {
			continue
		}

		dep.Spec.Replicas = &desired
		if _, err := c.k8sClient.AppsV1().
			Deployments(rule.Namespace).
			Update(context.Background(), dep, metav1.UpdateOptions{}); err != nil {
			continue
		}

		log.Printf("[Scaling] %s/%s %s %.2f %s %.2f -> replicas %d → %d (%s)",
			rule.Namespace,
			rule.Deployment,
			rule.Metric,
			value,
			rule.Operator,
			rule.Threshold,
			current,
			desired,
			action,
		)

		_ = UpdateScalingRuleStatus(rule.ID, map[string]interface{}{
			"lastAction":   action,
			"lastActionAt": time.Now().UTC(),
			"lastValue":    value,
			"lastFrom":     current,
			"lastTo":       desired,
		})
	}
}
