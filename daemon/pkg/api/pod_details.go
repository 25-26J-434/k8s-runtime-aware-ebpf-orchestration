package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ContainerInfo represents detailed container information
type ContainerInfo struct {
	Name         string                 `json:"name"`
	Image        string                 `json:"image"`
	Ready        bool                   `json:"ready"`
	RestartCount int32                  `json:"restart_count"`
	State        string                 `json:"state"`
	Resources    map[string]interface{} `json:"resources"`
}

// PodDetails represents detailed pod information including containers
type PodDetails struct {
	Namespace      string                 `json:"namespace"`
	Name           string                 `json:"name"`
	NodeName       string                 `json:"node_name"`
	PodIP          string                 `json:"pod_ip"`
	Status         string                 `json:"status"`
	CreatedAt      string                 `json:"created_at"`
	Labels         map[string]string      `json:"labels"`
	Containers     []ContainerInfo        `json:"containers"`
	InitContainers []ContainerInfo        `json:"init_containers,omitempty"`
	TotalCPU       string                 `json:"total_cpu_requested"`
	TotalMemory    string                 `json:"total_memory_requested"`
	Metrics        map[string]interface{} `json:"metrics,omitempty"`
}

// ClusterMetrics represents cluster-level metrics
type ClusterMetrics struct {
	TotalNodes      int                    `json:"total_nodes"`
	TotalPods       int                    `json:"total_pods"`
	TotalContainers int                    `json:"total_containers"`
	TotalNamespaces int                    `json:"total_namespaces"`
	PodsPerNode     map[string]int         `json:"pods_per_node"`
	PodsByNamespace map[string]int         `json:"pods_by_namespace"`
	NodeCapacity    map[string]interface{} `json:"node_capacity"`
	NodeAllocatable map[string]interface{} `json:"node_allocatable"`
}

// PodDetailsResponse represents the response with pod and container details
type PodDetailsResponse struct {
	Timestamp      string                `json:"timestamp"`
	ClusterMetrics ClusterMetrics        `json:"cluster_metrics"`
	Pods           map[string]PodDetails `json:"pods"` // key: namespace/pod-name
}

