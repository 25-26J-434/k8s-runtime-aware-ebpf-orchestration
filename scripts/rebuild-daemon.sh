#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

IMAGE_TAG="ebpf-daemon:latest"
KIND_CLUSTER="ebpf-cluster"
NAMESPACE="ebpf-telemetry"
APP_LABEL="app=ebpf-daemon"

echo "[1/6] Building daemon image..."
docker build -t "$IMAGE_TAG" -f "$PROJECT_ROOT/daemon/Dockerfile" "$PROJECT_ROOT/daemon"

echo "[2/6] Loading image into Kind cluster: $KIND_CLUSTER"
kind load docker-image "$IMAGE_TAG" --name "$KIND_CLUSTER"

echo "[3/6] Ensuring namespace exists: $NAMESPACE"
kubectl apply -f "$PROJECT_ROOT/k8s/namespace.yaml"

echo "[4/6] Applying DaemonSet and RBAC manifests"
kubectl apply -f "$PROJECT_ROOT/k8s/daemonset.yaml"

echo "[5/6] Restarting daemon pods in namespace $NAMESPACE"
kubectl -n "$NAMESPACE" delete pod -l "$APP_LABEL"

echo "[6/6] Listing daemon pods (should show recreated pods once ready)"
kubectl -n "$NAMESPACE" get pods -o wide
