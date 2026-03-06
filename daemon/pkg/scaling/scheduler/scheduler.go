package scheduler

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/util/workqueue"
)

type Scheduler struct {
	client          *kubernetes.Clientset
	cfg             Config
	queue           workqueue.RateLimitingInterface
	factory         informers.SharedInformerFactory
	podInformer     cache.SharedIndexInformer
	nodeInformer    cache.SharedIndexInformer
	telemetry       *telemetryManager
	podLocks        *keyedMutex
	inflightMu      sync.Mutex
	inflightPerNode map[string]int
}

func New(client *kubernetes.Clientset, cfg Config) (*Scheduler, error) {
	if client == nil {
		return nil, fmt.Errorf("kubernetes client is nil")
	}

	factory := informers.NewSharedInformerFactory(client, 0)
	s := &Scheduler{
		client:          client,
		cfg:             cfg,
		queue:           workqueue.NewNamedRateLimitingQueue(workqueue.DefaultControllerRateLimiter(), "kerneleye-scheduler"),
		factory:         factory,
		podInformer:     factory.Core().V1().Pods().Informer(),
		nodeInformer:    factory.Core().V1().Nodes().Informer(),
		telemetry:       newTelemetryManager(cfg),
		podLocks:        newKeyedMutex(),
		inflightPerNode: make(map[string]int),
	}

	s.podInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			s.enqueuePod(obj)
		},
		UpdateFunc: func(_, newObj interface{}) {
			s.enqueuePod(newObj)
		},
	})

	s.nodeInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if node, ok := obj.(*corev1.Node); ok {
				s.telemetry.EnsureNode(context.Background(), node.Name)
			}
		},
		UpdateFunc: func(_, newObj interface{}) {
			if node, ok := newObj.(*corev1.Node); ok {
				s.telemetry.EnsureNode(context.Background(), node.Name)
			}
		},
		DeleteFunc: func(obj interface{}) {
			switch node := obj.(type) {
			case *corev1.Node:
				s.telemetry.RemoveNode(node.Name)
			case cache.DeletedFinalStateUnknown:
				if deletedNode, ok := node.Obj.(*corev1.Node); ok {
					s.telemetry.RemoveNode(deletedNode.Name)
				}
			}
		},
	})

	return s, nil
}

func (s *Scheduler) Run(ctx context.Context) error {
	defer s.queue.ShutDown()

	s.factory.Start(ctx.Done())
	if !cache.WaitForCacheSync(ctx.Done(), s.podInformer.HasSynced, s.nodeInformer.HasSynced) {
		return fmt.Errorf("timed out waiting for informer caches to sync")
	}

	for _, obj := range s.nodeInformer.GetStore().List() {
		if node, ok := obj.(*corev1.Node); ok {
			s.telemetry.EnsureNode(ctx, node.Name)
		}
	}

	for i := 0; i < s.cfg.WorkerCount; i++ {
		go wait.UntilWithContext(ctx, s.runWorker, time.Second)
	}

	<-ctx.Done()
	return ctx.Err()
}

func (s *Scheduler) runWorker(ctx context.Context) {
	for s.processNextItem(ctx) {
	}
}

func (s *Scheduler) processNextItem(ctx context.Context) bool {
	item, shutdown := s.queue.Get()
	if shutdown {
		return false
	}
	defer s.queue.Done(item)

	key, ok := item.(string)
	if !ok {
		s.queue.Forget(item)
		return true
	}

	if err := s.schedulePod(ctx, key); err != nil {
		log.Printf("[Scheduler] Failed to schedule %s: %v", key, err)
		s.queue.AddRateLimited(key)
		return true
	}

	s.queue.Forget(item)
	return true
}

func (s *Scheduler) enqueuePod(obj interface{}) {
	pod, ok := obj.(*corev1.Pod)
	if !ok || !s.shouldSchedulePod(pod) {
		return
	}

	key, err := cache.MetaNamespaceKeyFunc(pod)
	if err != nil {
		return
	}
	s.queue.Add(key)
}

func (s *Scheduler) shouldSchedulePod(pod *corev1.Pod) bool {
	if pod == nil {
		return false
	}
	if pod.Spec.SchedulerName != s.cfg.SchedulerName {
		return false
	}
	if pod.Spec.NodeName != "" {
		return false
	}
	return pod.Status.Phase == corev1.PodPending
}

