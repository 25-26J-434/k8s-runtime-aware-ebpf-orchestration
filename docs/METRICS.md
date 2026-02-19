# Metrics: Collection, Granularity, and Transport

This document describes how metrics are collected at **node**, **pod**, and **container** level, how they are **transported** (in-process publish/subscribe, HTTP API, and cross-node), and how external consumers such as the web dashboard and other nodes obtain them. It aligns with the methodology described in [METHODOLOGY.md](METHODOLOGY.md).

---

## 1. Overview

The system collects **kernel-level telemetry** via eBPF (DNS latency, TCP RTT, retransmissions, scheduling latency, disk I/O, packet distribution, etc.) and aggregates it at three granularities:

| Level       | Key identifier        | Use case                                      |
|------------|------------------------|-----------------------------------------------|
| **Node**   | Node name              | Scheduling, capacity, cross-node coordination |
| **Pod**    | `namespace/podName`   | Routing, scaling, per-workload health        |
| **Container** | Pod + container name | Per-container attribution, sidecar vs main app |

All metrics originate from **eBPF ring buffers** on the local node. They are aggregated in **in-memory maps** inside the daemon and then exposed via:

1. **In-process transport** – direct function calls and publish/subscribe channels (Components 2, 3, 4).
2. **HTTP API** – for the React dashboard, Prometheus, and other external tools.
3. **Cross-node transport** – P2P messages (Component 4) to publish metrics or summaries to other nodes.

---

## 2. Collection by Level

### 2.1 Node-Level Metrics

**How we collect**

- eBPF programs emit events that are **aggregated across all workloads** on the node.
- Collector goroutines read from kernel ring buffers, optionally filter by node (when multi-node data is present), and update **per-node structures** in memory (e.g. `map[nodeName]NodeMetrics`).

**What we collect (examples)**

- DNS latency (event counts, min/avg/max latency) for the node.
- TCP RTT and retransmission statistics.
- TCP health (packet loss, congestion state).
- Node system metrics: CPU, memory, load average.
- Packet distribution, NAT metadata, service health (node-level).

**Internal access**

- `telemetry.GetDNSMetrics()`, `telemetry.GetRTTMetrics()` (node-level view).
- `collector.GetNodeMetrics()` for a specific collector type.
- `telemetry.GlobalRegistry.Get(metricType).Subscribe()` for push-based node-level updates.

**HTTP**

- `GET /api/metrics` (unified response includes `node`).
- `GET /metrics` (Prometheus), `GET /metrics/json` (legacy JSON).

---

### 2.2 Pod-Level Metrics

**How we collect**

1. Each eBPF event includes **PID** and socket metadata (e.g. 4-tuple).
2. The daemon maps **PID (and optionally IP/port)** to a Kubernetes pod using the Kubernetes API and in-memory pod caches.
3. Metrics are stored in **per-pod structures** keyed by `namespace/podName` (e.g. `map[podKey]PodDNSMetrics`, `map[podKey]PodRTTMetrics`).

**What we collect (examples)**

- Per-pod DNS latency (events, total latency, min/avg/max).
- Per-pod RTT and retransmission metrics.
- Per-pod TCP metrics (SRTT, retransmissions, packet loss, congestion window).
- Per-pod scheduling latency, disk I/O, packet distribution (where implemented).

**Internal access**

- `telemetry.GetPodDNSMetrics()`, `telemetry.GetPodRTTMetrics()`, `telemetry.GetPodTCPMetrics()`, `telemetry.GetPodSchedLatencyMetrics()`, `telemetry.GetPodDiskIOMetrics()`.
- `collector.GetPodMetrics()` for a given collector.
- `telemetry.GlobalRegistry.Get(metricType).Subscribe()` for real-time pod-level updates (push).

**HTTP**

- `GET /api/metrics` – unified response includes `pods` (per-pod metrics).
- `GET /api/metrics?level=pod` – pod-level only.
- `GET /api/scaling/metrics/latest` – latest per-deployment aggregates (derived from pod metrics).
- `GET /api/sched/metrics`, `GET /api/disk/metrics` – scheduling and disk I/O per pod.

Pod-level metrics are the **primary input** for Component 2 (routing) and Component 3 (scaling).

---

### 2.3 Container-Level Metrics

**How we collect**

- eBPF events still carry **PID**. To attribute to a **container** within a pod:
  1. Read **`/proc/<PID>/cgroup`** on the node to obtain a container identifier (runtime-specific, e.g. `cri-containerd-<id>.scope`, `docker-<id>.scope`).
  2. Resolve **container ID → pod + container name** using the Kubernetes API and a cached pod list.
  3. Aggregate metrics in **per-container structures** nested under each pod (e.g. `map[podKey][containerName]ContainerMetrics`).

**What we collect (when container mapping succeeds)**

- Same metric types as pod (DNS, RTT, TCP, etc.) but keyed by **pod + container name**, so that multiple containers in one pod (e.g. main app + sidecar) can be distinguished.

**Status**

- **Infrastructure**: Container mapper (`pkg/telemetry/container_mapper.go`), container-aware collectors, and API shape are in place.
- **Data**: Container-level maps are populated only when PID→container resolution works (e.g. cgroup format and environment such as Kind can leave `containers` empty while pod-level remains valid).

**Internal access**

- Container metrics are exposed through the same telemetry package and unified API; internal getters may return pod-level fallback when container resolution fails.

**HTTP**

- `GET /api/metrics` – unified response includes `containers` (per-container metrics when available).
- Dashboard shows a “Container-Level eBPF Metrics” section when data is present.

This design supports research questions such as: *which container in a multi-container pod is responsible for elevated DNS latency?*

---

## 3. Transport: How Metrics Reach Consumers

