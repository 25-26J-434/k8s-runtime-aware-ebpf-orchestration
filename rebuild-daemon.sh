#!/bin/bash
set -e

echo "========================================="
echo "  Rebuilding eBPF Daemon"
echo "========================================="

# Get the project root directory
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAEMON_DIR="$ROOT_DIR/daemon"

# Step 1: Rebuild eBPF programs
echo "[1/6] Rebuilding eBPF programs..."
chmod +x "$ROOT_DIR/scripts/build-ebpf.sh"
"$ROOT_DIR/scripts/build-ebpf.sh"

# Step 2: Clean old binary
echo "[2/6] Cleaning old binary..."
cd "$DAEMON_DIR"
rm -f ebpf-daemon

# Step 3: Rebuild Go binary
echo "[3/6] Building Go binary..."
go build -o ebpf-daemon ./cmd/daemon
ls -lh ebpf-daemon

# Step 4: Build Docker image with timestamp tag to force rebuild
echo "[4/6] Building Docker image..."
cd "$ROOT_DIR"
TIMESTAMP=$(date +%s)
docker build --build-arg CACHEBUST=$TIMESTAMP -t ebpf-daemon:latest daemon

# Step 5: Load image into kind cluster
echo "[5/6] Loading image into kind cluster..."
kind load docker-image ebpf-daemon:latest --name ebpf-cluster

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
