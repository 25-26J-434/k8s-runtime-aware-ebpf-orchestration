# WebSocket Redundancy Analysis

## Question: Why do we need `/ws/topology` and `/ws/pod-details` when `/api/metrics/ws` exists?

This document analyzes the differences and potential redundancy between these WebSocket endpoints.

---

## Data Structure Comparison

### 1. `/api/metrics/ws` - UnifiedMetricsResponse

```typescript
{
  timestamp: string
  node_name: string
  node_ip: string
  node: {
    // Node-level eBPF metrics only
    dns_latency: {...},
    tcp_metrics: {...},
    rtt: {...},
    sched_latency: {...},
    disk_io: {...}
  },
  pods: {
    "namespace/pod-name": {
      // Pod-level eBPF metrics only
      dns_latency: {...},
      tcp_metrics: {...},
      rtt: {...}
    }
  },
  containers: {
    "container-key": {
      // Container-level eBPF metrics
      dns_latency: {...},
      tcp_metrics: {...},
      disk_io: {...}
    }
  }
}
```

**Key Characteristics:**
- ✅ Provides **eBPF telemetry metrics** (DNS latency, TCP retransmissions, RTT, etc.)
- ✅ Cluster-wide scope (aggregates from all daemon nodes)
- ❌ **Does NOT include** pod metadata (status, IP, node assignment)
- ❌ **Does NOT include** container information (names, images, resources)
- ❌ **Does NOT include** cluster structure (services, node roles)
- ❌ Only shows pods/nodes that have **generated eBPF events**

---

### 2. `/ws/topology` - ClusterTopology

```typescript
{
  nodes: [
    {
      name: "node-name",
      ip: "172.18.0.2",
      status: "Ready",
      role: "control-plane",
      kernel_version: "6.14.0",
      os_image: "Ubuntu 22.04",
      pods: [
        {
          name: "pod-name",
          namespace: "namespace",
          ip: "10.244.0.1",
          status: "Running",
          service: "service-name",
          labels: {...}
        }
      ]
    }
  ],
  services: [
    {
      name: "service-name",
      namespace: "namespace",
      cluster_ip: "10.96.0.1",
      type: "ClusterIP",
      pods: [...]
    }
  ]
}
```

**Key Characteristics:**
- ✅ Provides **complete cluster structure** (all nodes, all pods, all services)
- ✅ Includes pod metadata (status, IP, labels, service association)
- ✅ Includes node metadata (role, kernel version, OS image)
- ✅ Shows **ALL pods** regardless of eBPF activity
- ❌ **Does NOT include** eBPF metrics
- ❌ **Does NOT include** container details
- ❌ **Does NOT include** resource requests/limits

---

### 3. `/ws/pod-details` - PodDetailsResponse

```typescript
{
  timestamp: string,
  cluster_metrics: {
    total_nodes: 3,
    total_pods: 10,
    pods_per_node: {...},
    pods_by_namespace: {...},
    node_capacity: {...},
    node_allocatable: {...}
  },
  pods: {
    "namespace/pod-name": {
      name: "pod-name",
      namespace: "namespace",
      node_name: "node-name",
      pod_ip: "10.244.0.1",
      status: "Running",
      created_at: "2026-01-02T04:11:23Z",
      labels: {...},
      containers: [
        {
          name: "container-name",
          image: "image:tag",
          ready: true,
          restart_count: 0,
          state: "Running",
          resources: {
            requests: { cpu: "100m", memory: "128Mi" },
            limits: { cpu: "500m", memory: "512Mi" }
          }
        }
      ],
      init_containers: [...],
      total_cpu_requested: "100m",
      total_memory_requested: "128Mi"
    }
  }
}
```

