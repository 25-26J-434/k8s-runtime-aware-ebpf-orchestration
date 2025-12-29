# Kubernetes Runtime-Aware eBPF Orchestration

## Architectural Optimization of Kubernetes using Sidecar-less Orchestration with Runtime-Aware Intelligent Telemetry via eBPF

**Project ID:** 25-26J-434

This project implements a sidecar-less service mesh architecture for Kubernetes using eBPF (Extended Berkeley Packet Filter) to provide runtime telemetry collection without the overhead of traditional sidecar proxies.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Kubernetes Cluster                               │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                     Orchestration Layer                            │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │  │
│  │  │  Intelligent │  │  Latency-   │  │   Multi-    │  │  React   │  │  │
│  │  │   Traffic    │  │   Aware     │  │  Cluster    │  │Dashboard │  │  │
│  │  │   Routing    │  │ Scheduling  │  │Coordination │  │   (UI)   │  │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────┬─────┘  │  │
│  │         │                │                │               │        │  │
│  │         └────────────────┴────────────────┴───────────────┘        │  │
│  │                              │                                      │  │
│  │                    ┌─────────▼─────────┐                           │  │
│  │                    │  REST API Server  │◄──── HTTP/JSON            │  │
│  │                    │  Port: 8080       │      Interface            │  │
│  │                    └─────────┬─────────┘                           │  │
│  └──────────────────────────────┼─────────────────────────────────────┘  │
│                                 │                                        │
│  ┌──────────────────────────────┼─────────────────────────────────────┐  │
│  │                     Node (DaemonSet)                                │  │
│  │                              │                                      │  │
│  │  ┌───────────────────────────▼───────────────────────────────────┐ │  │
│  │  │                    eBPF Daemon (Go)                           │ │  │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │ │  │
│  │  │  │    DNS      │ │    RTT      │ │  Metrics    │             │ │  │
│  │  │  │  Collector  │ │  Collector  │ │ Aggregator  │             │ │  │
│  │  │  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘             │ │  │
│  │  └─────────┼───────────────┼───────────────┼─────────────────────┘ │  │
│  │            │               │               │                       │  │
│  │            │    Ring Buffer Read (continuous)                      │  │
│  │            └───────────────┴───────────────┘                       │  │
│  │                            │                                        │  │
│  │  ┌─────────────────────────▼───────────────────────────────────┐   │  │
│  │  │                    Linux Kernel                              │   │  │
│  │  │                                                              │   │  │
│  │  │  eBPF Programs (C) - Attached to Kernel Functions           │   │  │
│  │  │  ┌─────────────────┐ ┌─────────────────┐                    │   │  │
│  │  │  │ kprobe/         │ │ kprobe/         │                    │   │  │
│  │  │  │ udp_sendmsg     │ │ udp_recvmsg     │                    │   │  │
│  │  │  │ (DNS Request)   │ │ (DNS Response)  │                    │   │  │
│  │  │  └────────┬────────┘ └────────┬────────┘                    │   │  │
│  │  │           │                   │                              │   │  │
│  │  │           │  Timestamp (ns)   │  Timestamp (ns)              │   │  │
│  │  │           │  Calculate Δt = Response - Request               │   │  │
│  │  │           └───────────────────┘                              │   │  │
│  │  │                     │                                        │   │  │
│  │  │           ┌─────────▼─────────┐                              │   │  │
│  │  │           │   Ring Buffer     │                              │   │  │
│  │  │           │   (dns_events)    │                              │   │  │
│  │  │           │  - latency_ns     │                              │   │  │
│  │  │           │  - timestamp_ns   │                              │   │  │
│  │  │           │  - source_ip      │                              │   │  │
│  │  │           │  - pid            │                              │   │  │
│  │  │           └───────────────────┘                              │   │  │
│  │  └──────────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## How It Works: eBPF Data Collection Pipeline

### 1. **Kernel-Level Instrumentation** (Zero Application Changes)

The system uses **eBPF (Extended Berkeley Packet Filter)** to instrument the Linux kernel at runtime:

```c
// ebpf/component-1-daemon/dns_latency.c

SEC("kprobe/udp_sendmsg")  // ← Attach to kernel function
int dns_start_probe(struct sock *sk) {
    u64 timestamp = bpf_ktime_get_ns();  // ← Nanosecond precision
    // Store start time
}

SEC("kprobe/udp_recvmsg")  // ← Attach to kernel function
int dns_end_probe(struct sock *sk) {
    u64 latency = end_time - start_time;  // ← Calculate in kernel
    bpf_ringbuf_submit(event);            // ← Send to userspace
}
```

**Key Points:**
- Runs **directly in the Linux kernel** (not userspace)
- **Zero overhead** - no sidecar containers
- Captures **real network latency** from kernel network stack
- Works for **all pods** without modification

