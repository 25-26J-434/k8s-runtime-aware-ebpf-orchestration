# Container-Level eBPF Metrics Implementation Plan

## Current State vs. Required State

### What We Have Now
- **Pod-level metrics:**DNS and TCP metrics aggregated per pod
- **Process-level events:**eBPF captures individual process events
- **Container details:**Name, image, resources, state (via Kubernetes API)

### What We Need
- **Container-level metrics:**DNS and TCP metrics per individual container within a pod
- **Example:**For `api-service` pod with 2 containers:
 ```
 api-service-xxx/
 ├─ api container: 45ms avg DNS, 1200 TCP events
 └─ metrics-exporter: 12ms avg DNS, 300 TCP events
 ```

---

## Technical Approach

### Option 1: PID to Container Mapping (Recommended)

**How it works:**
1. eBPF captures events with PID
2. Read `/proc/<PID>/cgroup` to get container ID
3. Query Kubernetes API to map container ID → container name
4. Aggregate metrics by container

**Pros:**
- Accurate container identification
- Works with all container runtimes (containerd, CRI-O, Docker)
- No eBPF program changes needed

**Cons:**
- Requires reading /proc filesystem
- Additional Kubernetes API calls

**Implementation:**

```go
// pkg/telemetry/container_mapper.go
type ContainerMapper struct {
 k8sClient *kubernetes.Clientset
 cache map[int32]ContainerInfo // PID -> Container
 podCache map[string]*corev1.Pod // Pod cache
}

type ContainerInfo struct {
 PodName string
 PodNamespace string
 ContainerID string
 ContainerName string
}

func (cm *ContainerMapper) GetContainerForPID(pid int32) (*ContainerInfo, error) {
 // Check cache first
 if info, exists := cm.cache[pid]; exists {
 return &info, nil
 }
 
 // Read /proc/<pid>/cgroup
 cgroupPath := fmt.Sprintf("/proc/%d/cgroup", pid)
 data, err := os.ReadFile(cgroupPath)
 if err != nil {
 return nil, err
 }
 
 // Extract container ID from cgroup path
 // Example: 0::/kubepods/besteffort/pod<pod-uid>/<container-id>
 containerID := extractContainerID(string(data))
 
 // Find pod and container via K8s API
 pods, _ := cm.k8sClient.CoreV1().Pods("").List(context.Background(), metav1.ListOptions{})
 for _, pod := range pods.Items {
 for _, containerStatus := range pod.Status.ContainerStatuses {
 if strings.Contains(containerStatus.ContainerID, containerID) {
 info := ContainerInfo{
 PodName: pod.Name,
 PodNamespace: pod.Namespace,
 ContainerID: containerID,
 ContainerName: containerStatus.Name,
 }
 cm.cache[pid] = info
 return &info, nil
 }
 }
 }
 
 return nil, fmt.Errorf("container not found for PID %d", pid)
}
```

### Option 2: eBPF Cgroup Tracking

**How it works:**
1. eBPF programs attach to cgroup hooks
2. Track metrics directly by cgroup (which represents a container)
3. Map cgroup to container via Kubernetes

**Pros:**
- Native eBPF solution
- More efficient

**Cons:**
- Requires modifying eBPF programs
- More complex implementation
- Need to handle cgroup v1 vs v2

---

## Implementation Steps

### Phase 1: Container Identification Layer (RECOMMENDED START HERE)

**File:**`daemon/pkg/telemetry/container_mapper.go`

