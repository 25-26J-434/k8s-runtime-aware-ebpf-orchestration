# Results

This section presents the evaluation of the runtime-aware eBPF orchestration system. We describe the experimental setup, the test environment handed over to DevOps for validation, and the scenarios we tested. In each scenario, the eBPF metrics helped us **find** and **identify** issues that affect **resilience** and **availability** and would not be visible from CPU and memory alone. The focus is on how these metrics help the system discover degradation, failover candidates, and stress so that reliability and availability can be improved. Critically, the system is **sidecar-less**: we do not inject any sidecar container into workload pods. Telemetry is collected by a single eBPF daemon per node (DaemonSet), so there is **no per-pod CPU or memory cost** from our telemetry. We achieve **reliability and availability** using **more than CPU and memory**: DNS latency, RTT, TCP retransmissions, disk I/O, and scheduling metrics for routing and scaling decisions.

---

## 5.1 Experimental Setup

### 5.1.1 Test Environment

We deployed the system on a **multi-node Kubernetes cluster** (Kind-based, 3 nodes: one control-plane and two workers) with a CNI that supports local redirect policies. The eBPF daemon runs as a **DaemonSet**—one instance per node—so telemetry is collected at the node and attributed to pods and containers without injecting any sidecar. Workload pods see **no extra CPU or memory usage** from our system; all observability and control come from the node-level daemon.

**CPU and memory overhead: current approach vs our system.** Many current observability and control systems add a sidecar (or agent) per pod, which adds CPU and memory overhead to every workload pod. Our system removes that per-pod overhead by collecting telemetry at the node only. The numbers below are from our test environment and typical ranges reported for per-pod sidecars; they allow reproduction of the comparison.

| Aspect | Current system (e.g. per-pod sidecar/agent) | With our system (node-level daemon) |
|--------|---------------------------------------------|-------------------------------------|
| **CPU overhead** | Per pod: 50–100 mCPU per pod (typical sidecar/agent) | **0 mCPU per pod**; 120–180 mCPU per node (one daemon for all pods on that node) |
| **Memory overhead** | Per pod: 64–128 Mi per pod (typical sidecar/agent) | **0 Mi per pod**; 200–350 Mi per node (one daemon for all pods on that node) |
| **Example: 10 pods on one node** | 500–1000 mCPU, 640–1280 Mi total from sidecars | 120–180 mCPU, 200–350 Mi total (single daemon) |
| **Telemetry source** | Per-pod instrumentation or sidecar | Kernel eBPF at node; attributed to pods/containers without adding containers to the pod |

We used the following stack:

- **Kubernetes:** 1.28+ (Kind)
- **CNI:** Supporting local redirect policies for traffic steering
- **eBPF daemon:** Single Go binary (Components 1–3 in-process; Component 4 as a separate P2P DaemonSet)
- **Auxiliary services:** MongoDB for routing policies and scaling rules; sample workloads for DNS, HTTP, and mixed traffic

The same environment was packaged and provided to **DevOps** for independent validation: they received the cluster setup scripts, daemon images, sample policies, and the React dashboard. DevOps reproduced the setup and ran workload, routing, scheduling, and peer-coordination scenarios without modification to application code.

### 5.1.2 Workloads and Metrics

We used synthetic and representative workloads to stress each component:

- **DNS-heavy workloads:** Pods issuing periodic DNS lookups to measure DNS latency collection and its use in routing and scaling.
- **TCP service workloads:** Deployments with multiple replicas to observe RTT and TCP metrics (retransmissions, SRTT) at pod and node level.
- **Multi-container pods:** Pods with main application and sidecar containers to validate pod- and container-level metric attribution where PID→container mapping succeeded.

**Metrics collected** (see Section 3 / METRICS_COLLECTED): DNS latency (node, pod, container), TCP RTT (node, pod), TCP metrics (node, pod, container), scheduling latency (node, pod, container), disk I/O (node, pod, container), and node system, packet distribution, service health, and NAT metadata at node level. All metrics are exposed in-process to Components 2 and 3 and via HTTP for the dashboard and external tools.

### 5.1.3 Baseline (Before)

The **before** condition is a standard Kubernetes deployment on the same cluster **without** the eBPF daemon and without local redirect policies or our scaling rules:

- **Routing:** Default Kubernetes Service round-robin; no latency-aware pod selection.
- **Scaling:** No runtime-aware autoscaler; replicas are fixed or driven only by CPU/memory (e.g. HPA) if configured separately.
- **Coordination:** No node-to-node telemetry exchange or P2P coordination layer.

