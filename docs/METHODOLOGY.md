## System Methodology

This section describes the end-to-end methodology used in the runtime‑aware eBPF orchestration system, focusing on the four core components, the bi‑directional pluggable interface, and how metrics are collected and exposed at node, pod, and container granularity.

---

## 1. Overall System Architecture

The system is implemented as a **single Go daemon process** deployed as a Kubernetes DaemonSet so that one instance runs on every node. Inside this process, all four components execute as Go packages that share state via **in‑memory data structures** and **typed function calls**, rather than via HTTP between components.

The high‑level architecture is illustrated in the following diagram:

```
┌─────────────────────────────────────────────────────────────────┐
│ Single Go Binary Process                                        │
│                                                                 │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ Component 2: Intelligent Routing                          │ │
│ │ - Imports: daemon/pkg/telemetry                           │ │
│ │ - Calls: telemetry.GetPodDNSMetrics()                     │ │
│ │ - Calls: telemetry.GetPodRTTMetrics()                     │ │
│ └────────────────┬───────────────────────────────────────────┘ │
│                  │                                             │
│ ┌────────────────▼───────────────────────────────────────────┐ │
│ │ Component 3: Latency-Aware Scheduling                     │ │
│ │ - Imports: daemon/pkg/telemetry                           │ │
│ │ - Calls: telemetry.GlobalRegistry.GetNodeMetrics()        │ │
│ │ - Subscribes: telemetry.Subscribe() → realtime updates    │ │
│ └────────────────┬───────────────────────────────────────────┘ │
│                  │                                             │
│ ┌────────────────▼───────────────────────────────────────────┐ │
│ │ Component 1: eBPF Telemetry (Core)                        │ │
│ │                                                             │ │
│ │ Package: daemon/pkg/telemetry                              │ │
│ │ ┌──────────────────────────────────────────────────────┐   │ │
│ │ │ Public API (for other components):                   │   │ │
│ │ │                                                       │   │ │
│ │ │ // Get current metrics                               │   │ │
│ │ │ func GetDNSMetrics() DNSMetrics                      │   │ │
│ │ │ func GetPodDNSMetrics() map[string]PodDNSMetrics     │   │ │
│ │ │ func GetRTTMetrics() RTTMetrics                      │   │ │
│ │ │ func GetPodRTTMetrics() map[string]PodRTTMetrics    │   │ │
│ │ │                                                       │   │ │
│ │ │ // Subscribe to real-time updates                     │   │ │
│ │ │ func Subscribe() <-chan Metric                       │   │ │
│ │ │ func GlobalRegistry.Subscribe(type) <-chan Metric    │   │ │
│ │ └──────────────────────────────────────────────────────┘   │ │
│ │                                                             │ │
│ │ eBPF Kernel Data Collection (Internal)                      │ │
│ │ - StartDNSLatencyCollector() → goroutine                  │ │
│ │ - StartRTTCollector() → goroutine                          │ │
│ │ - Reads from kernel ring buffers                           │ │
│ │ - Aggregates metrics in memory                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ HTTP API Server (For External Consumers)                   │ │
│ │ - React Dashboard                                           │ │
│ │ - Prometheus/Grafana                                        │ │
│ │ - External monitoring tools                                 │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                 │
└──────────────────────────────────────────────────────────────────┘
                  │
                  ▼
        ┌──────────────────────┐
        │ Linux Kernel         │
        │ eBPF Programs        │
        └──────────────────────┘
```

This diagram illustrates several key methodological principles:

1. **Shared‑library architecture**: All components run within a single process boundary, eliminating network overhead and serialization costs for internal communication.

2. **Layered design**: Component 1 (telemetry core) sits at the foundation, providing a stable interface that Components 2, 3, and 4 consume through direct function calls or subscription channels.

3. **Separation of concerns**: The HTTP API exists only at the edge for external consumers; internal components never use HTTP to communicate with each other.

4. **Unified data source**: All components access the same in‑memory telemetry structures, ensuring consistency and eliminating the need for data synchronization protocols.

Each daemon instance plays three roles simultaneously:

- **Kernel observer**: attaches and manages eBPF programs on the local node.
- **Telemetry broker**: aggregates raw events into higher‑level metrics and makes them available via a uniform interface.
- **Control executor**: applies routing, scaling, and federation decisions locally by updating kernel maps, Kubernetes resources, or P2P peers.

At the lowest layer, eBPF programs attached in the Linux kernel capture DNS, TCP, and system‑level telemetry. Kernel events are streamed to user space over ring buffers, where they are aggregated by the **Component 1 telemetry collectors** into node‑, pod‑, and (planned) container‑level metrics. These metrics are then consumed by higher‑level decision‑making components:

- **Component 2 – Telemetry‑driven local redirects** (routing),
- **Component 3 – Runtime‑aware autoscaling**, and
- **Component 4 – Node‑to‑node federation and coordination**.

The data flow through the system follows this path:

```
Kernel (eBPF)
 ↓ Ring Buffer
Telemetry Collectors (goroutines)
 ↓ Function Calls
In-Memory Maps (sync.Map)
 ↓
 ├→ Component 2 (Direct Call) telemetry.GetPodDNSMetrics()
 ├→ Component 3 (Direct Call) telemetry.GetPodRTTMetrics() 
 ├→ Component 4 (Direct Call) telemetry.Subscribe()
 └→ HTTP API (External Only) http://localhost:8080/metrics/json
```

This flow demonstrates that:

- **Kernel events** are captured by eBPF programs and pushed to user space via ring buffers (zero‑copy where possible).
- **Collector goroutines** process events asynchronously, updating shared in‑memory maps.
- **Components 2, 3, and 4** consume metrics through direct function calls (snapshot access) or subscription channels (streaming access), with no intermediate serialization.
- **External consumers** (dashboard, monitoring tools) access metrics through the HTTP API, which serializes the in‑memory structures on demand.

An HTTP API is exposed only at the edge of the daemon to serve external consumers such as the React dashboard, monitoring tools, and experiment scripts. Internally, components communicate exclusively through Go interfaces and shared telemetry registries, which keeps latency low and avoids serialization overhead.

---

## 2. Component 1 – eBPF Telemetry and Pluggable Interface

Component 1 is responsible for **collecting**, **aggregating**, and **serving** telemetry from eBPF programs running in the Linux kernel, and for exposing this data through a stable, versioned interface to the rest of the system.

### 2.1 Kernel‑Space Instrumentation

In the kernel, multiple eBPF programs attach to different hooks:

- **DNS latency**: kprobes and tracepoints around `udp_sendmsg` / `udp_recvmsg` and DNS parsing code (`dns_latency.c`).
- **TCP RTT and retransmissions**: TCP socket hooks (`rtt.c`, `tcp_metrics.c`) that observe round‑trip times, retransmission counters, and TCP state transitions.
- **System and socket metrics**: additional programs for socket counts, node resource usage, and packet distribution.

These programs emit compact event structs to eBPF ring buffers or write to shared BPF maps. Event payloads include:

- Process information (PID, TGID),
- Socket 4‑tuple (source/destination IP and port),
- Protocol metadata,
- Timestamps and cumulative counters.

### 2.2 User‑Space Collectors and Data Structures

On the user‑space side, the Go daemon runs dedicated collector goroutines for each event stream:

- Each collector attaches to a specific ring buffer or perf buffer,
- Performs **lightweight parsing and validation**,
- Resolves Kubernetes context (node, pod, and container) using cached API data,
- Updates concurrent in‑memory maps.

Logically, collectors maintain structures such as:

- `map[nodeName]NodeMetrics`,
- `map[podKey]PodDNSMetrics` and `map[podKey]PodRTTMetrics`,
- `map[podKey]TCPTelemetry`, and (planned) `map[podKey][containerName]ContainerMetrics`.

All of these maps are protected via mutexes or lock‑free primitives and are **owned** by the telemetry package; other components never mutate them directly.

### 2.3 Telemetry‑Out Interface (Read Path)

A central `telemetry` package exposes a **read‑only view** of these structures to the rest of the daemon. The interface provides:

- Direct getters for **node‑level** metrics, e.g. `GetDNSMetrics()`, `GetRTTMetrics()`.
- Direct getters for **pod‑level** metrics, e.g. `GetPodDNSMetrics()`, `GetPodRTTMetrics()`, and mappings such as `GetPodIPMapping()`.
- Access to a `GlobalRegistry` of collectors, each implementing a standard `Collector` interface with a `Subscribe()` method that returns a receive‑only channel of metric updates.

This design supports two consumption patterns:

- **Snapshot access**: components call getters periodically when they only need the latest aggregates.
- **Streaming access**: components subscribe once and react to **push‑based updates**, which is used for low‑latency decisions.

### 2.4 Control‑In Interface (Write Path, Bi‑Directional Extension)

The same telemetry package is extended with a **control‑in** side to complete the bi‑directional interface:

- A set of Go types describe **control instructions** (e.g. policy rules, rate limits, redirect decisions).
- HTTP control endpoints (`/api/control/*`) or internal function calls accept these instructions from higher‑level components or the dashboard.
- The daemon then:
  - Encodes these instructions into **eBPF map updates** (for policy and traffic‑control programs),
  - Or materializes/updates **Kubernetes CRDs** (e.g. Cilium `LocalRedirectPolicy` objects).

This turns the telemetry layer into an **active feedback boundary**: higher‑level modules both observe runtime conditions and inject control policies that change traffic handling in real time, while keeping all low‑level details hidden inside the telemetry/loader sub‑system.

Internally this interface behaves like a **service‑like module boundary**: other components import `daemon/pkg/telemetry` and use strongly‑typed calls or subscription channels, without being aware of the underlying kernel hooks or BPF map layouts. This separation is important for the research, because it allows evolving kernel programs and data schemas without changing component logic.

---

## 3. Metrics Collection and Aggregation

### 3.1 Node‑Level Metrics

Node‑level metrics are aggregated across all workloads on a node and include:

- DNS latency distributions (event counts, min/avg/max latency),
- TCP RTT and retransmission statistics,
- General TCP health indicators (packet loss, congestion state),
- System metrics (CPU, memory, load, packet distribution, NAT metadata).

Collectors maintain **per‑node aggregates** in shared memory keyed by node name. Components that make node‑level decisions (e.g. scheduling policies or cross‑node coordination) query these maps directly or subscribe for streaming updates.

### 3.2 Pod‑Level Metrics

Pod‑level metrics are derived by correlating eBPF events with Kubernetes metadata:

1. Each kernel event includes a PID and socket metadata.
2. The daemon maps the PID and IP/port tuple to a Kubernetes pod using the Kubernetes API and in‑memory pod caches.
3. Metrics are stored in **per‑pod structures**, usually keyed as `namespace/podName`.

Per‑pod metrics include:

- DNS latency statistics,
- RTT and retransmission metrics,
- Derived “health” indicators used by routing and scaling logic.

These pod‑level values are exposed through:

- Internal APIs like `GetPodDNSMetrics()` and `GetPodRTTMetrics()` for Components 2 and 3.
- A unified HTTP metrics endpoint consumed by the React dashboard and external tools.

### 3.3 Container‑Level Metrics (Planned / Partial)

To achieve true **container‑granular** visibility, the system introduces a **PID‑to‑container mapper** in the telemetry layer:

1. eBPF events provide the PID of the process that triggered the event.
2. The daemon reads `/proc/<PID>/cgroup` to extract a container identifier (runtime‑specific ID).
3. Kubernetes API data is used to map this container ID back to a specific container inside a pod (e.g. `dns-client` pod’s `primary-dns` container).
4. Aggregators maintain **per‑container metrics** nested under each pod.

In practice, this requires handling different cgroup and runtime formats (e.g. `cri-containerd-<id>.scope`, `docker-<id>.scope`) and keeping a **pod cache** in sync with the Kubernetes API so that container IDs can be efficiently resolved. The mapper also maintains a short‑lived PID cache to avoid repeated filesystem reads for the same process.

