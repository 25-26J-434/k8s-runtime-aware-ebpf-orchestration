package scaling

import (
	"encoding/json"
	"net/http"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type ScaleResponse struct {
	MetricValue float64 `json:"metric_value"`
	OldReplicas int32   `json:"old_replicas"`
	NewReplicas int32   `json:"new_replicas"`
	Action      string  `json:"action"`
}

func HandleScaling(k8sClient *kubernetes.Clientset) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {

		var rule ScalingRule
		if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		value, err := GetMetricValue(rule.MetricType, rule.MetricLevel)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		dep, err := k8sClient.AppsV1().
			Deployments(rule.Namespace).
			Get(r.Context(), rule.Deployment, metav1.GetOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		current := int32(1)
		if dep.Spec.Replicas != nil {
			current = *dep.Spec.Replicas
		}

		desired, action := DecideReplicas(current, value, rule)

		if desired != current {
			ApplyScaling(k8sClient, rule.Namespace, rule.Deployment, desired)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ScaleResponse{
			MetricValue: value,
			OldReplicas: current,
			NewReplicas: desired,
			Action:      action,
		})
	}
}