// GetPodDetails returns detailed pod and container information
func GetPodDetails() (*PodDetailsResponse, error) {
	if k8sClient == nil {
		return nil, log.Output(1, "Kubernetes client not initialized").(error)
	}

	ctx := context.Background()

	// Get node name from environment (daemon runs as DaemonSet, so it knows its node)
	nodeName := os.Getenv("NODE_NAME")

	// Get all pods from current node (dynamic - no hardcoding)
	var pods *corev1.PodList
	var err error
	if nodeName != "" {
		// Get pods only from this node
		pods, err = k8sClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{
			FieldSelector: fmt.Sprintf("spec.nodeName=%s", nodeName),
		})
		if err != nil {
			log.Printf("[API] Failed to list pods for node %s: %v", nodeName, err)
			return nil, err
		}
		log.Printf("[API] Found %d pods on node %s", len(pods.Items), nodeName)
	} else {
		// Fallback: get all pods if NODE_NAME not set
		log.Printf("[API] Warning: NODE_NAME not set, getting all pods")
		pods, err = k8sClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
		if err != nil {
			log.Printf("[API] Failed to list pods: %v", err)
			return nil, err
		}
	}

	// Get all nodes for cluster metrics
	nodes, err := k8sClient.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		log.Printf("[API] Failed to list nodes: %v", err)
		return nil, err
	}

	response := PodDetailsResponse{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Pods:      make(map[string]PodDetails),
	}

	// Include ALL pods - no filtering for consistency
	filteredPods := pods.Items
	namespaceSet := make(map[string]bool)
	for _, pod := range pods.Items {
		namespaceSet[pod.Namespace] = true
	}

	// Build cluster metrics - dynamic based on current node
	clusterMetrics := ClusterMetrics{
		TotalNodes:      len(nodes.Items),
		TotalPods:       len(filteredPods), // Only non-system pods on this node
		PodsPerNode:     make(map[string]int),
		PodsByNamespace: make(map[string]int),
		NodeCapacity:    make(map[string]interface{}),
		NodeAllocatable: make(map[string]interface{}),
		TotalNamespaces: len(namespaceSet), // Dynamic namespace count
	}

	// Aggregate node resources
	for _, node := range nodes.Items {
		if capacity, ok := node.Status.Capacity["cpu"]; ok {
			clusterMetrics.NodeCapacity["cpu"] = capacity.String()
		}
		if capacity, ok := node.Status.Capacity["memory"]; ok {
			clusterMetrics.NodeCapacity["memory"] = capacity.String()
		}
		if allocatable, ok := node.Status.Allocatable["cpu"]; ok {
			clusterMetrics.NodeAllocatable["cpu"] = allocatable.String()
		}
		if allocatable, ok := node.Status.Allocatable["memory"]; ok {
			clusterMetrics.NodeAllocatable["memory"] = allocatable.String()
		}
	}

	// Process each pod (filtered non-system pods from current node)
	totalContainers := 0
	for _, pod := range filteredPods {

		podKey := pod.Namespace + "/" + pod.Name

		// Count pods per node
		if pod.Spec.NodeName != "" {
			clusterMetrics.PodsPerNode[pod.Spec.NodeName]++
		}

		// Count pods per namespace
		clusterMetrics.PodsByNamespace[pod.Namespace]++

		podDetail := PodDetails{
			Namespace:      pod.Namespace,
			Name:           pod.Name,
			NodeName:       pod.Spec.NodeName,
			PodIP:          pod.Status.PodIP,
			Status:         string(pod.Status.Phase),
			CreatedAt:      pod.CreationTimestamp.Format(time.RFC3339),
			Labels:         pod.Labels,
			Containers:     make([]ContainerInfo, 0),
			InitContainers: make([]ContainerInfo, 0),
			Metrics:        make(map[string]interface{}),
		}

		// Process init containers
		for i, container := range pod.Spec.InitContainers {
			containerInfo := ContainerInfo{
				Name:  container.Name,
				Image: container.Image,
				Resources: map[string]interface{}{
					"requests": map[string]string{
						"cpu":    container.Resources.Requests.Cpu().String(),
						"memory": container.Resources.Requests.Memory().String(),
					},
					"limits": map[string]string{
						"cpu":    container.Resources.Limits.Cpu().String(),
						"memory": container.Resources.Limits.Memory().String(),
					},
				},
			}

			// Get container status
			if i < len(pod.Status.InitContainerStatuses) {
				status := pod.Status.InitContainerStatuses[i]
				containerInfo.Ready = status.Ready
				containerInfo.RestartCount = status.RestartCount

				if status.State.Running != nil {
					containerInfo.State = "Running"
				} else if status.State.Waiting != nil {
					containerInfo.State = "Waiting: " + status.State.Waiting.Reason
				} else if status.State.Terminated != nil {
					containerInfo.State = "Terminated: " + status.State.Terminated.Reason
				}
			}

			podDetail.InitContainers = append(podDetail.InitContainers, containerInfo)
			totalContainers++
		}

		// Process regular containers
		totalCPU := int64(0)
		totalMemory := int64(0)

		for i, container := range pod.Spec.Containers {
			containerInfo := ContainerInfo{
				Name:  container.Name,
				Image: container.Image,
				Resources: map[string]interface{}{
					"requests": map[string]string{
						"cpu":    container.Resources.Requests.Cpu().String(),
						"memory": container.Resources.Requests.Memory().String(),
					},
					"limits": map[string]string{
						"cpu":    container.Resources.Limits.Cpu().String(),
						"memory": container.Resources.Limits.Memory().String(),
					},
				},
			}

			// Sum up resource requests
			totalCPU += container.Resources.Requests.Cpu().MilliValue()
			totalMemory += container.Resources.Requests.Memory().Value()

			// Get container status
			if i < len(pod.Status.ContainerStatuses) {
				status := pod.Status.ContainerStatuses[i]
				containerInfo.Ready = status.Ready
				containerInfo.RestartCount = status.RestartCount

				if status.State.Running != nil {
					containerInfo.State = "Running"
				} else if status.State.Waiting != nil {
					containerInfo.State = "Waiting: " + status.State.Waiting.Reason
				} else if status.State.Terminated != nil {
					containerInfo.State = "Terminated: " + status.State.Terminated.Reason
				}
			}

			podDetail.Containers = append(podDetail.Containers, containerInfo)
			totalContainers++
		}

		// Set total resources
		podDetail.TotalCPU = formatMilliCPU(totalCPU)
		podDetail.TotalMemory = formatBytes(totalMemory)

		response.Pods[podKey] = podDetail
	}

	clusterMetrics.TotalContainers = totalContainers
	response.ClusterMetrics = clusterMetrics

	return &response, nil
}