### 2. **Userspace Collection** (Go Daemon)

The Go daemon reads events from the eBPF ring buffer:

```go
// daemon/pkg/telemetry/dns_latency_collector.go

func StartDNSLatencyCollector() {
    rd, _ := ringbuf.NewReader(rbMap)  // ← Read from kernel
    
    for {
        record, _ := rd.Read()  // ← Blocking read
        event := parseDNSEvent(record.RawSample)
        
        // Aggregate metrics
        updateMetrics(event.LatencyNs)      // Node-level
        updatePodMetrics(event.SourceIP)    // Pod-level
    }
}
```

**Data Enrichment:**
- Maps pod **IP addresses → Pod names** via Kubernetes API
- Aggregates metrics per pod and node
- Calculates min/max/avg statistics

### 3. **REST API Exposure** (HTTP/JSON)

Metrics are exposed via RESTful API for other components:

```go
// daemon/pkg/api/api.go

GET /metrics/json              // Node + Pod metrics
GET /api/dns/pods              // Per-pod DNS metrics
GET /api/cluster/topology      // Cluster structure
GET /metrics                   // Prometheus format
```

**Example Response:**
```json
{
  "dns": {
    "total_events": 1523,
    "avg_latency_us": 245.32,
    "pods": {
      "default/web-app": {
        "total_events": 842,
        "avg_latency_us": 198.45
      }
    }
  }
}
```

### 4. **Frontend Visualization** (React Dashboard)

Real-time dashboard consumes the API:

```typescript
// Polls API every 3 seconds
const { metrics } = useMetrics(3000);

// Displays:
- Node-level DNS latency graphs
- Per-pod DNS latency charts
- Real-time metrics updates
- Cluster topology information
```

## Components

### Component 1: eBPF Daemon Layer (This Repository) **IMPLEMENTED**
- **Purpose:** Sidecar-less telemetry collection
- **Technology:** eBPF (C) + Go + Kubernetes DaemonSet
- **Features:**
  - DNS latency measurement via kprobe on `udp_sendmsg`/`udp_recvmsg`
  - TCP RTT measurement via kprobe on `tcp_connect`/`tcp_finish_connect`
  - Per-pod and node-level metrics aggregation
  - REST API (JSON + Prometheus formats)
  - Kubernetes API integration for pod discovery
  - React dashboard with real-time graphs

### Component 2: Intelligent Traffic Routing (Planned)
- Dynamic traffic routing based on real-time telemetry
- When a rule says **redirect** (e.g., high latency), apply a Cilium `CiliumLocalRedirectPolicy` to steer the frontend Service to a safe backend; see `k8s/component-2/README-routing.md` + `apply-local-redirect.sh`. Ensure Cilium is installed with `--set localRedirectPolicy=true` (Helm) so the CRD exists.

### Component 3: Latency-Aware Scheduling (Planned)
- Pod scheduling decisions based on network performance metrics

### Component 4: Node-to-Node Communication (Demo Included)
- Peer-to-peer daemon for BROADCAST/UNICAST/MULTICAST control messages
- Lives in `component-4-node-communication/` with its own Makefile
- Dashboard is optional; default build deploys daemon only

## Node-to-Node Communication Quickstart (Component 4)

1. `make kind-setup` — brings up a 3-node kind cluster using `k8s/kind-config.yaml` (host networking + eBPF mounts).
2. `make node-comm-docker` — builds the P2P daemon image (`p2p-node:v3`).
3. `make node-comm-deploy` — applies `peers-configmap.yaml` and the DaemonSet from `component-4-node-communication/` to `kube-system`.
4. `make node-comm-logs` — follow logs; send test POSTs to `/broadcast`, `/unicast`, or `/multicast` on port 8080 of any node IP.

Notes:
- Update `component-4-node-communication/peers-configmap.yaml` if your node IPs differ (defaults match a 3-node kind network: 172.18.0.2/3/4).
- The dashboard in `component-4-node-communication/client` is optional and not built by default; use `make -C component-4-node-communication build-dashboard` if you need it later.

## Prerequisites

### System Requirements
- Linux kernel ≥ 5.4 with BTF support
- Kubernetes v1.25+
- Root/sudo access for eBPF operations

### Required Tools
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y \
    clang \
    llvm \
    libbpf-dev \
    linux-tools-$(uname -r) \
    linux-headers-$(uname -r) \
    golang-go \
    make \
    docker.io

# Verify kernel BTF support
ls /sys/kernel/btf/vmlinux
```

## Quick Start Guide

### Complete Setup (Recommended for Testing)

This guide will set up a complete environment with Kind cluster, eBPF daemon, sample services, and React dashboard.

### Step 1: Install Prerequisites

```bash
# Install Docker (if not already installed)
sudo apt update
sudo apt install -y docker.io
sudo usermod -aG docker $USER  # Add yourself to docker group
newgrp docker  # Activate group

