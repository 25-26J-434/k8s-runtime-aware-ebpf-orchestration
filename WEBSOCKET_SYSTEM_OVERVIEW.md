# WebSocket System Overview

This document describes all WebSocket connections in the k8s-runtime-aware-ebpf-orchestration system.

## Total WebSocket Endpoints: **4**

The system has **4 distinct WebSocket endpoints** on the backend, each serving different purposes.

---

## Backend WebSocket Endpoints

### 1. `/api/metrics/ws` - Cluster Metrics WebSocket
**Purpose:** Real-time cluster-wide metrics streaming with multi-node support

**Location:** `daemon/pkg/api/metrics_stream.go`

**Implementation:**
- Uses a separate implementation from the other websockets
- Supports cluster-wide metrics aggregation from multiple daemon nodes
- Broadcasts metrics updates from all nodes in the cluster

**Message Types:**
- `snapshot` - Initial cluster state with all nodes
  ```json
  {
    "type": "snapshot",
    "nodes": {
      "node-name-1": { /* UnifiedMetricsResponse */ },
      "node-name-2": { /* UnifiedMetricsResponse */ }
    }
  }
  ```

- `node_update` - Individual node metrics update
  ```json
  {
    "type": "node_update",
    "node": "ebpf-cluster-control-plane",
    "metrics": { /* UnifiedMetricsResponse */ }
  }
  ```

**Broadcast Frequency:** Every 5 seconds (`metricsBroadcastInterval`)

**Used By:**
- `useMetrics` hook - Dashboard metrics
- Receives metrics from multiple daemon nodes via in-process communication

**Key Features:**
- Aggregates metrics from all daemon instances across the cluster
- Sends snapshot of all nodes on connection
- Updates clients when any node's metrics change

---

### 2. `/ws/metrics` - Metrics WebSocket (Hub-based)
**Purpose:** Single-node metrics broadcasting via shared hub

**Location:** `daemon/pkg/api/websocket.go`

**Implementation:**
- Uses a shared Hub pattern (all `/ws/*` endpoints share the same hub)
- Broadcasts unified metrics for the current node only
- Part of the centralized broadcaster system

**Message Types:**
- `metrics` - Unified metrics data
  ```json
  {
    "type": "metrics",
    "data": { /* UnifiedMetricsResponse */ }
  }
  ```

**Broadcast Frequency:** Every 2 seconds (`StartMetricsBroadcaster` interval)

**Used By:**
- Currently not actively used in frontend (superseded by `/api/metrics/ws`)
- Available for backward compatibility

**Key Features:**
- Shares the same hub as `/ws/topology` and `/ws/pod-details`
- Broadcasts only local node metrics (not cluster-wide)

---

### 3. `/ws/topology` - Cluster Topology WebSocket
**Purpose:** Real-time cluster topology updates (nodes, pods, services)

**Location:** `daemon/pkg/api/websocket.go`

**Implementation:**
- Uses shared Hub pattern
- Broadcasts cluster topology information

**Message Types:**
- `topology` - Cluster topology data
  ```json
  {
    "type": "topology",
    "data": {
      "nodes": [
        {
          "name": "ebpf-cluster-control-plane",
          "ip": "172.18.0.2",
          "status": "Ready",
          "pods": [ /* PodInfo[] */ ],
          "role": "control-plane"
        }
      ],
      "services": [ /* ServiceInfo[] */ ]
    }
  }
  ```

**Broadcast Frequency:** Every 2 seconds (via `StartMetricsBroadcaster`)

**Used By:**
- `NetworkTopology` component - Node selector and pod counts
- `useClusterInfo` hook - Cluster information
- Topology page - Visual network graph

**Key Features:**
- Provides complete cluster view with all nodes and their pods
- Updates pod counts per node in real-time
- Includes service information

---

### 4. `/ws/pod-details` - Pod Details WebSocket
**Purpose:** Real-time pod and container details with resource information

**Location:** `daemon/pkg/api/websocket.go`

**Implementation:**
- Uses shared Hub pattern
- Broadcasts detailed pod information

**Message Types:**
- `pod_details` - Pod details data
  ```json
  {
    "type": "pod_details",
    "data": {
      "timestamp": "2026-01-02T04:11:23Z",
      "cluster_metrics": {
        "total_nodes": 3,
        "total_pods": 10,
        "pods_per_node": {
          "node-1": 5,
          "node-2": 3,
          "node-3": 2
        }
      },
      "pods": {
        "namespace/pod-name": {
          "name": "pod-name",
          "namespace": "namespace",
          "node_name": "node-1",
          "pod_ip": "172.18.0.3",
          "status": "Running",
          "containers": [ /* ContainerInfo[] */ ],
          "total_cpu_requested": "100m",
          "total_memory_requested": "128Mi"
        }
      }
    }
  }
  ```

**Broadcast Frequency:** Every 2 seconds (via `StartMetricsBroadcaster`)

**Used By:**
- `usePodDetails` hook - Pod details display
- `NetworkTopology` component - Node pod details panel
- Dashboard - Pod information cards