// handlePodDetails returns detailed pod and container information
func handlePodDetails(w http.ResponseWriter, r *http.Request) {
	response, err := GetPodDetails()
	if err != nil {
		http.Error(w, "Failed to get pod details", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// formatMilliCPU formats milli-CPU to a readable string
func formatMilliCPU(milliCPU int64) string {
	if milliCPU >= 1000 {
		return formatFloat(float64(milliCPU)/1000.0) + " cores"
	}
	return formatInt64(milliCPU) + "m"
}

// formatBytes formats bytes to a readable string
func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return formatInt64(bytes) + "B"
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	units := []string{"Ki", "Mi", "Gi", "Ti", "Pi"}
	return formatFloat(float64(bytes)/float64(div)) + units[exp]
}

// Helper functions for formatting
func formatFloat(f float64) string {
	return truncateFloat(f, 2)
}

func formatInt64(i int64) string {
	return truncateInt(i)
}

func truncateFloat(f float64, decimals int) string {
	return truncateString(f, decimals)
}

func truncateInt(i int64) string {
	return truncateIntString(i)
}

func truncateString(f float64, decimals int) string {
	format := "%.2f"
	if decimals == 1 {
		format = "%.1f"
	} else if decimals == 3 {
		format = "%.3f"
	}
	return jsonFormat(format, f)
}

func truncateIntString(i int64) string {
	return jsonFormatInt(i)
}

func jsonFormat(format string, f float64) string {
	// Simple implementation
	s := ""
	if format == "%.2f" {
		s = formatTwoDecimals(f)
	} else if format == "%.1f" {
		s = formatOneDecimal(f)
	}
	return s
}

func jsonFormatInt(i int64) string {
	return formatInteger(i)
}

func formatTwoDecimals(f float64) string {
	// Simple format to 2 decimals
	intPart := int64(f)
	fracPart := int64((f - float64(intPart)) * 100)
	if fracPart < 0 {
		fracPart = -fracPart
	}
	return formatInteger(intPart) + "." + formatTwoDigits(fracPart)
}

func formatOneDecimal(f float64) string {
	intPart := int64(f)
	fracPart := int64((f - float64(intPart)) * 10)
	if fracPart < 0 {
		fracPart = -fracPart
	}
	return formatInteger(intPart) + "." + formatOneDigit(fracPart)
}

func formatInteger(i int64) string {
	if i == 0 {
		return "0"
	}
	negative := i < 0
	if negative {
		i = -i
	}
	s := ""
	for i > 0 {
		s = string(rune('0'+i%10)) + s
		i /= 10
	}
	if negative {
		s = "-" + s
	}
	return s
}

func formatTwoDigits(i int64) string {
	if i < 10 {
		return "0" + formatInteger(i)
	}
	return formatInteger(i)
}

func formatOneDigit(i int64) string {
	return formatInteger(i)
}
