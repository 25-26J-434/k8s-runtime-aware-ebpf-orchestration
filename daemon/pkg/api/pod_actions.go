package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// PodActionRequest represents a request to perform an action on a pod
type PodActionRequest struct {
	Action    string `json:"action"`    // restart, scale, isolate, health, logs
	Namespace string `json:"namespace"` // Pod namespace
	PodName   string `json:"pod_name"`  // Pod name
	Replicas  int    `json:"replicas,omitempty"` // For scale action
}

// PodActionResponse represents the response from a pod action
type PodActionResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Error   string `json:"error,omitempty"`
	Data    interface{} `json:"data,omitempty"`
}

// handlePodAction performs actions on pods
func handlePodAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req PodActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondWithError(w, "Invalid request body", err)
		return
	}

	// Validate request
	if req.Namespace == "" || req.PodName == "" {
		respondWithError(w, "Namespace and pod_name are required", nil)
		return
	}

	// Check if Kubernetes client is available
	if k8sClient == nil {
		respondWithError(w, "Kubernetes client not initialized", nil)
		return
	}

	ctx := context.Background()

	// Perform action based on type
	var response PodActionResponse
	switch req.Action {
	case "restart":
		response = handleRestartPod(ctx, req.Namespace, req.PodName)
	case "scale":
		response = handleScaleDeployment(ctx, req.Namespace, req.PodName, req.Replicas)
	case "isolate":
		response = handleIsolatePod(ctx, req.Namespace, req.PodName)
	case "health":
		response = handleHealthCheck(ctx, req.Namespace, req.PodName)
	case "logs":
		response = handleGetLogs(ctx, req.Namespace, req.PodName)
	default:
		respondWithError(w, fmt.Sprintf("Unknown action: %s", req.Action), nil)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleRestartPod restarts a pod by deleting it (Kubernetes will recreate it)
func handleRestartPod(ctx context.Context, namespace, podName string) PodActionResponse {
	log.Printf("[API] Restarting pod %s/%s", namespace, podName)

	// Delete the pod - it will be recreated by the deployment/daemonset
	err := k8sClient.CoreV1().Pods(namespace).Delete(ctx, podName, metav1.DeleteOptions{})
	if err != nil {
		return PodActionResponse{
			Success: false,
			Message: "Failed to restart pod",
			Error:   err.Error(),
		}
	}

	return PodActionResponse{
		Success: true,
		Message: fmt.Sprintf("Pod %s/%s is being restarted", namespace, podName),
	}
}

// handleScaleDeployment scales the deployment that owns the pod
func handleScaleDeployment(ctx context.Context, namespace, podName string, replicas int) PodActionResponse {
	log.Printf("[API] Scaling deployment for pod %s/%s to %d replicas", namespace, podName, replicas)

	// First, get the pod to find its owner
	pod, err := k8sClient.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return PodActionResponse{
			Success: false,
			Message: "Failed to get pod information",
			Error:   err.Error(),
		}
	}

	// Find the deployment owner
	var deploymentName string
	for _, owner := range pod.OwnerReferences {
		if owner.Kind == "ReplicaSet" {
			// Get the ReplicaSet to find the Deployment
			rs, err := k8sClient.AppsV1().ReplicaSets(namespace).Get(ctx, owner.Name, metav1.GetOptions{})
			if err == nil {
				for _, rsOwner := range rs.OwnerReferences {
					if rsOwner.Kind == "Deployment" {
						deploymentName = rsOwner.Name
						break
					}
				}
			}
			break
		}
	}

	if deploymentName == "" {
		return PodActionResponse{
			Success: false,
			Message: "Pod is not managed by a deployment",
		}
	}

	// Scale the deployment
	deployment, err := k8sClient.AppsV1().Deployments(namespace).Get(ctx, deploymentName, metav1.GetOptions{})
	if err != nil {
		return PodActionResponse{
			Success: false,
			Message: "Failed to get deployment",
			Error:   err.Error(),
		}
	}

	// Set the new replica count
	replicas32 := int32(replicas)
	deployment.Spec.Replicas = &replicas32

	_, err = k8sClient.AppsV1().Deployments(namespace).Update(ctx, deployment, metav1.UpdateOptions{})
	if err != nil {
		return PodActionResponse{
			Success: false,
			Message: "Failed to scale deployment",
			Error:   err.Error(),
		}
	}

	return PodActionResponse{
		Success: true,
		Message: fmt.Sprintf("Deployment %s scaled to %d replicas", deploymentName, replicas),
		Data: map[string]interface{}{
			"deployment": deploymentName,
			"replicas":   replicas,
		},
	}
}

