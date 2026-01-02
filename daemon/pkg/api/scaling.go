package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/scaling"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"k8s.io/apimachinery/pkg/labels"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type DeploymentInfo struct {
	Namespace         string `json:"namespace"`
	Name              string `json:"name"`
	Replicas          int32  `json:"replicas"`
	AvailableReplicas int32  `json:"availableReplicas,omitempty"`
}

type LatestMetric struct {
	Namespace  string  `json:"namespace"`
	Deployment string  `json:"deployment"`
	Metric     string  `json:"metric"`
	Value      float64 `json:"value"`
	Timestamp  string  `json:"timestamp,omitempty"`
}

func handleScalingRules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rules, err := scaling.GetScalingRules()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, rules)
	case http.MethodPost:
		var rule scaling.ScalingRule
		if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		if rule.Namespace == "" || rule.Deployment == "" || rule.Metric == "" {
			http.Error(w, "namespace, deployment, and metric are required", http.StatusBadRequest)
			return
		}
		created, err := scaling.CreateScalingRule(rule)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, created)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func handleScalingRuleByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/scaling/rules/")
	path = strings.Trim(path, "/")
	if path == "" {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	parts := strings.Split(path, "/")
	idStr := parts[0]
	id, err := primitive.ObjectIDFromHex(idStr)
	if err != nil {
		http.Error(w, "invalid rule id", http.StatusBadRequest)
		return
	}

	if len(parts) == 2 && parts[1] == "toggle" {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		updated, err := scaling.ToggleScalingRule(id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, updated)
		return
	}

	if len(parts) != 1 {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	if r.Method == http.MethodDelete {
		if err := scaling.DeleteScalingRule(id); err != nil {
			if errors.Is(err, scaling.ErrRuleNotFound) {
				http.Error(w, "rule not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPut {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var updates bson.M
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	delete(updates, "_id")
	delete(updates, "id")

	normalized, err := normalizeScalingUpdates(updates)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	updated, err := scaling.UpdateScalingRule(id, normalized)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, updated)
}

func handleScalingDeployments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if k8sClient == nil {
		http.Error(w, "Kubernetes client not initialized", http.StatusServiceUnavailable)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	deps, err := k8sClient.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	out := make([]DeploymentInfo, 0, len(deps.Items))
	for _, dep := range deps.Items {
		replicas := int32(0)
		if dep.Spec.Replicas != nil {
			replicas = *dep.Spec.Replicas
		}
		out = append(out, DeploymentInfo{
			Namespace:         dep.Namespace,
			Name:              dep.Name,
			Replicas:          replicas,
			AvailableReplicas: dep.Status.AvailableReplicas,
		})
	}

	writeJSON(w, out)
}

func handleScalingLatestMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if k8sClient == nil {
		http.Error(w, "Kubernetes client not initialized", http.StatusServiceUnavailable)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()

	deps, err := k8sClient.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	dnsMetrics := telemetry.GetPodDNSMetrics()
	rttMetrics := telemetry.GetPodRTTMetrics()
	tcpMetrics := telemetry.GetPodTCPMetrics()

	now := time.Now().UTC().Format(time.RFC3339)
	out := make([]LatestMetric, 0, len(deps.Items)*3)

	for _, dep := range deps.Items {
		if len(dep.Spec.Selector.MatchLabels) == 0 {
			continue
		}

		selector := labels.SelectorFromSet(dep.Spec.Selector.MatchLabels).String()
		pods, err := k8sClient.CoreV1().Pods(dep.Namespace).List(ctx, metav1.ListOptions{
			LabelSelector: selector,
		})
		if err != nil {
			continue
		}

		var dnsSum float64
		var dnsCount int
		var rttSum float64
		var rttCount int
		var tcpSum float64
		var tcpCount int

		for _, pod := range pods.Items {
			key := fmt.Sprintf("%s/%s", dep.Namespace, pod.Name)
			if m, ok := dnsMetrics[key]; ok {
				dnsSum += float64(m.LastLatencyNs)
				dnsCount++
			}
			if m, ok := rttMetrics[key]; ok {
				rttSum += float64(m.LastRTTNs)
				rttCount++
			}
			if m, ok := tcpMetrics[key]; ok {
				tcpSum += float64(m.Retransmissions)
				tcpCount++
			}
		}

		if dnsCount > 0 {
			out = append(out, LatestMetric{
				Namespace:  dep.Namespace,
				Deployment: dep.Name,
				Metric:     "dns_latency",
				Value:      dnsSum / float64(dnsCount),
				Timestamp:  now,
			})
		} else {
			dns := telemetry.GetDNSMetrics()
			if dns.LastLatencyNs > 0 {
				out = append(out, LatestMetric{
					Namespace:  dep.Namespace,
					Deployment: dep.Name,
					Metric:     "dns_latency",
					Value:      float64(dns.LastLatencyNs),
					Timestamp:  now,
				})
			}
		}
		if rttCount > 0 {
			out = append(out, LatestMetric{
				Namespace:  dep.Namespace,
				Deployment: dep.Name,
				Metric:     "rtt",
				Value:      rttSum / float64(rttCount),
				Timestamp:  now,
			})
		} else {
			rtt := telemetry.GetRTTMetrics()
			if rtt.LastRTTNs > 0 {
				out = append(out, LatestMetric{
					Namespace:  dep.Namespace,
					Deployment: dep.Name,
					Metric:     "rtt",
					Value:      float64(rtt.LastRTTNs),
					Timestamp:  now,
				})
			}
		}
		if tcpCount > 0 {
			out = append(out, LatestMetric{
				Namespace:  dep.Namespace,
				Deployment: dep.Name,
				Metric:     "tcp_retrans",
				Value:      tcpSum / float64(tcpCount),
				Timestamp:  now,
			})
		} else {
			tcp := telemetry.GetTCPMetrics()
			if tcp.Retransmissions > 0 {
				out = append(out, LatestMetric{
					Namespace:  dep.Namespace,
					Deployment: dep.Name,
					Metric:     "tcp_retrans",
					Value:      float64(tcp.Retransmissions),
					Timestamp:  now,
				})
			}
		}
	}

	writeJSON(w, out)
}

func normalizeScalingUpdates(updates bson.M) (bson.M, error) {
	for key, val := range updates {
		switch key {
		case "namespace", "deployment", "metric", "operator":
			s, ok := val.(string)
			if !ok {
				return nil, fmt.Errorf("invalid type for %s", key)
			}
			updates[key] = s
		case "threshold":
			f, ok := toFloat64(val)
			if !ok {
				return nil, fmt.Errorf("invalid type for threshold")
			}
			updates[key] = f
		case "minReplicas", "maxReplicas", "step":
			i, ok := toInt32(val)
			if !ok {
				return nil, fmt.Errorf("invalid type for %s", key)
			}
			updates[key] = i
		case "enabled":
			b, ok := val.(bool)
			if !ok {
				return nil, fmt.Errorf("invalid type for enabled")
			}
			updates[key] = b
		default:
			// allow unknown fields to pass through
		}
	}
	return updates, nil
}

func toFloat64(v interface{}) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	case int32:
		return float64(t), true
	case int64:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}

func toInt32(v interface{}) (int32, bool) {
	switch t := v.(type) {
	case float64:
		return int32(t), true
	case int:
		return int32(t), true
	case int32:
		return t, true
	case int64:
		return int32(t), true
	case json.Number:
		i, err := t.Int64()
		if err != nil {
			return 0, false
		}
		return int32(i), true
	default:
		return 0, false
	}
}
