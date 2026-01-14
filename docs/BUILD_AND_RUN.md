# Build and Run Guide

## Quick Start

### 1. Build the Daemon (Docker Image)

```bash
cd /home/irushig/Research/k8s-runtime-aware-ebpf-orchestration

# Option A: Using Makefile (recommended)
make build-images

# Option B: Direct Docker build (with no cache for clean rebuild)
docker build --no-cache -t ebpf-daemon:latest -f daemon/Dockerfile daemon/
```

**Note:** The Makefile will automatically:
- Build eBPF programs first (`build-ebpf`)
- Then build the Docker image

### 2. Deploy Daemon to Kubernetes

```bash
# Deploy the daemon DaemonSet
kubectl apply -f k8s/daemonset.yaml

# Wait for pod to be ready
kubectl -n ebpf-telemetry wait --for=condition=ready pod -l app=ebpf-daemon --timeout=120s

# Or use Makefile
make deploy-daemon
```

### 3. Setup Port-Forward

```bash
# Kill any existing port-forwards
pkill -f "kubectl port-forward.*8080" 2>/dev/null

# Start port-forward (runs in background)
kubectl port-forward -n ebpf-telemetry svc/ebpf-daemon-service 8080:8080 > /tmp/port-forward.log 2>&1 &

# Or use Makefile (runs in foreground)
make port-forward
```

### 4. Run the Frontend

```bash
cd /home/irushig/Research/k8s-runtime-aware-ebpf-orchestration/frontend

# Install dependencies (if needed)
npm install

# Start development server
npm run dev
```

The frontend will be available at `http://localhost:5173` (or the port shown in the terminal).

---

## Complete Rebuild Script

If you need to rebuild everything from scratch:

```bash
#!/bin/bash
cd /home/irushig/Research/k8s-runtime-aware-ebpf-orchestration

# 1. Build daemon Docker image (no cache)
echo "🔨 Building daemon..."
docker build --no-cache -t ebpf-daemon:latest -f daemon/Dockerfile daemon/

# 2. Restart daemon pod
echo "🔄 Restarting daemon pod..."
kubectl delete pod -n ebpf-telemetry -l app=ebpf-daemon
sleep 15

# 3. Setup port-forward
echo "🔌 Setting up port-forward..."
pkill -f "kubectl port-forward.*8080" 2>/dev/null
sleep 2
kubectl port-forward -n ebpf-telemetry svc/ebpf-daemon-service 8080:8080 > /tmp/port-forward.log 2>&1 &

# 4. Start frontend
echo "🚀 Starting frontend..."
pkill -f vite 2>/dev/null
sleep 2
cd frontend
npm run dev > /tmp/frontend.log 2>&1 &

echo "✅ Done! Frontend: http://localhost:5173"
echo "📊 API: http://localhost:8080"
```

---

## Alternative: Local Development (Without Docker)

If you want to run the daemon locally (requires root):

```bash
# Build eBPF programs
make build-ebpf

# Build Go binary
make build-daemon

# Run daemon (requires sudo for eBPF)
sudo ./daemon/ebpf-daemon
```

Then run the frontend normally:
```bash
cd frontend && npm run dev
```

---

## Troubleshooting

### Check if daemon is running:
```bash
kubectl -n ebpf-telemetry get pods -l app=ebpf-daemon
kubectl -n ebpf-telemetry logs -l app=ebpf-daemon --tail=50
```

### Test API:
```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/metrics | jq .
```

### Check port-forward:
```bash
ps aux | grep "port-forward"
cat /tmp/port-forward.log
```

### Check frontend:
```bash
ps aux | grep vite
cat /tmp/frontend.log
```

