package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	corev1 "k8s.io/api/core/v1"
)

// handlePodLogs handles GET requests for pod logs
func handlePodLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	namespace := r.URL.Query().Get("namespace")
	podName := r.URL.Query().Get("pod")
	linesParam := r.URL.Query().Get("lines")

	if namespace == "" || podName == "" {
		respondWithJSON(w, http.StatusBadRequest, map[string]interface{}{
			"success": false,
			"error":   "namespace and pod parameters are required",
		})
		return
	}

	// Check if Kubernetes client is available
	if k8sClient == nil {
		respondWithJSON(w, http.StatusServiceUnavailable, map[string]interface{}{
			"success": false,
			"error":   "Kubernetes client not initialized",
		})
		return
	}

	// Parse lines parameter (default to 100)
	tailLines := int64(100)
	if linesParam != "" {
		var lines int64
		_, err := fmt.Sscanf(linesParam, "%d", &lines)
		if err == nil && lines > 0 {
			tailLines = lines
		}
	}

	ctx := context.Background()
	log.Printf("[API] Fetching logs for pod %s/%s (last %d lines)", namespace, podName, tailLines)

	// Get pod logs
	logOptions := &corev1.PodLogOptions{
		TailLines: &tailLines,
	}

	req := k8sClient.CoreV1().Pods(namespace).GetLogs(podName, logOptions)
	logs, err := req.DoRaw(ctx)
	if err != nil {
		log.Printf("[API] Failed to fetch logs for %s/%s: %v", namespace, podName, err)
		respondWithJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Failed to fetch logs: %v", err),
			"logs":    "",
		})
		return
	}

	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"logs":    string(logs),
		"pod":     podName,
		"namespace": namespace,
	})
}

// respondWithJSON sends a JSON response
func respondWithJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}