# Install Kind
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.20.0/kind-linux-amd64
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind

# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/

# Install Node.js and npm (for React dashboard)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installations
kind version
kubectl version --client
docker --version
node --version
npm --version
```

### Step 2: Create Kind Cluster

```bash
cd k8s-runtime-aware-ebpf-orchestration

# Create Kind cluster with eBPF support
kind create cluster --name ebpf-cluster --config k8s/kind-config.yaml

# Verify cluster is ready
kubectl get nodes
kubectl cluster-info
```

**What this creates:**
- Single-node Kubernetes cluster (control-plane + worker)
- Cluster name: `ebpf-cluster`
- Node with eBPF capabilities
- Port mappings for services
- Optimized for stable, reliable setup

### Step 3: Build and Deploy eBPF Daemon

```bash
# Build eBPF programs
cd ebpf/component-1-daemon
clang -O2 -g -target bpf -D__TARGET_ARCH_x86 -c dns_latency.c -o dns_latency.o
cd ../..

# Build Go daemon
cd daemon
go build -o ebpf-daemon ./cmd/daemon
cd ..

# Build Docker image
docker build -t ebpf-daemon:latest daemon/

# Load image into Kind cluster
kind load docker-image ebpf-daemon:latest --name ebpf-cluster

# Deploy to Kubernetes
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/daemonset.yaml

# Wait for daemon to be ready
kubectl -n ebpf-telemetry wait --for=condition=ready pod -l app=ebpf-daemon --timeout=60s

# Check daemon status
kubectl get pods -n ebpf-telemetry
kubectl logs -n ebpf-telemetry -l app=ebpf-daemon --tail=20
```

**Expected Output:**
```
NAME                READY   STATUS    RESTARTS   AGE
ebpf-daemon-xxxxx   1/1     Running   0          30s
```

### Step 4: Deploy Sample Services (DNS Traffic Generators)

The sample services continuously generate DNS queries to test the monitoring system.

```bash
# Deploy test pods
kubectl apply -f k8s/simple-test-pods.yaml

# Wait for pods to be ready
kubectl -n dns-test wait --for=condition=ready pod --all --timeout=60s

# Check pod status
kubectl get pods -n dns-test

# View pod logs to see DNS queries
kubectl logs -n dns-test pod-a --tail=10
kubectl logs -n dns-test pod-b --tail=10
kubectl logs -n dns-test pod-c --tail=10
```

**What these pods do:**
- `pod-a`: Queries `kubernetes.default.svc.cluster.local` every 2 seconds
- `pod-b`: Queries `pod-a.dns-test.svc.cluster.local` every 3 seconds  
- `pod-c`: Queries `kube-dns.kube-system.svc.cluster.local` every 4 seconds

**Expected Output:**
```
NAME    READY   STATUS    RESTARTS   AGE
pod-a   1/1     Running   0          30s
pod-b   1/1     Running   0          30s
pod-c   1/1     Running   0          30s
```

### Step 5: Set Up Port Forwarding

```bash
# Terminal 1: Port forward the eBPF daemon API
kubectl port-forward -n ebpf-telemetry svc/ebpf-daemon 8080:8080
```

Keep this terminal open. The API is now accessible at `http://localhost:8080`.

### Step 6: Start React Dashboard

```bash
# Terminal 2: Start the React dashboard
cd frontend

# Install dependencies (first time only)
npm install

# Start development server
npm run dev
```

**Dashboard will be available at:** `http://localhost:5000`

### Step 7: Deploy Node-to-Node Communication (Component 4 - Optional)

This component enables peer-to-peer communication. It works with single-node clusters for demos and scales to multi-node setups.

```bash
# Build and deploy the P2P daemon
cd component-4-node-communication

# Build the P2P daemon Docker image
docker build -t p2p-node:v3 .

# Load image into Kind cluster
kind load docker-image p2p-node:v3 --name ebpf-cluster

# Deploy the P2P daemon
kubectl apply -f peers-configmap.yaml
kubectl apply -f daemonset.yaml

# Verify deployment
kubectl get pods -n kube-system -l app=p2p-node -o wide
kubectl logs -n kube-system -l app=p2p-node --tail=20

cd ..
```

**What Component 4 provides:**
- **BROADCAST**: Send messages to all nodes
- **UNICAST**: Send messages to a specific node
- **MULTICAST**: Send messages to groups of nodes
- **P2P Architecture**: Node-to-node communication
- **REST API**: HTTP endpoints on port 8080
- **Dashboard Integration**: Interactive control panel

**Using the Node Communication Dashboard:**

