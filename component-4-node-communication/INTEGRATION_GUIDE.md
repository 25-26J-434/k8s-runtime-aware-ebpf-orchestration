# Node Communication Integration Guide

## Overview

This guide integrates **broadcast**, **unicast**, and **multicast** communication features into your Kind cluster with a comprehensive web dashboard for real-time monitoring.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Frontend (React)                            │
│              NodeCommunication.tsx Component                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│           Dashboard Server (Go)                              │
│  - /api/send: Send messages (broadcast/unicast/multicast)   │
│  - /api/stats: Get aggregated stats                         │
│  - /api/logs: Get communication logs                        │
│  - /api/nodes: Get list of available nodes                  │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
    ┌─────────────┐      ┌─────────────┐
    │  Node 1     │      │  Node 2     │
    │  Daemon     │◄────►│  Daemon     │
    │  (8080)     │      │  (8080)     │
    └─────────────┘      └─────────────┘
         ▲
         │
    ┌─────────────┐
    │  Node N     │
    │  Daemon     │
    └─────────────┘
```

## Components Updated

### 1. **Frontend Component** (`frontend/src/pages/NodeCommunication.tsx`)
   - **New**: Complete React UI with Broadcast/Unicast/Multicast controls
   - **Features**:
     - Send messages with different communication types
     - Real-time stats visualization (pie chart, bar chart)
     - Communication logs table
     - Node selection for sender/recipients
     - Event type selection

### 2. **Node Daemon** (`component-4-node-communication/cmd/daemon/main.go`)
   - **Enhanced**: Added communication stats tracking
   - **New Endpoints**:
     - `GET /stats` - Returns communication statistics
     - `GET /health` - Health check
   - **Features**:
     - Tracks broadcast, unicast, multicast, received messages
     - Maintains peer list from ConfigMap
     - Real-time stats updates

### 3. **Dashboard Server** (`component-4-node-communication/cmd/dashboard-server/dashboard-server.go`)
   - **Enhanced**: Dynamic node discovery and stats aggregation
   - **New Endpoints**:
     - `GET /api/nodes` - List discovered nodes
     - `POST /api/send` - Send messages to daemon pods
     - `GET /api/stats` - Aggregated stats across all nodes
     - `GET /api/logs` - Communication logs
   - **Features**:
     - Auto-discovers nodes from Kubernetes
     - Aggregates stats from all daemons
     - Tracks sent/received messages per node

## Quick Start

### Step 1: Create Kind Cluster
```bash
kind create cluster --name ebpf-cluster --config k8s/kind-config.yaml
kubectl get nodes -o wide
```

### Step 2: Deploy Node Communication Component
```bash
# Navigate to component directory
cd component-4-node-communication

# Build daemon Docker image
docker build -t node-daemon:latest -f Dockerfile .

# Load into Kind
kind load docker-image node-daemon:latest --name ebpf-cluster

# Deploy peers ConfigMap
kubectl apply -f peers-configmap.yaml

# Deploy DaemonSet
kubectl apply -f daemonset.yaml

# Wait for pods
kubectl rollout status daemonset/node-communication-daemon -n kube-system
```

### Step 3: Update Peers ConfigMap
```bash
# Auto-discover node IPs and update ConfigMap
bash update-peers.sh

# Verify
kubectl -n kube-system get configmap node-daemon-peers -o yaml
```

### Step 4: Start Dashboard Server
```bash
# In the component-4-node-communication directory
cd component-4-node-communication/cmd/dashboard-server

# Build and run
go build -o dashboard-server .
./dashboard-server

# Dashboard will be available at http://localhost:8000
```

### Step 5: Access Frontend
Open in browser: **http://localhost:5173** (if running `npm run dev` in frontend) or **http://localhost:8000** (if serving through dashboard)

## Usage Guide

### Broadcast
- Sends message to **all** nodes except sender
- Use case: Cluster-wide announcements, discovery events
- **Steps**:
  1. Click "📡 Broadcast" button
  2. Select sender node
  3. Select event type (DISCOVERY, HANDSHAKE, etc.)
  4. Click "Send Message"

### Unicast
- Sends message to **exactly 1** recipient
- Use case: Point-to-point communication, targeted updates
- **Steps**:
  1. Click "🎯 Unicast" button
  2. Select sender node
  3. Select **exactly 1** recipient
  4. Select event type
  5. Click "Send Message"

### Multicast
- Sends message to **multiple selected** nodes
- Use case: Subset communication, group coordination
- **Steps**:
  1. Click "🔄 Multicast" button
  2. Select sender node
  3. Select **multiple** recipients (click each)
  4. Select event type
  5. Click "Send Message"

## File Locations

```
component-4-node-communication/
├── cmd/
│   ├── daemon/main.go                 # Node daemon with comm support
│   └── dashboard-server/              # Web dashboard backend
│       └── dashboard-server.go        # Handles /api/send, /api/stats, etc.
├── daemonset.yaml                     # Kubernetes DaemonSet deployment
├── peers-configmap.yaml               # ConfigMap with node IPs
├── update-peers.sh                    # Auto-update peer ConfigMap
└── Dockerfile                         # Docker image for daemon

