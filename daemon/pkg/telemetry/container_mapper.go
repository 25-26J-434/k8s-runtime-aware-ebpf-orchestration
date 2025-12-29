package telemetry

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// ContainerInfo represents container identification information
type ContainerInfo struct {
	PodName       string
	PodNamespace  string
	PodUID        string
	ContainerID   string
	ContainerName string
	CachedAt      time.Time
}

// ContainerMapper maps PIDs to container information
type ContainerMapper struct {
	k8sClient   *kubernetes.Clientset
	pidCache    map[int32]*ContainerInfo
	podCache    map[string]*corev1.Pod
	cacheMutex  sync.RWMutex
	cacheExpiry time.Duration
}

// NewContainerMapper creates a new ContainerMapper
func NewContainerMapper(k8sClient *kubernetes.Clientset) *ContainerMapper {
	cm := &ContainerMapper{
		k8sClient:   k8sClient,
		pidCache:    make(map[int32]*ContainerInfo),
		podCache:    make(map[string]*corev1.Pod),
		cacheExpiry: 60 * time.Second,
	}

	// Start background pod cache refresh
	go cm.refreshPodCache()

	return cm
}

// GetContainerForPodAndPID returns container information for a PID within a known pod
// This is more reliable than trying to map PIDs directly since we already know the pod
func (cm *ContainerMapper) GetContainerForPodAndPID(podKey string, pid int32) (*ContainerInfo, error) {
	cm.cacheMutex.RLock()
	defer cm.cacheMutex.RUnlock()

	// Find the pod in our cache
	pod, exists := cm.podCache[podKey]
	if !exists {
		if pid%100 == 0 {
			log.Printf("[Container Mapper] Pod %s not found in cache (PID %d)", podKey, pid)
		}
		return nil, fmt.Errorf("pod %s not found in cache", podKey)
	}
	
	if pid%100 == 0 {
		log.Printf("[Container Mapper] Found pod %s with %d containers (PID %d)", 
			podKey, len(pod.Status.ContainerStatuses), pid)
	}

	// If pod has only one container, attribute everything to it
	if len(pod.Status.ContainerStatuses) == 1 {
		cs := pod.Status.ContainerStatuses[0]
		containerID := strings.TrimPrefix(cs.ContainerID, "containerd://")
		return &ContainerInfo{
			PodName:       pod.Name,
			PodNamespace:  pod.Namespace,
			PodUID:        string(pod.UID),
			ContainerID:   containerID,
			ContainerName: cs.Name,
		}, nil
	}

	// For multi-container pods, try to match by PID
	// First, check if we can read the PID's cgroup
	cgroupPath := fmt.Sprintf("/proc/%d/cgroup", pid)
	cgroupData, err := os.ReadFile(cgroupPath)
	if err == nil {
		// Try to match container ID in cgroup
		for _, cs := range pod.Status.ContainerStatuses {
			containerID := strings.TrimPrefix(cs.ContainerID, "containerd://")
			if strings.Contains(string(cgroupData), containerID) {
				return &ContainerInfo{
					PodName:       pod.Name,
					PodNamespace:  pod.Namespace,
					PodUID:        string(pod.UID),
					ContainerID:   containerID,
					ContainerName: cs.Name,
				}, nil
			}
		}
	}

	// If we can't determine the specific container, return the first one
	// This is a fallback for short-lived processes
	if len(pod.Status.ContainerStatuses) > 0 {
		cs := pod.Status.ContainerStatuses[0]
		containerID := strings.TrimPrefix(cs.ContainerID, "containerd://")
		return &ContainerInfo{
			PodName:       pod.Name,
			PodNamespace:  pod.Namespace,
			PodUID:        string(pod.UID),
			ContainerID:   containerID,
			ContainerName: cs.Name,
		}, nil
	}

	return nil, fmt.Errorf("no containers found in pod %s", podKey)
}

