# Component 3: Runtime-Aware Autoscaling and Scheduling (Kernel Eye)

Component 3 delivers telemetry-driven autoscaling for Kubernetes workloads using eBPF network signals (DNS latency, RTT, TCP retransmissions) instead of relying only on CPU and memory. It also includes a planned scheduling layer that will place newly created pods onto the best node using node health.

## What This Component Does

### Autoscaling (implemented)
- Stores scaling rules in MongoDB
- Continuously evaluates enabled rules against the latest eBPF telemetry
- Scales Kubernetes Deployments via the Kubernetes Scale API
- UI shows current replicas, latest metric, and last action

### Scheduling (to be implemented)
Before a scale-up creates new pods, the scheduling layer will:
- Pull per-node health from Component 4 (federation)
- Combine it with Component 1 telemetry (DNS, RTT, TCP signals)
- Select the best node for new pods and bind them there

This makes scaling smarter: not just add replicas, but add replicas and place them where the network path is healthiest.

---

## High-Level Architecture

```text
Application traffic
   ↓
Component 1: eBPF Telemetry Daemon (DNS, RTT, TCP metrics)
   ↓
Component 3: Autoscaling Controller (rules + evaluation + scale)
   ↓
Kubernetes Deployment replicas ↑ / ↓
   ↓
(Planned) Component 3: Network-aware Scheduler (node scoring + binding)
   ↕
Component 4: Federation (node-to-node health sharing)
```

---

## Key Files

- `daemon/pkg/scaling/controller.go`
  - Evaluation loop: ~5s (`scalingLoopInterval`)
  - Rule refresh: ~10s (`rulesRefreshInterval`) + Mongo change-stream (if available)
  - Scaling uses `action` + `step`, clamped by `minReplicas` and `maxReplicas`
- `daemon/pkg/scaling/store.go`
  - MongoDB rule store
  - Defaults: `operator=">"`, `minReplicas=1`, `maxReplicas=5`, `step=1`
- `daemon/pkg/scaling/metrics.go`
  - Metric lookup per deployment selector
  - Falls back to node-level metrics if pod-level data is missing
- `daemon/pkg/scaling/types.go`
  - Rule schema types
- `daemon/pkg/api/scaling.go`
  - Scaling REST API handlers
- `daemon/cmd/daemon/main.go`
  - Controller startup wiring

---

## Autoscaling: How It Works

1. UI creates or updates scaling rules via the daemon REST API.
2. Rules are stored in MongoDB (default `rulesdb.scaling_rules`).
3. Controller loop:
   - Loads enabled rules
   - Reads latest metric values
   - Evaluates rule conditions
4. If a rule matches:
   - Calculates new replica count (`step`, clamped by min/max)
   - Calls Kubernetes Scale API to apply the change
   - Writes status fields back into the rule (last action, last value, last replicas)

### Near real-time behavior
- Telemetry is event-driven (no Prometheus scrape delay for scaling decisions).
- Controller evaluates every ~5 seconds and reacts to rule updates quickly.

---

## Scheduling: What Will Be Implemented

### Goal
When scaling increases replicas, Kubernetes will create new pods. The scheduling layer will ensure those pods land on the best node based on real network health.

### Inputs
- Component 1 telemetry:
  - DNS latency, RTT, retransmissions (pod-level when available, node-level fallback)
- Component 4 federation node health:
  - Node-to-node shared health signals (example: node status, network quality, peer-reported conditions)

### Planned flow
1. Scale-up triggers new pods for a target deployment.
2. Pods are configured to be scheduled by the custom scheduler (example via `schedulerName: kerneleye-scheduler`).
3. The scheduler watches Pending pods and scores nodes:
   - Filters out unhealthy nodes first (NotReady, missing peers, poor health score)
   - Ranks remaining nodes using combined telemetry + federation score
4. Scheduler binds each pod to the best node using the Kubernetes binding API.
5. Logs and UI can show:
   - Chosen node
   - Scores and key signals used in the decision

### Planned rule storage (proposal)
Scheduling will introduce a separate collection (example: `rulesdb.scheduling_rules`) to store placement logic, such as:
- Target: namespace + deployment (or a label selector)
- Weights: `dns_latency` vs `rtt` vs `tcp_retrans` vs federation health score
- Constraints: allowed nodes, excluded nodes, max pods per node
- Enable or disable scheduling per workload (safe rollout)

