#!/usr/bin/env bash
# create-nonrunning-pod.sh - create and optionally remove a pod that never enters Running state
#
# Usage:
#   ./create-nonrunning-pod.sh [create|delete] [name] [namespace]
#
# Defaults:
#   name=bogus
#   namespace=default
#
# Examples:
#   ./create-nonrunning-pod.sh create
#   ./create-nonrunning-pod.sh delete bogus testns

set -euo pipefail

cmd=${1:-create}
name=${2:-bogus}
ns=${3:-default}

manifest=$(mktemp)
trap 'rm -f "$manifest"' EXIT

cat <<EOF >"$manifest"
apiVersion: v1
kind: Pod
metadata:
  name: $name
  namespace: $ns
spec:
  containers:
  - name: fail
    image: busybox
    # the container will exit immediately with nonzero status
    command: ["sh","-c","exit 1"]
  restartPolicy: Never
EOF

case "$cmd" in
  create)
    echo "creating pod $name in namespace $ns"
    kubectl apply -f "$manifest"
    echo "pod status:"
    kubectl get pod "$name" -n "$ns" -o wide
    ;;
  delete)
    echo "deleting pod $name in namespace $ns"
    kubectl delete pod "$name" -n "$ns" --ignore-not-found
    ;;
  *)
    echo "unknown command '$cmd'" >&2
    echo "usage: $0 [create|delete] [name] [namespace]" >&2
    exit 1
    ;;
esac
