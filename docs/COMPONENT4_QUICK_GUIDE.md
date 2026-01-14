# Quick Setup Guide - 3-Node Cluster with Component 4

## Complete Setup in 5 Steps

### 1. Create 3-Node Kind Cluster
```bash
cd /home/kavishka/Documents/k8s-runtime-aware-ebpf-orchestration
kind create cluster --name ebpf-cluster --config k8s/kind-config.yaml

# Verify all 3 nodes are ready
kubectl get nodes
# Should show: ebpf-cluster-control-plane, ebpf-cluster-worker, ebpf-cluster-worker2
```

### 2. Deploy eBPF Daemon (on all nodes)
```bash
# Build eBPF programs
cd ebpf/component-1-daemon
clang -O2 -g -target bpf -D__TARGET_ARCH_x86 -c dns_latency.c -o dns_latency.o
cd ../..

# Build and deploy daemon
cd daemon
go build -o ebpf-daemon ./cmd/daemon
cd ..

docker build -t ebpf-daemon:latest daemon/
kind load docker-image ebpf-daemon:latest --name ebpf-cluster

kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/daemonset.yaml

# Verify daemon is running on ALL 3 nodes
kubectl get pods -n ebpf-telemetry -o wide
```

### 3. Deploy Test Services
```bash
kubectl apply -f k8s/simple-test-pods.yaml
kubectl get pods -n dns-test
```

### 4. Deploy Component 4 (P2P Communication)
```bash
cd component-4-node-communication

# Build P2P daemon
docker build -t p2p-node:v3 .
kind load docker-image p2p-node:v3 --name ebpf-cluster

# Deploy to all nodes
kubectl apply -f peers-configmap.yaml
kubectl apply -f daemonset.yaml

# Verify P2P daemon on ALL 3 nodes
kubectl get pods -n kube-system -l app=p2p-node -o wide
# Should show 3 pods (one per node)

cd ..
```

### 5. Start Dashboard
```bash
# Terminal 1: Port forward
kubectl port-forward -n ebpf-telemetry svc/ebpf-daemon 8080:8080

# Terminal 2: Start frontend
cd frontend
npm install # First time only
npm run dev
```

## Access Dashboard
- Open `http://localhost:5000`
- Go to **Federation**tab
- See all 3 nodes displayed!

## What You'll See

### Federation Tab Features:
1. **Stats Cards**at top:
 - Total Nodes: 3
 - Ready Nodes: 3
 - Messages Sent: (real-time counter)
 - Last Sent: (timestamp)

2. **3 Interactive Node Cards**:
 - ebpf-cluster-control-plane (Ready)
 - ebpf-cluster-worker (Ready)
 - ebpf-cluster-worker2 (Ready)
 - Each showing IP, status, and pod count

3. **Communication Controls**:
 - BROADCAST (blue) - Send to all 3 nodes
 - UNICAST (green) - Send to 1 specific node
 - MULTICAST (orange) - Send to 2+ nodes

4. **Interactive Selection**:
 - Click nodes to select them (they turn green!)
 - Selected nodes show checkmark ✓
 - Scales up slightly when selected

5. **Event Types**:
 - HANDSHAKE
 - SCHEDULING
 - STATE_UPDATE
 - METRIC_UPDATE
 - DISCOVERY

6. **Real-time Logs**:
 - Shows sent messages
 - Success / Failure indicators
 - Timestamps
 - Full payload display

## Test It Out!

### Test 1: BROADCAST to all nodes
1. Select BROADCAST
2. Event: HANDSHAKE
3. Payload: `{"message": "Hello all 3 nodes!"}`
4. Click "Send BROADCAST"
5. Check logs on all nodes:
 ```bash
 kubectl logs -n kube-system -l app=p2p-node -f
 ```

### Test 2: UNICAST to specific node
1. Select UNICAST
2. Click on one node card (e.g., worker node)
3. Event: STATE_UPDATE
4. Payload: `{"status": "active", "load": 0.5}`
5. Click "Send UNICAST"
6. Only selected node receives it!

### Test 3: MULTICAST to 2 nodes
1. Select MULTICAST
2. Click on 2 node cards (e.g., both workers)
3. Event: METRIC_UPDATE
4. Payload: `{"cpu": 45, "memory": 60}`
5. Click "Send MULTICAST"
6. Both selected nodes receive it!

## Key Differences from Before

### Before (1 node):
- Only 1 node shown
- BROADCAST = UNICAST (same node)
- MULTICAST not useful

### Now (3 nodes):
- 3 nodes displayed
- BROADCAST reaches all 3
- UNICAST targets specific node
- MULTICAST sends to groups
- Interactive node selection
- Real visual feedback
- Stats cards show cluster health

## Troubleshooting

### Not seeing 3 nodes?
```bash
kubectl get nodes
# Should show 3 nodes
```

### P2P daemon not running on all nodes?
```bash
kubectl get pods -n kube-system -l app=p2p-node -o wide
# Should show 3 pods
```

### Dashboard not showing nodes?
```bash
# Check API connectivity
curl http://localhost:8080/api/cluster/topology | jq '.nodes | length'
# Should return 3
```

### Node selection not working?
- Make sure you've selected UNICAST or MULTICAST (not BROADCAST)
- BROADCAST mode disables node selection (sends to all)

## Visual Guide

```
┌─────────────────────────────────────────────────────────────┐
│ Node-to-Node Communication │
│ P2P messaging and coordination across cluster nodes │
├─────────────────────────────────────────────────────────────┤
│ [Total: 3] [Ready: 3] [Sent: 5] [Last: 14:30:45] │
├─────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│ │ Ready Node1 │ │ Ready Node2 │ │ Ready Node3 │ (Click to select)│
│ │ IP: .2 │ │ IP: .3 │ │ IP: .4 │ │
│ │ Pods: 5 │ │ Pods: 3 │ │ Pods: 4 │ │
│ └──────────┘ └──────────┘ └──────────┘ │
├─────────────────────────────────────────────────────────────┤
│ [ BROADCAST ] [ UNICAST ] [ MULTICAST ] │
│ [ HANDSHAKE ] [ SCHEDULING ] [ STATE_UPDATE ] ... │
│ Payload: {"message": "..."} │
│ [ Send BROADCAST ] │
├─────────────────────────────────────────────────────────────┤
│ Logs: │
│ BROADCAST | HANDSHAKE | To: ALL | 14:30:45 │
│ UNICAST | STATE | To: .3 | 14:29:12 │
└─────────────────────────────────────────────────────────────┘
```

## Success!

You now have:
- 3-node Kubernetes cluster
- eBPF daemon on all nodes
- P2P communication daemon on all nodes
- Interactive dashboard with node selection
- Real-time messaging between nodes
- Visual feedback and logging

Enjoy testing node-to-node communication!
