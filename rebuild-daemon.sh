#!/bin/bash
set -e

echo "========================================="
echo "  Rebuilding eBPF Daemon"
echo "========================================="

# Step 1: Clean old binary
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAEMON_DIR="$ROOT_DIR/daemon"

echo "[1/6] Cleaning old binary..."
cd "$DAEMON_DIR"
rm -f ebpf-daemon

# Step 2: Rebuild Go binary
echo "[2/6] Building Go binary..."
go build -o ebpf-daemon ./cmd/daemon
ls -lh ebpf-daemon

# Step 3: Build Docker image with timestamp tag to force rebuild
echo "[3/6] Building Docker image..."
cd "$ROOT_DIR"
TIMESTAMP=$(date +%s)
sudo docker build --build-arg CACHEBUST=$TIMESTAMP -t ebpf-daemon:$TIMESTAMP -t ebpf-daemon:latest daemon

# Step 4: Load image into kind cluster
echo "[4/6] Loading image into kind cluster..."
kind load docker-image ebpf-daemon:latest --name ebpf-cluster

# Step 5: Deploy/Update daemon
echo "[5/6] Deploying daemon to cluster..."
kubectl apply -f k8s/namespace.yaml 2>/dev/null || true
kubectl apply -f k8s/daemonset.yaml

# Step 6: Restart daemon pod to use new image
echo "[6/6] Restarting daemon pod..."
kubectl -n ebpf-telemetry delete pod -l app=ebpf-daemon --ignore-not-found=true
kubectl -n ebpf-telemetry wait --for=condition=ready pod -l app=ebpf-daemon --timeout=60s

echo ""
echo "========================================="
echo "  Rebuild Complete!"
echo "========================================="
echo ""
echo "Daemon pod status:"
kubectl get pods -n ebpf-telemetry
echo ""
echo "Test with:"
echo "  kubectl port-forward -n ebpf-telemetry svc/ebpf-daemon 8080:8080"
echo "  curl http://localhost:8080/metrics/json | jq '.dns.pods'"
echo ""