**Key Characteristics:**
- ✅ Provides **detailed pod metadata** (creation time, containers, resources)
- ✅ Includes **container information** (names, images, status, resource requests/limits)
- ✅ Includes cluster statistics (pods per node, namespace counts)
- ❌ **Scope is limited** to current node only (daemon's node)
- ❌ **Does NOT include** eBPF metrics
- ❌ **Does NOT include** service information
- ❌ **Does NOT include** node metadata (kernel version, OS)

---

## Summary Table

| Feature | `/api/metrics/ws` | `/ws/topology` | `/ws/pod-details` |
|---------|-------------------|----------------|-------------------|
| **eBPF Metrics** | ✅ Yes (DNS, TCP, RTT, etc.) | ❌ No | ❌ No |
| **Pod Metadata** | ❌ No (only metrics) | ✅ Yes (basic) | ✅ Yes (detailed) |
| **Container Details** | ❌ No | ❌ No | ✅ Yes (names, images, resources) |
| **Node Metadata** | ❌ No | ✅ Yes (role, kernel, OS) | ❌ No |
| **Services** | ❌ No | ✅ Yes | ❌ No |
| **Cluster Scope** | ✅ All nodes (aggregated) | ✅ All nodes | ❌ Current node only |
| **Resource Requests** | ❌ No | ❌ No | ✅ Yes |
| **Creation Time** | ❌ No | ❌ No | ✅ Yes |
| **Pods Without eBPF Events** | ❌ No | ✅ Yes | ✅ Yes |

---

## Why They Exist Separately

### 1. **Different Data Sources**

- **`/api/metrics/ws`**: Data from eBPF probes (real-time telemetry)
- **`/ws/topology`**: Data from Kubernetes API (cluster structure)
- **`/ws/pod-details`**: Data from Kubernetes API (pod/container specs)

### 2. **Different Update Frequencies**

- **`/api/metrics/ws`**: Updates every 5 seconds (metrics change frequently)
- **`/ws/topology`**: Updates every 2 seconds (structure changes less frequently)
- **`/ws/pod-details`**: Updates every 2 seconds (metadata changes infrequently)

### 3. **Different Scopes**

- **`/api/metrics/ws`**: Cluster-wide aggregation (all nodes' metrics)
- **`/ws/topology`**: Cluster-wide structure (all nodes, all pods)
- **`/ws/pod-details`**: Single-node scope (daemon's node only)

### 4. **Different Use Cases**

- **`/api/metrics/ws`**: Dashboard metrics, performance monitoring
- **`/ws/topology`**: Network topology visualization, service discovery
- **`/ws/pod-details`**: Resource management, container inspection

---

## Potential Redundancy

### ❌ **NOT Redundant** - They serve different purposes:

1. **Metrics vs Structure**: 
   - `/api/metrics/ws` = Telemetry data
   - `/ws/topology` = Cluster structure
   - These are fundamentally different data types

2. **Basic vs Detailed Pod Info**:
   - `/ws/topology` = Basic pod info (name, IP, status, labels)
   - `/ws/pod-details` = Detailed info (containers, resources, creation time)

3. **Scope Differences**:
   - `/ws/topology` = All nodes (complete cluster view)
   - `/ws/pod-details` = Single node (detailed local view)

### ⚠️ **Potential Overlap** (Minor):

1. **Pod Status/IP**: Both `/ws/topology` and `/ws/pod-details` provide pod status and IP
   - But: Topology shows ALL pods, Pod-details shows only current node's pods

2. **Pod Counts**: Both provide pod counts
   - But: Topology has per-node pod counts, Pod-details has cluster statistics

---

## Could We Consolidate?

### Option 1: Add topology/pod-details to `/api/metrics/ws`

**Pros:**
- Single connection for all data
- Consistent update frequency

**Cons:**
- Mixing telemetry data with structural data (different concerns)
- Larger payload sizes
- More frequent updates for static data (inefficient)
- Breaks separation of concerns

### Option 2: Keep separate but optimize

**Current approach (recommended):**
- Keep separate websockets for different data types
- Frontend connects to what it needs
- Allows independent scaling and optimization

**Potential optimization:**
- Could merge `/ws/topology` and `/ws/pod-details` into one endpoint
- But: Topology is cluster-wide, pod-details is node-specific
- This would complicate the data model

---

## Current Usage in Frontend

### `/api/metrics/ws`
- Used by: `useMetrics` hook
- Purpose: Dashboard metrics, charts
- Needs: eBPF telemetry data only

### `/ws/topology`
- Used by: `NetworkTopology` component, `useClusterInfo` hook
- Purpose: Node selector, pod counts per node, network graph
- Needs: Complete cluster structure (all nodes, all pods)

### `/ws/pod-details`
- Used by: `usePodDetails` hook, `NetworkTopology` component
- Purpose: Pod details panel, container information, resource usage
- Needs: Detailed pod metadata (containers, resources)

---

## Conclusion

**These websockets are NOT redundant** - they serve different purposes:

1. **`/api/metrics/ws`** = **Telemetry** (eBPF metrics)
2. **`/ws/topology`** = **Structure** (cluster architecture)
3. **`/ws/pod-details`** = **Metadata** (pod/container details)

However, there is **minor overlap** in pod status/IP information, but:
- Topology shows ALL pods (cluster-wide)
- Pod-details shows detailed info for current node only
- They complement each other rather than duplicate

**Recommendation**: Keep them separate for:
- ✅ Clear separation of concerns
- ✅ Independent update frequencies
- ✅ Smaller, focused payloads
- ✅ Better scalability

If optimization is needed, consider:
- Merging `/ws/topology` and `/ws/pod-details` into a single `/ws/cluster` endpoint
- But this would require careful design to handle scope differences (cluster-wide vs node-specific)



