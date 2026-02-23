#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-ebpf-cluster}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

echo "=== Building test service images (tag: ${IMAGE_TAG}) ==="
docker build -t service-a:${IMAGE_TAG} examples/service-a/
docker build -t service-b:${IMAGE_TAG} examples/service-b/
docker build -t service-c:${IMAGE_TAG} examples/service-c/
docker build -t tcp-client:${IMAGE_TAG} examples/tcp-client/

echo "=== Loading images into kind cluster: ${CLUSTER_NAME} ==="
kind load docker-image \
  service-a:${IMAGE_TAG} \
  service-b:${IMAGE_TAG} \
  service-c:${IMAGE_TAG} \
  tcp-client:${IMAGE_TAG} \
  --name "${CLUSTER_NAME}"

echo "=== Applying test services ==="
kubectl apply -f k8s/test-services.yaml

echo "=== Done ==="