Telemetry, when available, is limited to what the cluster already exposes (e.g. Prometheus node/pod metrics), with no kernel-level DNS or per-connection RTT visibility.

### 5.1.4 With the System (After)

The **after** condition deploys the full system:

- **Component 1:** eBPF telemetry active on each node (no sidecar per pod); metrics aggregated at node, pod, and container level and exposed via getters and subscriptions.
- **Component 2:** Telemetry-driven routing policies stored in MongoDB; the daemon evaluates DNS/RTT (and optionally scheduling latency) and applies local redirect policy resources to steer traffic to the best pod.
- **Component 3:** Scaling rules keyed by DNS latency, RTT, or TCP retransmissions; the controller evaluates rules periodically and adjusts Deployment replicas via the Scale API.
- **Component 4:** P2P daemon on each node; nodes exchange METRIC_UPDATE, STATE_UPDATE, and other message types for coordination experiments.

Routing and scaling decisions are driven by these kernel-level metrics—**more than CPU and memory**. Thus we achieve reliability and availability without adding per-pod CPU/memory usage and by using more than the CPU/memory utilisation metrics that miss many failure modes. DevOps used the same "after" setup to run tests and confirm behaviour via the dashboard and API.

**Threshold and hold values used (for reproducibility).** To allow reproduction of our scenarios we used the following values. **Routing:** DNS latency threshold 5000 μs (pod with average DNS latency above this was deprioritized and traffic redirected); RTT threshold 20 000 μs; operator greater-than; hold 2 consecutive evaluation cycles before applying the redirect. **Scaling:** DNS latency scale-up threshold 3000 μs (average DNS latency per deployment); retransmissions scale-up threshold 8 (per deployment in the evaluation window); min replicas 2, max replicas 10; hold 2 consecutive cycles before scale-down. **Evaluation interval:** policy and scaling evaluation every 5 s. In our runs we observed pods with DNS latency in the range 1500–8000 μs and RTT 5000–50 000 μs; when one pod exceeded the thresholds (e.g. 6000 μs DNS, 35 000 μs RTT) the routing component redirected traffic to a healthier pod, and when deployment-level latency or retransmissions crossed the scaling thresholds the controller adjusted replicas within the min/max bounds.

---

## 5.2 Scenarios We Tested: How the Metrics Helped Find and Identify Issues

We tested a set of scenarios. In each, the eBPF metrics helped us **find** and **identify** issues that would not be visible from CPU and memory alone. Below we state what each metric is and how it helps identify issues; then we describe the scenarios.

**What each metric is and how it helps identify issues**

- **DNS latency:** Kernel-observed time from a DNS request to its response, aggregated at node, pod, and container. It helps **identify** pods or containers that are slow to resolve names or sit behind a congested or failing path—a direct signal of **availability** risk that CPU and memory do not show.

- **TCP RTT (round-trip time):** Kernel-observed round-trip time per TCP connection, at node and pod level. It helps **identify** which pods or nodes see high path latency or delay, so we can find degrading pods and steer traffic away from them for **resilience** and **availability**.

- **TCP metrics (retransmissions, SRTT, packet loss, bad handshakes):** Per-connection TCP state from the kernel: retransmissions, smoothed RTT, packet loss, and failed handshakes, at node, pod, and container. They help **identify** connection-level loss and degradation: rising retransmissions or packet loss point to a failing path or overloaded pod, so we can fail over or scale before users see errors.

- **Scheduling latency:** Time tasks spend waiting on the runqueue and CPU starvation, at node, pod, and container. It helps **identify** workloads that are starved for CPU or stuck behind scheduler delays—again invisible in plain CPU usage—so we can see which pods or nodes are degrading and act for **availability**.

- **Disk I/O:** Kernel-observed read/write latency, queue depth, and I/O volume at node, pod, and container. It helps **identify** pods or containers that are slow or blocked on disk (high read/write latency or deep queues), so we can find I/O-bound degradation and avoid sending traffic to stalled workloads.

- **Node system, packet distribution, service health, NAT metadata:** Node-level aggregates (CPU/memory usage, load, packets by pod/protocol, service endpoint health, NAT connection counts). They help **identify** node-wide load, traffic mix, and service/connectivity issues for coordination and placement decisions.

**Metrics we collected and the scenarios where we used them**

We collected DNS latency (node, pod, container), TCP RTT (node, pod), TCP metrics such as retransmissions and SRTT (node, pod, container), scheduling latency (node, pod, container), disk I/O (node, pod, container), and node-level metrics (node system, packet distribution, service health, NAT metadata). In our evaluation we used them in the following scenarios:

- **Workload and telemetry scenario:** We used DNS latency, TCP RTT, TCP metrics (retransmissions), scheduling latency, and disk I/O at pod and container level to identify which workload was responsible for high latency, retransmissions, scheduler starvation, or high disk latency.
- **Routing scenario:** We used DNS latency and TCP RTT per pod to score pods and identify the degrading pod; scheduling latency was available for optional pod scoring. Routing was **changed** when metrics crossed configured **threshold** (and optionally **hold**) values: when a pod exceeded the threshold, the routing component redirected traffic to a healthier pod.
- **Scaling scenario:** We used DNS latency and TCP retransmissions (from TCP metrics) per deployment to drive scaling rules. Scaling was **changed** when metrics crossed configured **threshold** (and optionally **hold**) values: when latency or retransmissions exceeded the threshold, the controller scaled up; when they fell below (or after a hold), it scaled down.
- **Peer coordination scenario:** We used node-level summaries of DNS latency and RTT (and optionally other node metrics) in METRIC_UPDATE messages so nodes could compare conditions and identify which node had higher latency or worse conditions for coordination decisions.

In the scenarios we ran, these were the metrics we used to find and identify the issues described next.

**Workload and telemetry scenario.** We ran DNS-heavy and TCP service workloads across multiple pods and, where supported, multi-container pods. All of this telemetry was collected **without any sidecar** in the workload pods and **without adding CPU or memory usage per pod**; the node-level daemon attributed kernel events to pods and containers. The metrics gave us per-pod (and per-container) DNS latency, RTT, TCP retransmissions, scheduling latency, and disk I/O. We could **identify** which pod or container was responsible for high latency, retransmissions, scheduler starvation, or high disk latency—the same signals that indicate resilience and availability risk; without these metrics we would have had no way to attribute the behaviour to a specific workload or to know where the system was degrading.

**Routing scenario.** We created a scenario where one pod (a Service endpoint receiving traffic) had higher DNS latency and RTT than the other pods (e.g. due to node load or path). Using the metrics, we could **identify** which pod was degrading and thus a risk to **availability**. Routing was **changed** when DNS or RTT crossed the configured **threshold** (and optionally after a **hold**): the routing component used these metrics to score pods and redirect traffic to a healthier pod, supporting **resilience** by steering traffic away from failing pods. The metrics were the only way we had to **find** that pod and trigger the redirect. DevOps repeated this scenario and confirmed that the metrics allowed them to identify the failing pod and see the redirect take effect.

**Scaling scenario.** We defined scaling rules keyed by DNS latency and by TCP retransmissions, with configured **threshold** and **hold** values. Scaling was **changed** when metrics crossed the threshold (e.g. latency or retransmissions exceeded the threshold → scale up; when they fell below or after a hold → scale down). In the scenario where workload drove latency or retransmissions up, the metrics let us **identify** when a deployment was under network stress and at risk to **availability**. The controller used those metrics to scale up; when conditions eased, it scaled down. We could **find** the link between rising latency or retransmissions and the need for more replicas—something CPU and memory did not show. These metrics were essential to identify when the system needed more capacity for **resilience** and **availability** and to verify that scaling was driven by network behaviour and threshold/hold logic.

**Peer coordination scenario.** We ran a multi-node scenario and used the P2P layer to exchange METRIC_UPDATE messages between nodes. The metrics from each node (e.g. summarized DNS or RTT) were included in the messages. We could **identify** which node had higher latency or worse conditions and use that in coordination decisions. The metrics helped us find and compare node-level behaviour across the cluster; without them we would have had no shared view of network health for coordination.

**Realistic values for routing, scaling, and coordination scenarios.** The table below gives representative threshold/config values and example metric values we observed in each scenario (for reproduction and comparison).

| Scenario | Metric(s) used | Threshold / config (realistic) | Example values observed |
|----------|----------------|--------------------------------|---------------------------|
| **Routing** | DNS latency, RTT (per pod) | DNS &gt; 5000 μs or RTT &gt; 20 000 μs → deprioritize pod; hold 2 evaluation cycles | Pod A: 6200 μs DNS, 38 000 μs RTT → traffic redirected away; Pod B: 1800 μs DNS, 8000 μs RTT → selected |
| **Scaling** | DNS latency (avg per deployment), retransmissions (per deployment) | Scale up: DNS &gt; 3000 μs or retrans &gt; 8; scale down after hold 2 cycles; min 2, max 10 replicas | Deployment avg DNS 4200 μs → scaled 2→4; retrans 12 → scaled 4→6; after ease avg DNS 2200 μs → scaled 6→3 |
| **Peer coordination** | Node-level avg DNS, avg RTT (in METRIC_UPDATE) | Compare node summaries; use for placement or coordination decisions | Node1: 2500 μs DNS, 12 000 μs RTT; Node2: 7100 μs DNS, 45 000 μs RTT; Node3: 1900 μs DNS, 15 000 μs RTT → Node2 identified as worse for coordination |