**Key Features:**
- Provides detailed pod and container information
- Includes resource requests/limits
- Container status and readiness
- Note: Only shows pods from the current node (daemon's node)

---

## Frontend WebSocket Services

The frontend has a centralized WebSocket service system in `frontend/src/services/websocket.ts`:

### WebSocketService Class
A reusable class that provides:
- Connection management with auto-reconnect
- Message subscription/unsubscription pattern
- Type-based message routing
- Connection state management

### Frontend WebSocket Instances

1. **metricsWebSocket** (`/ws/metrics`)
   - Currently not actively used
   - Available but superseded by direct `/api/metrics/ws` connection in `useMetrics`

2. **topologyWebSocket** (`/ws/topology`)
   - Used by: `NetworkTopology` component, `useClusterInfo` hook
   - Subscribes to: `topology` messages
   - Purpose: Cluster topology updates

3. **podDetailsWebSocket** (`/ws/pod-details`)
   - Used by: `usePodDetails` hook
   - Subscribes to: `pod_details` messages
   - Purpose: Pod and container details

4. **Direct `/api/metrics/ws` Connection** (in `useMetrics` hook)
   - Custom implementation (not using WebSocketService)
   - Uses singleton pattern to prevent multiple connections
   - Handles: `snapshot` and `node_update` messages
   - Purpose: Cluster-wide metrics aggregation

---

## Architecture Overview

### Backend Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Backend API Server                        │
│                        (Port 8080)                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  /api/metrics/ws (Separate Implementation)          │  │
│  │  - Cluster-wide metrics aggregation                 │  │
│  │  - Multi-node support                               │  │
│  │  - Snapshot + node_update messages                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Shared WebSocket Hub                                │  │
│  │  ┌────────────────────────────────────────────────┐ │  │
│  │  │  /ws/metrics                                    │ │  │
│  │  │  - Unified metrics (local node)                │ │  │
│  │  └────────────────────────────────────────────────┘ │  │
│  │  ┌────────────────────────────────────────────────┐ │  │
│  │  │  /ws/topology                                   │ │  │
│  │  │  - Cluster topology (nodes, pods, services)    │ │  │
│  │  └────────────────────────────────────────────────┘ │  │
│  │  ┌────────────────────────────────────────────────┐ │  │
│  │  │  /ws/pod-details                                │ │  │
│  │  │  - Pod and container details                   │ │  │
│  │  └────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                               │
│  StartMetricsBroadcaster (runs every 2 seconds)              │
│  - Gathers metrics                                            │
│  - Broadcasts to /ws/metrics, /ws/topology, /ws/pod-details  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Frontend Usage

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React)                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  useMetrics Hook:                                            │
│  └──> Direct connection to /api/metrics/ws                  │
│       - Receives cluster-wide metrics                        │
│       - Handles snapshot and node_update                     │
│                                                               │
│  useClusterInfo Hook:                                        │
│  └──> topologyWebSocket (/ws/topology)                      │
│       - Subscribes to 'topology' messages                    │
│                                                               │
│  usePodDetails Hook:                                         │
│  └──> podDetailsWebSocket (/ws/pod-details)                 │
│       - Subscribes to 'pod_details' messages                 │
│                                                               │
│  NetworkTopology Component:                                  │
│  ├──> topologyWebSocket (/ws/topology)                      │
│  │    - For node list and pod counts                        │
│  └──> podDetailsWebSocket (/ws/pod-details)                 │
│       - For detailed pod information                         │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Message Flow Examples

### Example 1: Dashboard Metrics Update

```
Backend (Node 1) → /api/metrics/ws → Frontend (useMetrics)
  {
    "type": "node_update",
    "node": "ebpf-cluster-control-plane",
    "metrics": {
      "node_name": "ebpf-cluster-control-plane",
      "pods": { /* pod metrics */ },
      "node": { /* node metrics */ }
    }
  }
```

### Example 2: Topology Update

```
Backend → Hub → /ws/topology → Frontend (NetworkTopology)
  {
    "type": "topology",
    "data": {
      "nodes": [
        {
          "name": "ebpf-cluster-control-plane",
          "pods": [ /* all pods on this node */ ]
        },
        {
          "name": "ebpf-cluster-worker2",
          "pods": [ /* all pods on this node */ ]
        }
      ]
    }
  }
```

### Example 3: Pod Details Update

```
Backend → Hub → /ws/pod-details → Frontend (usePodDetails)
  {
    "type": "pod_details",
    "data": {
      "pods": {
        "namespace/pod-name": {
          "name": "pod-name",
          "containers": [ /* container details */ ],
          "total_cpu_requested": "100m"
        }
      }
    }
  }
```

---

## Key Differences

| Feature | `/api/metrics/ws` | `/ws/metrics` | `/ws/topology` | `/ws/pod-details` |
|---------|-------------------|---------------|----------------|-------------------|
| **Scope** | Cluster-wide | Local node | Cluster-wide | Local node |
| **Implementation** | Separate | Hub-based | Hub-based | Hub-based |
| **Message Types** | snapshot, node_update | metrics | topology | pod_details |
| **Update Frequency** | 5 seconds | 2 seconds | 2 seconds | 2 seconds |
| **Primary Use** | Dashboard metrics | Legacy | Topology view | Pod details |
| **Multi-node** | Yes | No | Yes | No |

---

## Summary

1. **4 WebSocket endpoints** total on the backend
2. **2 different architectures:**
   - `/api/metrics/ws` - Separate implementation for cluster-wide metrics
   - `/ws/*` endpoints - Shared hub for topology and pod details
3. **3 active frontend connections:**
   - Direct `/api/metrics/ws` connection (useMetrics hook)
   - `topologyWebSocket` (`/ws/topology`)
   - `podDetailsWebSocket` (`/ws/pod-details`)
4. **1 legacy/unused:**
   - `metricsWebSocket` (`/ws/metrics`) - Available but not actively used

The system uses WebSockets extensively for real-time updates, avoiding polling and providing instant feedback when cluster state changes.



