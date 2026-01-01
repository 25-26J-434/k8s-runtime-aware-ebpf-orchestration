# Telemetry-Driven Redirection with Cilium LocalRedirectPolicy

This replaces the earlier Envoy/CEC weight fiddling. When telemetry + your rule say “redirect,” we push a `CiliumLocalRedirectPolicy` (LRP) so traffic for the frontend Service is locally redirected to the pods you mark as the safe backend.

## Prerequisites
- Cilium running with the LocalRedirectPolicy CRD available (`kubectl api-resources | grep LocalRedirect`). If missing, reinstall/upgrade Cilium with LRP enabled:
  ```bash
  # Example (Helm install/upgrade) - adjust values.yaml as needed
  helm upgrade --install cilium cilium/cilium \
    --namespace kube-system \
    --set localRedirectPolicy=true
  ```
  After install, verify:
  ```bash
  kubectl api-resources | grep LocalRedirect
  ```
- `ebpf-telemetry/ebpf-daemon` is up and its API is reachable (port-forwarded).
- Backend pods have a label you can match (example uses `app=service-b`).

## Files in this folder
- `redirect-rule.example.json` — rule format the frontend can post later; used by the helper script now.
- `apply-local-redirect.sh` — checks telemetry + rule, and applies an LRP on violation.
- `local-redirect-policy.yaml` — static example LRP manifest (manual apply if you want).
- `k8s/test-services.yaml` — now includes `service-a`, `service-b`, and an extra backend `service-c` (port 5003) so you can test redirecting to more than one backend. Image for service-c lives at `examples/service-c/`.
- `backend/` — optional Node/Express + MongoDB API to store and retrieve redirect rules for this component.

## Quick flow (telemetry + rule -> redirect)
```bash
# 1) Port-forward telemetry API (Irushi side data)
kubectl -n ebpf-telemetry port-forward ds/ebpf-daemon 8080:8080

# 2) Build/load test images (service-a, service-b, service-c share the same cluster)
docker build -t service-a:latest examples/service-a
docker build -t service-b:latest examples/service-b
docker build -t service-c:latest examples/service-c
kind load docker-image service-a:latest --name ebpf-cluster
kind load docker-image service-b:latest --name ebpf-cluster
kind load docker-image service-c:latest --name ebpf-cluster

# 3) Deploy the test stack (service-a/b/c, traffic generator, tcp-client)
kubectl apply -f k8s/test-services.yaml

# 4) Inspect / tweak the rule
cat k8s/component-2/redirect-rule.example.json

# 5) Run the helper (uses the rule + telemetry)
./k8s/component-2/apply-local-redirect.sh
# -> If avg RTT/DNS for monitored pods crosses the threshold and action=redirect,
#    it applies a CiliumLocalRedirectPolicy that sends service-a traffic to pods
#    labeled app=service-b on port 5001 (change label/port to target service-c: app=service-c, port 5003).
#    The policy is auto-removed after the rule's TTL; if the issue resurfaces, re-run
#    the helper to re-enforce the redirect.
#    Set strategy=best_pod to have the helper pick the lowest-latency backend pod,
#    label it, and point the LRP only at that pod.
```

The rule format (what the frontend will eventually send):
```json
{
  "policy_name": "redirect-service-a-to-b",
  "namespace": "test-services",
  "frontend_service": "service-a",
  "frontend_service_port": "5000",
  "monitor_pod_contains": "service-a",
  "metric": "rtt_us",
  "violation_threshold": 150000,
  "action": "redirect",
  "redirect_backend_label": "app=service-b",
  "redirect_backend_port": "5001",
  "redirect_backend_protocol": "TCP",
  "ttl_seconds": 300,
  "strategy": "best_pod",
  "backend_candidate_label": "app=service-b",
  "redirect_winner_label": "redirect-winner=yes"
}
```
- `metric` can be `rtt_us` (default) or `dns_us`; the helper switches endpoints accordingly.
- `monitor_pod_contains` is a simple substring match on pod names within the namespace you set.
- `redirect_backend_label` is the label selector applied in the LRP `localEndpointSelector`. To redirect to the new `service-c` backend, change to `app=service-c` and set `redirect_backend_port` to `5003`.
- `ttl_seconds` defines how long the redirect stays enforced before the helper automatically deletes the LRP (and removes the winner label if `strategy=best_pod` was used). If new outliers appear after TTL expiry, rerun the helper to recreate the policy.
- `strategy` can be `all` (default) or `best_pod`; `best_pod` selects the lowest-latency pod from the candidates and applies `redirect_winner_label` to only that pod. The LRP then targets that label so just the winner receives redirected traffic. Set `backend_candidate_label` to choose which pods are evaluated (defaults to `redirect_backend_label`). `choose_best_pod` is still accepted for backward compatibility and maps to `best_pod` when true.

## Optional: rule storage backend (Express + MongoDB)
```bash
# Start MongoDB (or point MONGODB_URI to your cluster)
cd backend
cp .env.example .env   # update MONGODB_URI/PORT if needed
npm install
npm start

# Save a rule (upsert by policy_name)
curl -X POST http://localhost:4000/api/rules \
  -H "Content-Type: application/json" \
  -d @k8s/component-2/redirect-rule.example.json

# Export to a file and apply via the helper
curl -s http://localhost:4000/api/rules/by-policy/redirect-service-a-to-c/rule-file \
  -o /tmp/rule.json
./k8s/component-2/apply-local-redirect.sh /tmp/rule.json
```

## Validate
```bash
./k8s/component-2/apply-local-redirect.sh
kubectl -n test-services describe ciliumlocalredirectpolicy redirect-service-a-to-b

# curl loop from an in-cluster client and check the backend logs to confirm traffic lands on the redirected pods
kubectl -n test-services run curl-test --rm -it --restart=Never --image=curlimages/curl -- sh
```

## Manual apply (no helper)
```bash
kubectl apply -f k8s/component-2/local-redirect-policy.yaml
```
Edit `serviceMatcher`, `matchLabels`, and `toPorts` to match your frontend + safe backend before applying.

## Cleanup
```bash
kubectl -n test-services delete ciliumlocalredirectpolicy redirect-service-a-to-b
```
