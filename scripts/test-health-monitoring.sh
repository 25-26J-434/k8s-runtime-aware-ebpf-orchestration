#!/bin/bash

# Quick Test Script for Health Monitoring
# This script tests the health monitoring system end-to-end

set -e

echo "🧪 Health Monitoring Test Suite"
echo "==============================="
echo ""

function check_daemon() {
    echo "🔍 Checking if daemon is running..."
    if ps aux | grep -v grep | grep "daemon" > /dev/null; then
        echo "✅ Daemon process found"
    else
        echo "❌ Daemon not running. Start it first:"
        echo "   cd daemon && go run cmd/daemon/main.go"
        exit 1
    fi
}

function check_health_endpoints() {
    echo "🌐 Testing health monitoring endpoints..."
    
    echo "📊 Testing REST health endpoint..."
    if curl -s http://localhost:8080/api/cluster/node-health > /dev/null; then
        echo "✅ REST health endpoint accessible"
        echo "   URL: http://localhost:8080/api/cluster/node-health"
    else
        echo "❌ REST health endpoint not accessible"
        echo "   Make sure daemon is running on port 8080"
    fi
    
    echo "📡 Testing unified metrics endpoint..."
    if curl -s http://localhost:8080/api/metrics/unified > /dev/null; then
        echo "✅ Unified metrics endpoint accessible"
        echo "   URL: http://localhost:8080/api/metrics/unified"
    else
        echo "❌ Unified metrics endpoint not accessible"
    fi
}

function check_frontend() {
    echo "🎨 Checking frontend setup..."
    
    if cd frontend 2>/dev/null; then
        if [[ -f package.json ]]; then
            echo "✅ Frontend directory found with package.json"
            
            if [[ -d node_modules ]]; then
                echo "✅ Node modules installed"
            else
                echo "⚠️  Node modules not found. Installing..."
                npm install
            fi
            
            echo "📱 Frontend health page: http://localhost:3000/health"
            echo "   (After running: npm run dev)"
        else
            echo "❌ Frontend package.json not found"
        fi
        cd ..
    else
        echo "❌ Frontend directory not found"
    fi
}

function deploy_test_services() {
    echo "📦 Deploying test services (optional)..."
    
    if kubectl version > /dev/null 2>&1; then
        echo "✅ kubectl available"
        
        if [[ -f k8s/health-test-deployments.yaml ]]; then
            echo "🚀 Test deployments available at: k8s/health-test-deployments.yaml"
            echo "   Deploy with: ./scripts/health-test-manager.sh deploy"
        else
            echo "⚠️  Test deployment file not found"
        fi
    else
        echo "⚠️  kubectl not available - skipping Kubernetes test setup"
    fi
}

function show_health_data_sample() {
    echo "📊 Sample health data structure..."
    echo "Health REST Response:"
    echo "{"
    echo "  \"timestamp\": \"2026-03-05T18:45:32Z\","
    echo "  \"nodes\": {"
    echo "    \"worker-1\": {"
    echo "      \"health_level\": \"degraded\","
    echo "      \"health_score\": 68,"
    echo "      \"health_reasons\": [\"cpu usage elevated: 83.2%\"],"
    echo "      \"total_pods\": 8,"
    echo "      \"healthy_pods\": 7,"
    echo "      \"unhealthy_pods\": 1"
    echo "    }"
    echo "  },"
    echo "  \"alerts\": [...]"
    echo "}"
    echo ""
    echo "WebSocket endpoints:"
    echo "  - ws://localhost:8080/ws/node-health (health updates)"
    echo "  - ws://localhost:8080/api/metrics/ws (metrics streaming)"
}

function run_complete_test() {
    echo "🚀 Running complete health monitoring test..."
    echo ""
    
    check_daemon
    echo ""
    
    check_health_endpoints  
    echo ""
    
    check_frontend
    echo ""
    
    deploy_test_services
    echo ""
    
    echo "✅ Health monitoring test complete!"
    echo ""
    echo "🎯 Next Steps:"
    echo "   1. Start frontend: cd frontend && npm run dev"
    echo "   2. Visit: http://localhost:3000/health"
    echo "   3. Deploy test services: ./scripts/health-test-manager.sh deploy"
    echo "   4. Trigger failures: ./scripts/health-test-manager.sh fail"
    echo "   5. Monitor real-time: ./scripts/health-test-manager.sh monitor"
}

# Main execution
case "${1:-test}" in
    "daemon")
        check_daemon
        ;;
    "endpoints")
        check_health_endpoints
        ;;
    "frontend")
        check_frontend
        ;;
    "deploy")
        deploy_test_services
        ;;
    "sample")
        show_health_data_sample
        ;;
    "test"|*)
        run_complete_test
        ;;
esac