// GetContainerForPID returns container information for a given PID (legacy method)
func (cm *ContainerMapper) GetContainerForPID(pid int32) (*ContainerInfo, error) {
	// Check cache first
	cm.cacheMutex.RLock()
	if info, exists := cm.pidCache[pid]; exists {
		if time.Since(info.CachedAt) < cm.cacheExpiry {
			cm.cacheMutex.RUnlock()
			return info, nil
		}
	}
	cm.cacheMutex.RUnlock()

	// Log every 50th PID for debugging
	if pid%50 == 0 {
		log.Printf("[Container Mapper] Attempting to map PID %d", pid)
	}

	// Try to find container by checking /proc/<pid>/root path
	// Each container has a unique rootfs
	info, err := cm.findContainerByPIDRoot(pid)
	if err != nil {
		if pid%50 == 0 {
			log.Printf("[Container Mapper] PID %d root method failed: %v, trying cgroup", pid, err)
		}
		// Fallback: try cgroup method
		containerID, err2 := cm.getContainerIDFromPID(pid)
		if err2 != nil {
			if pid%50 == 0 {
				log.Printf("[Container Mapper] PID %d cgroup method also failed: %v", pid, err2)
			}
			return nil, fmt.Errorf("failed both methods: root=%v, cgroup=%v", err, err2)
		}

		// Find container in pod cache
		info, err = cm.findContainerInPods(containerID)
		if err != nil {
			if pid%50 == 0 {
				log.Printf("[Container Mapper] PID %d found container ID but not in pods: %v", pid, err)
			}
			return nil, err
		}
	}

	if pid%50 == 0 {
		log.Printf("[Container Mapper] ✅ Successfully mapped PID %d to container %s/%s/%s", 
			pid, info.PodNamespace, info.PodName, info.ContainerName)
	}

	// Cache result
	info.CachedAt = time.Now()
	cm.cacheMutex.Lock()
	cm.pidCache[pid] = info
	cm.cacheMutex.Unlock()

	return info, nil
}

// findContainerByPIDRoot matches PID to container by checking network namespace
// This works even for short-lived processes by matching their netns to container netns
func (cm *ContainerMapper) findContainerByPIDRoot(pid int32) (*ContainerInfo, error) {
	// Try to read network namespace for this PID
	nsLink := fmt.Sprintf("/proc/%d/ns/net", pid)
	nsPath, err := os.Readlink(nsLink)
	if err != nil {
		// If process doesn't exist, we can't map it
		return nil, fmt.Errorf("failed to read network namespace for PID %d: %w", pid, err)
	}
	
	// Extract namespace ID from path like "net:[4026532598]"
	nsID := strings.TrimPrefix(nsPath, "net:[")
	nsID = strings.TrimSuffix(nsID, "]")
	
	// Match this namespace to a container
	return cm.matchNetNSToContainer(pid, nsID)
}

// matchNetNSToContainer matches a network namespace ID to a container
// by iterating through all pods and checking each container's processes
func (cm *ContainerMapper) matchNetNSToContainer(pid int32, targetNsID string) (*ContainerInfo, error) {
	cm.cacheMutex.RLock()
	defer cm.cacheMutex.RUnlock()

	// Iterate through all pods and their containers
	for _, pod := range cm.podCache {
		// Check regular containers
		for _, containerStatus := range pod.Status.ContainerStatuses {
			// Try to find any process in this container and check its netns
			// We use `crictl inspect` container ID to find PIDsif we had crictl, 
			// but we'll use a simpler approach: check if container ID appears in any process cgroup
			containerID := strings.TrimPrefix(containerStatus.ContainerID, "containerd://")
			
			// Scan /proc to find processes in this container's netns
			if cm.containerHasNetNS(containerID, targetNsID) {
				if pid%50 == 0 {
					log.Printf("[Container Mapper] ✅ Mapped PID %d via netns %s to %s/%s/%s", 
						pid, targetNsID, pod.Namespace, pod.Name, containerStatus.Name)
				}
				return &ContainerInfo{
					PodName:       pod.Name,
					PodNamespace:  pod.Namespace,
					PodUID:        string(pod.UID),
					ContainerID:   containerID,
					ContainerName: containerStatus.Name,
				}, nil
			}
		}

		// Check init containers
		for _, containerStatus := range pod.Status.InitContainerStatuses {
			containerID := strings.TrimPrefix(containerStatus.ContainerID, "containerd://")
			if cm.containerHasNetNS(containerID, targetNsID) {
				return &ContainerInfo{
					PodName:       pod.Name,
					PodNamespace:  pod.Namespace,
					PodUID:        string(pod.UID),
					ContainerID:   containerID,
					ContainerName: containerStatus.Name,
				}, nil
			}
		}
	}

	return nil, fmt.Errorf("no container found for netns %s (PID %d)", targetNsID, pid)
}

