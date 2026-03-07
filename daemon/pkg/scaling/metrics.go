package scaling

import (
	"context"
	"fmt"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/kubernetes"
)

// GetMetricValue returns the latest metric value used for scaling.
// IMPORTANT: map your telemetry here.
func GetMetricValue(metric string) (float64, error) {
	switch metric {

	// Example metric name you’re using in Mongo:
	// { metric: "dns_latency", threshold: 300000 }
	case "dns_latency":
		// Return the last observed DNS latency in nanoseconds (preferred)
		if nm, ok := telemetry.GlobalRegistry.GetNodeMetrics(telemetry.MetricTypeDNS); ok {
			if v, ok := nm.Value.(telemetry.DNSMetricValue); ok {
				return float64(v.LastLatencyNs), nil
			}
		}
		// Fallback to the direct accessor
		dns := telemetry.GetDNSMetrics()
		return float64(dns.LastLatencyNs), nil

	case "rtt":
		// Return the last observed RTT in nanoseconds
		if nm, ok := telemetry.GlobalRegistry.GetNodeMetrics(telemetry.MetricTypeRTT); ok {
			if v, ok := nm.Value.(telemetry.RTTMetricValue); ok {
				return float64(v.LastRTTNs), nil
			}
		}
		rtt := telemetry.GetRTTMetrics()
		return float64(rtt.LastRTTNs), nil

	case "tcp_retrans":
		// Return the total retransmissions count (node-level)
		if nm, ok := telemetry.GlobalRegistry.GetNodeMetrics(telemetry.MetricTypeTCP); ok {
			if m, ok := nm.Value.(map[string]interface{}); ok {
				if val, found := m["retransmissions"]; found {
					switch t := val.(type) {
					case float64:
						return t, nil
					case int:
						return float64(t), nil
					case int64:
						return float64(t), nil
					case uint64:
						return float64(t), nil
					}
				}
			}
		}
		tcp := telemetry.GetTCPMetrics()
		return float64(tcp.Retransmissions), nil

	case "disk_read_latency":
		// Return node-level average disk read latency in nanoseconds
		disk := telemetry.GetDiskIOMetrics()
		if disk != nil {
			return float64(disk.AvgReadLatencyNs), nil
		}
		return 0, nil

	case "disk_write_latency":
		// Return node-level average disk write latency in nanoseconds
		disk := telemetry.GetDiskIOMetrics()
		if disk != nil {
			return float64(disk.AvgWriteLatencyNs), nil
		}
		return 0, nil

	default:
		return 0, fmt.Errorf("unknown metric: %s", metric)
	}
}

// GetDeploymentMetricValue returns the pod-level metric value for a deployment.
// It averages the latest per-pod metric values for pods matched by the deployment selector.
func GetDeploymentMetricValue(k8sClient *kubernetes.Clientset, rule ScalingRule) (float64, error) {
	if k8sClient == nil {
		return 0, fmt.Errorf("k8s client not initialized")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dep, err := k8sClient.AppsV1().
		Deployments(rule.Namespace).
		Get(ctx, rule.Deployment, metav1.GetOptions{})
	if err != nil {
		return 0, err
	}
	if len(dep.Spec.Selector.MatchLabels) == 0 {
		return 0, fmt.Errorf("deployment selector is empty")
	}

	selector := labels.SelectorFromSet(dep.Spec.Selector.MatchLabels).String()
	pods, err := k8sClient.CoreV1().Pods(rule.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: selector,
	})
	if err != nil {
		return 0, err
	}
	if len(pods.Items) == 0 {
		return 0, fmt.Errorf("no pods found for deployment")
	}

	switch rule.Metric {
	case "dns_latency":
		podDNS := telemetry.GetPodDNSMetrics()
		var sum float64
		var count int
		for _, pod := range pods.Items {
			key := fmt.Sprintf("%s/%s", rule.Namespace, pod.Name)
			if m, ok := podDNS[key]; ok {
				sum += float64(m.LastLatencyNs)
				count++
			}
		}
		if count == 0 {
			if val, err := GetMetricValue("dns_latency"); err == nil {
				return val, nil
			}
			return 0, fmt.Errorf("no dns metrics for deployment pods")
		}
		return sum / float64(count), nil

	case "rtt":
		podRTT := telemetry.GetPodRTTMetrics()
		var sum float64
		var count int
		for _, pod := range pods.Items {
			key := fmt.Sprintf("%s/%s", rule.Namespace, pod.Name)
			if m, ok := podRTT[key]; ok {
				sum += float64(m.LastRTTNs)
				count++
			}
		}
		if count == 0 {
			if val, err := GetMetricValue("rtt"); err == nil {
				return val, nil
			}
			return 0, fmt.Errorf("no rtt metrics for deployment pods")
		}
		return sum / float64(count), nil

	case "tcp_retrans":
		podTCP := telemetry.GetPodTCPMetrics()
		var sum float64
		var count int
		for _, pod := range pods.Items {
			key := fmt.Sprintf("%s/%s", rule.Namespace, pod.Name)
			if m, ok := podTCP[key]; ok {
				sum += float64(m.Retransmissions)
				count++
			}
		}
		if count == 0 {
			if val, err := GetMetricValue("tcp_retrans"); err == nil {
				return val, nil
			}
			return 0, fmt.Errorf("no tcp metrics for deployment pods")
		}
		return sum / float64(count), nil

	case "disk_read_latency":
		podDisk := telemetry.GetPodDiskIOMetrics()
		var sum float64
		var count int
		for _, pod := range pods.Items {
			key := fmt.Sprintf("%s/%s", rule.Namespace, pod.Name)
			if m, ok := podDisk[key]; ok {
				sum += float64(m.AvgReadLatencyNs)
				count++
			}
		}
		if count == 0 {
			if val, err := GetMetricValue("disk_read_latency"); err == nil {
				return val, nil
			}
			return 0, fmt.Errorf("no disk read metrics for deployment pods")
		}
		return sum / float64(count), nil

	case "disk_write_latency":
		podDisk := telemetry.GetPodDiskIOMetrics()
		var sum float64
		var count int
		for _, pod := range pods.Items {
			key := fmt.Sprintf("%s/%s", rule.Namespace, pod.Name)
			if m, ok := podDisk[key]; ok {
				sum += float64(m.AvgWriteLatencyNs)
				count++
			}
		}
		if count == 0 {
			if val, err := GetMetricValue("disk_write_latency"); err == nil {
				return val, nil
			}
			return 0, fmt.Errorf("no disk write metrics for deployment pods")
		}
		return sum / float64(count), nil

	default:
		return 0, fmt.Errorf("unknown metric: %s", rule.Metric)
	}
}