This design allows the system to answer questions like “which container in this multi‑container pod is responsible for elevated DNS latency?”. The HTTP API returns a unified structure with:

- **Pod‑level aggregates**, and
- **Per‑container breakdowns** for each pod,

which the frontend renders as container‑level metric cards. In the evaluation, this makes it possible to attribute anomalous behaviour to a specific sidecar or main application container, rather than only to the pod as a whole.

---

## 4. Component 2 – Telemetry‑Driven Local Redirects

Component 2 implements **runtime‑aware traffic steering** using the telemetry exposed by Component 1 and Cilium’s `LocalRedirectPolicy` CRD.

### 4.1 Control Loop

1. **Policy ingestion**:
   - Policies are submitted via the daemon HTTP API (`/api/policies`) and stored in MongoDB.
   - Each policy specifies:
     - the **frontend service** (`service`, `port`),
     - the **telemetry signal** (e.g. DNS latency in microseconds, RTT, retransmissions),
     - a **violation threshold** and matching strategy (e.g. “average latency of pods with label X exceeds Y”),
     - and a **redirect action** (backend selector, backend port, TTL, strategy such as “best pod” or “fixed backend”).
2. **Telemetry evaluation**:
   - The routing module imports `telemetry` and uses direct calls such as `GetPodDNSMetrics()` and `GetPodRTTMetrics()` to compute per‑pod or per‑backend latency.
   - It can also subscribe to metric updates for near real‑time reactions when policies require faster response.
   - The evaluation step computes a **score** for each candidate backend (e.g. combined DNS + RTT) and compares it against the threshold and current winner.
3. **Action application**:
   - When telemetry indicates a violation (e.g. latency above threshold or a better backend becomes available), Component 2 materializes or updates the corresponding `CiliumLocalRedirectPolicy` pointing the frontend service to healthier backend pods.
   - These actions constitute the **control path** of the bi‑directional interface: telemetry has triggered a policy update that changes how the data plane routes requests, without the application being aware of the change.

### 4.2 Integration with the Pluggable Interface

Component 2 treats `telemetry` as a **read/write service interface**:

- **Read**: queries pod‑ and node‑level metrics using Go functions and/or subscription channels.
- **Write**: issues routing decisions that are pushed into the kernel and network stack via policy maps and Cilium CRDs.

This design keeps the routing logic **decoupled** from low‑level eBPF details while still operating at eBPF timescales.

---

## 5. Component 3 – Runtime‑Aware Autoscaling

Component 3 provides **autoscaling based on network‑level telemetry** instead of traditional CPU/memory metrics.

### 5.1 Rule‑Driven Scaling

1. **Rule specification**:
   - Users define scaling rules through the frontend or directly via the scaling REST API (`/api/scaling/rules`).
   - Each rule links a deployment to:
     - a **metric** (e.g. `dns_latency`, `rtt`, `tcp_retrans`),
     - an **operator** and **threshold** (e.g. “> 2 ms average DNS latency”),
     - bounds such as `minReplicas`, `maxReplicas`,
     - and a scaling **action** and **step size** (`scale_up` / `scale_down` by N replicas).
2. **Evaluation loop**:
   - A controller loop (≈5s interval) retrieves enabled rules from MongoDB.
   - For each rule, it uses the telemetry interface to obtain **per‑deployment metrics**, aggregating across the pods selected by the deployment’s label selector.
   - Basic hysteresis is achieved by re‑evaluating conditions on each loop and by bounding minimum and maximum replicas, which avoids extreme oscillations.
3. **Scaling action**:
   - If a rule’s condition is satisfied, the controller calls the Kubernetes Scale API to adjust the deployment’s replica count.
   - Scaling decisions (last value, last action, from/to replicas) are written back to the rule for observability and later analysis in experiments.

### 5.2 Metrics Usage

The scaling component primarily consumes:

- **Pod‑level metrics** grouped by deployment, for example:
  - average DNS latency across all pods of a service,
  - RTT or retransmission counts per deployment,
- **Node‑level metrics** as a fallback or to reason about capacity on each node.

By basing scaling decisions on **runtime network behaviour** instead of only CPU, Component 3 can:

- Scale out services when they experience sustained high network latency or retransmissions, and
- Scale in when conditions stabilize, while respecting the configured bounds.

---

## 6. Component 4 – Federation and Node‑to‑Node Coordination

Component 4 introduces a **peer‑to‑peer (P2P) communication layer** across nodes to support federated decision‑making and cluster‑wide experiments. While the architecture diagram shows Components 2 and 3 consuming telemetry directly, Component 4 operates slightly differently: it runs as a separate P2P daemon but still integrates with the telemetry daemon on each node.

### 6.1 P2P Communication Architecture

- A dedicated P2P daemon runs as a DaemonSet and establishes **logical links between nodes**, supporting broadcast, unicast, and multicast messaging.
- The React dashboard exposes a **Federation** view where operators can:
  - Visualize nodes and their status,
  - Send messages of different types (`HANDSHAKE`, `SCHEDULING`, `STATE_UPDATE`, `METRIC_UPDATE`, `DISCOVERY`) to selected nodes,
  - Observe logs and counters for all inter‑node communication.

### 6.2 Integration with Telemetry Interface

Although Component 4 runs as a separate process, it integrates with Component 1's telemetry interface through the HTTP API or by sharing the same node's telemetry data. This allows Component 4 to:

- **Read local telemetry** before sending coordination messages (e.g. include node metrics in `METRIC_UPDATE` messages),
- **Receive telemetry summaries** from other nodes via P2P messages,
- **Make federated decisions** based on cluster‑wide telemetry aggregation.

### 6.3 Methodology and Use Cases

From a methodology perspective, Component 4 is used to:

- Experiment with **distributed orchestration strategies**, where decisions made on one node (e.g. based on local telemetry) can be propagated to peers,
- Coordinate **cluster‑level state**, such as summarised metrics or scheduling hints,
- Enable **cross‑node policy coordination**, where routing or scaling decisions on one node can influence decisions on other nodes.

Because all nodes run the same telemetry daemon, each P2P message can be interpreted in the context of local node‑ and pod‑level metrics, enabling experiments with **federated, telemetry‑aware policies**. This extends the bi‑directional interface concept beyond a single node: telemetry flows both locally (within a node) and globally (across nodes), and control decisions can be coordinated cluster‑wide.

---

## 7. Bi‑Directional Pluggable Interface as a Research Abstraction

A core research contribution of this system is the design of a **bi‑directional pluggable interface** between low‑level eBPF telemetry and higher‑level orchestration logic. This interface is illustrated in the architecture diagram above, where Component 1's telemetry package serves as the central abstraction layer.

### 7.1 Downstream Path (Telemetry → Components)

The **downstream path** (read operations) flows from kernel to components:

1. **eBPF programs emit events** from kernel hooks (DNS, TCP, system calls).
2. **Component 1 collectors** aggregate events into structured node/pod/container metrics stored in shared in‑memory maps.
3. **Components 2, 3, and 4** consume these metrics via:
   - **Direct function calls** (e.g. `telemetry.GetPodDNSMetrics()`) for snapshot access,
   - **Subscription channels** (e.g. `telemetry.Subscribe()`) for push‑based streaming updates.

As shown in the architecture diagram, Components 2 and 3 import `daemon/pkg/telemetry` and call functions directly, with no HTTP or network calls involved. This design ensures **sub‑millisecond latency** for telemetry access, which is critical for real‑time routing and scaling decisions.

### 7.2 Upstream Path (Components → Kernel/Data Plane)

The **upstream path** (write operations) flows from components back to the kernel and Kubernetes control plane:

