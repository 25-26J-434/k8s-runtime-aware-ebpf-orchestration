package scheduler

import (
	"context"
	"log"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
    "k8s.io/client-go/kubernetes"
)

const SchedulerName = "intelligent-scheduler"

type Scheduler struct {
	client *kubernetes.Clientset
}

func NewScheduler(client *kubernetes.Clientset) *Scheduler {
	return &Scheduler{
		client: client,
	}
}

func (s *Scheduler) Run() {
	log.Println("[SCHEDULER] Intelligent scheduler started")

	for {
		pods, err := s.client.CoreV1().
			Pods("").
			List(context.Background(), 
				metav1.ListOptions{})

		if err != nil {
			log.Println("[SCHEDULER] Failed to list pods:", err)
			time.Sleep(2 * time.Second)
			continue
		}

		for _, pod := range pods.Items {

			// Only pods meant for THIS scheduler
			if pod.Spec.SchedulerName != SchedulerName {
				continue
			}

			// Already scheduled → skip
			if pod.Spec.NodeName != "" {
				continue
			}

			log.Printf(
				"[SCHEDULER] Pending pod detected: %s/%s\n",
				pod.Namespace,
				pod.Name,
			)
		}

		time.Sleep(2 * time.Second)
	}
}
