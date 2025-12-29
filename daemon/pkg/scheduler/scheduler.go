package scheduler

import (
	"context"
	"log"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/scaling"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func Start(k8s *kubernetes.Clientset) {
	if k8s == nil {
		log.Println("[Scheduler] k8s client is nil - scheduler not started")
		return
	}
	log.Println("[Scheduler] Custom scheduler started")

	for {
		pods, _ := k8s.CoreV1().Pods("").List(context.TODO(), metav1.ListOptions{
			FieldSelector: "spec.schedulerName=ebpf-scheduler,status.phase=Pending",
		})

		if len(pods.Items) == 0 {
			continue
		}

		rules, _ := GetRules()

		for _, pod := range pods.Items {
			node := pickNode(k8s, pod, rules)
			if node == "" {
				continue
			}

			bindPod(k8s, pod, node)
		}
	}
}

func pickNode(k8s *kubernetes.Clientset, pod v1.Pod, rules []Rule) string {
	nodes, _ := k8s.CoreV1().Nodes().List(context.TODO(), metav1.ListOptions{})

	bestNode := ""
	bestScore := -1

	for _, n := range nodes.Items {
		score := 0

		for _, r := range rules {
			if r.Namespace != pod.Namespace {
				continue
			}
			if !MatchLabels(r, pod.Labels) {
				continue
			}

			val, _ := scaling.GetMetricValue(r.Metric)
			if Compare(val, r.Threshold, r.Operator) {
				score++
			}
		}

		if score > bestScore {
			bestScore = score
			bestNode = n.Name
		}
	}

	return bestNode
}

func bindPod(k8s *kubernetes.Clientset, pod v1.Pod, node string) {
	binding := &v1.Binding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      pod.Name,
			Namespace: pod.Namespace,
		},
		Target: v1.ObjectReference{
			Kind: "Node",
			Name: node,
		},
	}

	_ = k8s.CoreV1().Pods(pod.Namespace).Bind(context.TODO(), binding, metav1.CreateOptions{})
	log.Printf("[Scheduler] Bound pod %s → %s\n", pod.Name, node)
}
