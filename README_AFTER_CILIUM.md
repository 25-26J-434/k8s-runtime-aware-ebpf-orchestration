# Post-Cilium Run Guide

Use this after setting up the base cluster with Cilium to get the eBPF daemon running and port-forwarded locally.

## How to run

```bash
cd scripts
./setup-base-cluster.sh
```

## Before port-forwarding

1) Build the image locally:
```bash
docker build -t ebpf-daemon:latest -f daemon/Dockerfile daemon/
```

2) Load it into your Kind cluster (`ebpf-cluster` from `k8s/kind-config.yaml`):
```bash
kind load docker-image ebpf-daemon:latest --name ebpf-cluster
```

3) Restart the daemon pods so they pick up the loaded image:
```bash
kubectl -n ebpf-telemetry delete pod -l app=ebpf-daemon
kubectl -n ebpf-telemetry get pods -o wide
```

## Start port-forwarding

```bash
./scripts/port-forward-watchdog.sh &
```
