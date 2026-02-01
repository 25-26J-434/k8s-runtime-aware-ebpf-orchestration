#!/bin/bash
# Create Kind cluster with Cilium as the CNI (no default kindnet).
# Uses Cilium CLI to install Cilium (no Helm required). Component 1 and Component 2 both work.
# Our k8s/kind-config.yaml is Cilium's base + project-specific eBPF mounts and ports.
# Use this base cluster for all 4 components: Component 1 (daemon), 2 (routing), 3 (scaling), 4 (node-comm).
# Avoids conflicts between kindnet, CoreDNS, and Cilium when Component 1 and Component 2 run together.
#
# Cilium docs: https://docs.cilium.io/en/stable/installation/kind/
# Note: Cilium may fail due to "too many open files" - increase inotify limits on host if needed.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
K8S_DIR="${ROOT_DIR}/k8s"
TOOLS_DIR="${ROOT_DIR}/.tools"
CLUSTER_NAME="ebpf-cluster"

# Cilium version to match Kind/Cilium docs; LocalRedirectPolicy supported
CILIUM_VERSION="${CILIUM_VERSION:-1.18.6}"

# Ensure Cilium CLI is available (check PATH and .tools)
ensure_cilium_cli() {
    if command -v cilium >/dev/null 2>&1; then
        return 0
    fi
    if [ -x "${TOOLS_DIR}/cilium" ]; then
        export PATH="${TOOLS_DIR}:${PATH}"
        return 0
    fi
    echo "   Installing Cilium CLI to .tools..."
    mkdir -p "$TOOLS_DIR"
    CILIUM_CLI_VERSION="$(curl -s https://raw.githubusercontent.com/cilium/cilium-cli/main/stable.txt)"
    CLI_ARCH="amd64"
    [ "$(uname -m)" = "aarch64" ] || [ "$(uname -m)" = "arm64" ] && CLI_ARCH="arm64"
    curl -fsSL -o "${TOOLS_DIR}/cilium.tar.gz" \
        "https://github.com/cilium/cilium-cli/releases/download/${CILIUM_CLI_VERSION}/cilium-linux-${CLI_ARCH}.tar.gz"
    tar -xzf "${TOOLS_DIR}/cilium.tar.gz" -C "${TOOLS_DIR}"
    # Tarball may contain linux-amd64/cilium or cilium at root
    if [ -f "${TOOLS_DIR}/linux-${CLI_ARCH}/cilium" ]; then
        mv "${TOOLS_DIR}/linux-${CLI_ARCH}/cilium" "${TOOLS_DIR}/cilium"
        rm -rf "${TOOLS_DIR}/linux-${CLI_ARCH}"
    elif [ ! -f "${TOOLS_DIR}/cilium" ]; then
        echo "   Error: failed to extract Cilium CLI"
        exit 1
    fi
    rm -f "${TOOLS_DIR}/cilium.tar.gz"
    chmod +x "${TOOLS_DIR}/cilium"
    export PATH="${TOOLS_DIR}:${PATH}"
}

# Use Cilium's official kind-config from their repo (per Cilium docs), or our merged config.
# Set USE_CILIUM_OFFICIAL_CONFIG=1 to use Cilium's vanilla config (no eBPF mounts; Component 1 won't work).
USE_CILIUM_OFFICIAL="${USE_CILIUM_OFFICIAL_CONFIG:-0}"

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

# 2. Create Kind cluster (Cilium's kind-config: disableDefaultCNI=true)
echo "[2/6] Creating Kind cluster..."
if [ "$USE_CILIUM_OFFICIAL" = "1" ]; then
    KIND_CONFIG_SRC="https://raw.githubusercontent.com/cilium/cilium/${CILIUM_VERSION}/Documentation/installation/kind-config.yaml"
    KIND_CONFIG="${ROOT_DIR}/kind-config.yaml"
    echo "   Fetching Cilium's official kind-config (per Cilium docs)..."
    curl -fsSL -o "$KIND_CONFIG" "$KIND_CONFIG_SRC"
else
    KIND_CONFIG="${K8S_DIR}/kind-config.yaml"
fi
echo "   Using config: $KIND_CONFIG"
kind create cluster --name "$CLUSTER_NAME" --config "$KIND_CONFIG"
echo "   Cluster created (nodes will be NotReady until Cilium is installed)"
echo ""

# 3. Preload Cilium image into Kind (per Cilium Kind installation docs)
echo "[3/6] Preloading Cilium image into Kind..."
docker pull "quay.io/cilium/cilium:v${CILIUM_VERSION}" || true
kind load docker-image "quay.io/cilium/cilium:v${CILIUM_VERSION}" --name "$CLUSTER_NAME"
echo "   Cilium image loaded"
echo ""

# 4. Ensure Cilium CLI and install Cilium (no Helm required)
echo "[4/6] Installing Cilium via Cilium CLI (Kind + LocalRedirectPolicy for Component 2)..."
ensure_cilium_cli
# k8sServiceHost: Kind control plane container name for cluster "ebpf-cluster"
cilium install \
  --version "v${CILIUM_VERSION}" \
  --set image.pullPolicy=IfNotPresent \
  --set ipam.mode=kubernetes \
  --set localRedirectPolicy=true \
  --set k8sServiceHost=ebpf-cluster-control-plane \
  --set k8sServicePort=6443
echo "   Cilium installed"
echo ""

# 5. Wait for Cilium and nodes
echo "[5/6] Waiting for Cilium and nodes..."
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