1. Open **Federation** tab in React dashboard (`http://localhost:5000`)
2. **View Node Status**: See all nodes with IP, status, and pod counts
3. **Select Communication Type**: BROADCAST, UNICAST, or MULTICAST
4. **Interactive Node Selection**: Click nodes to select (green highlight + checkmark)
5. **Choose Event Type**: HANDSHAKE, SCHEDULING, STATE_UPDATE, METRIC_UPDATE, DISCOVERY
6. **Enter Payload**: JSON or plain text messages
7. **Send & Monitor**: Real-time logs with success/failure indicators

**Dashboard Features:**
- 📊 Live stats: Total nodes, ready nodes, messages sent
- 🖥️ Interactive node cards with visual feedback
- 🎨 Color-coded communication types
- ✅ Success/failure indicators
- 📝 Real-time message logs
5. **Interactive node selection**:
   - Click nodes to select them (they turn green and scale up)
   - Selected nodes show a checkmark
   - Works with UNICAST (1 node) and MULTICAST (multiple nodes)
6. **Enter payload** as JSON or plain text
7. **Click "🚀 Send"** to broadcast the message
8. **View real-time logs** with success/failure indicators

**Dashboard Features:**
- 📊 Stats cards showing total nodes, ready nodes, messages sent, and last sent time
- 🖥️ Interactive node cards that respond to clicks
- 🎨 Color-coded communication types
- ✅ Success/failure indicators in logs
- 📝 Real-time message logging with timestamps
- 🧹 Clear logs button

**Testing P2P Communication via CLI:**
```bash
# Get a node IP
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')

# Send broadcast message to all nodes
curl -X POST http://$NODE_IP:8080/broadcast \
  -H "Content-Type: application/json" \
  -d '{"event": "HANDSHAKE", "payload": {"message": "Hello from all nodes!"}, "action": "NONE"}'

# Send unicast message to specific node
curl -X POST http://$NODE_IP:8080/unicast \
  -H "Content-Type: application/json" \
  -d '{"event": "STATE_UPDATE", "targets": ["172.18.0.2"], "payload": {"status": "active"}, "action": "UPDATE_STATE"}'

# Send multicast message to group of nodes
curl -X POST http://$NODE_IP:8080/multicast \
  -H "Content-Type: application/json" \
  -d '{"event": "METRIC_UPDATE", "targets": ["172.18.0.2", "172.18.0.3"], "payload": {"metrics": "data"}, "action": "NONE"}'

# View logs on receiving nodes
kubectl logs -n kube-system -l app=p2p-node -f
```

**Use Cases:**
- Coordinating eBPF program updates across nodes
- Sharing local metrics aggregations between nodes
- Implementing distributed consensus for routing decisions
- Cross-node health checks and status updates
- State synchronization across the cluster

### Step 8: Verify Everything is Working

```bash
# Terminal 3: Test the API
curl http://localhost:8080/health
# Output: OK

# Get metrics with pod details
curl http://localhost:8080/metrics/json | jq '.dns.pods'

# Get cluster topology
curl http://localhost:8080/api/cluster/topology | jq '.nodes[0].name'
```

**Expected JSON Output:**
```json
{
  "dns-test/pod-a": {
    "total_events": 28,
    "avg_latency_us": 364.13,
    "max_latency_us": 697.05,
    "min_latency_us": 80.08
  },
  "dns-test/pod-b": {
    "total_events": 20,
    "avg_latency_us": 412.18,
    "max_latency_us": 974.39,
    "min_latency_us": 125.92
  }
}
```

## You're Now Running!

You should now have:

**Kind Cluster**: Running with eBPF support  
**eBPF Daemon**: Collecting DNS latency from kernel  
**Sample Services**: 3 pods generating DNS traffic  
**REST API**: Available at `http://localhost:8080`  
**React Dashboard**: Available at `http://localhost:5000`  
**P2P Communication** (optional): Node-to-node messaging via Federation tab

**Dashboard Features:**
- Real-time DNS latency graphs per node
- Per-pod DNS latency trends
- Cluster information (name, node, pod count)
- Live metric updates every 3 seconds
- Dark theme UI
- **Node Communication Panel** (Federation tab):
  - View all cluster nodes with status
  - Send BROADCAST/UNICAST/MULTICAST messages
  - Real-time communication logs
  - Event-driven message types (HANDSHAKE, SCHEDULING, etc.)

## Using Make Commands (Alternative)

If you prefer using Make:

```bash
# Complete automated setup
make kind-setup              # Create cluster
make build-images            # Build all Docker images
make kind-load-images        # Load images into Kind
make deploy-all              # Deploy daemon + services

# Individual commands
make build-ebpf              # Build eBPF programs only
make build-daemon            # Build Go daemon only
make logs-daemon             # View daemon logs
make metrics                 # Get metrics via API
make port-forward            # Start port forwarding

# Cleanup
make undeploy                # Remove deployments
kind delete cluster --name ebpf-cluster  # Delete cluster
```

