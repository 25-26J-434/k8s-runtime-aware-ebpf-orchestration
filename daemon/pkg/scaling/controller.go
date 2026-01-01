package scaling

import (
	"context"
	"log"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// subscriber pattern
func StartScalingController(k8sClient *kubernetes.Clientset) {
	if k8sClient == nil {
		log.Println("[Scaling] Controller not started (k8sClient is nil)")
		return
	}

	log.Println("[Scaling] Controller started")

	for {
		rules, err := GetEnabledScalingRules()
		if err != nil {
			log.Printf("[Scaling] Rule read error: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}

		for _, rule := range rules {
			value, err := GetMetricValue(rule.Metric)
			if err != nil {
				// don’t spam logs
				continue
			}

			dep, err := k8sClient.AppsV1().
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
			if _, err := k8sClient.AppsV1().
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

		time.Sleep(5 * time.Second)
	}
}

func decideReplicas(current int32, value float64, rule ScalingRule) (int32, string) {
	minR := rule.MinReplicas
	maxR := rule.MaxReplicas
	step := rule.Step

	// clamp defaults just in case
	if minR < 1 {
		minR = 1
	}
	if maxR < minR {
		maxR = minR
	}
	if step < 1 {
		step = 1
	}

	scaleUp := false
	scaleDown := false

	switch rule.Operator {
	case ">":
		scaleUp = value > rule.Threshold
	case ">=":
		scaleUp = value >= rule.Threshold
	case "<":
		scaleDown = value < rule.Threshold
	case "<=":
		scaleDown = value <= rule.Threshold
	default:
		// unknown operator -> no action
		return current, "noop"
	}

	desired := current
	action := "noop"

	if scaleUp {
		desired = current + step
		action = "scale_up"
	} else if scaleDown {
		desired = current - step
		action = "scale_down"
	}

	if desired < minR {
		desired = minR
	}
	if desired > maxR {
		desired = maxR
	}

	return desired, action
}
