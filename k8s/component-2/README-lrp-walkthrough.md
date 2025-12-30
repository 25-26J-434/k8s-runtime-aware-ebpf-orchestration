# Component 2 — Telemetry-Driven Local Redirect Policy (Cilium LRP)

Step-by-step guide to redirect the frontend `service-a` to an alternate backend (default: `service-c`) when telemetry and your rule say so.

## Prerequisites
- Cluster is `ebpf-cluster` (kind) and context set.
- Cilium installed with LocalRedirectPolicy enabled; CRD exists: `kubectl get crd ciliumlocalredirectpolicies.cilium.io`.
- Test images built locally: `service-a`, `service-b`, `service-c` (see below).
- Telemetry daemon running in `ebpf-telemetry` (`ebpf-daemon` pod Ready).

## 1) Build and load test images into kind
```bash
docker build -t service-a:latest examples/service-a
docker build -t service-b:latest examples/service-b
docker build -t service-c:latest examples/service-c
docker save service-a:latest -o /tmp/service-a.tar
docker save service-b:latest -o /tmp/service-b.tar
docker save service-c:latest -o /tmp/service-c.tar
kind load image-archive --name ebpf-cluster /tmp/service-a.tar
kind load image-archive --name ebpf-cluster /tmp/service-b.tar
kind load image-archive --name ebpf-cluster /tmp/service-c.tar
```

## 2) Deploy the test stack (3 services + traffic gen)
```bash
kubectl apply -f k8s/test-services.yaml
kubectl -n test-services wait --for=condition=ready pod -l app=service-a,app=service-b,app=service-c,app=tcp-client --timeout=120s
kubectl -n test-services get pods -o wide
```

## 3) Expose telemetry API (needed by the helper)
```bash
kubectl -n ebpf-telemetry port-forward ds/ebpf-daemon 8080:8080 --address 127.0.0.1
```
Leave this running. Endpoints:
- RTT (empty in this lab): `http://127.0.0.1:8080/api/rtt/pods`
- DNS (we use this): `http://127.0.0.1:8080/api/dns/pods`


cilium install --helm-set localRedirectPolicy=true

helm upgrade --install cilium cilium/cilium \
--namespace kube-system \
--set localRedirectPolicy=true

Quick check:
```bash
kubectl -n ebpf-telemetry exec ebpf-daemon-5stch -- sh -c "wget -qO- http://127.0.0.1:8080/api/dns/pods | head"
```

## 4) Rule file (what the frontend would send)
We use the sample at `k8s/component-2/redirect-rule.example.json` (already set to DNS metric and service-c backend):
```json
{
  "policy_name": "redirect-service-a-to-c",
  "namespace": "test-services",
  "frontend_service": "service-a",
  "frontend_service_port": "5000",
  "monitor_pod_contains": "service-a",
  "metric": "dns_us",
  "violation_threshold": 1000,
  "action": "redirect",
  "redirect_backend_label": "app=service-c",
  "redirect_backend_port": "5003",
  "redirect_backend_protocol": "TCP",
  "ttl_seconds": 300,
  "choose_best_pod": true,
  "backend_candidate_label": "app=service-c",
  "redirect_winner_label": "redirect-winner=yes"
}
```
Notes:
- `metric`: use `dns_us` unless RTT is populated. RTT is empty by default in this cluster.
- Lower `violation_threshold` if you want to force a redirect (example uses 1000µs).
- To target service-b instead, set `redirect_backend_label: "app=service-b"` and `redirect_backend_port: "5001"`.
- `ttl_seconds` is required; after this many seconds, the helper deletes the LRP (and clears the winner label if used) so traffic returns to normal unless a new violation triggers a reapply.
- `choose_best_pod`: when true, the helper reads telemetry for pods matching `backend_candidate_label` (defaults to `redirect_backend_label`), picks the lowest-latency pod, labels it with `redirect_winner_label`, removes that label from the other candidates, and points the LRP at that winner label so only the chosen pod receives redirected traffic.

## 5) Apply telemetry-driven redirect
```bash
API_URL=http://127.0.0.1:8080/api/dns/pods \
./k8s/component-2/apply-local-redirect.sh ./k8s/component-2/redirect-rule.example.json
```
The helper:
- Pulls telemetry from `API_URL`.
- Computes avg metric for pods containing `monitor_pod_contains` in the rule namespace.
- If metric >= threshold and action=redirect, it creates a `CiliumLocalRedirectPolicy` (LRP) named from `policy_name`.
- If `choose_best_pod` is true, it selects the best pod (lowest metric) among the candidate backends, labels it, and targets that label in the LRP.
- A background timer deletes the LRP after `ttl_seconds`, so the redirect is temporary unless the next run sees a fresh violation.

## 6) Validate
```bash
kubectl -n test-services get ciliumlocalredirectpolicy
kubectl -n test-services describe ciliumlocalredirectpolicy redirect-service-a-to-c

# Generate client traffic and observe backend
kubectl -n test-services delete pod curl-test --force --grace-period=0

kubectl -n test-services run curl-test --rm -it --restart=Never --image=curlimages/curl -- \
  sh -c "while true; do curl -s service-a:5000; sleep 1; done"
  
  kubectl -n test-services run curl-test --restart=Never --image=curlimages/curl -- \
    sh -c 'while true; do curl -s service-a:5000/whoami; sleep 1; done'

  kubectl -n test-services logs -f curl-test
  
# In another terminal, watch the redirected backend logs
kubectl -n test-services logs -f deploy/service-c

# Quick backend identity check (who actually handled the request)
  kubectl -n test-services run id-check --rm -it --restart=Never --image=curlimages/curl -- \
    sh -c 'for i in $(seq 1 5); do curl -s service-a:5000/whoami; sleep 1; done'
# If the redirect points to service-b you'll see: 'Hi, I am service B'
# If traffic stays on service-c you'll see: 'Hi, I am service C'
```
You should see requests landing on the redirected backend (service-c by default, or service-b if you changed the rule).

## 7) Cleanup
```bash
kubectl -n test-services delete ciliumlocalredirectpolicy redirect-service-a-to-c
kubectl delete -f k8s/test-services.yaml
```

## Conclusion
You built a telemetry-aware redirection loop: collect DNS latency from the eBPF daemon, evaluate a rule (threshold/action/target), and, on violation, push a `CiliumLocalRedirectPolicy` that steers the frontend `service-a` to a safer backend (service-c by default). This shows how Component 2 consumes Component 1 telemetry to enforce in-cluster traffic redirection without touching app code.

## Troubleshooting
- **CRD errors**: Ensure `apiVersion: cilium.io/v2` is used and CRD exists (`kubectl get crd ciliumlocalredirectpolicies.cilium.io`).
- **Field validation**: In LRP `spec.redirectFrontend.serviceMatcher`, the field is `serviceName` (not `name`).
- **Telemetry missing**: If `/api/rtt/pods` is empty, use `/api/dns/pods` and set `metric: dns_us`.
- **Threshold too high**: Lower `violation_threshold` to force a redirect for testing.