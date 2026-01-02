# eBPF Metrics WebSocket Analysis

## Answer: **eBPF metrics are provided by `/api/metrics/ws`** (Primary)

There are actually **TWO websockets** that can provide eBPF metrics, but only one is actively used:

---

## 1. `/api/metrics/ws` - PRIMARY (Actively Used) ✅

**Location:** `daemon/pkg/api/metrics_stream.go`

**Purpose:** Cluster-wide eBPF metrics aggregation

**Implementation:**
- Uses separate implementation (not shared hub)
- Calls `buildUnifiedMetricsResponse()` which collects eBPF metrics from telemetry collectors
- Aggregates metrics from all daemon nodes in the cluster
- Provides `UnifiedMetricsResponse` structure

**eBPF Metrics Provided:**
```typescript
{
  node_name: string,
  node_ip: string,
  node: {
    dns_latency: {...},      // ✅ eBPF: DNS query latency
    tcp_metrics: {...},      // ✅ eBPF: TCP retransmissions, packet loss
    rtt: {...},              // ✅ eBPF: Round-trip time
    sched_latency: {...},    // ✅ eBPF: CPU scheduling latency
    disk_io: {...},          // ✅ eBPF: Disk I/O latency
    node_system: {...}       // System metrics
  },
  pods: {
    "namespace/pod": {
      dns_latency: {...},    // ✅ eBPF: Pod DNS metrics
      tcp_metrics: {...},    // ✅ eBPF: Pod TCP metrics
      rtt: {...},            // ✅ eBPF: Pod RTT metrics
      sched_latency: {...},  // ✅ eBPF: Pod scheduling metrics
      disk_io: {...}         // ✅ eBPF: Pod disk I/O
    }
  },
  containers: {
    "container-key": {
      dns_latency: {...},    // ✅ eBPF: Container DNS metrics
      tcp_metrics: {...},    // ✅ eBPF: Container TCP metrics
      disk_io: {...}         // ✅ eBPF: Container disk I/O
    }
  }
}
```

**Update Frequency:** Every 5 seconds

**Scope:** Cluster-wide (aggregates from all daemon nodes)

**Used By:**
- ✅ `useMetrics` hook in frontend (Dashboard)
- ✅ Actively used for real-time metrics display

**Message Types:**
- `snapshot` - Initial cluster state with all nodes' metrics
- `node_update` - Individual node metrics update

**Code Flow:**
```go
// daemon/pkg/api/metrics_stream.go
func publishLocalMetrics() {
    metrics := buildUnifiedMetricsResponse("", "")  // Collects eBPF metrics
    storeClusterMetrics(nodeKey, metrics)
    broadcastClusterUpdate(nodeKey, metrics)
}

// daemon/pkg/api/unified_metrics.go
func buildUnifiedMetricsResponse() {
    // Gets eBPF metrics from telemetry collectors:
    // - DNS metrics (telemetry.GetDNSMetrics())
    // - TCP metrics (telemetry.GetTCPMetrics())
    // - RTT metrics (telemetry.GetRTTMetrics())
    // - Scheduling latency (from collectors)
    // - Disk I/O (from collectors)
}
```

---

## 2. `/ws/metrics` - LEGACY (Not Actively Used) ⚠️

**Location:** `daemon/pkg/api/websocket.go`

**Purpose:** Single-node eBPF metrics (via shared hub)

**Implementation:**
- Uses shared hub (same as `/ws/topology` and `/ws/pod-details`)
- Also calls `gatherAllMetrics()` → `buildUnifiedMetricsResponse()`
- Provides same `UnifiedMetricsResponse` structure

**eBPF Metrics Provided:**
- ✅ Same eBPF metrics as `/api/metrics/ws`
- ✅ DNS, TCP, RTT, scheduling latency, disk I/O

**Update Frequency:** Every 2 seconds (via `StartMetricsBroadcaster`)

