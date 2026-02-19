# Component 1: Methodology and Technical Description

This document describes **Component 1 (eBPF Telemetry Core)** in technical detail: how it works, how it provides the **bi-directional pluggable interface**, and how **Components 2, 3, and 4** connect to it. It serves as the dedicated methodology for Component 1 and complements [METHODOLOGY.md](METHODOLOGY.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Role of Component 1

Component 1 is the **telemetry and control core** of the runtime-aware eBPF orchestration system. It:

1. **Collects** raw events from eBPF programs in the Linux kernel.
2. **Aggregates** them into node-, pod-, and (where supported) container-level metrics in user space.
3. **Serves** these metrics to other components and to external consumers.
4. **Exposes a bi-directional interface**: other components both **read** telemetry (observe) and **write** control instructions (policy, redirect, drop, shape) that are translated into kernel or data-plane actions.

Component 1 is implemented as the **`daemon/pkg/telemetry`** package (and related loader/API code) inside the single Go daemon process. It does not run as a separate service; all communication with Components 2, 3, and 4 is **in-process** (function calls and channels).

---

## 2. How Component 1 Works (Technical Flow)

### 2.1 Kernel-Space: eBPF Programs and Ring Buffers

Each eBPF program attaches to specific kernel hooks and writes **typed events** to **BPF_MAP_TYPE_RINGBUF** maps. Ring buffers provide zero-copy, lock-free event streaming from kernel to user space.

**DNS latency** (`dns_latency.c`): `kprobe/udp_sendmsg` records start time in a hash map by PID; `kprobe/udp_recvmsg` computes latency and submits a `struct dns_event` (timestamp_ns, pid, saddr, latency_ns) via `bpf_ringbuf_submit()`.

**TCP RTT** (`rtt.c`): Observes round-trip times; events to `rtt_events`. **TCP metrics** (`tcp_metrics.c`): SRTT, min RTT, retransmissions, packet loss, congestion window, bad handshakes; `tcp_metrics_events`. **Scheduling** (`sched_latency.c`): `sched_switch` / `sched_wakeup` → `sched_events`. **Disk I/O** (`disk_io.c`): block I/O → `disk_io_events`. **Others:** socket count, node system, packet distribution, service health, NAT.

Event payloads include: PID, socket metadata (source/dest IP, port), timestamps, and protocol-specific counters.

### 2.2 Loader: Program Load and Attach

The **`daemon/pkg/loader`** package loads pre-compiled BPF objects (e.g. `dns_latency.o`, `rtt.o`) via `ebpf.NewCollection()` and attaches programs with `link.Kprobe()`. It exposes maps (e.g. `loader.DNSObjs.Maps["dns_events"]`) to collectors. Collectors wait for loader initialization before starting their read loops.

### 2.3 User-Space: Collectors, Parsing, and Aggregation

Each collector runs a **goroutine** that blocks on `ringbuf.NewReader(map)` and `rd.Read()`. For each event:

1. **Parse** raw bytes into a typed struct (e.g. `DNSEvent`: TimestampNs, Pid, SourceIP, LatencyNs, Domain) using `binary.LittleEndian`.
2. **Update node-level aggregates** with `atomic.AddUint64` / `atomic.StoreUint64` on global counters (lock-free).
3. **Resolve Kubernetes context:**
   - **Pod:** `containerMapper.GetContainerForPID(pid)` or fallback `ipToPodMap[sourceIP]` (IP → `namespace/podname`). IP map refreshed from K8s API.
   - **Container:** `GetContainerForPodAndPID(podKey, pid)` if container mapper is set; key is `namespace/podname/containername`.
4. **Update per-pod / per-container maps** under `podDNSMetricsMutex` and `containerDNSMetricsMutex`; per-entry fields use atomics for hot path.
5. **Notify subscribers:** `OnMetricUpdate(event)` builds `PodMetric`, calls `notifySubscribers()`, which sends on each subscriber channel (non-blocking; drop if full).

**Concurrency:** Node metrics = atomics only. Pod/container maps = `sync.RWMutex` for structure + `atomic.*` for counters. Subscribers = buffered channels (cap 100); `Subscribe()` appends, `notifySubscribers` sends with `select { case ch <- m: default: }`.

### 2.4 End-to-End Flow (DNS Example)

```
Kernel: udp_sendmsg → store start_ts in hash[pid]
        udp_recvmsg → latency = now - start_ts; bpf_ringbuf_reserve; fill dns_event; bpf_ringbuf_submit
   ↓
User:  rd.Read() → parseDNSEvent(raw) → DNSEvent
   ↓
       updateDNSMetrics: atomic add node; resolve pod (containerMapper or ipToPodMap); mutex+atomic update pod; optional container update
   ↓
       OnMetricUpdate → notifySubscribers(PodMetric)
   ↓
       Getters (GetPodDNSMetrics) return snapshot; Subscribers receive on channel
```

### 2.5 Summary Flow

```
Kernel (eBPF hooks) → BPF_MAP_TYPE_RINGBUF → collector goroutines (parse, resolve K8s, update maps)
                                                                        ↓
                                    In-memory: node (atomic), pod (mutex+atomic), container
                                                                        ↓
                                              Bi-directional interface (read + control-in)
                                                                        ↓
                                    Components 2, 3, 4  and  HTTP API / control endpoints
```

---

## 3. Bi-Directional Interface Provided by Component 1

Component 1 provides a **single, coherent interface** with two directions.

### 3.1 Read Path (Telemetry Out)

Other components **observe** runtime state without talking to the kernel directly.

**Snapshot (pull)**

- **Node-level:** `telemetry.GetDNSMetrics()`, `telemetry.GetRTTMetrics()`, and node metrics from other collectors (e.g. system, packet distribution). Getters return structs built from `atomic.LoadUint64` on global counters; no locks.
- **Pod-level:** `telemetry.GetPodDNSMetrics()`, `telemetry.GetPodRTTMetrics()`, `telemetry.GetPodTCPMetrics()`, `telemetry.GetPodSchedLatencyMetrics()`, `telemetry.GetPodDiskIOMetrics()`, etc. Each holds `RLock`, copies the map (or iterates and copies entries), releases lock, returns. Pod keys are `namespace/podname`.
- **Container-level:** `telemetry.GetContainerDNSMetrics()` (and similar when implemented). Keys: `namespace/podname/containername`.
- **Mapping:** `telemetry.GetPodIPMapping()` (IP → `namespace/podname`) for IP-based pod resolution.

**Streaming (push / publish–subscribe)**

- Each collector implements the **`Collector`** interface (`GetType()`, `GetNodeMetrics()`, `GetPodMetrics()`, `Subscribe()`, `Unsubscribe()`) and is registered in **`telemetry.GlobalRegistry`**.
- **`Subscribe()`** creates a buffered channel (cap 100), appends it to `subscribers`, returns `<-chan Metric`. On each event, `notifySubscribers(metric)` iterates over subscribers under `RLock` and sends with `select { case ch <- metric: default: }` (non-blocking; drops if channel full).
- Components call `telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS).Subscribe()` (or `MetricTypeRTT`, `MetricTypeTCP`, etc.) and run a goroutine that reads from the channel and reacts in real time.
- **Metric types:** `dns_latency`, `rtt`, `tcp_metrics`, `node_system`, `packet_distribution`, `service_health`, `nat_metadata`, etc. Each collector emits `NodeMetric` or `PodMetric` with `Type`, `Timestamp`, `Value` (e.g. `DNSMetricValue`, `RTTMetricValue`).

So Component 1 **serves** telemetry by (1) maintaining the authoritative in-memory state and (2) exposing it via **getters** (snapshot) and **subscription channels** (push). No HTTP is used between Component 1 and Components 2, 3, or 4; all access is in-process.

### 3.2 Write Path (Control In) – Bi-Directional Completion

The **control-in** side completes the bi-directional interface: higher-level logic can **inject policies or actions** that affect the kernel or data plane.

**Intended usage:** Components 2, 3, or 4 (or the dashboard) send **control instructions** (e.g. allow/deny/rate_limit, redirect, drop, shape) so that telemetry-driven decisions can modify runtime behaviour.

**Mechanisms (current or planned):**

- **Internal:** Typed Go functions in the telemetry/loader layer accept `ControlInstruction` (or similar) structs with `Type`, `Target`, `Action`, `Parameters`. They update eBPF maps (e.g. policy hash map keyed by IP) or call Kubernetes client to create/update CRDs.
- **External:** HTTP endpoints such as `POST /api/control/policy`, `POST /api/control/redirect`, `POST /api/control/drop`, `POST /api/control/shape` decode JSON into the same control types and invoke the same internal logic.

**Effect:**

- **eBPF map updates:** Policy rules (allow/deny/rate_limit) are stored in a hash map; XDP or TC programs look up the map and drop/limit packets accordingly.
- **Kubernetes CRDs:** Redirect decisions become `CiliumLocalRedirectPolicy` objects; scaling decisions use the Scale API. Component 1 (or its control layer) provides the API; Components 2 and 3 implement the decision logic and call it.

**Data flow:** Telemetry (read) → Component 2/3/4 decision logic → control instruction → Component 1 control API → eBPF map or K8s API → kernel or control plane. This forms a **closed loop**: observe → decide → act → observe.

So Component 1 acts as the **single boundary** between “orchestration logic” and “kernel/data plane”: it both **provides** telemetry and **accepts** control, keeping eBPF and Kubernetes details inside the daemon.

---

## 4. How Other Components Connect to Component 1

All connections are **in-process**: Components 2, 3, and 4 **import** `daemon/pkg/telemetry` and use only Go types and function calls (and channels). No HTTP, no extra ports, no RPC between components.

### 4.1 Component 2 (Routing / Telemetry-Driven Redirects)

- **Import:** `github.com/.../daemon/pkg/telemetry`
- **Read:**  
  - Snapshot: `telemetry.GetPodDNSMetrics()`, `telemetry.GetPodRTTMetrics()` (and optionally `GetPodSchedLatencyMetrics()`) in the redirection engine when evaluating policies. The engine iterates over candidate backends (pods), computes combined latency (e.g. avg DNS + avg RTT per pod key), and picks the best.  
  - Optional: `collector.Subscribe()` for real-time updates; the latency router spawns a goroutine that reads from the channel and updates its routing table when metrics change.
- **Write:** Component 2 creates/updates **Cilium `LocalRedirectPolicy`** CRDs via the Kubernetes client (e.g. in `daemon/pkg/redirection/engine.go`). Control-in is the mechanism through which these decisions flow; Component 1 exposes the API that the engine or HTTP handlers use to apply redirects.

**Concrete usage:** `daemon/pkg/redirection/engine.go` calls `telemetry.GetPodDNSMetrics()`, `telemetry.GetPodRTTMetrics()`, `telemetry.GetPodSchedLatencyMetrics()` when computing backend scores. `daemon/pkg/plugins/routing/latency_router.go` uses `Subscribe()` for push-based updates.

**Example (conceptual):**

```go
// Component 2: pkg/plugins/routing/latency_router.go (or redirection engine)
package routing

import "github.com/.../daemon/pkg/telemetry"

func (r *LatencyAwareRouter) SelectBestPod(serviceName string) string {
    podDNSMetrics := telemetry.GetPodDNSMetrics()
    podRTTMetrics := telemetry.GetPodRTTMetrics()
    // ... compute combined latency per pod, return best pod key
}
```

### 4.2 Component 3 (Scaling / Runtime-Aware Autoscaling)

- **Import:** `daemon/pkg/telemetry`
- **Read:**  
  - Snapshot: `daemon/pkg/scaling/metrics.go` calls `telemetry.GetPodDNSMetrics()`, `telemetry.GetPodRTTMetrics()`, `telemetry.GetPodTCPMetrics()` and aggregates by deployment (label selector → pod keys → metric values). The controller loop (~5s) evaluates rules against these values. Node-level fallback uses `telemetry.GetDNSMetrics()`, `telemetry.GetRTTMetrics()`.  
  - Optional: `collector.Subscribe()` so the controller can react to metric changes without waiting for the next poll.
- **Write:** Scaling actions use the **Kubernetes Scale API** (update Deployment replicas). Component 1 does not perform scaling; it only provides metrics. Control-in is used when policy/redirect/drop instructions are sent through Component 1’s control API (e.g. from the dashboard).

**Concrete usage:** `daemon/pkg/scaling/metrics.go` and `daemon/pkg/scaling/controller.go`; `daemon/pkg/api/scaling.go` serves `/api/scaling/metrics/latest` which reads from the same telemetry getters.

**Example (conceptual):**

```go
// Component 3: scaling logic
package scaling

import "github.com/.../daemon/pkg/telemetry"

// In evaluation loop:
podDNS := telemetry.GetPodDNSMetrics()
podRTT := telemetry.GetPodRTTMetrics()
podTCP := telemetry.GetPodTCPMetrics()
// Aggregate by deployment, compare to thresholds, then call K8s Scale API.
```

**Optional subscription:**

```go
if collector, ok := telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS); ok {
    ch := collector.Subscribe()
    go func() { for m := range ch { /* react to update */ } }()
}
```

### 4.3 Component 4 (Federation / Node-to-Node Coordination)

- **Import:** `daemon/pkg/telemetry` when Component 4 logic runs inside the same daemon, or **HTTP** (e.g. `GET /api/metrics`) when the P2P daemon is a separate process.
- **Read:**  
  - In-process: same getters and `Subscribe()` to read local node/pod metrics before sending **METRIC_UPDATE**, **STATE_UPDATE**, **SCHEDULING**, **HANDSHAKE**, or **DISCOVERY** P2P messages to other nodes. The sender packages telemetry (or summaries) into the message payload.  
  - Cross-node: receiving nodes get P2P messages and may combine them with their local telemetry (via Component 1’s getters on that node) for federated decisions.
- **Write:** Federation coordinates state and metrics across nodes; it does not typically write into Component 1’s control API. If a node’s local logic (e.g. routing or scaling) decides to apply a policy based on remote + local telemetry, it would use the same control-in APaaI as Components 2 and 3.

**Concrete usage:** The P2P daemon (Component 4) runs as a DaemonSet; it may call the daemon’s HTTP API (`/api/metrics`, `/api/cluster/topology`) to obtain local metrics for inclusion in P2P payloads. The React dashboard’s Federation view aggregates topology and metrics from multiple nodes.

So: **connection to Component 1** = import `telemetry` + use getters and/or `Subscribe()` for in-process access; or HTTP for external/P2P processes. Optionally invoke control endpoints or internal control functions when applying policies.

---

## 5. Repository Layout and Interface Contract

### 5.1 File Structure

```
daemon/pkg/telemetry/           # Component 1 core
├── types.go                    # MetricType, Collector interface, NodeMetric, PodMetric, DNSMetricValue, RTTMetricValue
├── dns_latency_collector.go    # DNSEvent, DNSMetrics, PodDNSMetrics, ContainerDNSMetrics; GetDNSMetrics(), GetPodDNSMetrics(), GetContainerDNSMetrics(); StartDNSLatencyCollector(); DNSCollector.Subscribe()
├── rtt_collector.go            # GetRTTMetrics(), GetPodRTTMetrics(); RTTCollector
├── tcp_metrics_collector.go    # GetPodTCPMetrics(); TCPMetricsCollector
├── sched_latency_collector.go  # GetPodSchedLatencyMetrics(); SchedLatencyCollector
├── disk_io_collector.go        # GetPodDiskIOMetrics(); DiskIOCollector
├── node_system_collector.go    # Node CPU, memory, load; NodeSystemCollector
├── packet_distribution_collector.go
├── service_health_collector.go
├── nat_metadata_collector.go
├── container_mapper.go         # ContainerMapper, GetContainerForPID(); PID→cgroup→K8s container
└── ... (other collectors)

daemon/pkg/loader/              # eBPF load/attach
├── loader.go                   # LoadDNSLatencyBPF(), AttachDNSProbes(); exposes DNSObjs.Maps["dns_events"], etc.
└── bpf/*.o                     # Pre-compiled BPF objects (dns_latency.o, rtt.o, tcp_metrics.o, ...)

ebpf/component-1-daemon/        # eBPF C sources
├── dns_latency.c               # kprobe udp_sendmsg/udp_recvmsg; dns_events ring buffer
├── rtt.c                       # rtt_events
├── tcp_metrics.c               # tcp_metrics_events
├── sched_latency.c             # sched_events
├── disk_io.c                   # disk_io_events
└── ...
```

### 5.2 Collector Interface Contract

```go
type Collector interface {
    GetType() MetricType
    GetNodeMetrics() NodeMetric
    GetPodMetrics() map[string]PodMetric
    Subscribe() <-chan Metric
    Unsubscribe(ch <-chan Metric)
}
```

`MetricType` values: `dns_latency`, `rtt`, `tcp_metrics`, `node_system`, `packet_distribution`, `service_health`, `nat_metadata`. All collectors register with `telemetry.GlobalRegistry`; components look up by `MetricType` and call `Get*()` or `Subscribe()`.

Components 2, 3, and 4 live under `daemon/pkg/plugins/routing`, `daemon/pkg/redirection`, `daemon/pkg/scaling`, and the Component 4 P2P code; they **depend on** `daemon/pkg/telemetry` and do not implement their own eBPF collection.

---

## 6. Methodology Summary for Component 1

For the thesis or report, the following is a concise **methodology for Component 1**:

1. **Component 1 is the eBPF telemetry and control core.** It runs inside the same daemon process as the other components and is the only part of the system that talks to eBPF and maintains the canonical node/pod/container metrics. All internal communication uses Go imports, function calls, and channels—no HTTP between components.

2. **Kernel-to-user flow:** eBPF programs attach to kprobes/tracepoints (e.g. `udp_sendmsg`/`udp_recvmsg`, TCP hooks, sched, block I/O). They write typed events to **BPF_MAP_TYPE_RINGBUF** maps via `bpf_ringbuf_submit()`. User-space collectors open ring buffers with `ringbuf.NewReader()`, block on `Read()`, parse raw bytes into structs, resolve Kubernetes context (PID → pod via cgroup or IP → pod via K8s API), and update in-memory maps (atomic for node, mutex+atomic for pod/container). No message broker or database; events flow directly from kernel to collectors.

3. **Bi-directional interface:**  
   - **Read:** Snapshot getters (`GetDNSMetrics()`, `GetPodDNSMetrics()`, `GetPodRTTMetrics()`, `GetPodTCPMetrics()`, etc.) return copies of in-memory state; push-based subscriptions via `Subscribe()` send `PodMetric`/`NodeMetric` on buffered channels when events arrive.  
   - **Write:** Control instructions (policy, redirect, drop, shape) via internal typed functions or HTTP control endpoints; translated into eBPF map updates (policy hash map for XDP/TC) and/or Kubernetes CRDs (e.g. Cilium `LocalRedirectPolicy`). This closes the loop: telemetry → decision → control → kernel/K8s.

4. **Connection with Components 2, 3, 4:** All import `daemon/pkg/telemetry`. Component 2 (routing) and 3 (scaling) call `GetPodDNSMetrics()`, `GetPodRTTMetrics()`, etc., and optionally `Subscribe()` for real-time updates. Component 4 uses the same getters (or HTTP) when packaging metrics for P2P messages. No HTTP between Component 1 and 2/3/4; sub-millisecond access for routing and scaling decisions.

5. **External consumers:** React dashboard, Prometheus, Grafana, scripts use **HTTP API** (`/api/metrics`, `/metrics`, `/api/scaling/metrics/latest`, WebSocket). These endpoints serialize the same in-memory maps on demand. Control from outside uses the same control-in API (HTTP) that internal logic uses via function calls.

6. **Design goals:** Type-safe (Go interfaces, `Collector` contract, `Metric` types), in-process (zero network overhead), single source of truth (shared maps), low latency (atomics, RLock, non-blocking notify), and a clear boundary so that kernel programs and map layouts can evolve without changing Component 2, 3, or 4 logic.

7. **Concurrency model:** Node-level counters use `atomic.*` only. Pod/container maps use `sync.RWMutex` for structure and `atomic.*` for per-entry counters. Subscribers use buffered channels; notification is non-blocking and best-effort. Getters hold `RLock` briefly; writers hold `Lock` only for map structure changes.

8. **Collector interface:** Each collector implements `GetType()`, `GetNodeMetrics()`, `GetPodMetrics()`, `Subscribe()`, `Unsubscribe()` and registers with `telemetry.GlobalRegistry`. This enables a uniform, pluggable interface for DNS, RTT, TCP, scheduling, disk I/O, system, packet distribution, service health, NAT, and future metric types.

This document and the linked [METHODOLOGY.md](METHODOLOGY.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [METRICS.md](METRICS.md) together give a complete picture of how Component 1 works, how it provides the bi-directional interface, and how the other components connect to it.
