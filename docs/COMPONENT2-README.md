# Component 2 — Telemetry-Driven Local Redirects (Go Daemon)

## Purpose (Theory + System View)
Component 2 is responsible for *local* service redirection on a single node. It monitors telemetry, evaluates policies, and programs a `CiliumLocalRedirectPolicy` (LRP) so traffic to a frontend service is redirected to a chosen backend on the same node. This gives fast, node-local decisions without touching the cluster control plane for each request.

Core ideas (theory):
- Intent-aware routing: policies are user-defined and continuously evaluated against live eBPF telemetry.
- Sidecarless, low-overhead design: avoids per-pod proxies and  YAML based routing only.
- Conditional redirection: traffic is rerouted **only when a policy violation is detected**; normal routing is preserved in stable conditions.
- Real-time adaptivity: decisions update with live kernel telemetry (latency, congestion, retransmissions).

At a high level:
- Input: telemetry signal (latency or error metric) plus a policy definition.
- Decision: choose a backend pod that satisfies the policy (e.g., "best_pod" by metric).
- Action: apply/expire a Cilium LRP to change local routing.

System overview (conceptual):
- Each node has a telemetry interface that feeds policy evaluation.
- Component 2 performs the decision logic and issues local redirects.
- A coordination layer can be used to exchange higher-level state.
- The kernel interface is bi-directional: telemetry in, routing actions out.

User requirements addressed:
- Functional:
  - Define user-specified, intent-based routing policies.
  - Monitor live network metrics using eBPF.
  - Redirect traffic only on policy violations.
- Non-functional:
  - Low overhead routing (sidecarless design).
  - Real-time adaptability without service restarts or YAML redeployments.

## Where This Fits Next (Node-to-Node Redirection)
The next step is *node-to-node* route redirection using **Component 4**. Component 2 handles only local (same-node) redirects. When we move to node-to-node routing, Component 4 supplies **related data about other nodes** (e.g., remote candidates and their health/telemetry), which becomes the decision input for cross-node routing.

In other words:
- Component 2: local redirects driven by local telemetry.
- Component 4: adds remote-node intelligence so redirects can target backends on *other* nodes.

Current progress (prototype context):
- Implemented pod-to-pod traffic redirection within the same node, based on eBPF telemetry and user policies.
- Integrated live kernel-level metric collection.
- Policy evaluation and conditional redirect logic validated in a Kubernetes test environment.

Next milestone:
- Extend routing across nodes to support cross-node and multi-hop redirection.
- Integrate with Component 4 / coordination to receive global health metrics and shift traffic toward healthy pods on other nodes.

## Prerequisites
- Cilium installed with LocalRedirectPolicy enabled (`kubectl api-resources | grep LocalRedirect`). If missing:
  - Helm: `helm upgrade --install cilium cilium/cilium -n kube-system --set localRedirectPolicy=true`
  - CLI: `cilium upgrade --helm-set localRedirectPolicy=true`
- Namespaces:
  - `kubectl apply -f k8s/namespace.yaml` (ebpf-telemetry)
  - `kubectl apply -f k8s/test-services.yaml` (creates `test-services` and sample services; optional but useful)
- MongoDB in-cluster:
  - `kubectl apply -f k8s/mongo.yaml`
  - Wait: `kubectl -n test-services rollout status deploy/mongodb`

## Configure the daemon to use in-cluster Mongo
Set both routing (Component 2) and scaling env vars on the DaemonSet (rolling restart will occur):
```bash
kubectl -n ebpf-telemetry set env ds/ebpf-daemon \
  ROUTING_MONGO_URI="mongodb://mongodb.test-services.svc.cluster.local:27017/kernelEye?directConnection=true" \
  ROUTING_MONGO_DB="kernelEye" \
  ROUTING_MONGO_COLLECTION="policies" \
  MONGO_URI="mongodb://mongodb.test-services.svc.cluster.local:27017/kernelEye?directConnection=true" \
  MONGO_DB="kernelEye" \
  MONGO_COLLECTION="scaling_rules"
kubectl -n ebpf-telemetry rollout status ds/ebpf-daemon
```

## Access the API
Port-forward the daemon (use a free local port, e.g., 18080):
```bash
kubectl -n ebpf-telemetry port-forward ds/ebpf-daemon 18080:8080 --address 127.0.0.1
```
Health check: `curl -s http://127.0.0.1:18080/health`

## Core endpoints
- `GET /api/policies` — list
- `POST /api/policies` — create
- `GET /api/policies/{name}` — get
- `PUT /api/policies/{name}` — update (partial)
- `POST /api/policies/{name}/evaluate` — check telemetry + apply LRP
- `POST /api/policies/{name}/expire` — delete LRP and mark expired
- `GET /api/probe/{service}` — in-cluster probe of a service `/whoami`
- `GET /api/cluster/summary` — cluster/services snapshot

## Implementation Notes (Code-Level)
This section connects the behavior to the code paths you will touch.

- Policy CRUD + evaluation lives in the daemon API layer. The `POST /api/policies/{name}/evaluate` endpoint loads the policy, evaluates telemetry, and triggers redirect actions.
- The redirect action builds and applies a `CiliumLocalRedirectPolicy` (LRP) object. On success, the redirect is active until TTL expiry or explicit `expire`.
- Backend selection strategies (e.g., `best_pod`) are based on the telemetry window defined in the policy. This is what you will extend when cross-node data is introduced.

Suggested code reading order:
1. API handlers for policy CRUD and `evaluate`.
2. Policy evaluation and telemetry fetch logic.
3. LRP construction and apply/cleanup flow.

When adding node-to-node support, expect to:
- Extend the policy evaluation to merge local telemetry with Component 4 data.
- Modify the backend selection step to allow remote-node candidates.
- Keep the LRP path for local-only scenarios; cross-node routing will likely use a different CRD or dataplane action.

## Example: create + apply a redirect
```bash
BASE=http://127.0.0.1:18080

curl -X POST "$BASE/api/policies" -H "Content-Type: application/json" -d '{
  "policy_name": "redirect-service-a-to-c",
  "namespace": "test-services",
  "frontend": {"service": "service-a", "port": 5000},
  "telemetry": {"metric": "dns_us", "violation_threshold": 1000, "monitor_pod_contains": "service-a"},
  "action": {
    "type": "redirect",
    "backend_selector": "app=service-c",
    "backend_port": 5003,
    "protocol": "TCP",
    "ttl_seconds": 300,
    "strategy": "best_pod",
    "backend_candidates_selector": "app=service-c",
    "winner_label": "redirect-winner=yes"
  }
}'

curl -X POST "$BASE/api/policies/redirect-service-a-to-c/evaluate"
```

## Verify Mongo connectivity (optional)
```bash
kubectl -n test-services port-forward svc/mongodb 27017:27017
mongosh "mongodb://127.0.0.1:27017/component2" --eval "db.runCommand({ping:1})"
```

## Notes
- The daemon applies `CiliumLocalRedirectPolicy` directly; no helper script is required.
- Ensure Cilium LRP CRD exists before evaluating policies.
- Postman collection: `Component 2.postman_collection.json` (set `BASE_URL` to your forwarded address). 
