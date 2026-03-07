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
KIND_CONFIG="${K8S_DIR}/kind-config.yaml"

# Cilium version to match Kind/Cilium docs; LocalRedirectPolicy supported
CILIUM_VERSION="${CILIUM_VERSION:-1.18.6}"
# Default platform for images we preload into Kind (override with CILIUM_IMAGE_PLATFORM)
CILIUM_PLATFORM_ARCH="amd64"
[ "$(uname -m)" = "aarch64" ] || [ "$(uname -m)" = "arm64" ] && CILIUM_PLATFORM_ARCH="arm64"
CILIUM_IMAGE_PLATFORM="${CILIUM_IMAGE_PLATFORM:-linux/${CILIUM_PLATFORM_ARCH}}"
CILIUM_IMAGE="quay.io/cilium/cilium:v${CILIUM_VERSION}"
# Allow skipping preloading (Cilium CLI will pull images if needed)
PRELOAD_CILIUM_IMAGE="${PRELOAD_CILIUM_IMAGE:-1}"

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
if [ ! -f "$KIND_CONFIG" ]; then
    echo "   Error: Kind config not found at $KIND_CONFIG"
    exit 1
fi
echo "   Using config: $KIND_CONFIG"
kind create cluster --name "$CLUSTER_NAME" --config "$KIND_CONFIG"
echo "   Cluster created (nodes will be NotReady until Cilium is installed)"
echo ""

# 3. Preload Cilium image into Kind (per Cilium Kind installation docs)
if [ "${PRELOAD_CILIUM_IMAGE}" = "1" ]; then
    echo "[3/6] Preloading Cilium image into Kind..."
    docker pull --platform="${CILIUM_IMAGE_PLATFORM}" "${CILIUM_IMAGE}" || true
    PRELOAD_OK=0
    if kind load docker-image "${CILIUM_IMAGE}" --name "$CLUSTER_NAME"; then
        PRELOAD_OK=1
    else
        echo "   kind load failed; retrying via image-archive to avoid multi-arch digest issues (platform: ${CILIUM_IMAGE_PLATFORM})..."
        TMP_CILIUM_TAR="$(mktemp "/tmp/cilium-${CILIUM_VERSION}-XXXX.tar")"
        if docker save "${CILIUM_IMAGE}" -o "${TMP_CILIUM_TAR}"; then
            if kind load image-archive "${TMP_CILIUM_TAR}" --name "$CLUSTER_NAME"; then
                PRELOAD_OK=1
            else
                echo "   WARN: kind load image-archive failed (will let Cilium CLI pull images)"
            fi
        else
            echo "   WARN: docker save failed; skipping preload (Cilium CLI will pull images)"
        fi
        rm -f "${TMP_CILIUM_TAR}"
    fi
    if [ "${PRELOAD_OK}" = "1" ]; then
        echo "   Cilium image loaded"
    else
        echo "   Continuing without preloading Cilium image"
    fi
    echo ""
else
    echo "[3/6] Skipping preload (PRELOAD_CILIUM_IMAGE=${PRELOAD_CILIUM_IMAGE})"
    echo ""
fi

# 4. Ensure Cilium CLI and install Cilium (no Helm required)
echo "[4/7] Installing Cilium via Cilium CLI (Kind + LocalRedirectPolicy, kube-proxy replacement)..."
ensure_cilium_cli
# k8sServiceHost: Kind control plane container name for cluster "ebpf-cluster"
cilium install \
  --version "v${CILIUM_VERSION}" \
  --set image.pullPolicy=IfNotPresent \
  --set ipam.mode=kubernetes \
  --set localRedirectPolicy=true \
  --set kubeProxyReplacement=true \
  --set enable-bpf-masquerade=true \
  --set k8sServiceHost=ebpf-cluster-control-plane \
  --set k8sServicePort=6443
echo "   Cilium installed"
echo ""

# 5. Remove kube-proxy (Cilium handles Services via eBPF)
echo "[5/7] Removing kube-proxy (kube-proxy replacement enabled in Cilium)..."
kubectl -n kube-system delete ds kube-proxy --ignore-not-found
kubectl -n kube-system delete cm kube-proxy --ignore-not-found
echo "   kube-proxy removed"
echo ""

# 6. Wait for Cilium and nodes
echo "[6/7] Waiting for Cilium and nodes..."
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