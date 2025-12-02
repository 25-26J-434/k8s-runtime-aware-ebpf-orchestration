

### Kubernetes Runtime-Aware Orchestration via eBPF

Sidecar-Less Telemetry, Intelligent Routing, Runtime-Aware Scheduling, Multi-Cluster Coordination

---

## 1. Overview

This repository provides a modular orchestration framework for Kubernetes using eBPF as the primary mechanism for kernel-level telemetry and control. The system removes the need for sidecar proxies and replaces them with a unified node-level daemon that exposes a pluggable interface for routing, scheduling, and multi-cluster coordination.

The platform is divided into four main components:

* **Component 1** — eBPF Daemon Layer
* **Component 2** — Intelligent Routing
* **Component 3** — Runtime-Aware Scheduling
* **Component 4** — Federated Multi-Cluster Coordination

Component 1 serves as the foundation by loading and managing eBPF programs, exposing kernel metrics, and offering a control API. Components 2–4 integrate on top of it through plugins and standard APIs.

---

## 2. Repository Structure

```
k8s-runtime-aware-ebpf-orchestration/
│
├── daemon/                                # Component 1 daemon service
│   ├── cmd/daemon/                        # Daemon entrypoint
│   ├── pkg/
│   │   ├── api/                           # HTTP APIs
│   │   ├── loader/                        # eBPF loader
│   │   ├── telemetry/                     # Data collectors
│   │   ├── plugins/                       # Plugin interfaces for other components
│   │   │   ├── routing/
│   │   │   ├── scheduling/
│   │   │   └── federation/
│   │   └── util/
│   └── go.mod
│
├── ebpf/                                  # eBPF kernel programs
│   ├── common/                            # Shared structs and maps
│   ├── component-1-daemon/                # Daemon BPF programs
│   ├── component-2-routing/               # Routing BPF logic
│   ├── component-3-scheduling/            # Scheduler telemetry logic
│   └── component-4-federation/
│
├── k8s/                                   # Kubernetes manifests
│   └── daemonset.yaml
│
├── ui/                                    # Dashboards for each component
│   ├── component-1-daemon-ui/
│   ├── component-2-routing-ui/
│   ├── component-3-scheduler-ui/
│   └── component-4-federation-ui/
│
├── scripts/                               # Build and development scripts
│   ├── build-ebpf.sh
│   ├── load-ebpf.sh
│   └── dev-setup.sh
│
├── examples/                              # Test microservices
│   ├── service-a/
│   └── service-b/
│
└── docs/                                  # Component-specific documentation
    ├── architecture.md
    ├── component-1-daemon/
    ├── component-2-routing/
    ├── component-3-scheduler/
    └── component-4-federation/
```

---

## 3. Branching Strategy 

This project uses a structured Git workflow to support multi-component development.

### Primary Branches

* **main**
  Production-ready, stable code only.

* **develop**
  Integration branch where all components merge before going to main.

### Feature Branches

Each component has its own long-lived feature branch:

```
feature/component-1-daemon
feature/component-2-routing
feature/component-3-scheduler
feature/component-4-federation
feature/ui-dashboard
```

### Workflow

1. Developer checks out from `develop`
2. Creates component-specific feature branch
3. Works on code, commits, and pushes
4. Opens Pull Request → merge into `develop`
5. Once all components are stable, merge `develop` → `main`

### Commands (copy/paste)

Create a new branch:

```bash
git checkout develop
git pull
git checkout -b feature/component-1-daemon
```

Push first time:

```bash
git push -u origin feature/component-1-daemon
```

Merge into develop:

```bash
git checkout develop
git pull
git merge feature/component-1-daemon
git push
```

Merge develop → main:

```bash
git checkout main
git merge develop
git push
```

This workflow ensures:

* Component teams do not break each other
* Component 1 remains the foundational base
* Integration happens cleanly
* Main always stays stable

---

## 4. Build Instructions

### Build eBPF Programs

```bash
./scripts/build-ebpf.sh
```

### Run Daemon Locally

```bash
go run daemon/cmd/daemon/main.go
```

Expected to see:

```
Daemon started...
eBPF programs loaded...
HTTP server running at :8080
```

---

## 5. Kubernetes Deployment

Apply DaemonSet:

```bash
kubectl apply -f k8s/daemonset.yaml
```

Verify daemon pods:

```bash
kubectl get pods -A | grep ebpf
```

---

## 6. Testing Using Microservices

Start example test services:

```bash
python3 examples/service-a/app.py
python3 examples/service-b/app.py
```

Generate traffic:

```bash
curl http://localhost:5000
curl http://localhost:5001
```

---

## 7. Component Responsibilities (Summary)

### Component 1 – eBPF Daemon Layer

* Manages kernel eBPF programs
* Exposes metrics via REST
* Hosts plugin interfaces
* Coordinates routing, scheduling, federation

### Component 2 – Intelligent Routing

* Updates BPF maps for dynamic flow redirection
* Uses latency, retransmissions, and congestion

### Component 3 – Runtime-Aware Scheduling

* Provides node scoring based on kernel telemetry
* Integrates with K8s scheduler extender

### Component 4 – Federated Multi-Cluster Control

* Shares telemetry across clusters
* Coordinates decisions globally

---

## 8. Summary

This repository provides a next-generation, eBPF-based orchestration framework for Kubernetes. The system replaces sidecar proxies with a lightweight kernel-level architecture and enables advanced routing, scheduling, and multi-cluster decision making using real-time telemetry.

Component 1 forms the foundation, while Components 2–4 build specialized intelligence on top of it. The branching strategy, repository structure, and modular design support scalable development for research and production use.

---

