# Metrics We Collect (Node, Pod, Container)

Exact list of metrics collected **right now** by the eBPF daemon, by level. Keys: **node** = per-node aggregates; **pod** = keyed by `namespace/podname`; **container** = keyed by `namespace/podname/containername` (when PID→container mapping succeeds).

---

## 1. DNS Latency (`dns_latency`)

| Level     | Struct / Access | Fields |
|----------|------------------|--------|
| **Node** | `GetDNSMetrics()` → `DNSMetrics` | `TotalEvents`, `TotalLatencyNs`, `LastLatencyNs`, `MaxLatencyNs`, `MinLatencyNs` |
| **Pod**  | `GetPodDNSMetrics()` → `map[string]PodDNSMetrics` | `PodName`, `Namespace`, `TotalEvents`, `TotalLatencyNs`, `LastLatencyNs`, `MaxLatencyNs`, `MinLatencyNs` |
| **Container** | `GetContainerDNSMetrics()` → `map[string]ContainerDNSMetrics` | `ContainerName`, `ContainerID`, `PodName`, `Namespace`, `TotalEvents`, `TotalLatencyNs`, `LastLatencyNs`, `MaxLatencyNs`, `MinLatencyNs` |

*(Derived: avg latency = TotalLatencyNs / TotalEvents.)*

---

## 2. TCP RTT (`rtt`)

| Level     | Struct / Access | Fields |
|----------|------------------|--------|
| **Node** | `GetRTTMetrics()` → `RTTMetrics` | `TotalEvents`, `TotalRTTNs`, `LastRTTNs`, `MaxRTTNs`, `MinRTTNs` |
| **Pod**  | `GetPodRTTMetrics()` → `map[string]PodRTTMetrics` | `PodName`, `Namespace`, `TotalEvents`, `TotalRTTNs`, `LastRTTNs`, `MaxRTTNs`, `MinRTTNs` |
| **Container** | — | RTT is **not** aggregated per container; pod-level only. |

*(Derived: avg RTT = TotalRTTNs / TotalEvents.)*

---

## 3. TCP Metrics (`tcp_metrics`)

| Level     | Struct / Access | Fields |
|----------|------------------|--------|
| **Node** | `GetTCPMetrics()` → `TCPMetrics` | `TotalEvents`, `SmoothedRTTUs`, `MinRTTUs`, `Retransmissions`, `PacketLoss`, `StateTransitions` (map), `BadHandshakes`, `LastSRTTUs`, `LastMinRTTUs`, `LastCWND`, `RecentEvents` (slice) |
| **Pod**  | `GetPodTCPMetrics()` → `map[string]PodTCPMetrics` | `PodName`, `Namespace`, `TotalEvents`, `SmoothedRTTUs`, `MinRTTUs`, `Retransmissions`, `PacketLoss`, `BadHandshakes`, `StateTransitions`, `LastSRTTUs`, `LastMinRTTUs`, `LastCWND`, `RecentEvents` |
| **Container** | `GetContainerTCPMetrics()` → `map[string]ContainerTCPMetrics` | `ContainerName`, `ContainerID`, `PodName`, `Namespace`, same TCP fields as pod |

---

## 4. Scheduling Latency (`sched_latency`)

| Level     | Struct / Access | Fields |
|----------|------------------|--------|
| **Node** | `GetSchedLatencyMetrics()` → `SchedLatencyMetrics` | `TotalEvents`, `AvgRunqueueLatencyUs`, `MaxRunqueueLatencyUs`, `MinRunqueueLatencyUs`, `P50/P95/P99RunqueueLatencyUs`, `AvgCPUTimeUs`, `CPUStarvationCount`, `LastUpdate` |
| **Pod**  | `GetPodSchedLatencyMetrics()` → `map[string]*PodSchedLatencyMetrics` | `PodKey`, `PodName`, `Namespace`, `EventCount`, `AvgRunqueueLatencyUs`, `MaxRunqueueLatencyUs`, `AvgCPUTimeUs`, `CPUStarvationCount`, `LastSeen` |
| **Container** | `GetContainerSchedLatencyMetrics()` → `map[string]*ContainerSchedLatencyMetrics` | `ContainerKey`, `ContainerName`, `PodKey`, `PodName`, `Namespace`, `EventCount`, `AvgRunqueueLatencyUs`, `MaxRunqueueLatencyUs`, `AvgCPUTimeUs`, `CPUStarvationCount`, `LastSeen` |

