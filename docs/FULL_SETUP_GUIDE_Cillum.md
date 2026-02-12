# Full Setup Guide: Cluster, Cilium, and How Everything Works

This guide explains everything that gets installed, what each piece does, and how they work together.

---

## Table of Contents

1. [What Gets Installed](#what-gets-installed)
2. [How the Pieces Fit Together](#how-the-pieces-fit-together)
3. [Kind: Local Kubernetes](#kind-local-kubernetes)
4. [Cilium: The CNI and Why It Matters](#cilium-the-cni-and-why-it-matters)
5. [Why Disable Default CNI?](#why-disable-default-cni)
6. [The Base Cluster Flow](#the-base-cluster-flow)
7. [Component 1: eBPF Daemon](#component-1-ebpf-daemon)
8. [Port-Forward and Frontend](#port-forward-and-frontend)
9. [Quick Reference](#quick-reference)

---

## What Gets Installed

| Component | What It Is | Where |
|-----------|------------|-------|
| **Kind** | Creates local Kubernetes clusters using Docker | `kind` CLI or `.tools/kind` |
| **Cilium CLI** | Installs and manages Cilium (no Helm required) | `cilium` CLI or `.tools/cilium` |
| **Cilium** | CNI (Container Network Interface) + eBPF networking | Runs as pods in `kube-system` |
| **ebpf-daemon** | Component 1: collects kernel telemetry via eBPF | Runs as DaemonSet in `ebpf-telemetry` |
| **CoreDNS** | DNS for the cluster (comes with Kind/K8s) | Runs in `kube-system` |
| **React frontend** | Dashboard UI | Runs on your machine via `npm run dev` |

---

## How the Pieces Fit Together

```
┌─────────────────────────────────────────────────────────────────────────┐
│ YOUR MACHINE                                                             │
│                                                                          │
│  Browser (localhost:3000)  ───►  Vite dev server  ───►  proxy to 8080   │
│         │                              │                     │           │
│         │                              └─────────────────────┼───────────┤
│         │                                                    │           │
│         │                              kubectl port-forward ◄─┘           │
│         │                                    │                           │
│         │                                    ▼                           │
│         │                         localhost:8080 (daemon API)             │
└─────────┼───────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ DOCKER (Kind runs here)                                                  │
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│  │ ebpf-cluster-   │  │ ebpf-cluster-   │  │ ebpf-cluster-   │          │
│  │ control-plane   │  │ worker          │  │ worker2         │          │
│  │                 │  │                 │  │                 │          │
│  │ • kube-apiserver│  │ • Cilium agent  │  │ • Cilium agent  │          │
│  │ • CoreDNS       │  │ • ebpf-daemon   │  │ • ebpf-daemon   │          │
│  │ • Cilium agent  │  │ • eBPF programs │  │ • eBPF programs │          │
│  │ • ebpf-daemon   │  │                 │  │                 │          │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘          │
│         ▲                      ▲                      ▲                  │
│         └──────────────────────┴──────────────────────┘                  │
│                    Cilium provides pod networking                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Flow in plain words:**

1. **Kind** creates 3 Docker containers that act as Kubernetes nodes.
2. **Cilium** runs on each node and provides networking (IPs, routing) for all pods.
3. **ebpf-daemon** runs on each node and collects kernel telemetry via eBPF.
4. **kubectl port-forward** exposes the daemon Service on `localhost:8080`.
5. **Vite** dev server proxies API calls from the frontend to `localhost:8080`.

---

## Kind: Local Kubernetes

**Cilium's official approach** (from Cilium docs):
```bash
curl -LO https://raw.githubusercontent.com/cilium/cilium/1.18.6/Documentation/installation/kind-config.yaml
kind create cluster --config=kind-config.yaml
```

Our project uses Cilium's kind-config as the base plus eBPF mounts and port mappings for Component 1. To use Cilium's vanilla config (no eBPF mounts), set `USE_CILIUM_OFFICIAL_CONFIG=1` before running `./scripts/setup-base-cluster.sh`.

**Note:** Cilium may fail with "too many open files" — increase inotify limits on the host if needed.

**What Kind does:**
- Spins up Kubernetes nodes as Docker containers
- Gives you a real cluster (API server, scheduler, etc.) on your machine
- Uses `k8s/kind-config.yaml` to configure nodes, ports, and mounts

**Our Kind config:**
- **3 nodes:** 1 control-plane + 2 workers
- **disableDefaultCNI: true** — Kind does NOT install its default CNI (kindnet). We use Cilium instead.
- **extraMounts:** `/lib/modules` and `/sys/fs/bpf` so eBPF programs can load in the kernel
- **extraPortMappings:** 30000, 30001, 8081 for NodePort / services

**Why Kind:**
- No VMs or cloud
- Fast to create and destroy
- Good for development and testing

---

## Cilium: The CNI and Why It Matters

**What Cilium is:**
- **CNI (Container Network Interface):** Provides networking for pods (IPs, routing, DNS resolution).
- **eBPF-based:** Uses eBPF in the kernel for performance and observability.
- **Extra features:** Network policies, Hubble (observability), and **LocalRedirectPolicy** (LRP).

**Why we use Cilium:**
- **Component 2 (routing)** uses **CiliumLocalRedirectPolicy** to steer traffic based on telemetry.
- Without Cilium, Component 2 cannot do traffic redirection.
- Using Cilium as the **only** CNI avoids conflicts with kindnet and CoreDNS.

**How we install Cilium:**
- **Cilium CLI** installs Cilium (no Helm required). Auto-installed to `.tools/cilium` if not in PATH.
- We preload the image into Kind so it doesn’t need to pull at runtime.
- Kind-specific settings:
  - `k8sServiceHost=ebpf-cluster-control-plane` — API server hostname
  - `k8sServicePort=6443` — API server port
  - `ipam.mode=kubernetes` — IP allocation via Kubernetes
  - `localRedirectPolicy=true` — enables Component 2

---

## Why Disable Default CNI?

**Default Kind setup:**
- Kind installs **kindnet** as the CNI.
- CoreDNS runs for DNS.

**Problem:**
- Adding Cilium on top of kindnet causes two CNIs and conflicts.
- Component 1 (daemon) + Component 2 (routing with Cilium LRP) don’t play well when both kindnet and Cilium are active.

**Our approach:**
- Set `disableDefaultCNI: true` in Kind config.
- Kind creates nodes **without** a CNI (nodes stay `NotReady`).
- We install **Cilium** as the only CNI.
- Cilium brings up networking; nodes become `Ready`; CoreDNS and all pods work.

**Result:** One clean CNI (Cilium) for all 4 components.

---

## The Base Cluster Flow

**Script:** `./scripts/setup-base-cluster.sh`

| Step | Action |
|------|--------|
| 1 | Delete existing `ebpf-cluster` (if any) |
| 2 | Create Kind cluster from `k8s/kind-config.yaml` |
| 3 | Pull and load Cilium image into Kind |
| 4 | Ensure Cilium CLI (auto-install to .tools if needed), install Cilium via `cilium install` with Kind + LRP settings |
| 5 | Wait for Cilium pods and nodes to be Ready |

**After this:** You have a 3-node cluster with Cilium as the CNI. Ready for Component 1 and the rest.

---

## Component 1: eBPF Daemon

**What it does:**
- Runs as a **DaemonSet** (one pod per node)
- Loads eBPF programs into the kernel
- Collects telemetry: DNS latency, RTT, TCP metrics, scheduling, disk I/O
- Exposes an HTTP API on port 8080

**How it’s deployed:**
- `kubectl apply -f k8s/namespace.yaml` — creates `ebpf-telemetry`
- `kubectl apply -f k8s/daemonset.yaml` — deploys the daemon

**Full rebuild (base cluster + Component 1):**
```bash
./rebuild-cluster-and-daemon.sh
```

This runs `setup-base-cluster.sh` plus building eBPF, daemon, Docker image, loading into Kind, and deploying.

---

## Port-Forward and Frontend

**Problem:** The daemon runs **inside** the cluster. Your browser cannot reach it directly.

**Solution:** `kubectl port-forward` maps `localhost:8080` to the daemon Service.

```
Browser  ──►  localhost:3000 (Vite)  ──proxy──►  localhost:8080  ──port-forward──►  daemon pods in cluster
```

**Start everything:**

```bash
# Terminal 1: Port-forward (keep running)
kubectl -n ebpf-telemetry port-forward svc/ebpf-daemon 8080:8080

# Terminal 2: Frontend
cd frontend && npm run dev
```

**Or use the watchdog** (auto-restarts port-forward if it dies):
```bash
./scripts/port-forward-watchdog.sh &
cd frontend && npm run dev
```

**If you see `ECONNREFUSED 127.0.0.1:8080`:**
- The port-forward is not running. Start it in a separate terminal and keep it open.

---

## Quick Reference

| Task | Command |
|------|---------|
| Full rebuild (cluster + Cilium + daemon) | `PATH="$(pwd)/.tools:$PATH" ./rebuild-cluster-and-daemon.sh` |
| Base cluster only (Kind + Cilium) | `PATH="$(pwd)/.tools:$PATH" ./scripts/setup-base-cluster.sh` |
| Start port-forward | `kubectl -n ebpf-telemetry port-forward svc/ebpf-daemon 8080:8080` |
| Start frontend | `cd frontend && npm run dev` |
| Check cluster | `kubectl get nodes` |
| Check Cilium | `kubectl get pods -n kube-system -l k8s-app=cilium` |
| Check daemon | `kubectl get pods -n ebpf-telemetry` |
| API health | `curl http://localhost:8080/health` |
| Dashboard | http://localhost:3000 |

---

## Summary

1. **Kind** gives you a local Kubernetes cluster in Docker.
2. **Cilium** is the CNI (and more); we use it instead of kindnet and enable LocalRedirectPolicy for Component 2.
3. **ebpf-daemon** collects kernel telemetry on each node and serves it via HTTP.
4. **Port-forward** exposes the daemon on `localhost:8080` so the frontend can talk to it.
5. **Frontend** runs on `localhost:3000` and proxies API calls to `localhost:8080`.

All four project components share the same cluster, with Cilium providing networking and the base for Component 2 traffic steering.
