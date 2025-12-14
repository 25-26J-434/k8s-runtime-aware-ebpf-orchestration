# Component 2 – Intent-Aware Traffic Routing

This guide isolates Component 2 so you can continue building the intent-aware/same-node routing logic on top of the telemetry provided by Component 1.

## Where Component 2 Lives

```
component-2/
  README.md             # This file – high-level flow for routing work
  manifests/            # (future) Overlays specific to routing tests
  experiments/          # (future) Test plans, captures, lab notes
daemon/pkg/plugins/routing/
  latency_router.go     # Sample latency-based router using telemetry
k8s/
  kind-config.yaml      # Kind cluster config to reuse for routing work
  daemonset.yaml        # Deploys the telemetry daemon (Component 1)
  test-services.yaml    # Traffic generators/endpoints for routing tests
```

## Cluster Baseline (reuse existing Kind config)

Use the existing cluster definition in `k8s/kind-config.yaml` (name: `ebpf-cluster`). This keeps Component 2 consistent with Component 1 telemetry.

```bash
# From repo root
kind create cluster --config k8s/kind-config.yaml --name ebpf-cluster
kubectl cluster-info
```

### Using Cilium on the existing (Docker-backed) Kind cluster

Kind nodes are Docker containers, and Cilium is supported there. Install Cilium as the CNI on the same `ebpf-cluster`:

```bash
kubectl config use-context kind-ebpf-cluster
cilium install
cilium status --wait
```

If pods stay Pending, inspect why:

```bash
kubectl get nodes
kubectl get pods -n kube-system
kubectl describe pod -n kube-system -l k8s-app=cilium | sed -n '1,160p'
```

Once `cilium status` is green, all pod-to-pod traffic (including same-node) is routed via Cilium’s eBPF datapath.

## Deploy Telemetry Daemon (Component 1 prerequisite)

Component 2 reads metrics from the daemon; make sure it is running on the cluster above.

```bash
# Build and load the daemon image into the Kind cluster
docker build -t ebpf-daemon:latest daemon
kind load docker-image ebpf-daemon:latest --name ebpf-cluster

# Deploy into the cluster
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/daemonset.yaml
kubectl -n ebpf-telemetry wait --for=condition=ready pod -l app=ebpf-daemon --timeout=90s
```

## Enable the Routing Plugin

The sample router is already implemented at `daemon/pkg/plugins/routing/latency_router.go`. To run it with the daemon:

1. In `daemon/cmd/daemon/main.go`, import the routing package and start the router (see the commented block in the file).
2. Rebuild and reload the image, then redeploy the DaemonSet:

```bash
docker build -t ebpf-daemon:latest daemon
kind load docker-image ebpf-daemon:latest --name ebpf-cluster
kubectl rollout restart daemonset/ebpf-daemon -n ebpf-telemetry
```

Watch the logs to confirm the router is active:

```bash
kubectl -n ebpf-telemetry logs -l app=ebpf-daemon -f | grep "[Routing]"
```

## Traffic to Exercise Routing

Use the existing test workloads to generate pod-to-pod traffic on the same node:

```bash
kubectl apply -f k8s/test-services.yaml
kubectl get pods -o wide
```

Once traffic is flowing, the router will see live DNS/RTT metrics via direct function calls (no HTTP).

## Next Steps for Component 2

- Refine endpoint selection in `latency_router.go` (e.g., include intent tags, SLO thresholds, or same-node affinity).
- Add manifests under `component-2/manifests/` for routing-specific experiments (e.g., multiple services per node, taints/tolerations).
- Capture experiment notes under `component-2/experiments/` (commands run, metrics observed, conclusions).
- If you switch CNIs (e.g., Cilium) for eBPF data plane experiments, still keep the Kind cluster anchored to `k8s/kind-config.yaml` for consistency; adjust only the CNI install step.

## Using REST to drive routing decisions (same-node example)

Even though Component 2 is designed for in-process calls, you can pull metrics over REST and choose endpoints:

1) Port-forward the daemon API:
```bash
kubectl -n ebpf-telemetry port-forward svc/ebpf-daemon 8080:8080
```

2) Fetch per-pod DNS metrics for service-a pods (same-node in the Kind cluster):
```bash
curl -s http://localhost:8080/metrics/json \
  | jq '.dns.pods | to_entries[] | select(.key | startswith("test-services/"))'
```

3) Pick the best pod by avg latency and route traffic to its IP:
```bash
BEST=$(curl -s http://localhost:8080/metrics/json \
  | jq -r '.dns.pods
    | to_entries
    | map(select(.key|startswith("test-services/service-a")))
    | min_by(.value.avg_latency_us)
    | .key')
POD=$(echo "$BEST" | cut -d'/' -f2)
IP=$(kubectl -n test-services get pod "$POD" -o jsonpath='{.status.podIP}')
kubectl -n test-services exec deploy/service-a -- sh -c "apt-get update && apt-get install -y curl" >/dev/null 2>&1 || true
kubectl -n test-services exec deploy/service-a -- curl -s "http://$IP:5001/health"
```

Because the project’s Kind cluster (`k8s/kind-config.yaml`, `ebpf-cluster`) is single-node, all pod traffic is automatically same-node; with Cilium installed, that traffic is handled by Cilium’s eBPF datapath.
