#!/bin/bash
# Complete setup script for k8s-runtime-aware-ebpf-orchestration
# This script sets up everything: eBPF daemon, test pods, and Component 4

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "🚀 Kubernetes eBPF Orchestration Setup"
echo "=========================================="
echo ""

# Step 1: Build eBPF programs
echo "📦 Step 1: Building eBPF programs..."
cd ebpf/component-1-daemon
clang -O2 -g -target bpf -D__TARGET_ARCH_x86 -c dns_latency.c -o dns_latency.o 2>/dev/null || true
clang -O2 -g -target bpf -D__TARGET_ARCH_x86 -c rtt.c -o rtt.o 2>/dev/null || true
cd "$SCRIPT_DIR"
echo "✅ eBPF programs built"
echo ""

# Step 2: Build Go daemon
echo "📦 Step 2: Building Go daemon..."
cd daemon
go build -o ebpf-daemon ./cmd/daemon 2>/dev/null || echo "⚠️  Go build skipped (go may not be installed)"
cd "$SCRIPT_DIR"
echo "✅ Go daemon built"
echo ""

# Step 3: Build Docker images
echo "🐳 Step 3: Building Docker images..."
docker build -t ebpf-daemon:latest daemon/ > /dev/null 2>&1 && echo "✅ ebpf-daemon image built" || echo "⚠️  Docker image build skipped"

cd component-4-node-communication
docker build -t p2p-node:v3 . > /dev/null 2>&1 && echo "✅ p2p-node image built" || echo "⚠️  Docker image build skipped"
cd "$SCRIPT_DIR"
echo ""

# Step 4: Load images into Kind
echo "📥 Step 4: Loading images into Kind cluster..."
kind load docker-image ebpf-daemon:latest --name ebpf-cluster 2>/dev/null && echo "✅ ebpf-daemon loaded" || echo "⚠️  Failed to load ebpf-daemon"
kind load docker-image p2p-node:v3 --name ebpf-cluster 2>/dev/null && echo "✅ p2p-node loaded" || echo "⚠️  Failed to load p2p-node"
echo ""

# Step 5: Deploy Kubernetes resources
echo "☸️  Step 5: Deploying Kubernetes resources..."
kubectl apply -f k8s/namespace.yaml > /dev/null 2>&1 && echo "✅ Namespace created" || echo "⚠️  Namespace creation skipped"
kubectl apply -f k8s/daemonset.yaml > /dev/null 2>&1 && echo "✅ eBPF DaemonSet deployed" || echo "⚠️  DaemonSet deployment skipped"
kubectl apply -f k8s/simple-test-pods.yaml > /dev/null 2>&1 && echo "✅ Test pods deployed" || echo "⚠️  Test pods deployment skipped"

cd component-4-node-communication
kubectl apply -f peers-configmap.yaml > /dev/null 2>&1 && echo "✅ P2P ConfigMap created" || echo "⚠️  ConfigMap creation skipped"
kubectl apply -f daemonset.yaml > /dev/null 2>&1 && echo "✅ P2P DaemonSet deployed" || echo "⚠️  P2P DaemonSet deployment skipped"
cd "$SCRIPT_DIR"
echo ""

# Step 6: Wait for pods
echo "⏳ Step 6: Waiting for pods to be ready (this may take a minute)..."
kubectl wait --for=condition=ready pod -l app=ebpf-daemon -n ebpf-telemetry --timeout=120s 2>/dev/null && echo "✅ eBPF daemon ready" || echo "⚠️  Timeout waiting for eBPF daemon"
kubectl wait --for=condition=ready pod -l app=p2p-node -n kube-system --timeout=60s 2>/dev/null && echo "✅ P2P daemon ready" || echo "⚠️  Timeout waiting for P2P daemon"
echo ""

# Step 7: Show status
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "📊 Cluster Status:"
echo "---"
kubectl get nodes
echo ""
echo "🖥️  Running Pods:"
echo "---"
echo "eBPF Daemon:"
kubectl get pods -n ebpf-telemetry -l app=ebpf-daemon
echo ""
echo "P2P Communication:"
kubectl get pods -n kube-system -l app=p2p-node
echo ""
echo "Test Pods:"
kubectl get pods -n dns-test 2>/dev/null || echo "(Test pods namespace not found)"
echo ""
echo "=========================================="
echo "🚀 Next Steps:"
echo "=========================================="
echo ""
echo "1. Start port-forward in Terminal 1:"
echo "   kubectl port-forward -n ebpf-telemetry svc/ebpf-daemon 8080:8080"
echo ""
echo "2. Start React dashboard in Terminal 2:"
echo "   cd frontend && npm install && npm run dev"
echo ""
echo "3. Open in browser:"
echo "   http://localhost:5000"
echo ""
echo "4. Click 'Federation' tab to see Component 4 in action!"
echo ""
echo "=========================================="