// containerHasNetNS checks if a container has the specified network namespace
func (cm *ContainerMapper) containerHasNetNS(containerID, targetNsID string) bool {
	// Look for processes that match this container ID in their cgroup
	// and check if their netns matches
	procDir, err := os.Open("/proc")
	if err != nil {
		return false
	}
	defer procDir.Close()

	entries, err := procDir.Readdirnames(-1)
	if err != nil {
		return false
	}

	for _, entry := range entries {
		// Check if it's a PID directory
		pid, err := fmt.Sscanf(entry, "%d", new(int))
		if err != nil || pid == 0 {
			continue
		}

		// Check if this process belongs to the container
		cgroupPath := fmt.Sprintf("/proc/%s/cgroup", entry)
		cgroupData, err := os.ReadFile(cgroupPath)
		if err != nil {
			continue
		}

		// If the cgroup contains our container ID, check its netns
		if strings.Contains(string(cgroupData), containerID) {
			nsLink := fmt.Sprintf("/proc/%s/ns/net", entry)
			nsPath, err := os.Readlink(nsLink)
			if err != nil {
				continue
			}

			nsID := strings.TrimPrefix(nsPath, "net:[")
			nsID = strings.TrimSuffix(nsID, "]")

			if nsID == targetNsID {
				return true
			}
		}
	}

	return false
}

// matchRootPathToContainer matches a root path to a container
func (cm *ContainerMapper) matchRootPathToContainer(originalPID, mappedPID int32, rootPath string) (*ContainerInfo, error) {
	// The rootPath contains the container ID in Kind/containerd
	// Example: /var/lib/containerd/io.containerd.grpc.v1.cri/sandboxes/<pod-id>/containers/<container-id>/rootfs
	// Or: /run/containerd/io.containerd.runtime.v2.task/k8s.io/<container-id>/rootfs

	cm.cacheMutex.RLock()
	defer cm.cacheMutex.RUnlock()

	// Search through all pods and containers
	for _, pod := range cm.podCache {
		for _, containerStatus := range pod.Status.ContainerStatuses {
			// Extract short container ID from the full ID
			parts := strings.Split(containerStatus.ContainerID, "//")
			if len(parts) != 2 {
				continue
			}
			shortID := parts[1]
			if len(shortID) > 12 {
				shortID = shortID[:12] // Use first 12 chars like Docker
			}

			// Check if the rootPath contains this container ID
			if strings.Contains(rootPath, shortID) || strings.Contains(rootPath, parts[1]) {
				if originalPID != mappedPID {
					log.Printf("[Container Mapper] ✅ Mapped PID %d via parent PID %d to %s/%s/%s", 
						originalPID, mappedPID, pod.Namespace, pod.Name, containerStatus.Name)
				}
				return &ContainerInfo{
					PodName:       pod.Name,
					PodNamespace:  pod.Namespace,
					PodUID:        string(pod.UID),
					ContainerID:   parts[1],
					ContainerName: containerStatus.Name,
				}, nil
			}
		}

		// Check init containers too
		for _, containerStatus := range pod.Status.InitContainerStatuses {
			parts := strings.Split(containerStatus.ContainerID, "//")
			if len(parts) != 2 {
				continue
			}
			shortID := parts[1]
			if len(shortID) > 12 {
				shortID = shortID[:12]
			}

			if strings.Contains(rootPath, shortID) || strings.Contains(rootPath, parts[1]) {
				return &ContainerInfo{
					PodName:       pod.Name,
					PodNamespace:  pod.Namespace,
					PodUID:        string(pod.UID),
					ContainerID:   parts[1],
					ContainerName: containerStatus.Name,
				}, nil
			}
		}
	}

	return nil, fmt.Errorf("no container found for PID %d (mapped via %d) with root %s", originalPID, mappedPID, rootPath)
}

