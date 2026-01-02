# WebSocket Best Practices & Recommendations

## Current Architecture Analysis

The system currently has **4 WebSocket endpoints** with different purposes and characteristics. This document provides recommendations for optimal websocket architecture.

---

## Recommended Architecture

### ✅ **Option 1: Keep Current Separation (RECOMMENDED)**

**Structure:**
```
/api/metrics/ws      → Telemetry data (eBPF metrics)
/ws/topology         → Cluster structure (nodes, pods, services)
/ws/pod-details      → Pod metadata (containers, resources)
```

**Pros:**
- ✅ Clear separation of concerns
- ✅ Independent update frequencies (5s vs 2s)
- ✅ Smaller, focused payloads
- ✅ Better scalability (connect only to what you need)
- ✅ Easier to optimize independently
- ✅ Less bandwidth waste (no unnecessary data)

**Cons:**
- ❌ Multiple connections (but this is fine - browsers handle this well)
- ❌ More endpoints to maintain

**Best For:**
- Production systems
- Systems with varying update frequencies
- Systems where different clients need different data

---

### ⚠️ **Option 2: Consolidate into 2 Websockets**

**Structure:**
```
/api/metrics/ws      → Telemetry data (eBPF metrics)
/ws/cluster          → Everything else (topology + pod-details combined)
```

**Pros:**
- ✅ Fewer connections
- ✅ Single source for cluster data
- ✅ Simpler client code

**Cons:**
- ❌ Larger payload sizes (mixing different data types)
- ❌ Same update frequency for different data types (inefficient)
- ❌ More complex message routing on client
- ❌ Harder to optimize independently

**Best For:**
- Simple systems
- Systems with similar update frequencies
- Systems where all clients need all data

---

### ❌ **Option 3: Single Unified WebSocket (NOT RECOMMENDED)**

**Structure:**
```
/ws/unified          → Everything (metrics + topology + pod-details)
```

**Pros:**
- ✅ Single connection

**Cons:**
- ❌ Very large payloads
- ❌ Mixed update frequencies (inefficient)
- ❌ Bandwidth waste
- ❌ Complex message routing
- ❌ Harder to optimize
- ❌ Violates separation of concerns

**NOT Recommended** - Too much coupling, poor performance

---

## Detailed Recommendations

### 1. **Keep `/api/metrics/ws` Separate** ✅

**Why:**
- Different update frequency (5s vs 2s)
- Different data source (eBPF probes vs K8s API)
- Different scope (cluster-wide aggregation)
- Different purpose (telemetry vs structure)

**Optimizations:**
- ✅ Current implementation is good
- Consider adding message type filtering (client can subscribe to specific metric types)
- Consider compression for large payloads

---

### 2. **Consider Merging `/ws/topology` and `/ws/pod-details`** ⚠️

**Analysis:**
Both endpoints:
- Update at same frequency (2s)
- Use same data source (K8s API)
- Are often used together
- Have scope mismatch (topology = cluster-wide, pod-details = node-specific)

**Recommendation: Enhanced `/ws/cluster`**

Create a single `/ws/cluster` endpoint that provides:

```typescript
{
  type: "cluster_update",
  data: {
    // Cluster-wide structure (like current topology)
    topology: {
      nodes: [...],
      services: [...]
    },
    
    // Node-specific details (like current pod-details)
    node_details: {
      "node-name": {
        pods: {
          "namespace/pod": {
            // Detailed pod info (containers, resources, etc.)
          }
        }
      }
    }
  }
}
```

**Pros:**
- ✅ Single connection for cluster data
- ✅ Can still optimize independently (topology updates less frequently than pod details)
- ✅ Solves scope issue (cluster-wide + node-specific in one message)
- ✅ Client gets complete picture in one place

**Implementation Strategy:**
```go
// Backend: Send topology less frequently, pod-details more frequently
func StartClusterBroadcaster() {
    topologyTicker := time.NewTicker(5 * time.Second)  // Less frequent
    podDetailsTicker := time.NewTicker(2 * time.Second) // More frequent
    
    // Send topology updates
    go func() {
        for range topologyTicker.C {
            topology := GetClusterTopology()
            BroadcastMessage("topology", topology)
        }
    }()
    
    // Send pod-details updates
    go func() {
        for range podDetailsTicker.C {
            podDetails := GetPodDetails()
            BroadcastMessage("pod_details", podDetails)
        }
    }()
}
```

Or combine into single message:
```go
func StartClusterBroadcaster() {
    ticker := time.NewTicker(2 * time.Second)
    
    for range ticker.C {
        topology := GetClusterTopology()
        podDetails := GetPodDetails()
        
        BroadcastMessage("cluster_update", map[string]interface{}{
            "topology": topology,
            "node_details": podDetails, // Only current node
        })
    }
}
```

---

### 3. **Best Practice: Message Type Subscription Pattern** ✅

**Current Issue:**
All clients receive all messages, even if they don't need them.

**Recommended Solution:**
Add client-side subscription filtering:

```typescript
// Frontend: Subscribe to specific message types
topologyWebSocket.subscribe('topology', handleTopology);
topologyWebSocket.subscribe('pod_details', handlePodDetails);

// Backend: Only send what client subscribed to
// (This requires protocol enhancement)
```

**Or use separate endpoints (current approach) - also fine!**

---

## Performance Considerations

### Current Architecture Performance

| Endpoint | Update Frequency | Avg Payload Size | Bandwidth (est.) |
|----------|-----------------|------------------|------------------|
| `/api/metrics/ws` | 5s | ~50-200 KB | ~10-40 KB/s |
| `/ws/topology` | 2s | ~20-50 KB | ~10-25 KB/s |
| `/ws/pod-details` | 2s | ~30-100 KB | ~15-50 KB/s |
| **Total** | - | **~100-350 KB** | **~35-115 KB/s** |

### Bandwidth Impact

For 10 concurrent clients:
- **Current**: 350 KB/s - 1.15 MB/s total
- **Consolidated**: Similar (same data, different structure)

**Verdict:** Bandwidth is not a major concern - separation is fine.

---

## Recommendations Summary

### ✅ **RECOMMENDED: Keep Current Architecture with Minor Improvements**

1. **Keep `/api/metrics/ws` separate** ✅
   - Different purpose (telemetry vs structure)
   - Different update frequency
   - Different scope

2. **Keep `/ws/topology` separate** ✅
   - Cluster-wide structure
   - Used for network visualization

3. **Keep `/ws/pod-details` separate** ✅
   - Node-specific details
   - Different scope from topology

4. **Optional Enhancement: Message Filtering**
   - Add subscription patterns if needed
   - But current approach is fine for most cases

### ⚠️ **ALTERNATIVE: Merge Topology + Pod-Details**

If you want to reduce connections, merge `/ws/topology` and `/ws/pod-details` into `/ws/cluster`:

**Pros:**
- One less connection
- Complete cluster picture in one place

**Cons:**
- Larger payloads (but still manageable)
- Scope complexity (cluster-wide + node-specific)

---

## Implementation Best Practices

### 1. **Connection Management** ✅

```typescript
// ✅ GOOD: Singleton pattern for connections
const topologyWebSocket = new WebSocketService('/ws/topology');

// ✅ GOOD: Auto-reconnect with exponential backoff
// ✅ GOOD: Connection pooling (reuse connections)
```

### 2. **Message Handling** ✅

```typescript
// ✅ GOOD: Type-based routing
websocket.subscribe('topology', handleTopology);
websocket.subscribe('pod_details', handlePodDetails);

// ✅ GOOD: Error handling
websocket.onError(handleError);
```

### 3. **Update Frequency** ✅

```go
// ✅ GOOD: Different frequencies for different data
metricsTicker := 5 * time.Second    // Telemetry changes frequently
structureTicker := 2 * time.Second  // Structure changes less frequently
```

### 4. **Payload Optimization** ✅

```go
// ✅ GOOD: Only send when clients connected
if len(hub.clients) > 0 {
    BroadcastMessage(...)
}

// ✅ GOOD: Compress large payloads (consider)
// ✅ GOOD: Send deltas instead of full snapshots (future optimization)
```

---

## Migration Path (If Consolidating)

If you decide to merge topology + pod-details:

### Step 1: Create `/ws/cluster` endpoint
```go
func handleWebSocketCluster(w http.ResponseWriter, r *http.Request) {
    // Same hub pattern
    // Send combined messages
}
```

### Step 2: Update backend broadcaster
```go
func StartClusterBroadcaster() {
    ticker := time.NewTicker(2 * time.Second)
    
    for range ticker.C {
        topology := GetClusterTopology()
        podDetails := GetPodDetails()
        
        BroadcastMessage("cluster_update", map[string]interface{}{
            "topology": topology,
            "node_details": podDetails,
        })
    }
}
```

### Step 3: Update frontend
```typescript
// Replace two websockets with one
const clusterWebSocket = new WebSocketService('/ws/cluster');

clusterWebSocket.subscribe('cluster_update', (data) => {
    if (data.topology) {
        handleTopology(data.topology);
    }
    if (data.node_details) {
        handlePodDetails(data.node_details);
    }
});
```

---

## Final Recommendation

### **Keep Current Architecture** ✅

**Rationale:**
1. ✅ Clear separation of concerns
2. ✅ Optimal update frequencies
3. ✅ Smaller, focused payloads
4. ✅ Better scalability
5. ✅ Easier to optimize independently
6. ✅ Multiple connections are fine (browsers handle well)

**Only consider consolidation if:**
- You have bandwidth constraints (unlikely)
- You have many concurrent clients (>100)
- You want to simplify client code

**For your use case:** Current architecture is optimal! 🎯

---

## Checklist for WebSocket Implementation

- ✅ Separate by concern (metrics vs structure vs metadata)
- ✅ Use appropriate update frequencies
- ✅ Implement auto-reconnect
- ✅ Handle errors gracefully
- ✅ Use type-based message routing
- ✅ Optimize payload sizes
- ✅ Only broadcast when clients connected
- ✅ Document message formats
- ✅ Consider compression for large payloads
- ✅ Monitor connection counts and bandwidth