```go
package telemetry

import (
 "context"
 "fmt"
 "os"
 "strings"
 "sync"
 "time"
 
 corev1 "k8s.io/api/core/v1"
 metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
 "k8s.io/client-go/kubernetes"
)

type ContainerMapper struct {
 k8sClient *kubernetes.Clientset
 pidCache map[int32]*ContainerInfo
 podCache map[string]*corev1.Pod
 cacheMutex sync.RWMutex
 cacheExpiry time.Duration
}

type ContainerInfo struct {
 PodName string
 PodNamespace string
 PodUID string
 ContainerID string
 ContainerName string
 CachedAt time.Time
}

func NewContainerMapper(k8sClient *kubernetes.Clientset) *ContainerMapper {
 cm := &ContainerMapper{
 k8sClient: k8sClient,
 pidCache: make(map[int32]*ContainerInfo),
 podCache: make(map[string]*corev1.Pod),
 cacheExpiry: 60 * time.Second,
 }
 
 // Refresh pod cache periodically
 go cm.refreshPodCache()
 
 return cm
}

func (cm *ContainerMapper) GetContainerForPID(pid int32) (*ContainerInfo, error) {
 // Check cache
 cm.cacheMutex.RLock()
 if info, exists := cm.pidCache[pid]; exists {
 if time.Since(info.CachedAt) < cm.cacheExpiry {
 cm.cacheMutex.RUnlock()
 return info, nil
 }
 }
 cm.cacheMutex.RUnlock()
 
 // Get container ID from cgroup
 containerID, err := cm.getContainerIDFromPID(pid)
 if err != nil {
 return nil, err
 }
 
 // Find container in pod cache
 info, err := cm.findContainerInPods(containerID)
 if err != nil {
 return nil, err
 }
 
 // Cache result
 info.CachedAt = time.Now()
 cm.cacheMutex.Lock()
 cm.pidCache[pid] = info
 cm.cacheMutex.Unlock()
 
 return info, nil
}

func (cm *ContainerMapper) getContainerIDFromPID(pid int32) (string, error) {
 cgroupPath := fmt.Sprintf("/proc/%d/cgroup", pid)
 data, err := os.ReadFile(cgroupPath)
 if err != nil {
 return "", err
 }
 
 // Parse cgroup path to extract container ID
 // Format: 0::/kubepods.slice/kubepods-besteffort.slice/kubepods-besteffort-pod<uid>.slice/cri-containerd-<container-id>.scope
 lines := strings.Split(string(data), "\n")
 for _, line := range lines {
 if strings.Contains(line, "kubepods") {
 // Extract container ID (last component)
 parts := strings.Split(line, "/")
 for _, part := range parts {
 if strings.Contains(part, "cri-containerd-") || 
 strings.Contains(part, "docker-") ||
 strings.Contains(part, "crio-") {
 // Extract ID
 id := strings.TrimPrefix(part, "cri-containerd-")
 id = strings.TrimPrefix(id, "docker-")
 id = strings.TrimPrefix(id, "crio-")
 id = strings.TrimSuffix(id, ".scope")
 return id, nil
 }
 }
 }
 }
 
 return "", fmt.Errorf("container ID not found in cgroup")
}

func (cm *ContainerMapper) findContainerInPods(containerID string) (*ContainerInfo, error) {
 cm.cacheMutex.RLock()
 defer cm.cacheMutex.RUnlock()
 
 for _, pod := range cm.podCache {
 for _, containerStatus := range pod.Status.ContainerStatuses {
 if strings.Contains(containerStatus.ContainerID, containerID) {
 return &ContainerInfo{
 PodName: pod.Name,
 PodNamespace: pod.Namespace,
 PodUID: string(pod.UID),
 ContainerID: containerID,
 ContainerName: containerStatus.Name,
 }, nil
 }
 }
 }
 
 return nil, fmt.Errorf("container not found: %s", containerID)
}

func (cm *ContainerMapper) refreshPodCache() {
 ticker := time.NewTicker(30 * time.Second)
 defer ticker.Stop()
 
 for range ticker.C {
 ctx := context.Background()
 pods, err := cm.k8sClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
 if err != nil {
 continue
 }
 
 cm.cacheMutex.Lock()
 cm.podCache = make(map[string]*corev1.Pod)
 for i := range pods.Items {
 pod := &pods.Items[i]
 key := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)
 cm.podCache[key] = pod
 }
 cm.cacheMutex.Unlock()
 }
}
```

### Phase 2: Modify Collectors to Track Container-Level Metrics

**Modify DNS Collector:**

```go
// In pkg/telemetry/dns_latency.go

type ContainerDNSStats struct {
 ContainerName string
 Events int
 TotalLatency uint64
 MinLatency uint64
 MaxLatency uint64
 AvgLatency float64
}

type DNSCollector struct {
 // ... existing fields ...
 containerMapper *ContainerMapper
 containerStats map[string]map[string]*ContainerDNSStats // pod -> container -> stats
}

func (dc *DNSCollector) processEvent(event DNSEvent) {
 // Get container info from PID
 containerInfo, err := dc.containerMapper.GetContainerForPID(event.PID)
 if err != nil {
 // Fall back to pod-level metrics
 dc.updatePodStats(event)
 return
 }
 
 // Update container-level stats
 podKey := fmt.Sprintf("%s/%s", containerInfo.PodNamespace, containerInfo.PodName)
 
 if dc.containerStats[podKey] == nil {
 dc.containerStats[podKey] = make(map[string]*ContainerDNSStats)
 }
 
 if dc.containerStats[podKey][containerInfo.ContainerName] == nil {
 dc.containerStats[podKey][containerInfo.ContainerName] = &ContainerDNSStats{
 ContainerName: containerInfo.ContainerName,
 MinLatency: ^uint64(0), // Max uint64
 }
 }
 
 stats := dc.containerStats[podKey][containerInfo.ContainerName]
 stats.Events++
 stats.TotalLatency += event.LatencyNs
 if event.LatencyNs < stats.MinLatency {
 stats.MinLatency = event.LatencyNs
 }
 if event.LatencyNs > stats.MaxLatency {
 stats.MaxLatency = event.LatencyNs
 }
 stats.AvgLatency = float64(stats.TotalLatency) / float64(stats.Events)
}
```

