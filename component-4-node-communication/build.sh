#!/bin/bash

# P2P Node Daemon - Build Script

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

function print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

function build_daemon() {
    echo -e "${YELLOW}📦 Building daemon...${NC}"
    go build -o daemon cmd/daemon/main.go
    echo -e "${GREEN}✅ Daemon built successfully: ./daemon${NC}"
}

function build_dashboard() {
    echo -e "${YELLOW}📦 Building dashboard server...${NC}"
    go build -o dashboard-server cmd/dashboard-server/dashboard-server.go
    echo -e "${GREEN}✅ Dashboard server built successfully: ./dashboard-server${NC}"
}

function build_all() {
    print_header "Building All Binaries"
    build_daemon
    echo ""
    build_dashboard
    echo ""
    echo -e "${GREEN}✅ All binaries built successfully!${NC}"
}

function clean() {
    print_header "Cleaning Build Artifacts"
    rm -f daemon dashboard-server
    echo -e "${GREEN}✅ Clean complete${NC}"
}

function docker_build() {
    print_header "Building Docker Image"
    docker build -t p2p-node:v3 .
    echo -e "${GREEN}✅ Docker image built: p2p-node:v3${NC}"
}

function docker_load() {
    docker_build
    echo ""
    echo -e "${YELLOW}📥 Loading image into Kind cluster...${NC}"
    kind load docker-image p2p-node:v3 --name p2p
    echo -e "${GREEN}✅ Image loaded into Kind cluster${NC}"
}

function deploy() {
    print_header "Deploying to Kubernetes"
    kubectl apply -f peers-configmap.yaml
    kubectl apply -f daemonset.yaml
    echo -e "${GREEN}✅ Deployment complete${NC}"
}

function restart() {
    print_header "Restarting DaemonSet"
    kubectl rollout restart daemonset node-daemon -n kube-system
    echo -e "${GREEN}✅ DaemonSet restarted${NC}"
}

function redeploy() {
    docker_load
    echo ""
    restart
    echo ""
    echo -e "${GREEN}✅ Full redeploy complete!${NC}"
}

function status() {
    print_header "Pod Status"
    kubectl get pods -n kube-system -l app=node-daemon -o wide
}

function logs() {
    print_header "Pod Logs (Press Ctrl+C to exit)"
    kubectl logs -f -l app=node-daemon -n kube-system --all-containers=true
}

function start_dashboard() {
    if [ ! -f "./dashboard-server" ]; then
        build_dashboard
        echo ""
    fi
    print_header "Starting Dashboard Server"
    echo -e "${GREEN}🌐 Dashboard will be available at: http://localhost:8000${NC}"
    echo ""
    ./dashboard-server
}

function show_help() {
    cat << EOF
${BLUE}P2P Node Daemon - Build Script${NC}

${YELLOW}Usage:${NC}
  ./build.sh [command]

${YELLOW}Commands:${NC}
  ${GREEN}build${NC}            Build all binaries
  ${GREEN}build-daemon${NC}     Build daemon binary only
  ${GREEN}build-dashboard${NC}  Build dashboard server only
  ${GREEN}clean${NC}            Remove build artifacts

  ${GREEN}docker-build${NC}     Build Docker image
  ${GREEN}docker-load${NC}      Build and load image to Kind cluster
  ${GREEN}deploy${NC}           Deploy to Kubernetes
  ${GREEN}restart${NC}          Restart daemonset
  ${GREEN}redeploy${NC}         Full rebuild, load, and restart

  ${GREEN}dashboard${NC}        Start dashboard server
  ${GREEN}status${NC}           Check pod status
  ${GREEN}logs${NC}             View pod logs (streaming)

  ${GREEN}help${NC}             Show this help message

${YELLOW}Examples:${NC}
  ./build.sh build              # Build everything
  ./build.sh redeploy           # Full deployment
  ./build.sh dashboard          # Start dashboard

EOF
}

# Main script
case "${1:-help}" in
    build)
        build_all
        ;;
    build-daemon)
        build_daemon
        ;;
    build-dashboard)
        build_dashboard
        ;;
    clean)
        clean
        ;;
    docker-build)
        docker_build
        ;;
    docker-load)
        docker_load
        ;;
    deploy)
        deploy
        ;;
    restart)
        restart
        ;;
    redeploy)
        redeploy
        ;;
    dashboard)
        start_dashboard
        ;;
    status)
        status
        ;;
    logs)
        logs
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo -e "${RED}❌ Unknown command: $1${NC}"
        echo ""
        show_help
        exit 1
        ;;
esac