// getContainerIDFromPID extracts container ID from process cgroup or falls back to PID-based lookup
func (cm *ContainerMapper) getContainerIDFromPID(pid int32) (string, error) {
	// Try cgroup first
	cgroupPath := fmt.Sprintf("/proc/%d/cgroup", pid)
	data, err := os.ReadFile(cgroupPath)
	if err != nil {
		// If can't read cgroup, try fallback method
		return cm.getContainerIDFromPIDFallback(pid)
	}

	// Parse cgroup path to extract container ID
	// cgroup v2 format: 0::/kubepods.slice/kubepods-besteffort.slice/kubepods-besteffort-pod<uid>.slice/cri-containerd-<container-id>.scope
	// cgroup v1 format: 1:name=systemd:/kubepods.slice/...
	// Both formats can coexist, prefer v2 (starts with 0::)

	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Handle cgroup v2 format (0::/path)
		if strings.HasPrefix(line, "0::") {
			cgroupPath := strings.TrimPrefix(line, "0::")
			if !strings.Contains(cgroupPath, "kubepods") {
				continue
			}

			// Split by "/" and look for container ID patterns
			parts := strings.Split(cgroupPath, "/")
			for _, part := range parts {
				// containerd format (cgroup v2)
				if strings.HasPrefix(part, "cri-containerd-") {
					id := strings.TrimPrefix(part, "cri-containerd-")
					id = strings.TrimSuffix(id, ".scope")
					return id, nil
				}
				// cri-o format (cgroup v2)
				if strings.HasPrefix(part, "crio-") {
					id := strings.TrimPrefix(part, "crio-")
					id = strings.TrimSuffix(id, ".scope")
					return id, nil
				}
				// docker format (direct container ID, 64 chars)
				if len(part) == 64 && !strings.Contains(part, "-") && !strings.Contains(part, ".") {
					return part, nil
				}
			}
		}

		// Handle cgroup v1 format (legacy)
		if strings.Contains(line, "kubepods") {
			// Split by ":" to get the path part
			parts := strings.Split(line, ":")
			if len(parts) >= 3 {
				cgroupPath := parts[2]
				pathParts := strings.Split(cgroupPath, "/")
				for _, part := range pathParts {
					// containerd format (cgroup v1)
					if strings.HasPrefix(part, "cri-containerd-") {
						id := strings.TrimPrefix(part, "cri-containerd-")
						id = strings.TrimSuffix(id, ".scope")
						return id, nil
					}
					// docker format (direct container ID)
					if len(part) == 64 && !strings.Contains(part, "-") {
						return part, nil
					}
					// cri-o format
					if strings.HasPrefix(part, "crio-") {
						id := strings.TrimPrefix(part, "crio-")
						id = strings.TrimSuffix(id, ".scope")
						return id, nil
					}
				}
			}
		}
	}

	// cgroup didn't have container ID, try fallback
	return cm.getContainerIDFromPIDFallback(pid)
}