### Phase 3: API Response Structure

**Update API to return container-level metrics:**

```go
// pkg/api/unified_metrics.go

type ContainerMetrics struct {
 ContainerName string `json:"container_name"`
 ContainerID string `json:"container_id"`
 Metrics map[string]interface{} `json:"metrics"`
}

type PodMetricsWithContainers struct {
 PodLevel map[string]interface{} `json:"pod_level"` // Aggregated pod metrics
 ContainerLevel []ContainerMetrics `json:"container_level"` // Per-container metrics
}

type UnifiedMetricsResponse struct {
 Timestamp string `json:"timestamp"`
 NodeName string `json:"node_name"`
 Pods map[string]PodMetricsWithContainers `json:"pods"`
}
```

**Example Response:**
```json
{
 "timestamp": "2025-12-22T20:00:00Z",
 "node_name": "node-1",
 "pods": {
 "test-apps/api-service-xxx": {
 "pod_level": {
 "dns_latency": {
 "avg_latency_us": 850.5,
 "total_events": 1500
 }
 },
 "container_level": [
 {
 "container_name": "api",
 "container_id": "abc123",
 "metrics": {
 "dns_latency": {
 "avg_latency_us": 920.3,
 "total_events": 1200
 },
 "tcp_metrics": {
 "srtt_us": 5500,
 "retransmissions": 2
 }
 }
 },
 {
 "container_name": "metrics-exporter",
 "container_id": "def456",
 "metrics": {
 "dns_latency": {
 "avg_latency_us": 450.1,
 "total_events": 300
 }
 }
 }
 ]
 }
 }
}
```

### Phase 4: Frontend Display

**Update Dashboard to show container metrics:**

```tsx
// In Dashboard.tsx pod card
{podMetrics.container_level && podMetrics.container_level.map((container) => (
 <div className="container-metrics-card" key={container.container_name}>
 <h5> {container.container_name}</h5>
 
 {container.metrics.dns_latency && (
 <div className="metric-row">
 <span>DNS Avg Latency:</span>
 <span>{container.metrics.dns_latency.avg_latency_us.toFixed(2)} μs</span>
 </div>
 )}
 
 {container.metrics.tcp_metrics && (
 <div className="metric-row">
 <span>TCP SRTT:</span>
 <span>{(container.metrics.tcp_metrics.srtt_us / 1000).toFixed(2)} ms</span>
 </div>
 )}
 </div>
))}
```

---

## Quick Start Implementation

### Step 1: Create Container Mapper (30 minutes)
```bash
# Create the file
touch daemon/pkg/telemetry/container_mapper.go

# Copy the ContainerMapper code from Phase 1 above
```

### Step 2: Integrate with DNS Collector (20 minutes)
```bash
# Modify daemon/pkg/telemetry/dns_latency.go
# Add container_mapper field and use it in processEvent()
```

### Step 3: Update API Response (15 minutes)
```bash
# Modify daemon/pkg/api/unified_metrics.go
# Add container_level to response structure
```

### Step 4: Update Frontend (20 minutes)
```bash
# Modify frontend/src/pages/Dashboard.tsx
# Add container metrics display section
```

---

## Testing

```bash
# 1. Rebuild daemon
cd daemon && go build -o ebpf-daemon ./cmd/daemon

# 2. Check logs for container mapping
kubectl logs -n ebpf-telemetry -l app=ebpf-daemon | grep -i container

# 3. Test API
curl http://localhost:8080/api/metrics | jq '.pods | to_entries[0].value.container_level'

# 4. Verify multi-container pods show separate metrics
curl http://localhost:8080/api/metrics | jq '.pods["test-apps/api-service-xxx"].container_level'
```

---

## Benefits

 **Granular visibility:**See which container in a pod is causing issues
 **Sidecar monitoring:**Track metrics for sidecar containers separately
 **Resource attribution:**Know exactly which container uses what
 **Better debugging:**Isolate problems to specific containers

---

## Next Steps

1. **Implement ContainerMapper**(highest priority)
2. **Modify DNS collector**to use ContainerMapper
3. **Test with multi-container pods**(api-service, web-app)
4. **Extend to TCP collector**
5. **Update frontend display**

Would you like me to start implementing the ContainerMapper now?