## Testing Different Services

### Deploy Your Own Services

Any pod making DNS queries will be automatically monitored:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
  namespace: default
spec:
  containers:
  - name: app
    image: nginx:latest
    # No changes needed - eBPF monitors automatically!
```

Deploy it:
```bash
kubectl apply -f my-app.yaml

# Wait a few seconds, then check metrics
curl http://localhost:8080/metrics/json | jq '.dns.pods["default/my-app"]'
```

### Scale Test Pods

```bash
# Scale up pod-a (create more DNS traffic)
kubectl scale deployment pod-a --replicas=3 -n dns-test

# Watch metrics increase
watch -n 1 'curl -s http://localhost:8080/metrics/json | jq .dns.total_events'
```

## Troubleshooting

### Daemon Not Starting

```bash
# Check pod status
kubectl get pods -n ebpf-telemetry

# View logs
kubectl logs -n ebpf-telemetry -l app=ebpf-daemon

# Check node has required kernel
kubectl debug node/ebpf-cluster-control-plane -it --image=ubuntu
ls /sys/kernel/btf/vmlinux  # Should exist
```

### No Metrics Showing

```bash
# Verify pods are making DNS queries
kubectl logs -n dns-test pod-a

# Check API is accessible
curl http://localhost:8080/metrics/json

# Verify port-forward is running
lsof -i :8080
```

### Dashboard Not Loading

```bash
# Check frontend is running
lsof -i :5000

# Check API is accessible
curl http://localhost:8080/health

# Restart frontend
cd frontend
npm run dev
```

## Component Integration

### **For Internal Components: Direct Function Calls (Recommended)**

Components in this repository can directly import the telemetry package and call functions - **no HTTP, no ports, no configuration needed**:

```go
package mycomponent

import (
    "log"
    "github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

// Example 1: Get current metrics
func SelectBestPod(serviceName string) string {
    // Direct function call - fast, type-safe, no network
    podDNS := telemetry.GetPodDNSMetrics()
    podRTT := telemetry.GetPodRTTMetrics()
    
    bestPod := ""
    minLatency := float64(99999999)
    
    for podKey, dns := range podDNS {
        rtt := podRTT[podKey]
        
        avgDNS := float64(dns.TotalLatencyNs) / float64(dns.TotalEvents)
        avgRTT := float64(0)
        if rtt.TotalEvents > 0 {
            avgRTT = float64(rtt.TotalRTTNs) / float64(rtt.TotalEvents)
        }
        
        combinedLatency := avgDNS + avgRTT
        if combinedLatency < minLatency {
            minLatency = combinedLatency
            bestPod = podKey
        }
    }
    
    log.Printf("Selected: %s (latency: %.2fms)", bestPod, minLatency/1e6)
    return bestPod
}

// Example 2: Subscribe for real-time updates
func WatchMetrics() {
    collector, ok := telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS)
    if !ok {
        return
    }
    
    updatesChan := collector.Subscribe()
    defer collector.Unsubscribe(updatesChan)
    
    for metric := range updatesChan {
        // Receive push updates as events happen
        if podMetric, ok := metric.(telemetry.PodMetric); ok {
            log.Printf("Pod %s latency update: %+v", podMetric.PodName, podMetric.Value)
            // Make immediate decisions
        }
    }
}
```

**Available Functions:**

| Function | Returns | Description |
|----------|---------|-------------|
| `GetDNSMetrics()` | `DNSMetrics` | Node-level DNS stats |
| `GetPodDNSMetrics()` | `map[string]PodDNSMetrics` | Per-pod DNS (key: "namespace/pod") |
| `GetRTTMetrics()` | `RTTMetrics` | Node-level RTT stats |
| `GetPodRTTMetrics()` | `map[string]PodRTTMetrics` | Per-pod RTT (key: "namespace/pod") |
| `GlobalRegistry.Get(type)` | `Collector` | Get collector for subscriptions |
| `collector.Subscribe()` | `<-chan Metric` | Real-time metric stream (push) |

**Integration Steps:**

1. Import the package:
   ```go
   import "github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
   ```

2. Call functions directly - that's it! No HTTP client, no port configuration needed.

3. To start your component in the same binary, edit `daemon/cmd/daemon/main.go`:
   ```go
   import "yourpackage/routing"
   
   func main() {
       // ... load eBPF ...
       go telemetry.StartDNSLatencyCollector()
       go telemetry.StartRTTCollector()
       
       // Start your component
       router := routing.NewRouter()
       go router.Start()
       
       // ... rest ...
   }
   ```

See `ARCHITECTURE.md` for detailed design and more examples.

---

### **For External Tools: HTTP API Endpoints**

For external consumers (dashboards, monitoring tools, other applications):

| Endpoint | Method | Description | Use Case |
|----------|--------|-------------|----------|
| `/health` | GET | Health check | Liveness probe |
| `/ready` | GET | Readiness check | Readiness probe |
| `/metrics` | GET | Prometheus format | Monitoring systems (Grafana, Prometheus) |
| `/metrics/json` | GET | JSON format with pod details | Dashboards, custom tools |
| `/api/dns/pods` | GET | Per-pod DNS metrics | Routing decisions, scheduling |
| `/api/rtt/pods` | GET | Per-pod RTT metrics | Performance monitoring |
| `/api/cluster/topology` | GET | Cluster structure | Service mesh, load balancing |

### **Sample API Responses**

#### 1. **Node-Level Metrics** (`GET /metrics/json`)
```json
{
  "timestamp": "2025-12-08T17:00:00Z",
  "dns": {
    "total_events": 1523,
    "avg_latency_us": 245.32,
    "last_latency_us": 189.45,
    "max_latency_us": 1523.67,
    "min_latency_us": 45.12,
    "pods": {
      "default/web-app": {
        "total_events": 842,
        "avg_latency_us": 198.45,
        "max_latency_us": 1200.0,
        "min_latency_us": 45.12
      },
      "default/api-server": {
        "total_events": 681,
        "avg_latency_us": 312.89,
        "max_latency_us": 1523.67,
        "min_latency_us": 89.34
      }
    }
  },
  "rtt": {
    "total_events": 892,
    "avg_rtt_us": 1234.56,
    "last_rtt_us": 1100.00,
    "max_rtt_us": 5000.00,
    "min_rtt_us": 200.00
  }
}
```

#### 2. **Per-Pod DNS Metrics** (`GET /api/dns/pods`)
```json
{
  "pods": {
    "default/web-app": {
      "namespace": "default",
      "pod_name": "web-app",
      "total_events": 842,
      "avg_latency_us": 198.45,
      "last_latency_us": 156.78,
      "max_latency_us": 1200.0,
      "min_latency_us": 45.12
    }
  }
}
```

#### 3. **Cluster Topology** (`GET /api/cluster/topology`)
```json
{
  "nodes": [
    {
      "name": "node-1",
      "ip": "172.18.0.2",
      "status": "Ready",
      "role": "control-plane",
      "pods": [
        {
          "name": "web-app",
          "namespace": "default",
          "ip": "10.244.0.5",
          "status": "Running",
          "service": "web-svc"
        }
      ]
    }
  ]
}
```

## Using This Data in Other Components

### **Example 1: Intelligent Traffic Routing**

Use DNS latency to route traffic to pods with better network performance:

```go
// Component 2: Routing Controller