### 3.1 In-Process (Same Daemon) – Publish/Subscribe and Direct Calls

**Used by:** Component 2 (routing), Component 3 (scaling), and optionally Component 4 integration.

- **Snapshot (pull):** Components call `telemetry.GetPodDNSMetrics()`, `telemetry.GetPodRTTMetrics()`, `telemetry.GetDNSMetrics()`, etc. No network, no serialization; reads from shared in-memory maps.
- **Streaming (push):** Components obtain a channel via `collector.Subscribe()` (e.g. `telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS).Subscribe()`). The telemetry layer pushes updates to the channel when new events are aggregated; components react in real time (e.g. routing or scaling logic).

**Characteristics**

- Sub-millisecond latency.
- Single source of truth (all components see the same in-memory state).
- No HTTP between components; see architecture diagram in [METHODOLOGY.md](METHODOLOGY.md).

---

### 3.2 HTTP API – Web Dashboard and External Tools

**Used by:** React dashboard, Prometheus, Grafana, scripts, other services outside the daemon.

| Endpoint                         | Description                                      |
|----------------------------------|--------------------------------------------------|
| `GET /api/metrics`              | Unified metrics (node, pods, containers). Optional `?type=` and `?level=` (e.g. `level=pod`). |
| `GET /metrics/json`              | Legacy JSON metrics                              |
| `GET /metrics`                   | Prometheus exposition format                     |
| `GET /api/scaling/metrics/latest`| Latest per-deployment metrics for scaling UI     |
| `GET /api/sched/metrics`        | Scheduling latency metrics                       |
| `GET /api/disk/metrics`         | Disk I/O metrics                                 |
| `WS /ws/metrics`                | WebSocket stream for real-time metrics           |
| `GET /api/metrics/ws`           | Alternative WebSocket metrics endpoint           |

The daemon **serializes** in-memory node/pod/container maps to JSON (or Prometheus text) on each request. The **React dashboard** typically polls `/api/metrics` (or uses WebSocket) to show:

- Dashboard overview (cluster-wide stats).
- Pod-level eBPF metrics (DNS/TCP per pod).
- Container-level eBPF metrics (when available).
- Network topology, scaling cards, etc.

So: **transport to the web and other external consumers is HTTP (REST + optional WebSocket)**; the “publish” side is the daemon serving these endpoints, and the “subscribe” side is the browser or monitoring client.

---

### 3.3 Cross-Node Transport – Publish to Other Nodes (Component 4)

**Used by:** Component 4 (federation), cluster-wide experiments.

- A **P2P daemon** runs on each node and maintains links to other nodes (broadcast, unicast, multicast).
- Nodes can **publish** telemetry-related messages to other nodes using event types such as:
  - **METRIC_UPDATE** – e.g. summarized node/pod metrics or aggregates.
  - **STATE_UPDATE**, **SCHEDULING**, **DISCOVERY**, **HANDSHAKE** – for coordination and discovery.

**How metrics reach other nodes**

- The **sender** (e.g. daemon or P2P layer) reads local metrics via the telemetry interface (or HTTP), packages them into a P2P message payload, and sends to one or more peers.
- The **receiver** gets the message on another node and can use it for federated decisions (e.g. cluster-wide scaling or routing policies) or for dashboard aggregation (e.g. topology that shows multiple nodes).

So: **transport to other nodes is P2P messaging**; the “publish” side is the node sending METRIC_UPDATE (or similar) messages, and the “subscribe” side is the P2P layer and any local logic on the receiving node. The **web dashboard** can then aggregate data from multiple nodes by talking to each node’s HTTP API (e.g. when displaying cluster topology or per-node views).

---

## 4. End-to-End Data Flow (Summary)

```
Kernel (eBPF) → Ring buffers
       ↓
Telemetry collectors (goroutines) → In-memory maps (node / pod / container)
       ↓
       ├→ In-process:  Get*() / Subscribe()  → Components 2, 3, 4
       ├→ HTTP:        GET /api/metrics, /metrics, /ws/metrics → Dashboard, Prometheus, tools
       └→ Cross-node:  P2P (e.g. METRIC_UPDATE) → Other nodes → (optional) their HTTP API → Dashboard
```

- **Node-level:** Aggregated on the node; consumed in-process, via HTTP, or after cross-node P2P.
- **Pod-level:** Keyed by `namespace/podName`; same transport paths; main source for routing and scaling.
- **Container-level:** Keyed by pod + container when PID→container mapping succeeds; same HTTP/unified API and dashboard section; in-process and P2P can carry container summaries if implemented.

---

## 5. What We Summarized in the Methodology Doc (Aligned Here)

From [METHODOLOGY.md](METHODOLOGY.md), the following are reflected in this metrics document:

- **Single process, shared in-memory maps:** All collection and aggregation happen inside the daemon; node/pod/container maps are the single source of truth.
- **Two consumption patterns in-process:** Snapshot (getters) and streaming (Subscribe channels).
- **HTTP only at the edge:** External consumers (web dashboard, Prometheus, etc.) get metrics only via HTTP/WebSocket; internal components do not use HTTP for telemetry.
- **Node-level metrics** for scheduling and cross-node coordination; **pod-level metrics** for routing and scaling; **container-level metrics** (PID→cgroup→Kubernetes) for fine-grained attribution.
- **Transport to “publish/subscribe and other nodes”:** In-process = direct calls + channels; external = HTTP/WS; other nodes = P2P (Component 4) with optional aggregation via dashboard calling each node’s API.

Together, **METRICS.md** (this file) and **METHODOLOGY.md** give a complete picture: methodology explains the architecture and components; this file details how we collect at node/pod/container level and how we transport each to in-process subscribers, the web/other consumers, and other nodes.
