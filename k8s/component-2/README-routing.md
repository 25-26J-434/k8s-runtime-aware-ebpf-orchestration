# Intelligent Traffic Routing with Cilium (single-node pods)

This guide shows how to use the existing eBPF telemetry DaemonSet plus Cilium/Envoy to steer traffic between `service-a` and `service-b` pods on the same node. It is terminal-first and matches the API endpoints described in `README.md`.

## Prerequisites
- Cluster running Cilium with Envoy (`cilium status` OK)
- `ebpf-telemetry/ebpf-daemon` DaemonSet running
- Services deployed in namespace `test-services`:
  - `service-a` at port `5000`
  - `service-b` at port `5001`
- `kubectl`, `jq` installed

## 0) Install the CiliumEnvoyConfig CRD (one-time)
```bash
kubectl apply -f https://raw.githubusercontent.com/cilium/cilium/v1.18.2/pkg/k8s/apis/cilium.io/client/crds/v2/ciliumenvoyconfigs.yaml
kubectl apply -f https://raw.githubusercontent.com/cilium/cilium/v1.18.2/pkg/k8s/apis/cilium.io/client/crds/v2/ciliumclusterwideenvoyconfigs.yaml

kubectl get crd | grep ciliumenvoyconfig
```

## 0.5) Define a simple “intent” policy (file-based)
Keep an intent file that encodes your thresholds and how to map them to weights. An example is provided at `k8s/component-2/intent-policy.example.json`:
```json
{
  "policy_name": "prefer-low-rtt-service-a",
  "target_service": "service-a",
  "namespace": "test-services",
  "metric": "rtt_us",
  "thresholds": {
    "prefer_below": 100000,
    "degrade_above": 150000
  },
  "backends": [
    { "name": "service-a", "weight_if_preferred": 70, "weight_if_degraded": 30 },
    { "name": "service-b", "weight_if_preferred": 30, "weight_if_degraded": 70 }
  ]
}
```
Workflow: read telemetry → compare RTT to thresholds → pick the weights → update/apply `cilium-weighted-routing.yaml`. You can script this later; for now do it manually with the steps below.

## 1) Access telemetry metrics
Port-forward the daemon API:
```bash
kubectl -n ebpf-telemetry port-forward ds/ebpf-daemon 8080:8080
```
In another terminal, get per-pod metrics:
```bash
curl -s http://127.0.0.1:8080/api/rtt/pods | jq
curl -s http://127.0.0.1:8080/api/dns/pods | jq
```
Note which backend (service-a vs service-b) shows lower latency.

## 2) Create weighted routing with Cilium Envoy
Save as `cilium-weighted-routing.yaml` (example starts with 70/30 preferring service-a). If you already have `k8s/component-2/cilium-weighted-routing.yaml`, you can reuse it:
```yaml
apiVersion: cilium.io/v2
kind: CiliumEnvoyConfig
metadata:
  name: service-a-intelligent
  namespace: test-services
spec:
  services:
    - name: service-a
      namespace: test-services
      ports:
        - 5000
  resources:
    - "@type": type.googleapis.com/envoy.config.listener.v3.Listener
      name: service-a-listener
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 5000
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: ingress_http
                route_config:
                  name: local_route
                  virtual_hosts:
                    - name: backend
                      domains: ["*"]
                      routes:
                        - match: { prefix: "/" }
                          route:
                            weighted_clusters:
                              clusters:
                                - name: service-a-cluster
                                  weight: 70
                                - name: service-b-cluster
                                  weight: 30
                http_filters:
                  - name: envoy.filters.http.router

    - "@type": type.googleapis.com/envoy.config.cluster.v3.Cluster
      name: service-a-cluster
      type: LOGICAL_DNS
      connect_timeout: 2s
      load_assignment:
        cluster_name: service-a-cluster
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: service-a.test-services.svc.cluster.local
                      port_value: 5000

    - "@type": type.googleapis.com/envoy.config.cluster.v3.Cluster
      name: service-b-cluster
      type: LOGICAL_DNS
      connect_timeout: 2s
      load_assignment:
        cluster_name: service-b-cluster
        endpoints:
          - lb_endpoints:
              - endpoint:
                  address:
                    socket_address:
                      address: service-b.test-services.svc.cluster.local
                      port_value: 5001

```
Apply it:
```bash
kubectl apply -f cilium-weighted-routing.yaml
```

## 3) Validate traffic split
Run a temporary client and send requests:
```bash
kubectl -n test-services run curl-test --rm -it --restart=Never --image=curlimages/curl -- sh
# inside the pod
while true; do curl -s http://service-a:5000; sleep 1; done
```
Watch backends to confirm distribution matches weights:
```bash
kubectl logs -n test-services -l app=service-a
kubectl logs -n test-services -l app=service-b
```

## 4) Adjust weights from telemetry
If telemetry shows `service-b` is faster, swap weights in the YAML and re-apply:
```bash
kubectl apply -f cilium-weighted-routing.yaml
```

Quick patch example (swap to 30/70 without editing file; adjust array indices if you reorder clusters):
```bash
kubectl -n test-services patch ciliumenvoyconfig service-a-intelligent \
  --type=json \
  -p='[{"op":"replace","path":"/spec/resources/0/filter_chains/0/filters/0/typed_config/route_config/virtual_hosts/0/routes/0/route/weighted_clusters/clusters/0/weight","value":30},{"op":"replace","path":"/spec/resources/0/filter_chains/0/filters/0/typed_config/route_config/virtual_hosts/0/routes/0/route/weighted_clusters/clusters/1/weight","value":70}]'
```

## 5) Simple “intent” -> weights workflow (manual)
- Define intent: e.g., “prefer latency < 100 ms; if backend exceeds 150 ms avg RTT, send it 30%.”
- Read telemetry: `/api/rtt/pods` shows per-pod RTT (Component 1 data).
- Map to weights: give the faster backend higher weight (e.g., 70) and the slower one lower (e.g., 30).
- Apply: edit weights in `cilium-weighted-routing.yaml` and `kubectl apply -f ...`.
- Validate: curl loop + logs to confirm split.
- Iterate: periodically re-check telemetry and adjust weights; automation can be added later by scripting this decision.

## 6) Automate intent -> weight patch (optional script)
You can keep intents in a JSON file and let a helper script set the weights:
```bash
# Make sure port-forward is running:
kubectl -n ebpf-telemetry port-forward ds/ebpf-daemon 8080:8080

# Run the helper (uses k8s/component-2/intent-policy.example.json by default)
./k8s/component-2/apply-intent.sh

# Or point to your own policy file:
./k8s/component-2/apply-intent.sh /path/to/policy.json
```
What it does:
- Reads thresholds + per-backend weights from the policy JSON (preferred vs degraded).
- Pulls telemetry from `/api/rtt/pods` (or `/api/dns/pods` if metric is `dns_us`).
- Picks the faster backend, maps to preferred/degraded weights, and patches the `CiliumEnvoyConfig` (assumes cluster index 0 = service-a, 1 = service-b).

## 7) Operational notes
- Update weights periodically based on `/api/rtt/pods` or `/api/dns/pods`.
- This setup is node-local and sidecar-less; routing is handled by Cilium/Envoy.
- Remove with: `kubectl delete -f cilium-weighted-routing.yaml`.