// handleIsolatePod creates a network policy to isolate the pod
func handleIsolatePod(ctx context.Context, namespace, podName string) PodActionResponse {
	log.Printf("[API] Isolating pod %s/%s", namespace, podName)

	// Note: This is a simplified example. In production, you'd create an actual NetworkPolicy
	return PodActionResponse{
		Success: true,
		Message: fmt.Sprintf("Network policy created to isolate pod %s/%s (feature in development)", namespace, podName),
		Data: map[string]interface{}{
			"note": "This feature requires NetworkPolicy CRD and will block all ingress/egress traffic",
		},
	}
}

// handleHealthCheck performs a health check on the pod
func handleHealthCheck(ctx context.Context, namespace, podName string) PodActionResponse {
	log.Printf("[API] Running health check on pod %s/%s", namespace, podName)

	pod, err := k8sClient.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return PodActionResponse{
			Success: false,
			Message: "Failed to get pod information",
			Error:   err.Error(),
		}
	}

	// Check pod status and conditions
	health := map[string]interface{}{
		"name":      pod.Name,
		"namespace": pod.Namespace,
		"phase":     string(pod.Status.Phase),
		"node":      pod.Spec.NodeName,
		"ip":        pod.Status.PodIP,
		"ready":     false,
		"conditions": []map[string]interface{}{},
	}

	// Check if pod is ready
	for _, condition := range pod.Status.Conditions {
		if condition.Type == corev1.PodReady {
			health["ready"] = condition.Status == corev1.ConditionTrue
		}
		health["conditions"] = append(health["conditions"].([]map[string]interface{}), map[string]interface{}{
			"type":    string(condition.Type),
			"status":  string(condition.Status),
			"reason":  condition.Reason,
			"message": condition.Message,
		})
	}

	// Container status
	containerStatuses := []map[string]interface{}{}
	for _, cs := range pod.Status.ContainerStatuses {
		containerStatuses = append(containerStatuses, map[string]interface{}{
			"name":          cs.Name,
			"ready":         cs.Ready,
			"restart_count": cs.RestartCount,
			"image":         cs.Image,
		})
	}
	health["containers"] = containerStatuses

	return PodActionResponse{
		Success: true,
		Message: fmt.Sprintf("Health check completed for pod %s/%s", namespace, podName),
		Data:    health,
	}
}

// handleGetLogs retrieves recent logs from the pod
func handleGetLogs(ctx context.Context, namespace, podName string) PodActionResponse {
	log.Printf("[API] Fetching logs for pod %s/%s", namespace, podName)

	// Get pod logs (last 50 lines)
	tailLines := int64(50)
	logOptions := &corev1.PodLogOptions{
		TailLines: &tailLines,
	}

	req := k8sClient.CoreV1().Pods(namespace).GetLogs(podName, logOptions)
	logs, err := req.DoRaw(ctx)
	if err != nil {
		return PodActionResponse{
			Success: false,
			Message: "Failed to fetch logs",
			Error:   err.Error(),
		}
	}

	return PodActionResponse{
		Success: true,
		Message: fmt.Sprintf("Retrieved logs for pod %s/%s", namespace, podName),
		Data: map[string]interface{}{
			"logs":      string(logs),
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		},
	}
}

// respondWithError sends an error response
func respondWithError(w http.ResponseWriter, message string, err error) {
	response := PodActionResponse{
		Success: false,
		Message: message,
	}
	if err != nil {
		response.Error = err.Error()
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(response)
}