func (s *Scheduler) schedulePod(parent context.Context, key string) error {
	namespace, name, err := cache.SplitMetaNamespaceKey(key)
	if err != nil {
		return err
	}

	unlock := s.podLocks.Lock(key)
	defer unlock()

	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()

	pod, err := s.client.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !s.shouldSchedulePod(pod) {
		return nil
	}

	candidates, err := s.listCandidateNodes(ctx)
	if err != nil {
		return err
	}
	if len(candidates) == 0 {
		return fmt.Errorf("no eligible nodes available")
	}

	scores := scoreCandidates(candidates, s.cfg, time.Now().UTC())
	if len(scores) == 0 {
		return fmt.Errorf("no node scores calculated")
	}

	selected := scores[0]
	s.incrementInflight(selected.Name)
	defer s.decrementInflight(selected.Name)

	binding := &corev1.Binding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      pod.Name,
			Namespace: pod.Namespace,
			UID:       pod.UID,
		},
		Target: corev1.ObjectReference{
			APIVersion: "v1",
			Kind:       "Node",
			Name:       selected.Name,
		},
	}

	if err := s.client.CoreV1().Pods(pod.Namespace).Bind(ctx, binding, metav1.CreateOptions{}); err != nil {
		if apierrors.IsNotFound(err) || apierrors.IsConflict(err) || apierrors.IsAlreadyExists(err) || strings.Contains(strings.ToLower(err.Error()), "already assigned") {
			return nil
		}
		return err
	}

	log.Printf("[Scheduler] Bound pod %s/%s to node %s (score=%.2f base=%.2f metrics=%t)", pod.Namespace, pod.Name, selected.Name, selected.Score, selected.BaseScore, selected.HasMetrics)
	return nil
}

func (s *Scheduler) listCandidateNodes(ctx context.Context) ([]CandidateNode, error) {
	nodes, err := s.client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	pods, err := s.client.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	podCounts := make(map[string]int)
	for _, pod := range pods.Items {
		if pod.Spec.NodeName == "" {
			continue
		}
		if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
			continue
		}
		podCounts[pod.Spec.NodeName]++
	}

	candidates := make([]CandidateNode, 0, len(nodes.Items))
	for _, node := range nodes.Items {
		s.telemetry.EnsureNode(ctx, node.Name)
		if !s.isCandidateNode(&node) {
			continue
		}

		telemetry, ok := s.telemetry.Snapshot(node.Name)
		candidates = append(candidates, CandidateNode{
			Name:       node.Name,
			PodCount:   podCounts[node.Name],
			Inflight:   s.getInflight(node.Name),
			Telemetry:  telemetry,
			HasMetrics: ok,
		})
	}

	return candidates, nil
}

func (s *Scheduler) isCandidateNode(node *corev1.Node) bool {
	if node == nil || node.Spec.Unschedulable {
		return false
	}

	if !nodeConditionIsTrue(node, corev1.NodeReady) {
		return false
	}
	if s.cfg.FilterDiskPressure && nodeConditionIsTrue(node, corev1.NodeDiskPressure) {
		return false
	}
	if s.cfg.FilterMemoryPressure && nodeConditionIsTrue(node, corev1.NodeMemoryPressure) {
		return false
	}
	if s.cfg.FilterPIDPressure && nodeConditionIsTrue(node, corev1.NodePIDPressure) {
		return false
	}

	return true
}

func nodeConditionIsTrue(node *corev1.Node, conditionType corev1.NodeConditionType) bool {
	for _, condition := range node.Status.Conditions {
		if condition.Type == conditionType {
			return condition.Status == corev1.ConditionTrue
		}
	}
	return false
}

func (s *Scheduler) getInflight(nodeName string) int {
	s.inflightMu.Lock()
	defer s.inflightMu.Unlock()
	return s.inflightPerNode[nodeName]
}

func (s *Scheduler) incrementInflight(nodeName string) {
	s.inflightMu.Lock()
	defer s.inflightMu.Unlock()
	s.inflightPerNode[nodeName]++
}

func (s *Scheduler) decrementInflight(nodeName string) {
	s.inflightMu.Lock()
	defer s.inflightMu.Unlock()

	current := s.inflightPerNode[nodeName]
	if current <= 1 {
		delete(s.inflightPerNode, nodeName)
		return
	}
	s.inflightPerNode[nodeName] = current - 1
}

type keyedMutex struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func newKeyedMutex() *keyedMutex {
	return &keyedMutex{locks: make(map[string]*sync.Mutex)}
}

func (m *keyedMutex) Lock(key string) func() {
	m.mu.Lock()
	lock, ok := m.locks[key]
	if !ok {
		lock = &sync.Mutex{}
		m.locks[key] = lock
	}
	m.mu.Unlock()

	lock.Lock()
	return lock.Unlock
}