func SelectBestPod(serviceName string) string {
    resp := httpGet("http://ebpf-daemon:8080/api/dns/pods")
    pods := parsePodMetrics(resp)
    
    // Find pod with lowest DNS latency
    bestPod := ""
    minLatency := math.MaxFloat64
    
    for podKey, metrics := range pods {
        if metrics.AvgLatencyUs < minLatency {
            minLatency = metrics.AvgLatencyUs
            bestPod = podKey
        }
    }
    
    return bestPod  // Route traffic here
}
```

### **Example 2: Latency-Aware Scheduling**

Schedule new pods on nodes with better network performance:

```python
# Component 3: Scheduler Plugin

import requests

def score_node(node_name):
    """Score node based on DNS latency"""
    metrics = requests.get(f"http://ebpf-daemon:8080/metrics/json").json()
    
    # Lower latency = higher score
    avg_latency = metrics['dns']['avg_latency_us']
    score = 100 - (avg_latency / 10)  # Normalize
    
    return max(0, min(100, score))
```

### **Example 3: Multi-Cluster Federation**

Compare network performance across clusters:

```javascript
// Component 4: Federation Controller

async function getClusterHealth(clusterEndpoint) {
    const response = await fetch(`${clusterEndpoint}/metrics/json`);
    const metrics = await response.json();
    
    return {
        cluster: clusterEndpoint,
        dnsLatency: metrics.dns.avg_latency_us,
        rttLatency: metrics.rtt.avg_rtt_us,
        totalPods: Object.keys(metrics.dns.pods).length
    };
}

// Select cluster with best performance
const clusters = await Promise.all([
    getClusterHealth("http://cluster-1:8080"),
    getClusterHealth("http://cluster-2:8080")
]);

