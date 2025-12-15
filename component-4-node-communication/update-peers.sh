#!/usr/bin/env bash
set -euo pipefail

NAMESPACE=${NAMESPACE:-kube-system}
CONFIGMAP_NAME=${CONFIGMAP_NAME:-node-daemon-peers}

# Collect InternalIPs for all nodes
kubectl get nodes -o jsonpath='{range .items[*]}{.status.addresses[?(@.type=="InternalIP")].address}{"\n"}{end}' | awk 'NF' > /tmp/peers.txt

echo "Discovered peers:" >&2
cat /tmp/peers.txt >&2

# Recreate configmap from peers.txt
kubectl -n "$NAMESPACE" delete configmap "$CONFIGMAP_NAME" 2>/dev/null || true
kubectl -n "$NAMESPACE" create configmap "$CONFIGMAP_NAME" --from-file=peers.txt=/tmp/peers.txt

kubectl -n "$NAMESPACE" get configmap "$CONFIGMAP_NAME" -o yaml

echo "Updated $CONFIGMAP_NAME in namespace $NAMESPACE" >&2