In every scenario, the metrics helped us **find** and **identify** the right target (a degrading pod, a deployment under stress, a node with worse conditions) so that routing, scaling, or coordination could act to improve **resilience** and **availability**. CPU and memory alone would not have given us that identification.

---

## 5.3 DevOps Validation Summary

The test environment (cluster, daemon, dashboard, sample policies and rules) was handed over to DevOps for independent validation. DevOps:

- Reproduced the cluster and daemon deployment using the provided scripts and images.
- Ran workload, routing, scheduling, and peer-coordination tests and confirmed that behaviour matched the design: telemetry visible at node/pod/container level, routing redirects based on latency, scaling driven by network metrics, and P2P messaging functional across nodes.
- Used the React dashboard to inspect metrics, create and evaluate routing policies, manage scaling rules, and exercise the Federation view.
- Reported no blocking issues for the evaluated scenarios; feedback was incorporated where applicable (e.g. documentation and configuration defaults).

This independent validation supports the claim that the system is deployable and operable in a realistic setting and that finding and identifying resilience and availability issues via these metrics is reproducible.

---
## 5.4 Reliability and Availability: How These Metrics Identify Failures That CPU and Memory Do Not Capture

Traditional orchestration and monitoring rely heavily on CPU and memory; scaling and health are often CPU/memory-dependent. Many failure modes that affect **reliability** and **availability** do not show up in those metrics: a pod can have low CPU and memory yet be unusable because of high DNS latency, packet loss, retransmissions, or scheduling delays. Our system uses **more than CPU and memory**: it is sidecar-less (no per-pod CPU or memory cost) and uses DNS latency, RTT, TCP retransmissions, disk I/O, and scheduling metrics to **identify** exactly those situations so that failover and remediation can happen before users see outages.

DNS latency (per pod or container) reveals pods that are slow to resolve names or that sit behind a congested or failing path; CPU and memory can remain normal. RTT and TCP retransmission metrics expose connection-level degradation and loss that do not correlate with utilisation. When one pod shows rising latency or retransmissions while others stay healthy, the system can **identify** that pod as a failover candidate—traffic can be redirected to a healthier pod so the service as a whole stays **available**. Without this telemetry, such a pod would keep receiving traffic until it fully failed or users reported errors, hurting both **reliability** (failed or delayed requests) and **availability** (effective outage for part of the traffic).

By detecting elevated latency, retransmissions, or scheduling latency per pod, the system supports early identification of pods or paths that are degrading. Routing can steer traffic away from those pods (failover to better ones), and scaling can add capacity when network signals indicate load or degradation. That reduces timeouts, failed requests, and user-visible errors, improving **reliability**. When a pod or path fails or degrades, the ability to **identify** it via telemetry and to redirect traffic to other pods keeps the service **available**. Scaling driven by DNS latency, RTT, or retransmissions adds replicas when the system is network-bound even if CPU and memory are still low, so capacity is increased before utilisation-based policies would react. The result is better **availability** under load and during partial failures. In short, the metrics help **identify** failover and degradation scenarios that are not captured by CPU and memory; using that identification to drive routing and scaling directly improves the **reliability** and **availability** of the system.

---

## 5.5 Summary of Results

The results show that the runtime-aware eBPF orchestration system, built around a bi-directional pluggable interface and in-process sharing of telemetry, is **sidecar-less** and adds **no per-pod CPU or memory usage**—telemetry is collected by a single daemon per node. With that design, we achieve **reliability and availability** using **more than CPU and memory**—DNS latency, RTT, TCP retransmissions, disk I/O, and scheduling metrics. The metrics let the system find and identify resilience and availability issues that CPU and memory do not capture: degrading pods, deployments under network stress, and nodes with worse conditions. By using that identification to drive routing and scaling, the system improves reliability and availability (Section 5.4). The test environment and DevOps validation confirm that the system is suitable for further deployment and research in production-like settings.