const bestCluster = clusters.reduce((prev, curr) => 
    curr.dnsLatency < prev.dnsLatency ? curr : prev
);
```

## Key Advantages for Component Developers

1. **No Kernel Access Required**: Components consume data via REST API
2. **Language Agnostic**: HTTP/JSON works with any programming language
3. **Real-Time Data**: Metrics update continuously (sub-second granularity)
4. **Pod-Level Granularity**: Make decisions per individual pod
5. **Zero Application Changes**: eBPF captures data transparently
6. **Production Ready**: DaemonSet deployment, automatic pod discovery

## Project Structure

```
k8s-runtime-aware-ebpf-orchestration/
├── daemon/                    # Go daemon source code
│   ├── cmd/daemon/           # Main entry point
│   ├── pkg/
│   │   ├── api/              # HTTP API server
│   │   ├── loader/           # eBPF program loader
│   │   ├── plugins/          # Plugin interface
│   │   └── telemetry/        # Telemetry collectors
│   ├── Dockerfile
│   └── go.mod
├── ebpf/                      # eBPF C programs
│   ├── common/               # Shared headers
│   │   ├── dns_latency.h
│   │   ├── maps.h
│   │   └── rtt.h
│   └── component-1-daemon/   # Daemon eBPF programs
│       ├── dns_latency.c
│       ├── rtt.c
│       └── vmlinux.h
├── examples/                  # Test services
│   ├── service-a/
│   └── service-b/
├── k8s/                       # Kubernetes manifests
│   ├── daemonset.yaml
│   ├── test-services.yaml
│   └── namespace.yaml
├── scripts/
│   └── build-ebpf.sh
├── ui/                        # UI components (planned)
├── Makefile
└── README.md
```

## Development

### Building Individual Components

```bash
# eBPF programs only
make build-ebpf

# Go daemon only
make build-daemon

# Docker images
make build-images
```

### Debugging

```bash
# View eBPF program info
sudo bpftool prog list
sudo bpftool map list

# View attached kprobes
cat /sys/kernel/debug/tracing/kprobe_events

# Check ring buffer
sudo bpftool map dump name dns_events
```

### Adding New Telemetry

1. Create new header in `ebpf/common/`
2. Create new eBPF program in `ebpf/component-1-daemon/`
3. Add collector in `daemon/pkg/telemetry/`
4. Update loader in `daemon/pkg/loader/`
5. Add metrics endpoint in `daemon/pkg/api/`

## Metrics Collected

### DNS Latency
- **Source:** kprobe on `udp_sendmsg` and `udp_recvmsg`
- **Metric:** Time between DNS request and response
- **Use Case:** Detect DNS resolution delays

### TCP RTT (Round-Trip Time)
- **Source:** kprobe on `tcp_connect` and `tcp_finish_connect`
- **Metric:** TCP connection establishment time
- **Use Case:** Monitor network latency between services

## Data Flow: From Kernel to Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Kernel Instrumentation (eBPF C Code)                    │
│                                                                  │
│  Pod makes DNS query → udp_sendmsg() → kprobe captures start    │
│  DNS response arrives → udp_recvmsg() → kprobe captures end     │
│                                                                  │
│  eBPF Program:                                                   │
│    latency_ns = end_timestamp - start_timestamp                 │
│    event = {pid, source_ip, latency_ns, timestamp}              │
│    bpf_ringbuf_submit(event)  ← Send to userspace               │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Userspace Collection (Go Daemon)                        │
│                                                                  │
│  for event := range ringbuffer.Read() {                         │
│    // Aggregate node-level metrics                              │
│    nodeMetrics.TotalEvents++                                    │
│    nodeMetrics.TotalLatency += event.LatencyNs                  │
│                                                                  │
│    // Map IP to pod name via K8s API                            │
│    podName := ipToPodMap[event.SourceIP]  // "default/web-app" │
│                                                                  │
│    // Aggregate per-pod metrics                                 │
│    podMetrics[podName].TotalEvents++                            │
│    podMetrics[podName].TotalLatency += event.LatencyNs          │
│  }                                                               │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: API Exposure (REST Server)                              │
│                                                                  │
│  HTTP Server (port 8080):                                       │
│    GET /metrics/json → Return aggregated metrics                │
│    GET /api/dns/pods → Return per-pod metrics                   │
│                                                                  │
│  Response:                                                       │
│  {                                                               │
│    "dns": {                                                      │
│      "avg_latency_us": 245.32,  ← Node-level                    │
│      "pods": {                                                   │
│        "default/web-app": {                                      │
│          "avg_latency_us": 198.45  ← Pod-level                  │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│  }                                                               │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Frontend Visualization (React)                          │
│                                                                  │
│  useEffect(() => {                                               │
│    setInterval(() => {                                           │
│      fetch('http://localhost:8080/metrics/json')                │
│        .then(data => updateCharts(data))  ← Every 3 seconds     │
│    }, 3000)                                                      │
│  })                                                              │
│                                                                  │
│  Display:                                                        │
│    - Node-level DNS latency chart                               │
│    - Per-pod DNS latency charts                                 │
│    - Real-time metric cards                                     │
│    - Cluster topology info                                      │
└─────────────────────────────────────────────────────────────────┘
```

## Data Types and Precision

