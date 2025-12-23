# (Legacy) Cilium weighted routing manifest (Envoy)

**Use LocalRedirectPolicy going forward.** This file is kept only for reference; the active path is described in `README-routing.md` with `CiliumLocalRedirectPolicy`.

This README explains what each part of `cilium-weighted-routing.yaml` does and how it connects to Component 1 (the eBPF telemetry daemon).

## How it ties to Component 1
- Component 1 (DaemonSet `ebpf-daemon`) exposes per-pod latency at `/api/rtt/pods` and `/api/dns/pods`.
- You read those metrics (via `kubectl -n ebpf-telemetry port-forward ds/ebpf-daemon 8080:8080`) and decide which backend is faster.
- You then set the weights in `cilium-weighted-routing.yaml` to favor the faster backend and apply it (`kubectl apply -f cilium-weighted-routing.yaml`).
- The YAML itself does not pull metrics; it is the control-plane knob you change based on Component 1’s data.

## File walkthrough: `cilium-weighted-routing.yaml`
```
apiVersion: cilium.io/v2
kind: CiliumEnvoyConfig
```
- Use the Cilium EnvoyConfig CRD to program Envoy sidecar-less at the node level.

```
metadata:
  name: service-a-intelligent
  namespace: test-services
```
- Name and namespace for the CRD object. Lives with your services in `test-services`.

```
spec:
  services:
    - name: service-a
      namespace: test-services
      ports:
        - 5000
```
- Bind this Envoy listener/config to the Kubernetes service `service-a` on port `5000`. This tells Cilium which service this config applies to.

```
  resources:
    - "@type": type.googleapis.com/envoy.config.listener.v3.Listener
      name: service-a-listener
      address:
        socket_address:
          address: 0.0.0.0
          port_value: 5000
```
- Envoy listener that accepts traffic on `0.0.0.0:5000` (the same port as `service-a`). All incoming traffic to service-a will hit this listener.

```
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                stat_prefix: ingress_http
```
- HTTP Connection Manager filter handles HTTP routing and stats for this listener.

```
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
```
- Routing rules: match all paths `/` and send traffic using weighted round-robin across two clusters.
- `weight: 70` vs `30` is the tunable knob. Change these numbers based on Component 1 telemetry (e.g., give more weight to the faster backend).

```
                http_filters:
                  - name: envoy.filters.http.router
```
- Router filter executes the route actions above.

```
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
```
- Defines an Envoy cluster pointing to the DNS name of `service-a` on port `5000`. `LOGICAL_DNS` lets Envoy resolve service endpoints via cluster DNS.

```
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
- Same for `service-b` on port `5001`. Both clusters are targets for the weighted routing defined above.

## How to use it with telemetry
1) Read latency:  
```bash
kubectl -n ebpf-telemetry port-forward ds/ebpf-daemon 8080:8080
curl -s http://127.0.0.1:8080/api/rtt/pods | jq
```
2) Choose weights based on which pod is faster (e.g., give the faster one 70 and the slower one 30).  
3) Edit `cilium-weighted-routing.yaml` weights accordingly.  
4) Apply:  
```bash
kubectl apply -f cilium-weighted-routing.yaml
```
5) Validate with an in-cluster curl loop and service logs to see the traffic split matches the weights.  
6) Repeat (tune weights) as telemetry changes.  

Remove with:  
```bash
kubectl delete -f cilium-weighted-routing.yaml
```