// getContainerIDFromPIDFallback uses PID to find container by checking all pods
func (cm *ContainerMapper) getContainerIDFromPIDFallback(pid int32) (string, error) {
	// Read /proc/<pid>/status to get more info
	statusPath := fmt.Sprintf("/proc/%d/status", pid)
	statusData, err := os.ReadFile(statusPath)
	if err != nil {
		return "", fmt.Errorf("failed to read status for PID %d: %w", pid, err)
	}
	
	// Get process name for matching
	var processName string
	lines := strings.Split(string(statusData), "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "Name:") {
			processName = strings.TrimSpace(strings.TrimPrefix(line, "Name:"))
			break
		}
	}
	
	// Use a pseudo container ID based on PID for tracking
	// This allows us to at least group metrics by unique process
	return fmt.Sprintf("pid-%d-%s", pid, processName), nil
}

// findContainerInPods searches for container in pod cache
func (cm *ContainerMapper) findContainerInPods(containerID string) (*ContainerInfo, error) {
	cm.cacheMutex.RLock()
	defer cm.cacheMutex.RUnlock()

	// Search in all pods
	for _, pod := range cm.podCache {
		// Check regular containers
		for _, containerStatus := range pod.Status.ContainerStatuses {
			if cm.matchesContainerID(containerStatus.ContainerID, containerID) {
				return &ContainerInfo{
					PodName:       pod.Name,
					PodNamespace:  pod.Namespace,
					PodUID:        string(pod.UID),
					ContainerID:   containerID,
					ContainerName: containerStatus.Name,
				}, nil
			}
		}
		// Check init containers
		for _, containerStatus := range pod.Status.InitContainerStatuses {
			if cm.matchesContainerID(containerStatus.ContainerID, containerID) {
				return &ContainerInfo{
					PodName:       pod.Name,
					PodNamespace:  pod.Namespace,
					PodUID:        string(pod.UID),
					ContainerID:   containerID,
					ContainerName: containerStatus.Name,
				}, nil
			}
		}
	}

	return nil, fmt.Errorf("container not found: %s", containerID)
}

// matchesContainerID checks if a container ID matches (handles different runtime formats)
func (cm *ContainerMapper) matchesContainerID(fullContainerID, shortID string) bool {
	// fullContainerID format: containerd://abc123... or docker://abc123...
	// shortID: abc123...

	// Remove runtime prefix
	parts := strings.Split(fullContainerID, "://")
	if len(parts) != 2 {
		return false
	}

	containerID := parts[1]

	// Check if shortID is contained in or equals the full ID
	return strings.Contains(containerID, shortID) || strings.Contains(shortID, containerID)
}

// refreshPodCache periodically refreshes the pod cache
func (cm *ContainerMapper) refreshPodCache() {
	log.Printf("[Container Mapper] Starting pod cache refresh goroutine")
	
	// Initial load
	log.Printf("[Container Mapper] Performing initial pod cache load...")
	cm.loadPodCache()

	// Refresh every 30 seconds
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		log.Printf("[Container Mapper] Refreshing pod cache...")
		cm.loadPodCache()
	}
}

// loadPodCache loads all pods from Kubernetes API
func (cm *ContainerMapper) loadPodCache() {
	if cm.k8sClient == nil {
		log.Printf("[Container Mapper] WARNING: k8sClient is nil, cannot load pod cache")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pods, err := cm.k8sClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		log.Printf("[Container Mapper] ERROR: Failed to list pods: %v", err)
		return
	}

	cm.cacheMutex.Lock()
	cm.podCache = make(map[string]*corev1.Pod)
	for i := range pods.Items {
		pod := &pods.Items[i]
		key := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)
		cm.podCache[key] = pod
	}
	podCount := len(cm.podCache)
	cm.cacheMutex.Unlock()
	
	log.Printf("[Container Mapper] ✅ Loaded %d pods into cache", podCount)
}

// ClearCache clears the PID cache (useful for testing)
func (cm *ContainerMapper) ClearCache() {
	cm.cacheMutex.Lock()
	cm.pidCache = make(map[int32]*ContainerInfo)
	cm.cacheMutex.Unlock()
}