| Data Point | Captured At | Precision | Source |
|------------|-------------|-----------|--------|
| **DNS Latency** | Kernel | Nanoseconds | `bpf_ktime_get_ns()` |
| **Timestamp** | Kernel | Nanoseconds | `bpf_ktime_get_ns()` |
| **Source IP** | Kernel | 32-bit | Socket structure |
| **Process ID** | Kernel | 32-bit | `bpf_get_current_pid_tgid()` |
| **Pod Name** | K8s API | String | Pod metadata |
| **Namespace** | K8s API | String | Pod metadata |

**Important Notes:**
- **Latency data** comes from **kernel timestamps** (not API queries)
- **Zero application instrumentation** required
- **Sub-microsecond precision** for latency measurements
- **Kubernetes API** only used for mapping IPs to pod names (enrichment)

## Roadmap

- [x] **Component 1: eBPF Daemon Layer** **COMPLETED**
  - [x] DNS latency collection via kernel probes
  - [x] RTT collection via TCP instrumentation
  - [x] Per-pod metrics aggregation
  - [x] REST API (JSON + Prometheus)
  - [x] Kubernetes DaemonSet deployment
  - [x] React dashboard with real-time graphs
  - [x] Cluster topology API
  - [x] Pod IP auto-discovery
- [ ] Component 2: Intelligent Traffic Routing
  - [ ] Consume DNS latency metrics via API
  - [ ] Implement latency-based routing decisions
  - [ ] Integration with service mesh
- [ ] Component 3: Latency-Aware Scheduling
  - [ ] Custom Kubernetes scheduler
  - [ ] Node scoring based on network metrics
  - [ ] Pod placement optimization
- [ ] Component 4: Multi-Cluster Federation
  - [ ] Cross-cluster metric aggregation
  - [ ] Federated traffic management
  - [ ] Global load balancing
- [ ] Additional Features
  - [ ] Grafana integration
  - [ ] AlertManager integration
  - [ ] Historical data storage
  - [ ] Policy enforcement engine

## Cleanup

### Stop Everything and Clean Up

```bash
# Stop frontend (Ctrl+C in Terminal 2)
# Stop port-forward (Ctrl+C in Terminal 1)

# Delete Kubernetes resources
kubectl delete -f k8s/simple-test-pods.yaml
kubectl delete -f k8s/daemonset.yaml
kubectl delete namespace dns-test ebpf-telemetry

# If you deployed Component 4 (P2P communication)
kubectl delete -f component-4-node-communication/daemonset.yaml
kubectl delete -f component-4-node-communication/peers-configmap.yaml

# Delete Kind cluster
kind delete cluster --name ebpf-cluster

# Clean build artifacts
cd k8s-runtime-aware-ebpf-orchestration
rm -f daemon/ebpf-daemon
rm -f ebpf/component-1-daemon/*.o
rm -rf frontend/node_modules

# Remove Docker images (optional)
docker rmi ebpf-daemon:latest
docker system prune -f
```

### Quick Cleanup Command

```bash
# One-liner to delete everything
kind delete cluster --name ebpf-cluster && \
kubectl config use-context docker-desktop && \
echo "Cleanup complete!"
```

## Monitoring and Debugging

### View Live Metrics

```bash
# Watch metrics update in real-time
watch -n 2 'curl -s http://localhost:8080/metrics/json | jq "{dns: .dns.avg_latency_us, pods: .dns.pods | length}"'

# Stream daemon logs
kubectl logs -n ebpf-telemetry -l app=ebpf-daemon -f

# Check eBPF programs loaded
kubectl exec -n ebpf-telemetry -it $(kubectl get pod -n ebpf-telemetry -l app=ebpf-daemon -o name) -- ls -la /sys/fs/bpf
```

### Performance Testing

```bash
# Generate more DNS traffic
for i in {1..100}; do 
  kubectl run test-$i --image=busybox --restart=Never -- nslookup kubernetes
done

# Watch metrics spike
watch -n 1 'curl -s http://localhost:8080/metrics/json | jq .dns.total_events'

# Cleanup test pods
kubectl delete pod -l run=test
```

## References

1. Lentz et al., "Dissecting Overheads of Service Mesh Sidecars," SoCC 2023
2. Linux Foundation, "Introduction to eBPF," 2021
3. Gregg, "BPF Performance Tools," Addison-Wesley, 2019
4. Cilium Project, "eBPF-based Networking, Security, and Observability"
5. Kubernetes Documentation, "DaemonSet," kubernetes.io/docs/concepts/workloads/controllers/daemonset/

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

**Gunawardana D.D.I. (IT22312426)**
- BSc. (Hons) in Information Technology Specializing in Software Engineering
- Sri Lanka Institute of Information Technology

---

*This project is part of undergraduate research (Project ID: 25-26J-434)*
