#!/usr/bin/env bash
set -euo pipefail

kubectl apply -f k8s/mongo-namespace.yaml
kubectl apply -f k8s/mongo-headless.yaml
kubectl apply -f k8s/mongo-statefulset.yaml
