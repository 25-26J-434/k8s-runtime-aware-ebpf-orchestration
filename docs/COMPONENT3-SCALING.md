# Runtime-Aware Autoscaling (Component 3 – Scaling)

This component implements automatic Kubernetes workload autoscaling driven by eBPF telemetry (for example DNS latency and RTT) instead of traditional CPU/memory metrics. Telemetry is collected by the eBPF daemon (Component 1) and consumed by the scaling controller (Component 3).

## Overview

### High-level architecture

```text
┌──────────────┐
│ Application  │   (e.g. nginx, busybox)
└──────┬───────┘
       │ network traffic
       ▼
┌────────────────────────┐
│ eBPF Telemetry Daemon  │  ← Component 1
│ (DNS, RTT, TCP metrics)│
└──────────┬─────────────┘
           │ in-memory metrics
           ▼
┌────────────────────────┐
│ Scaling Controller     │  ← Component 3
│ - Reads rules (Mongo)  │
│ - Evaluates metrics    │
│ - Calls K8s Scale API  │
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ Kubernetes Deployment  │
│ (replicas ↑ / ↓)       │
└────────────────────────┘
```

### Flow

1. The **frontend** (Scaling Rules page) creates/updates rules via the daemon REST API.
2. Rules are persisted in **MongoDB** (`rulesdb.scaling_rules` by default).
3. The daemon **scaling controller** periodically evaluates enabled rules and updates the target **Deployment** replicas in Kubernetes.
4. The UI polls deployments + latest metrics to render “Current Replicas / Latest Metric / Last Action”.

## Components

- **Controller**: `daemon/pkg/scaling/controller.go`
  - Evaluation loop: every ~5s (`scalingLoopInterval`)
  - Rule refresh: every ~10s (`rulesRefreshInterval`) + change-stream notifications (if Mongo watch is available)
  - Scaling action uses `action` + `step`, clamped by `minReplicas` / `maxReplicas`
- **Rule store (MongoDB)**: `daemon/pkg/scaling/store.go`
  - Defaults: operator `">"`, `minReplicas=1`, `maxReplicas=5`, `step=1`
- **Metric mapping**: `daemon/pkg/scaling/metrics.go`
  - Fetches pod-level metrics for the deployment selector; falls back to node-level metrics if needed
- **REST API**: `daemon/pkg/api/scaling.go` (registered in `daemon/pkg/api/api.go`)

## How autoscaling works (step-by-step)

1. An application runs inside Kubernetes and generates network activity.
2. The eBPF daemon collects metrics at kernel level.
3. The scaling controller runs continuously:
   - Fetches enabled rules from MongoDB
   - Reads the latest metric values
   - Evaluates rule conditions
4. If a rule matches, the controller updates the Kubernetes Deployment replica count.
5. The UI reflects:
   - Current replicas
   - Latest metric
   - Last scaling action

## Is this real-time?

Near real-time:

- Telemetry updates are event-driven (no Prometheus scrape delay for scaling decisions).
- The controller evaluates on a short loop (defaults to ~5 seconds) and also reacts to metric/rule-change triggers.

## Configuration

### MongoDB

Environment variables used by the daemon scaling store:

- `MONGO_URI` (default: `mongodb://mongo.rules-db.svc.cluster.local:27017`)
- `MONGO_DB` (default: `rulesdb`)
- `MONGO_COLLECTION` (default: `scaling_rules`)

### Frontend

The UI can point scaling calls at a separate base URL:

- `VITE_SCALING_API_BASE` (defaults to the same base as other API calls)

## REST API

Base port is `:8080` in the daemon.

### Rules

- `GET /api/scaling/rules` — list all rules
- `POST /api/scaling/rules` — create a rule
- `PUT /api/scaling/rules/{id}` — update a rule (including `enabled`)
- `POST /api/scaling/rules/{id}/toggle` — toggle enabled (supported by backend; UI may use PUT)
- `DELETE /api/scaling/rules/{id}` — delete a rule

### Status / telemetry helpers (UI cards)

- `GET /api/scaling/namespaces` — cluster namespaces
- `GET /api/scaling/deployments` — deployments + current replicas (optional `?namespace=...`)
- `GET /api/scaling/metrics/latest` — latest per-deployment metrics

## Rule schema

Stored in MongoDB and returned by `GET /api/scaling/rules`.

Core fields:

- `namespace` (string) — Kubernetes namespace
- `deployment` (string) — Kubernetes Deployment name
- `metric` (string) — `dns_latency` | `rtt` | `tcp_retrans`
- `operator` (string) — supports `>`, `>=`, `<`, `<=` (UI currently exposes `>` and `<`)
- `threshold` (number)
- `enabled` (boolean)
- `minReplicas` / `maxReplicas` (number)
- `action` (string) — `scale_up` | `scale_down`
- `step` (number) — how many replicas to change per action

Status fields (written by the controller after a scale action):

- `lastAction` — `scale_up` | `scale_down` | `noop`
- `lastActionAt` — UTC timestamp
- `lastValue` — metric value used for the decision (included even if `0`)
- `lastFrom` / `lastTo` — replica change information

## Metric units

- `dns_latency`: **nanoseconds** (latest DNS latency)
- `rtt`: **nanoseconds** (latest RTT)
- `tcp_retrans`: **count** (retransmissions)

If you want different units or derived signals, update the mapping in `daemon/pkg/scaling/metrics.go`.

## UI behavior (Scaling Rules page)

- Rules table lists the configured rules and enables/disables them.
- Rules can be edited inline via the Edit action (metric, operator, threshold, action, change, enabled).
- The metric cards show:
  - Current replicas (from `/api/scaling/deployments`)
  - Latest metric (from `/api/scaling/metrics/latest`, falling back to the rule’s `lastValue`)
  - Last action + timestamp (from rule status fields)
- When a rule is disabled, the cards intentionally blank to `—` to avoid showing stale “active rule” data.

## Proof of correctness (what to check)

- Replica count changes automatically:
  - `kubectl get deploy -n <namespace> <deployment> -w`
- Daemon logs show scaling decisions:
  - `kubectl logs -n ebpf-telemetry -l app=ebpf-daemon -c daemon --tail=200`
  - Look for `[Scaling]` log lines.
- UI updates:
  - “Current Replicas” changes
  - “Last Action” shows `scale_up` / `scale_down`
  - “Latest Metric” shows the current metric value used for decisions

## Real-world usage

In production:

- Rules are created/managed via the UI.
- Scaling responds to actual network conditions; no manual scaling commands are required.

## Troubleshooting

### “Latest Metric” shows `—` or `0`

- Telemetry may not have produced pod-level metrics yet for the selected deployment.
- The deployment selector may not match pods (empty or unexpected `matchLabels`).
- Check what the daemon is returning:
  - `GET /api/scaling/metrics/latest`
  - `GET /api/scaling/rules` (inspect `lastValue`, `lastAction*`)

### Scaling happens but UI doesn’t update

- The UI polls every few seconds; refresh and ensure the daemon API base is correct.
- If you run the daemon behind a different host/port, set `VITE_SCALING_API_BASE`.
