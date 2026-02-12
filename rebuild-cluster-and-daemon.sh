#!/bin/bash
set -e

echo "═══════════════════════════════════════════════════════"
echo "   REBUILD KIND CLUSTER & DAEMON"
echo "═══════════════════════════════════════════════════════"
echo ""

# Get the project root directory (same pattern as setup.sh and rebuild-daemon.sh)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Step 1: Base cluster = Kind with default CNI disabled + Cilium via Cilium CLI (for all 4 components)
echo "[1/6] Creating base cluster (Kind + Cilium via Cilium CLI)..."
chmod +x scripts/setup-base-cluster.sh
PATH="$(pwd)/.tools:$PATH" ./scripts/setup-base-cluster.sh
echo ""

# Step 2: Rebuild eBPF programs
echo "[2/6] Rebuilding eBPF programs..."
chmod +x scripts/build-ebpf.sh
./scripts/build-ebpf.sh
echo "   eBPF programs rebuilt"
echo ""

# Step 3: Rebuild Go daemon binary
echo "[3/6] Rebuilding Go daemon..."
cd daemon
go build -o ebpf-daemon ./cmd/daemon
cd ..
echo "   Go daemon rebuilt"
echo ""

# Step 4: Build Docker image
echo "[4/6] Building Docker image..."
TIMESTAMP=$(date +%s)
docker build --build-arg CACHEBUST=$TIMESTAMP -t ebpf-daemon:latest daemon
echo "   Docker image built"
echo ""

# Step 5: Load image into kind cluster
echo "[5/6] Loading image into kind cluster..."
kind load docker-image ebpf-daemon:latest --name ebpf-cluster
echo "   Image loaded into cluster"
echo ""

# Step 6: Deploy Component 1 daemon
echo "[6/6] Deploying Component 1 daemon..."
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/daemonset.yaml
kubectl -n ebpf-telemetry wait --for=condition=ready pod -l app=ebpf-daemon --timeout=120s
echo "   Daemon deployed and ready"
echo ""

echo "═══════════════════════════════════════════════════════"
echo "    CLUSTER & DAEMON REBUILD COMPLETE"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Cluster: ebpf-cluster (Kind + Cilium, all 4 components)"
echo "Nodes: $(kubectl get nodes --no-headers | wc -l)"
echo ""
echo "Next steps:"
echo "  1. Port forward: kubectl -n ebpf-telemetry port-forward svc/ebpf-daemon 8080:8080 &"
echo "  2. Start frontend: cd frontend && npm run dev"
echo ""