1. **Components compute decisions** based on telemetry (e.g. redirect to best pod, scale deployment, coordinate with peers).
2. **Decisions are expressed as control instructions** using typed Go structures (policy rules, rate limits, redirect actions).
3. **The daemon translates these instructions** into:
   - **eBPF map updates** (for policy enforcement programs in the kernel),
   - **Kubernetes CRD updates** (e.g. creating/updating `CiliumLocalRedirectPolicy` objects),
   - **P2P messages** (for Component 4's federated coordination).

This bi‑directional flow creates a **closed‑loop control system**: telemetry drives decisions, and decisions modify runtime behaviour, which in turn affects future telemetry. The architecture diagram shows this implicitly: Component 1's telemetry package exposes both read methods (for Components 2, 3, 4) and control methods (for policy updates), all within the same process boundary.

### 7.3 Interface Design Principles

The interface is **language‑level and type‑safe**: it is implemented as a Go package with clearly defined types, method names, and channels, making it pluggable for future components (e.g. anomaly detectors, security modules) with minimal changes. This abstraction allows the research to focus on policy design and evaluation, while reusing a common, well‑defined mechanism for data collection and enforcement.

Key design principles visible in the architecture:

- **No HTTP between components**: All internal communication uses Go function calls and channels, eliminating serialization overhead.
- **Single source of truth**: All components read from the same in‑memory maps maintained by Component 1.
- **Type safety**: Go's type system ensures compile‑time correctness of telemetry access patterns.
- **Extensibility**: New components can be added by importing `telemetry` and implementing decision logic, without modifying existing components.

---

## 8. Summary

In summary, the methodology combines:

- **Fine‑grained kernel‑level telemetry** (via eBPF),
- **Shared in‑process aggregation and APIs** (Component 1),
- **Telemetry‑driven routing** (Component 2),
- **Runtime‑aware autoscaling** (Component 3), and
- **Federated node‑to‑node coordination** (Component 4),

all tied together by a **bi‑directional pluggable interface**. Metrics are collected and exposed at node, pod, and container granularity, and are used to drive closed‑loop control decisions that are enforced back in the kernel and Kubernetes control plane.

---

## 9. Research Contributions and Technical Highlights

For the research and evaluation chapters, the following technical aspects are the primary points to highlight:

- **Bi‑directional pluggable interface between eBPF and orchestration logic**  
  - A language‑level (Go) interface that abstracts eBPF telemetry and control into typed functions and channels.  
  - Supports both **downstream telemetry** (node/pod/container metrics) and **upstream control** (policies, redirects, rate limits) in a single, consistent abstraction.

- **Single‑process shared‑library architecture for all components**  
  - Components 1–3 (and partially 4) execute within one daemon process, using in‑memory maps and function calls instead of inter‑service HTTP/RPC.  
  - This eliminates network overhead and serialization for internal decisions, enabling sub‑millisecond access to telemetry for routing and scaling.

- **Container‑level eBPF metrics (design and partial implementation)**  
  - PID‑to‑container mapping via `/proc/<pid>/cgroup` and Kubernetes API, enabling attribution of DNS/TCP behaviour to specific containers inside a pod.  
  - Provides the foundation for experiments that distinguish between main containers and sidecars when analysing performance anomalies.

- **Telemetry‑driven local routing (Component 2)**  
  - Uses live DNS/RTT metrics to decide when to redirect traffic between backends via Cilium `LocalRedirectPolicy`.  
  - Demonstrates how kernel‑level latency signals can directly influence service‑level routing without application changes.

- **Runtime‑aware autoscaling based on network metrics (Component 3)**  
  - Replaces traditional CPU/memory triggers with DNS latency, RTT, and retransmission metrics as scaling signals.  
  - Implements a rule‑based controller that reacts to eBPF telemetry and updates Kubernetes deployment replicas via the Scale API.

- **Federated, telemetry‑aware coordination across nodes (Component 4)**  
  - P2P messaging layer that allows nodes to exchange telemetry summaries and coordination messages (broadcast, unicast, multicast).  
  - Enables experiments with cluster‑wide, distributed policies that combine local telemetry with remote signals.

- **Closed‑loop control from kernel to orchestration and back**  
  - The system forms a full feedback loop: eBPF → telemetry aggregation → decision logic (routing/scaling/federation) → kernel maps / Kubernetes resources.  
  - This loop is central to the research question of how kernel‑level observability can directly inform and drive runtime orchestration.

These elements together define the **technical novelty** of the work and should be emphasized in any research write‑up, evaluation, or contributions section.