frontend/
└── src/pages/
    └── NodeCommunication.tsx          # Main UI component
```

## API Endpoints

### Dashboard Server (Port 8000)

#### POST /api/send
Send a message from one node
```bash
curl -X POST http://localhost:8000/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "sender_ip": "172.18.0.2",
    "type": "BROADCAST",
    "event": "DISCOVERY",
    "targets": [],
    "payload": {"test": "data"}
  }'
```

#### GET /api/stats
Get aggregated communication statistics
```bash
curl http://localhost:8000/api/stats
```

Response:
```json
{
  "broadcast": 5,
  "unicast": 3,
  "multicast": 2,
  "total": 10,
  "nodes_sent": {"172.18.0.2": 5, "172.18.0.3": 3},
  "nodes_recv": {"172.18.0.4": 2}
}
```

#### GET /api/nodes
Get list of available nodes
```bash
curl http://localhost:8000/api/nodes
```

Response:
```json
[
  {"name": "node-communication-daemon-abc1", "ip": "172.18.0.2"},
  {"name": "node-communication-daemon-xyz2", "ip": "172.18.0.3"}
]
```

#### GET /api/logs
Get communication logs
```bash
curl http://localhost:8000/api/logs
```

### Node Daemon (Port 8080, internal only)

#### POST /broadcast
Broadcast a message
```bash
kubectl exec -it <pod-name> -n kube-system -- curl -X POST http://localhost:8080/broadcast \
  -H "Content-Type: application/json" \
  -d '{"event": "DISCOVERY", "payload": {}}'
```

#### POST /unicast
Send to one node
```bash
kubectl exec -it <pod-name> -n kube-system -- curl -X POST http://localhost:8080/unicast \
  -H "Content-Type: application/json" \
  -d '{"targets": ["172.18.0.3"], "event": "HANDSHAKE", "payload": {}}'
```

#### POST /multicast
Send to multiple nodes
```bash
kubectl exec -it <pod-name> -n kube-system -- curl -X POST http://localhost:8080/multicast \
  -H "Content-Type: application/json" \
  -d '{"targets": ["172.18.0.3", "172.18.0.4"], "event": "STATE_UPDATE", "payload": {}}'
```

#### GET /stats
Get node daemon stats
```bash
kubectl exec -it <pod-name> -n kube-system -- curl http://localhost:8080/stats
```

#### GET /health
Health check
```bash
kubectl exec -it <pod-name> -n kube-system -- curl http://localhost:8080/health
```

## Verification

### Check Daemon Pods
```bash
kubectl -n kube-system get pods -l app=node-communication-daemon -o wide
```

### View Daemon Logs
```bash
# All pods
kubectl -n kube-system logs -l app=node-communication-daemon -f

# Specific pod
kubectl -n kube-system logs pod/<pod-name> -f
```

### Test Communication
```bash
# Get a pod
POD=$(kubectl -n kube-system get pods -l app=node-communication-daemon -o jsonpath='{.items[0].metadata.name}')

# Get another node's IP
PEER_IP=$(kubectl get nodes -o jsonpath='{.items[1].status.addresses[?(@.type=="InternalIP")].address}')

# Send broadcast (within pod)
kubectl -n kube-system exec -it "$POD" -- curl -X POST http://localhost:8080/broadcast \
  -H "Content-Type: application/json" \
  -d '{"event": "DISCOVERY", "payload": {"test": true}}'

# Check stats
kubectl -n kube-system exec -it "$POD" -- curl http://localhost:8080/stats | jq
```

## Troubleshooting

### Dashboard not connecting to daemon
- **Check**: Is daemon pod running? `kubectl -n kube-system get pods`
- **Fix**: Restart daemonset `kubectl -n kube-system rollout restart daemonset/node-communication-daemon`

### Nodes not appearing in UI
- **Check**: `curl http://localhost:8000/api/nodes` from host
- **Fix**: Ensure dashboard server can reach Kubernetes API
  ```bash
  kubectl config view
  kubectl auth can-i get pods --namespace kube-system
  ```

### Messages not being sent
- **Check**: View dashboard server logs (if running in foreground)
- **Check**: View pod logs: `kubectl -n kube-system logs <pod-name>`
- **Fix**: Verify peers ConfigMap: `kubectl -n kube-system get configmap node-daemon-peers -o yaml`

### Port conflicts
- Dashboard (8000): Change in `dashboard-server.go`
- Daemon (8080): Change in `daemonset.yaml` port mapping
- Frontend (5173/3000): Check vite config

## Performance Notes

- **Stats Update Interval**: 2 seconds (adjust in frontend)
- **Node Discovery**: Every 10 seconds (adjust in dashboard server)
- **Peer Refresh**: Every 10 seconds (adjust in daemon)
- **Max Logs**: 100 entries (adjust in dashboard server)

## Next Steps

1. **Add Metrics**: Integrate eBPF metrics collection with comm events
2. **Add Authentication**: Secure the API endpoints
3. **Add Persistence**: Store communication logs to database
4. **Add Routing**: Implement intelligent routing based on node health
5. **Add Replay**: Ability to replay communication sequences for testing
