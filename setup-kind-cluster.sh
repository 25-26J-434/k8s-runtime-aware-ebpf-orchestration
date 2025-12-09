#!/bin/bash
set -e

echo "========================================="
echo "  Setting up Kind Cluster for eBPF"
echo "========================================="

# Check if kind is installed
if ! command -v kind &> /dev/null; then
    echo "❌ kind is not installed. Installing..."
    echo "Please run: curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.20.0/kind-linux-amd64"
    echo "            chmod +x ./kind"
    echo "            sudo mv ./kind /usr/local/bin/kind"
    exit 1
fi

# Check if cluster already exists
if kind get clusters 2>/dev/null | grep -q "^ebpf-cluster$"; then
    echo "⚠️  Cluster 'ebpf-cluster' already exists."
    read -p "Do you want to delete and recreate it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🗑️  Deleting existing cluster..."
        kind delete cluster --name ebpf-cluster
    else
        echo "✅ Using existing cluster"
        exit 0
    fi
fi

# Create kind cluster
echo "🚀 Creating kind cluster with eBPF support..."
kind create cluster --config k8s/kind-config.yaml

# Wait for cluster to be ready
echo "⏳ Waiting for cluster to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=120s

# Display cluster info
echo ""
echo "========================================="
echo "  ✅ Kind Cluster Ready!"
echo "========================================="
echo ""
kubectl get nodes
echo ""
echo "Cluster name: ebpf-cluster"
echo "Nodes: $(kubectl get nodes --no-headers | wc -l)"
echo ""
echo "Next steps:"
echo "  1. Run: ./rebuild-daemon.sh"
echo "  2. Deploy test pods: kubectl apply -f k8s/simple-test-pods.yaml"
echo ""
