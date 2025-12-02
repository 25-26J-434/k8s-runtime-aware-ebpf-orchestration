# Kubernetes Runtime-Aware Orchestration via eBPF

## Introduction
This repository implements a unified, eBPF-powered orchestration framework designed to eliminate sidecar proxies and introduce a modular, kernel-level telemetry and control plane for Kubernetes clusters. The system enables real-time, network-aware decision making through four interoperable components:

1. Component 1 – eBPF Daemon Layer  
2. Component 2 – Intelligent Routing  
3. Component 3 – Runtime-Aware Scheduling  
4. Component 4 – Federated Multi-Cluster Coordination  

A single node-level daemon (Component 1) is deployed as a Kubernetes DaemonSet. It manages eBPF program loading, telemetry extraction, map updates, event handling, and enforcement operations. All other components connect to this daemon through a pluggable API surface.

---

## System Architecture Overview

### High-Level Architecture

+--------------------------------------------------------------+
| Kubernetes Cluster |
+--------------------------------------------------------------+
| Node 1 Node 2 Node N |
| +------------------+ +------------------+ +------------------+
| | eBPF DaemonSet | | eBPF DaemonSet | | eBPF DaemonSet |
| | (Component 1) | | (Component 1) | | (Component 1) |
| |------------------| |------------------| |------------------|
| | - Load eBPF | | - Load eBPF | | - Load eBPF |
| | - Export Maps | | - Export Maps | | - Export Maps |
| | - Kernel Hooks | | - Kernel Hooks | | - Kernel Hooks |
| +---------|--------+ +---------|--------+ +---------|--------+
| | Kernel Telemetry & Kernel Control |
+------------|---------------------------------------------------+
| Pluggable Interface (REST / WebSocket)
v

+--------------------------------------------------------------+
| Orchestration Modules |
+--------------------------------------------------------------+
| Component 2: Intelligent Routing Module |
| Component 3: Runtime-Aware Scheduling Module |
| Component 4: Federated Multi-Cluster Control Module |
+--------------------------------------------------------------+
^
| Daemon API Surface
+------------|--------------------------------------------------+
| UI Dashboards |
| Telemetry, Routing, Scheduling, Federation |
+--------------------------------------------------------------+


---

## Repository Structure

k8s-runtime-aware-ebpf-orchestration/
│
├── daemon/ Core Daemon (Component 1)
│ ├── cmd/daemon/ Entrypoint for daemon
│ ├── pkg/
│ │ ├── api/ REST API for modules
│ │ ├── loader/ eBPF loader logic
│ │ ├── telemetry/ Map readers and collectors
│ │ ├── plugins/ Plugin interfaces (Components 2–4)
│ │ │ ├── routing/
│ │ │ ├── scheduling/
│ │ │ └── federation/
│ │ └── util/
│ └── go.mod
│
├── ebpf/ All eBPF programs
│ ├── common/ Shared maps and structs
│ ├── component-1-daemon/
│ ├── component-2-routing/
│ ├── component-3-scheduling/
│ └── component-4-federation/
│
├── k8s/ Kubernetes deployment files
│ └── daemonset.yaml
│
├── ui/ Web dashboards
│ ├── component-1-daemon-ui/
│ ├── component-2-routing-ui/
│ ├── component-3-scheduler-ui/
│ └── component-4-federation-ui/
│
├── scripts/ Build & helper scripts
│ ├── build-ebpf.sh
│ ├── load-ebpf.sh
│ └── dev-setup.sh
│
├── examples/ Test microservices
│ ├── service-a/
│ └── service-b/
│
└── docs/ Documentation for each component
├── architecture.md
├── component-1-daemon/
├── component-2-routing/
├── component-3-scheduler/
└── component-4-federation/


---

## Branching Strategy

main Stable production-ready branch
develop Active ongoing integration branch

feature/component-1-daemon
feature/component-2-routing
feature/component-3-scheduler
feature/component-4-federation
feature/ui-dashboard


Development workflow:

1. Create feature branch  
2. Commit and push changes  
3. Merge to develop  
4. After review, merge develop → main  

---

## Building the System

### Build eBPF artifacts

```bash
./scripts/build-ebpf.sh

Run Daemon Locally

go run daemon/cmd/daemon/main.go

Deployment on Kubernetes

Apply the DaemonSet:

kubectl apply -f k8s/daemonset.yaml

Verify pods:

kubectl get pods -n kube-system -l app=ebpf-daemon

Testing with Example Microservices
Start example services

python3 examples/service-a/app.py
python3 examples/service-b/app.py

Generate traffic for telemetry

curl http://localhost:5000
curl http://localhost:5001

Access UI Dashboards

Each component's UI runs separately in the ui/ directory.
Summary

This repository provides a complete platform for sidecar-less service connectivity, runtime-aware routing, syscall-informed scheduling, and multi-cluster telemetry synchronization. Component 1 (the daemon) serves as the universal kernel-level interface, while Components 2–4 extend orchestration intelligence using data generated and exposed from the eBPF layer.

