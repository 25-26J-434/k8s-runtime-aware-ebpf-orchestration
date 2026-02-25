#!/usr/bin/env bash
set -euo pipefail

kubectl apply -f k8s/mongo-namespace.yaml
kubectl apply -f k8s/mongo-headless.yaml
kubectl apply -f k8s/mongo-statefulset.yaml

echo "[mongo] Waiting for pods to be ready..."
kubectl -n mongo wait --for=condition=ready pod -l app.kubernetes.io/name=mongo --timeout=300s

echo "[mongo] Initiating replica set (rs0) if needed..."
kubectl -n mongo exec -it mongo-0 -- mongosh --eval '
if (rs.status().ok !== 1) {
  rs.initiate({
    _id: "rs0",
    members: [
      { _id: 0, host: "mongo-0.mongo.mongo.svc.cluster.local:27017" },
      { _id: 1, host: "mongo-1.mongo.mongo.svc.cluster.local:27017" },
      { _id: 2, host: "mongo-2.mongo.mongo.svc.cluster.local:27017" }
    ]
  })
} else {
  print("rs0 already initialized")
}
'

echo "[mongo] Replica set status:"
kubectl -n mongo exec -it mongo-0 -- mongosh --eval 'rs.status()'
