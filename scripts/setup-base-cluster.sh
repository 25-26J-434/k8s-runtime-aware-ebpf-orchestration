#!/bin/bash
# Create Kind cluster with Cilium as the CNI (no default kindnet).
# Use this base cluster for all 4 components: Component 1 (daemon), 2 (routing), 3 (scaling), 4 (node-comm).
# Avoids conflicts between kindnet, CoreDNS, and Cilium when Component 1 and Component 2 run together.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KIND_CONFIG="${ROOT_DIR}/k8s/kind-config.yaml"
CLUSTER_NAME="ebpf-cluster"

# Cilium version to match Kind/Cilium docs; LocalRedirectPolicy supported
CILIUM_VERSION="${CILIUM_VERSION:-1.18.6}"

echo "═══════════════════════════════════════════════════════"
echo "   BASE CLUSTER: Kind + Cilium (all 4 components)"
echo "═══════════════════════════════════════════════════════"
echo ""

cd "$ROOT_DIR"

# 1. Delete existing cluster if present
echo "[1/6] Checking for existing cluster..."
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
    echo "   Deleting existing cluster..."
    kind delete cluster --name "$CLUSTER_NAME"
    echo "   Cluster deleted"
else
    echo "   No existing cluster found"
fi
echo ""

# 2. Create Kind cluster (default CNI disabled in kind-config.yaml)
echo "[2/6] Creating Kind cluster (disableDefaultCNI=true)..."
kind create cluster --name "$CLUSTER_NAME" --config "$KIND_CONFIG"
echo "   Cluster created (nodes will be NotReady until Cilium is installed)"
echo ""

# 3. Preload Cilium image into Kind (per Cilium Kind installation docs)
echo "[3/6] Preloading Cilium image into Kind..."
docker pull "quay.io/cilium/cilium:v${CILIUM_VERSION}" || true
kind load docker-image "quay.io/cilium/cilium:v${CILIUM_VERSION}" --name "$CLUSTER_NAME"
echo "   Cilium image loaded"
echo ""

# 4. Helm repo
echo "[4/6] Adding Cilium Helm repo..."
helm repo add cilium https://helm.cilium.io/
helm repo update
echo ""

# 5. Install Cilium with Kind-specific settings and LocalRedirectPolicy for Component 2
# k8sServiceHost: Kind control plane container name for cluster "ebpf-cluster"
echo "[5/6] Installing Cilium (Kind + LocalRedirectPolicy for Component 2)..."
helm upgrade --install cilium cilium/cilium --version "$CILIUM_VERSION" \
  --namespace kube-system \
  --set image.pullPolicy=IfNotPresent \
  --set ipam.mode=kubernetes \
  --set localRedirectPolicy=true \
  --set k8sServiceHost=ebpf-cluster-control-plane \
  --set k8sServicePort=6443
echo "   Cilium installed"
echo ""

# 6. Wait for Cilium and nodes
echo "[6/6] Waiting for Cilium and nodes..."
kubectl wait --for=condition=ready pod -l k8s-app=cilium -n kube-system --timeout=300s
kubectl wait --for=condition=Ready nodes --all --timeout=120s
echo "   Cilium and nodes ready"
echo ""

echo "═══════════════════════════════════════════════════════"
echo "    BASE CLUSTER READY"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Cluster: $CLUSTER_NAME"
echo "CNI: Cilium (LocalRedirectPolicy enabled for Component 2)"
echo "Nodes: $(kubectl get nodes --no-headers | wc -l)"
echo ""
echo "Next: deploy Component 1 (daemon) and other components as needed."
echo "  ./rebuild-cluster-and-daemon.sh  # full rebuild including Component 1"
echo "  Or: kubectl apply -f k8s/namespace.yaml && kubectl apply -f k8s/daemonset.yaml"
echo ""