---

## Metrics and Units

- `dns_latency`: nanoseconds (latest DNS latency)
- `rtt`: nanoseconds (latest RTT)
- `tcp_retrans`: count (retransmissions)

To change units or add derived signals, update `daemon/pkg/scaling/metrics.go`.

---

## Configuration

### MongoDB (daemon env vars)
- `MONGO_URI` (default: `mongodb://mongo.rules-db.svc.cluster.local:27017`)
- `MONGO_DB` (default: `rulesdb`)
- `MONGO_COLLECTION` (default: `scaling_rules`)

Planned scheduling addition:
- `MONGO_SCHED_COLLECTION` (example: `scheduling_rules`)

### Frontend
The UI can point scaling calls at a separate base URL:
- `VITE_SCALING_API_BASE` (defaults to the main API base)

### Node-scoped views (Selected Node)
When Selected Node is set, the frontend passes `node=<name-or-ip>` to filter results:
- `GET /api/scaling/rules?node=<name-or-ip>`
- `GET /api/scaling/deployments?node=<name-or-ip>`
- `GET /api/scaling/namespaces?node=<name-or-ip>`
- `GET /api/scaling/metrics/latest?node=<name-or-ip>`

The backend resolves either node name or node IP and applies filtering server-side.

---

## REST API (Scaling)

Base port: `:8080`

### Rules
- `GET /api/scaling/rules`
- `POST /api/scaling/rules`
- `PUT /api/scaling/rules/{id}`
- `POST /api/scaling/rules/{id}/toggle`
- `DELETE /api/scaling/rules/{id}`

### Status and telemetry helpers (UI cards)
- `GET /api/scaling/namespaces`
- `GET /api/scaling/deployments` (optional `?namespace=...`)
- `GET /api/scaling/metrics/latest`

---

## Rule Schema (scaling_rules)

Core fields:
- `namespace` (string)
- `deployment` (string)
- `metric` (string): `dns_latency` | `rtt` | `tcp_retrans`
- `operator` (string): `>`, `>=`, `<`, `<=`
- `threshold` (number)
- `enabled` (boolean)
- `minReplicas` / `maxReplicas` (number)
- `action` (string): `scale_up` | `scale_down`
- `step` (number)

Status fields set by the controller:
- `lastAction`: `scale_up` | `scale_down` | `noop`
- `lastActionAt`: UTC timestamp
- `lastValue`: metric value used for the decision
- `lastFrom` / `lastTo`: replica change information

---

## Verification

Watch replicas change:

```bash
kubectl get deploy -n <namespace> <deployment> -w
```

Inspect daemon logs:

```bash
kubectl logs -n ebpf-telemetry -l app=ebpf-daemon -c daemon --tail=200 | grep -i "\[Scaling\]"
```

Check API responses:

```bash
curl http://localhost:8080/api/scaling/rules | jq
curl http://localhost:8080/api/scaling/metrics/latest | jq
curl http://localhost:8080/api/scaling/deployments | jq
```

---

## Troubleshooting

### Latest Metric shows "-" or "0"
- Telemetry has not produced pod-level metrics yet
- Deployment selector does not match pods (labels mismatch)
- Inspect:
  - `GET /api/scaling/metrics/latest`
  - `GET /api/scaling/rules` (check `lastValue` and `lastAction*`)

### Scaling happens but UI does not update
- UI polling delay, refresh the page
- Verify `VITE_SCALING_API_BASE` points to the correct daemon API

---

## Roadmap

### Done
- Rule-driven autoscaling using eBPF telemetry
- MongoDB rule persistence + change tracking
- UI integration (rules table + status cards)
- Node-scoped views via `?node=...`

### Next
- Finalize scheduling rule schema in MongoDB
- Implement node scoring using:
  - Component 1 telemetry (per-node and per-pod)
  - Component 4 federation health data
- Bind scale-up pods to the best node for selected workloads
- Expand validation across namespaces and real services

---

## Related Docs

- `docs/COMPONENT3-SCALING.md`
- `README.md` (Component 3 section)