**Scope:** Local node only (current daemon's node)

**Used By:**
- ❌ NOT actively used in frontend
- ⚠️ Available but superseded by `/api/metrics/ws`

**Message Type:**
- `metrics` - Unified metrics data

**Code Flow:**
```go
// daemon/pkg/api/websocket.go
func gatherAllMetrics() interface{} {
    return buildUnifiedMetricsResponse("", "")  // Same function!
}

// Broadcasted via shared hub
func StartMetricsBroadcaster() {
    metrics := gatherAllMetrics()
    BroadcastMessage("metrics", metrics)  // Sent to /ws/metrics clients
}
```

---

## Comparison

| Feature | `/api/metrics/ws` (PRIMARY) | `/ws/metrics` (LEGACY) |
|---------|----------------------------|------------------------|
| **Status** | ✅ Actively Used | ⚠️ Not Used |
| **eBPF Metrics** | ✅ Yes | ✅ Yes (same data) |
| **Scope** | Cluster-wide (all nodes) | Local node only |
| **Update Frequency** | 5 seconds | 2 seconds |
| **Architecture** | Separate implementation | Shared hub |
| **Used By Frontend** | ✅ Yes (`useMetrics` hook) | ❌ No |
| **Message Types** | `snapshot`, `node_update` | `metrics` |

---

## Data Source: How eBPF Metrics are Collected

Both websockets use the same underlying function: `buildUnifiedMetricsResponse()`

**Source Code:** `daemon/pkg/api/unified_metrics.go`

**Collectors Used:**
```go
// Get all eBPF telemetry collectors
collectors := telemetry.GlobalRegistry.GetAll()

// Collect node-level eBPF metrics
for _, collector := range collectors {
    nodeMetric := collector.GetNodeMetrics()
    response.Node[string(nodeMetric.Type)] = nodeMetric.Value
}

// Collect pod-level eBPF metrics
for _, collector := range collectors {
    podMetrics := collector.GetPodMetrics()
    // Add to response.Pods
}

// Collect container-level eBPF metrics
dnsContainerMetrics := telemetry.GetContainerDNSMetrics()
tcpContainerMetrics := telemetry.GetContainerTCPMetrics()
diskIOContainerMetrics := telemetry.GetContainerDiskIOMetrics()
```

**eBPF Metrics Sources:**
1. **DNS Latency** - From `telemetry.GetDNSMetrics()`, `GetPodDNSMetrics()`, `GetContainerDNSMetrics()`
2. **TCP Metrics** - From `telemetry.GetTCPMetrics()`, `GetPodTCPMetrics()`, `GetContainerTCPMetrics()`
3. **RTT** - From `telemetry.GetRTTMetrics()`, `GetPodRTTMetrics()`
4. **Scheduling Latency** - From scheduling latency collectors
5. **Disk I/O** - From disk I/O collectors

---

## Frontend Usage

### `/api/metrics/ws` Usage (Active)

**File:** `frontend/src/hooks/useMetrics.ts`

```typescript
// Connect to cluster-wide metrics WebSocket
const wsUrl = `${protocol}//${host}:${port}/api/metrics/ws`;
const ws = new WebSocket(wsUrl);

// Handle snapshot (initial cluster state)
if (message.type === 'snapshot' && message.nodes) {
    clusterMetricsRef.current = message.nodes;
}

// Handle node_update (individual node metrics)
if (message.type === 'node_update' && message.node && message.metrics) {
    clusterMetricsRef.current[message.node] = message.metrics;
}
```

**Metrics Extracted:**
- DNS latency (node, pod, container level)
- TCP metrics (retransmissions, packet loss)
- RTT metrics
- Scheduling latency
- Disk I/O metrics

---

## Summary

### **Primary Source: `/api/metrics/ws`** ✅

- ✅ **Actively used** by frontend
- ✅ Provides **cluster-wide** eBPF metrics
- ✅ Updates every **5 seconds**
- ✅ Uses **separate implementation** (not shared hub)
- ✅ Supports **multi-node aggregation**
- ✅ Message types: `snapshot`, `node_update`

### **Legacy Source: `/ws/metrics`** ⚠️

- ⚠️ **Not actively used** in frontend
- ⚠️ Provides **local node only** eBPF metrics
- ⚠️ Updates every **2 seconds**
- ⚠️ Uses **shared hub** (same as topology/pod-details)
- ⚠️ Message type: `metrics`

### **Conclusion**

**eBPF metrics are primarily obtained from `/api/metrics/ws`** which is the actively used websocket for real-time eBPF telemetry data in the frontend dashboard.



