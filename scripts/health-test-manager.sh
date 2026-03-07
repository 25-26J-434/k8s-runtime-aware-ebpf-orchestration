#!/bin/bash

# Health Test Management Script
# This script helps deploy and manage health test services

set -e

NAMESPACE="health-test"
DAEMON_IMAGE="k8s-runtime-ebpf-daemon"

echo "🏥 Health Monitoring Test Environment Manager"
echo "============================================="

function deploy_test_services() {
    echo "📦 Deploying health test services..."
    
    # Apply the test deployments
    kubectl apply -f k8s/health-test-deployments.yaml
    
    echo "⏳ Waiting for deployments to be ready..."
    kubectl -n $NAMESPACE wait --for=condition=available --timeout=300s deployment/stable-test-service
    
    echo "✅ Test services deployed successfully!"
    echo ""
    echo "📊 Service status:"
    kubectl -n $NAMESPACE get pods -o wide
}

function trigger_pod_failure() {
    echo "💥 Triggering pod failures for testing..."
    
    # Kill a random flaky service pod
    FLAKY_POD=$(kubectl -n $NAMESPACE get pods -l app=flaky-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$FLAKY_POD" ]]; then
        echo "🔪 Killing flaky pod: $FLAKY_POD"
        kubectl -n $NAMESPACE delete pod $FLAKY_POD
    fi
    
    # Force restart a stable pod to see restart count increase
    STABLE_POD=$(kubectl -n $NAMESPACE get pods -l app=stable-test -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [[ -n "$STABLE_POD" ]]; then
        echo "🔄 Force restarting stable pod: $STABLE_POD"
        kubectl -n $NAMESPACE delete pod $STABLE_POD
    fi
}

function trigger_high_resource_usage() {
    echo "🔥 Triggering high resource usage..."
    
    # Deploy a resource-intensive pod
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: resource-bomb
  namespace: $NAMESPACE
  labels:
    app: resource-bomb
spec:
  containers:
  - name: cpu-bomb
    image: alpine:latest
    command: ["/bin/sh"]
    args: ["-c", "echo 'Starting CPU bomb...'; while true; do :; done"]
    resources:
      requests:
        cpu: 100m
        memory: 64Mi
      limits:
        cpu: 500m
        memory: 256Mi
  restartPolicy: Never
EOF
    
    echo "💣 CPU bomb deployed! This will create high CPU usage alerts."
    echo "⚠️  Use 'kubectl -n $NAMESPACE delete pod resource-bomb' to stop it."
}

function simulate_network_issues() {
    echo "🌐 Simulating network issues..."
    
    # Deploy a pod that creates network load and potential connectivity issues
    cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: network-stress
  namespace: $NAMESPACE
  labels:
    app: network-stress
spec:
  containers:
  - name: network-stress
    image: alpine:latest
    command: ["/bin/sh"]
    args: ["-c", "apk add --no-cache curl; while true; do for i in \$(seq 1 50); do curl -s --connect-timeout 1 google.com > /dev/null & done; wait; sleep 2; done"]
    resources:
      limits:
        cpu: 200m
        memory: 128Mi
  restartPolicy: Never
EOF
    
    echo "📡 Network stress pod deployed! This will create TCP retransmissions and latency."
    echo "⚠️  Use 'kubectl -n $NAMESPACE delete pod network-stress' to stop it."
}

function cleanup_test_env() {
    echo "🧹 Cleaning up test environment..."
    
    # Delete the namespace (this removes everything)
    kubectl delete namespace $NAMESPACE --force --grace-period=0 2>/dev/null || true
    
    echo "✅ Test environment cleaned up!"
}

function show_health_status() {
    echo "🏥 Current Health Status:"
    echo "========================"
    
    echo ""
    echo "📊 Pod Status:"
    kubectl -n $NAMESPACE get pods -o wide 2>/dev/null || echo "No pods found in $NAMESPACE namespace"
    
    echo ""
    echo "📈 Resource Usage:"
    kubectl top pods -n $NAMESPACE 2>/dev/null || echo "Metrics server not available or no pods found"
    
    echo ""
    echo "🔍 Recent Events:"
    kubectl -n $NAMESPACE get events --sort-by='.lastTimestamp' 2>/dev/null || echo "No events found"
}

function monitor_health_real_time() {
    echo "👀 Starting real-time health monitoring..."
    echo "Press Ctrl+C to stop monitoring"
    echo ""
    
    while true; do
        clear
        echo "🏥 Real-time Health Monitor - $(date)"
        echo "===================================="
        
        show_health_status
        
        echo ""
        echo "🌐 WebSocket Health Endpoint: ws://localhost:8080/ws/node-health"
        echo "📊 REST Health Endpoint: http://localhost:8080/api/cluster/node-health"
        echo ""
        echo "Refreshing in 10 seconds... (Ctrl+C to stop)"
        
        sleep 10
    done
}

function test_health_endpoints() {
    echo "🔍 Testing health monitoring endpoints..."
    
    echo "📊 Testing REST endpoint:"
    curl -s http://localhost:8080/api/cluster/node-health | jq '.' 2>/dev/null || echo "❌ REST endpoint not available or jq not installed"
    
    echo ""
    echo "📡 WebSocket endpoint available at: ws://localhost:8080/ws/node-health"
    echo "📊 Metrics endpoint available at: ws://localhost:8080/api/metrics/ws"
    
    echo ""
    echo "🌐 Frontend health dashboard: http://localhost:5173/health"
}

# Main menu
case "${1:-menu}" in
    "deploy")
        deploy_test_services
        ;;
    "fail")
        trigger_pod_failure
        ;;
    "stress-cpu")
        trigger_high_resource_usage
        ;;
    "stress-network")
        simulate_network_issues
        ;;
    "cleanup")
        cleanup_test_env
        ;;
    "status")
        show_health_status
        ;;
    "monitor")
        monitor_health_real_time
        ;;
    "test-endpoints")
        test_health_endpoints
        ;;
    "menu"|*)
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  deploy          Deploy test services for health monitoring"
        echo "  fail            Trigger pod failures for testing alerts"
        echo "  stress-cpu      Create high CPU usage to test resource alerts"
        echo "  stress-network  Create network stress to test TCP metrics"
        echo "  cleanup         Remove all test services"
        echo "  status          Show current health status"
        echo "  monitor         Real-time health monitoring"
        echo "  test-endpoints  Test health monitoring API endpoints"
        echo ""
        echo "Examples:"
        echo "  $0 deploy              # Setup test environment"
        echo "  $0 fail                # Trigger failures to see alerts"
        echo "  $0 stress-cpu          # Create high CPU usage"
        echo "  $0 monitor             # Watch health status in real-time"
        echo "  $0 cleanup             # Clean up when done testing"
        ;;
esac