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

		// Only allow POST
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		// Parse rule
		var rule ScalingRule
		if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		// Get metric value
		value, err := GetMetricValue(rule.MetricType, rule.MetricLevel)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Fetch Deployment
		dep, err := k8sClient.AppsV1().
			Deployments(rule.Namespace).
			Get(r.Context(), rule.Deployment, metav1.GetOptions{})
		if err != nil {
			http.Error(w, "Deployment not found", http.StatusNotFound)
			return
		}

		// Current replicas
		current := int32(1)
		if dep.Spec.Replicas != nil {
			current = *dep.Spec.Replicas
		}

		// Decide scaling
		desired, action := DecideReplicas(current, value, rule)

		// Apply scaling if needed
		if desired != current {
			dep.Spec.Replicas = &desired
			if _, err := k8sClient.AppsV1().
				Deployments(rule.Namespace).
				Update(r.Context(), dep, metav1.UpdateOptions{}); err != nil {

				http.Error(w, "Failed to update deployment replicas", http.StatusInternalServerError)
				return
			}
		}

		// Respond
		_ = json.NewEncoder(w).Encode(ScaleResponse{
			MetricValue: value,
			OldReplicas: current,
			NewReplicas: desired,
			Action:      action,
		})
	}
}
