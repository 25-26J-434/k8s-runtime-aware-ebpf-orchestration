#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

TAG="${TAG:-dnat-sync-$(date +%Y%m%d%H%M%S)}"
IMAGE_TAG="ebpf-daemon:${TAG}"
KIND_CLUSTER="ebpf-cluster"
NAMESPACE="ebpf-telemetry"
APP_LABEL="app=ebpf-daemon"

echo "[1/6] Building daemon image..."
DOCKER_NO_CACHE="${DOCKER_NO_CACHE:-0}"
if [ "$DOCKER_NO_CACHE" = "1" ]; then
  docker build --no-cache -t "$IMAGE_TAG" -f "$PROJECT_ROOT/daemon/Dockerfile" "$PROJECT_ROOT/daemon"
else
  docker build -t "$IMAGE_TAG" -f "$PROJECT_ROOT/daemon/Dockerfile" "$PROJECT_ROOT/daemon"
fi

echo "[2/6] Loading image into Kind cluster: $KIND_CLUSTER"
kind load docker-image "$IMAGE_TAG" --name "$KIND_CLUSTER"

echo "[3/6] Ensuring namespace exists: $NAMESPACE"
kubectl apply -f "$PROJECT_ROOT/k8s/namespace.yaml"

echo "[4/7] Applying DaemonSet and RBAC manifests"
kubectl apply -f "$PROJECT_ROOT/k8s/daemonset.yaml"

echo "[5/7] Setting DaemonSet image to: $IMAGE_TAG"
kubectl -n "$NAMESPACE" set image ds/ebpf-daemon daemon="$IMAGE_TAG"

echo "[6/7] Restarting daemon pods in namespace $NAMESPACE"
kubectl -n "$NAMESPACE" rollout restart ds/ebpf-daemon
kubectl -n "$NAMESPACE" rollout status ds/ebpf-daemon

echo "[7/7] Listing daemon pods (should show recreated pods once ready)"
kubectl -n "$NAMESPACE" get pods -o wide
