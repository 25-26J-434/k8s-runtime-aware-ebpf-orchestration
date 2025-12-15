#!/bin/bash

# P2P Node Dashboard - Startup Script

set -e

PROJECT_DIR="/home/kavishka/Documents/p2p-go"
cd "$PROJECT_DIR"

echo "🚀 Starting P2P Node Dashboard..."
echo ""

# Check if dashboard-server binary exists
if [ ! -f "./dashboard-server" ]; then
    echo "📦 Building dashboard server..."
    go build -o dashboard-server cmd/dashboard-server/dashboard-server.go
    echo "✅ Build complete"
    echo ""
fi

# Check if client directory exists
if [ ! -d "./client" ]; then
    echo "❌ Error: client directory not found!"
    echo "Please ensure dashboard.html is in ./client/"
    exit 1
fi

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "⚠️  Warning: kubectl not found. Dashboard will not be able to send messages."
fi

# Check if pods are running
echo "🔍 Checking Kubernetes pods..."
if kubectl get pods -n kube-system -l app=node-daemon &> /dev/null; then
    POD_COUNT=$(kubectl get pods -n kube-system -l app=node-daemon --no-headers 2>/dev/null | wc -l)
    echo "✅ Found $POD_COUNT daemon pod(s) running"
else
    echo "⚠️  Warning: Could not find daemon pods. Deploy with:"
    echo "   kubectl apply -f peers-configmap.yaml"
    echo "   kubectl apply -f daemonset.yaml"
fi

echo ""
echo "🌐 Starting dashboard server on http://localhost:8000"
echo "📂 Serving files from: $PROJECT_DIR/client"
echo ""
echo "Press Ctrl+C to stop the server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Start the server
./dashboard-server
