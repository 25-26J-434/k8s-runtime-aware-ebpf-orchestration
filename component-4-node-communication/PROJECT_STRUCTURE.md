# 📁 P2P Go - Project Structure

```
p2p-go/
├── cmd/                             # Command-line applications
│   ├── daemon/                     # Node daemon application
│   │   └── main.go                 # Daemon source code
│   └── dashboard-server/           # Dashboard backend server
│       └── dashboard-server.go     # Server source code
│
├── client/                          # Frontend dashboard files
│   ├── dashboard.html              # Web UI for real-time communication
│   └── DASHBOARD_GUIDE.md          # Dashboard usage guide
│
├── docs/                           # Documentation
│   ├── COMMUNICATION_TEST_RESULTS.md
│   ├── QUICK_TEST_GUIDE.md
│   └── TEST_SUMMARY.txt
│
├── daemon                          # Compiled daemon binary
├── dashboard-server                # Compiled server binary
│
├── Dockerfile                      # Container image definition
├── daemonset.yaml                  # Kubernetes DaemonSet deployment
├── peers-configmap.yaml            # Peer node configuration
├── kind-3node.yaml                 # Kind cluster configuration
│
├── Makefile                        # Build automation ✨
├── start-dashboard.sh              # Dashboard startup script
├── go.mod                          # Go module dependencies
│
├── README.md                       # Main project documentation
└── PROJECT_STRUCTURE.md            # This file
```

## 🚀 Quick Start

### Using Makefile (Recommended)

```bash
# Build everything
make build

# Build and deploy to Kubernetes
make docker-load deploy

# Start dashboard
make dashboard

# Check status
make status

# View logs
make logs

# See all commands
make help
```

### 2. Open Dashboard

Open http://localhost:8000 in your browser

### 3. Deploy Daemon (if not already running)

```bash
kubectl apply -f peers-configmap.yaml
kubectl apply -f daemonset.yaml
```

## 📂 Component Details

### Client (`/client`)
- **dashboard.html**: Interactive web interface
  - Real-time message visualization
  - Send BROADCAST, UNICAST, MULTICAST messages
  - Live statistics and logs
  - Modern responsive UI

### Dashboard Server (`dashboard-server.go`)
- REST API for message sending
- Kubernetes integration via kubectl
- Statistics tracking
- CORS enabled for browser access

### Daemon (`main.go`)
- Runs on each Kubernetes node
- Handles BROADCAST, UNICAST, MULTICAST
- Peer discovery from ConfigMap
- Concurrent message forwarding

## 🔧 Development

### Rebuild Daemon
```bash
docker build -t p2p-node:v3 .
kind load docker-image p2p-node:v3 --name p2p
kubectl rollout restart daemonset node-daemon -n kube-system
```

### Rebuild Dashboard Server
```bash
go build -o dashboard-server dashboard-server.go
```

### Test Communication
```bash
# Watch logs
kubectl logs -f -l app=node-daemon -n kube-system --all-containers=true
```

## 📝 Configuration Files

- **kind-3node.yaml**: 3-node cluster (1 control-plane + 2 workers)
- **peers-configmap.yaml**: Node IP addresses
- **daemonset.yaml**: Daemon deployment configuration
- **Dockerfile**: Daemon container build

## 🌐 Ports

- **8000**: Dashboard server (HTTP)
- **8080**: Node daemon (inter-node communication)

## 📚 Documentation

See `/client/DASHBOARD_GUIDE.md` for detailed dashboard usage instructions.
