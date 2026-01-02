#!/bin/bash
set -e

echo "═══════════════════════════════════════════════════════"
echo "   REBUILD KIND CLUSTER & DAEMON"
echo "═══════════════════════════════════════════════════════"
echo ""

PROJECT_ROOT="/home/irushig/Research/k8s-runtime-aware-ebpf-orchestration"
cd "$PROJECT_ROOT"

# Step 1: Delete existing cluster if it exists
echo "[1/6] Checking for existing cluster..."
if kind get clusters 2>/dev/null | grep -q "^ebpf-cluster$"; then
    echo "   Deleting existing cluster..."
    kind delete cluster --name ebpf-cluster
    echo "   Cluster deleted"
else
    echo "   No existing cluster found"
fi
echo ""

# Step 2: Create new cluster with updated config
echo "[2/6] Creating new Kind cluster with updated config..."
kind create cluster --name ebpf-cluster --config k8s/kind-config.yaml
echo "   Cluster created"
echo ""

# Wait for cluster to be ready
echo "[3/6] Waiting for cluster to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=120s
echo "   Cluster ready"
echo ""

# Step 3: Rebuild eBPF programs
echo "[4/6] Rebuilding eBPF programs..."
chmod +x scripts/build-ebpf.sh
./scripts/build-ebpf.sh
echo "   eBPF programs rebuilt"
echo ""

# Step 4: Rebuild Go daemon binary
echo "[5/6] Rebuilding Go daemon..."
cd daemon
go build -o ebpf-daemon ./cmd/daemon
cd ..
echo "   Go daemon rebuilt"
echo ""

# Step 5: Build Docker image
echo "[6/6] Building Docker image..."
TIMESTAMP=$(date +%s)
docker build --build-arg CACHEBUST=$TIMESTAMP -t ebpf-daemon:latest daemon
echo "   Docker image built"
echo ""

# Step 6: Load image into kind cluster
echo "[7/6] Loading image into kind cluster..."
kind load docker-image ebpf-daemon:latest --name ebpf-cluster
echo "   Image loaded into cluster"
echo ""

# Step 7: Deploy daemon
echo "[8/6] Deploying daemon..."
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/daemonset.yaml
kubectl -n ebpf-telemetry wait --for=condition=ready pod -l app=ebpf-daemon --timeout=120s
echo "   Daemon deployed and ready"
echo ""

echo "═══════════════════════════════════════════════════════"
echo "    CLUSTER & DAEMON REBUILD COMPLETE"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Cluster: ebpf-cluster"
echo "Nodes: $(kubectl get nodes --no-headers | wc -l)"
echo ""
echo "Next steps:"
echo "  1. Port forward: kubectl -n ebpf-telemetry port-forward svc/ebpf-daemon 8080:8080 &"
echo "  2. Start frontend: cd frontend && npm run dev"
echo ""
