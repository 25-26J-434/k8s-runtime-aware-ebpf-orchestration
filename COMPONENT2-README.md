# Component 2 — Telemetry-Driven Local Redirects (Go Daemon)


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