---

## 5. Disk I/O (`disk_io`)

| Level     | Struct / Access | Fields |
|----------|------------------|--------|
| **Node** | Disk I/O collector `GetNodeMetrics()` → `DiskIOMetrics` | `TotalReads`, `AvgReadLatencyNs`, `MaxReadLatencyNs`, `TotalReadBytes`; `TotalWrites`, `AvgWriteLatencyNs`, `MaxWriteLatencyNs`, `TotalWriteBytes`; `TotalOpens`, `TotalCloses`; `CurrentQueueDepth`, `MaxQueueDepth`, `AvgQueueDepth`; `TotalIOOperations`, `TotalIOBytes`, `AvgIOLatencyNs`; `RecentEvents` |
| **Pod**  | `GetPodDiskIOMetrics()` → `map[string]*DiskIOMetrics` | Same fields as node, per pod |
| **Container** | `GetContainerDiskIOMetrics()` → `map[string]*DiskIOMetrics` | Same fields, per container |

---

## 6. Node System (`node_system`)

| Level     | Struct / Access | Fields |
|----------|------------------|--------|
| **Node** | `NodeSystemCollector.GetNodeMetrics()` → `NodeSystemMetrics` | `CPUUsagePercent`, `MemoryTotalMB`, `MemoryUsedMB`, `MemoryFreeMB`, `MemoryUsagePercent`, `LoadAvg1min`, `LoadAvg5min`, `LoadAvg15min` |
| **Pod**  | — | **Node-level only**; no pod or container breakdown. |

---

## 7. Packet Distribution (`packet_distribution`)

| Level     | Struct / Access | Fields |
|----------|------------------|--------|
| **Node** | `GetNodeMetrics()` → `PacketDistributionMetrics` | `TotalPackets`, `PacketsByPod`, `PacketsByProtocol`, `BytesByPod` |
| **Pod**  | `GetPodMetrics()` → `PodPacketStats` | `PodName`, `Namespace`, `PacketCount`, `ByteCount`, `TCPPackets`, `UDPPackets`, `ICMPPackets` |
| **Container** | — | **Pod-level only.** |

---

## 8. Service Health (`service_health`)

| Level     | Struct / Access | Fields |
|----------|------------------|--------|
| **Node** | `GetNodeMetrics()` → `ServiceHealthMetrics` | `TotalServices`, `HealthyServices`, `UnhealthyServices`, `ServiceDetails` (name, namespace, ClusterIP, type, status, total/ready endpoints, per-endpoint health, last check) |
| **Pod**  | — | **Node/service-level only**; no per-pod metric type (endpoints are per-pod but exposed inside service details). |

---

## 9. NAT Metadata (`nat_metadata`)

| Level     | Struct / Access | Fields |
|----------|------------------|--------|
| **Node** | `GetNodeMetrics()` → `NATMetadataMetrics` | `TotalConnections`, `ActiveConnections`, `ConnectionsByPod`, `SNATTranslations`, `DNATTranslations`, `TranslationErrors` |
| **Pod**  | — | **Node-level only**; pod breakdown only via `ConnectionsByPod` map. |

---

## Summary Table

| Metric type           | Node | Pod | Container |
|-----------------------|------|-----|-----------|
| **dns_latency**       | ✓    | ✓   | ✓         |
| **rtt**               | ✓    | ✓   | —         |
| **tcp_metrics**       | ✓    | ✓   | ✓         |
| **sched_latency**     | ✓    | ✓   | ✓         |
| **disk_io**           | ✓    | ✓   | ✓         |
| **node_system**       | ✓    | —   | —         |
| **packet_distribution** | ✓  | ✓   | —         |
| **service_health**   | ✓    | —   | —         |
| **nat_metadata**      | ✓    | —   | —         |

**Container-level** metrics (DNS, TCP, sched, disk I/O) are populated only when PID→container resolution works (e.g. container mapper succeeds via cgroup + Kubernetes API). If it fails (e.g. in some Kind setups), container maps may be empty while node and pod metrics remain valid.

**API:** All of the above are exposed via `GET /api/metrics` (unified). Node/pod (and container where present) are also available from the telemetry getters used by Components 2 and 3 (e.g. `GetPodDNSMetrics()`, `GetPodRTTMetrics()`, `GetPodTCPMetrics()`, `GetPodSchedLatencyMetrics()`, `GetPodDiskIOMetrics()`).
