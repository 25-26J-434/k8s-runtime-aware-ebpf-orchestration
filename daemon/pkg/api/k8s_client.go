package api

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

var k8sClient *kubernetes.Clientset

// InitKubernetesClient initializes the Kubernetes client
func InitKubernetesClient() error {
	var config *rest.Config
	var err error

	// Try in-cluster config first
	config, err = rest.InClusterConfig()
	if err != nil {
		// Fall back to kubeconfig
		kubeconfig := os.Getenv("KUBECONFIG")
		if kubeconfig == "" {
			home, _ := os.UserHomeDir()
			kubeconfig = filepath.Join(home, ".kube", "config")
		}

		config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			log.Printf("[K8s] Failed to create Kubernetes client: %v", err)
			return err
		}
	}

	k8sClient, err = kubernetes.NewForConfig(config)
	if err != nil {
		log.Printf("[K8s] Failed to create Kubernetes clientset: %v", err)
		return err
	}

	log.Println("[K8s] Kubernetes client initialized successfully")
	return nil
}

// GetK8sClient returns the Kubernetes client for use by other packages
func GetK8sClient() *kubernetes.Clientset {
	return k8sClient
}

// ClusterTopology represents the cluster structure
type ClusterTopology struct {
	Nodes    []NodeInfo    `json:"nodes"`
	Services []ServiceInfo `json:"services"`
}

// NodeInfo represents a Kubernetes node
type NodeInfo struct {
	Name      string    `json:"name"`
	IP        string    `json:"ip"`
	Status    string    `json:"status"`
	Pods      []PodInfo `json:"pods"`
	Role      string    `json:"role"`
	KernelVer string    `json:"kernel_version"`
	OSImage   string    `json:"os_image"`
}

// PodInfo represents a Kubernetes pod
type PodInfo struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	IP        string            `json:"ip"`
	Status    string            `json:"status"`
	Service   string            `json:"service"`
	Labels    map[string]string `json:"labels"`
}

// ServiceInfo represents a Kubernetes service
type ServiceInfo struct {
	Name      string    `json:"name"`
	Namespace string    `json:"namespace"`
	ClusterIP string    `json:"cluster_ip"`
	Type      string    `json:"type"`
	Pods      []PodInfo `json:"pods"`
}

// GetClusterTopology fetches the cluster topology
func GetClusterTopology() (*ClusterTopology, error) {
	if k8sClient == nil {
		return nil, fmt.Errorf("Kubernetes client not initialized")
	}

	ctx := context.Background()
	topology := &ClusterTopology{
		Nodes:    []NodeInfo{},
		Services: []ServiceInfo{},
	}

	// Get all nodes
	nodes, err := k8sClient.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list nodes: %v", err)
	}

	// Get all pods across all namespaces
	pods, err := k8sClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %v", err)
	}

	// Build node info with pods
	for _, node := range nodes.Items {
		nodeInfo := NodeInfo{
			Name:   node.Name,
			Status: string(node.Status.Phase),
			Pods:   []PodInfo{},
		}

		// Get node IP
		for _, addr := range node.Status.Addresses {
			if addr.Type == "InternalIP" {
				nodeInfo.IP = addr.Address
				break
			}
		}

		// Get node role
		if _, ok := node.Labels["node-role.kubernetes.io/control-plane"]; ok {
			nodeInfo.Role = "control-plane"
		} else if _, ok := node.Labels["node-role.kubernetes.io/master"]; ok {
			nodeInfo.Role = "master"
		} else {
			nodeInfo.Role = "worker"
		}

		// Get node status
		for _, condition := range node.Status.Conditions {
			if condition.Type == "Ready" {
				if condition.Status == "True" {
					nodeInfo.Status = "Ready"
				} else {
					nodeInfo.Status = "NotReady"
				}
				break
			}
		}

		// Get system info
		nodeInfo.KernelVer = node.Status.NodeInfo.KernelVersion
		nodeInfo.OSImage = node.Status.NodeInfo.OSImage

		// Add pods running on this node
		for _, pod := range pods.Items {
			if pod.Spec.NodeName == node.Name {
				podInfo := PodInfo{
					Name:      pod.Name,
					Namespace: pod.Namespace,
					IP:        pod.Status.PodIP,
					Status:    string(pod.Status.Phase),
					Labels:    pod.Labels,
				}

				// Extract service name from labels
				if app, ok := pod.Labels["app"]; ok {
					podInfo.Service = app
				}

				nodeInfo.Pods = append(nodeInfo.Pods, podInfo)
			}
		}

		topology.Nodes = append(topology.Nodes, nodeInfo)
	}

	return topology, nil
}

// GetServices fetches all services with their pods
func GetServices() ([]ServiceInfo, error) {
	if k8sClient == nil {
		return nil, fmt.Errorf("Kubernetes client not initialized")
	}

	ctx := context.Background()
	services := []ServiceInfo{}

	// Get all services
	svcList, err := k8sClient.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list services: %v", err)
	}

	// Get all pods
	pods, err := k8sClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods: %v", err)
	}

	for _, svc := range svcList.Items {
		svcInfo := ServiceInfo{
			Name:      svc.Name,
			Namespace: svc.Namespace,
			ClusterIP: svc.Spec.ClusterIP,
			Type:      string(svc.Spec.Type),
			Pods:      []PodInfo{},
		}

		// Match pods to service using selector
		for _, pod := range pods.Items {
			if pod.Namespace != svc.Namespace {
				continue
			}

			// Check if pod matches service selector
			matches := true
			for key, value := range svc.Spec.Selector {
				if pod.Labels[key] != value {
					matches = false
					break
				}
			}

			if matches {
				podInfo := PodInfo{
					Name:      pod.Name,
					Namespace: pod.Namespace,
					IP:        pod.Status.PodIP,
					Status:    string(pod.Status.Phase),
					Labels:    pod.Labels,
				}

				if app, ok := pod.Labels["app"]; ok {
					podInfo.Service = app
				}

				svcInfo.Pods = append(svcInfo.Pods, podInfo)
			}
		}

		services = append(services, svcInfo)
	}

	return services, nil
}
