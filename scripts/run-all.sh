#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=== [1/7] Setting up base cluster ==="
"${SCRIPT_DIR}/setup-base-cluster.sh"

echo "=== [2/7] Applying MongoDB manifests ==="
"${SCRIPT_DIR}/apply-mongo.sh"

echo "=== [3/7] Waiting for MongoDB StatefulSet to be ready ==="
kubectl -n mongo rollout status statefulset/mongo --timeout=300s

echo "=== [4/7] Initializing MongoDB replica set (if needed) ==="
MONGO_INIT_JS='
try {
  printjson(rs.status())
  print("rs0 already initialized")
} catch (e) {
  print("Initializing rs0...")
  rs.initiate({
    _id: "rs0",
    members: [
      { _id: 0, host: "mongo-0.mongo.mongo.svc.cluster.local:27017" },
      { _id: 1, host: "mongo-1.mongo.mongo.svc.cluster.local:27017" },
      { _id: 2, host: "mongo-2.mongo.mongo.svc.cluster.local:27017" }
    ]
  })
}
'
kubectl -n mongo exec mongo-0 -- mongosh --quiet --eval "${MONGO_INIT_JS}"

echo "=== [5/7] Building eBPF programs ==="
"${SCRIPT_DIR}/build-ebpf.sh"

echo "=== [6/7] Rebuilding daemon ==="
"${SCRIPT_DIR}/rebuild-daemon.sh"

echo "=== [7/7] Building/loading/applying test services ==="
"${SCRIPT_DIR}/build-load-apply-test-services.sh"

echo "=== All steps completed ==="
