#!/bin/bash
set -e

echo "═══════════════════════════════════════════════════════"
echo "   COMPLETE REBUILD & START SCRIPT"
echo "═══════════════════════════════════════════════════════"
echo ""

# Get the project root directory
PROJECT_ROOT="/home/irushig/Research/k8s-runtime-aware-ebpf-orchestration"
cd "$PROJECT_ROOT"

# Step 1: Rebuild eBPF programs
echo "[1/7] Rebuilding eBPF programs..."
chmod +x scripts/build-ebpf.sh
./scripts/build-ebpf.sh
echo "eBPF programs rebuilt"
echo ""

# Step 2: Rebuild Go daemon binary
echo "[2/7] Rebuilding Go daemon..."
cd daemon
go build -o ebpf-daemon ./cmd/daemon
cd ..
echo "Go daemon rebuilt"
echo ""

# Step 3: Build Docker image
echo "[3/7] Building Docker image..."
TIMESTAMP=$(date +%s)
docker build --build-arg CACHEBUST=$TIMESTAMP -t ebpf-daemon:latest daemon
echo "Docker image built"
echo ""

# Step 4: Load image into kind cluster
echo "[4/7] Loading image into kind cluster..."
kind load docker-image ebpf-daemon:latest --name ebpf-cluster
echo "Image loaded into cluster"
echo ""

# Step 5: Restart daemon pod
echo "[5/7] Restarting daemon pod..."
kubectl -n ebpf-telemetry delete pod -l app=ebpf-daemon --ignore-not-found=true
kubectl -n ebpf-telemetry wait --for=condition=ready pod -l app=ebpf-daemon --timeout=60s
echo "Daemon pod restarted"
echo ""

# Step 6: Set up port forwarding (kill old one first)
echo "[6/7] Setting up port forwarding..."
pkill -f "kubectl.*port-forward.*ebpf-daemon.*8080" || true
sleep 1
kubectl port-forward -n ebpf-telemetry svc/ebpf-daemon 8080:8080 > /tmp/ebpf-port-forward.log 2>&1 &
sleep 2
echo "Port forwarding active (logs: /tmp/ebpf-port-forward.log)"
echo ""

# Step 7: Start frontend
echo "[7/7] Starting frontend..."
echo ""
echo "═══════════════════════════════════════════════════════"
echo "   BACKEND READY"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Backend API: http://localhost:8080/api/metrics"
echo "Frontend will start on: http://localhost:5000"
echo ""
echo "Starting frontend dev server..."
echo ""

cd frontend
npm run dev




