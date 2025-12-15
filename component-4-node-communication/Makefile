# Makefile for P2P Node Daemon Project

.PHONY: all build build-daemon build-dashboard clean docker-build docker-load deploy restart test help

# Variables
DAEMON_BINARY=daemon
DASHBOARD_BINARY=dashboard-server
DOCKER_IMAGE=p2p-node
DOCKER_TAG=v3
KIND_CLUSTER ?= ebpf-cluster
NAMESPACE=kube-system

# Default target (daemon only; dashboard is optional)
all: build-daemon

# Build daemon only (primary use-case)
build: build-daemon

# Build daemon
build-daemon:
	@echo "📦 Building daemon..."
	@go build -o $(DAEMON_BINARY) cmd/daemon/main.go
	@echo "✅ Daemon built: ./$(DAEMON_BINARY)"

# Build dashboard server (opt-in)
build-all: build-daemon build-dashboard
	@echo "✅ All binaries built successfully"

# Build dashboard server
build-dashboard:
	@echo "📦 Building dashboard server..."
	@go build -o $(DASHBOARD_BINARY) cmd/dashboard-server/dashboard-server.go
	@echo "✅ Dashboard server built: ./$(DASHBOARD_BINARY)"

# Clean build artifacts
clean:
	@echo "🧹 Cleaning build artifacts..."
	@rm -f $(DAEMON_BINARY) $(DASHBOARD_BINARY)
	@echo "✅ Clean complete"

# Build Docker image
docker-build:
	@echo "🐳 Building Docker image..."
	@docker build -t $(DOCKER_IMAGE):$(DOCKER_TAG) .
	@echo "✅ Docker image built: $(DOCKER_IMAGE):$(DOCKER_TAG)"

# Load Docker image into Kind cluster
docker-load: docker-build
	@echo "📥 Loading image into Kind cluster..."
	@kind load docker-image $(DOCKER_IMAGE):$(DOCKER_TAG) --name $(KIND_CLUSTER)
	@echo "✅ Image loaded into Kind cluster"

# Deploy to Kubernetes
deploy:
	@echo "🚀 Deploying to Kubernetes..."
	@kubectl apply -f peers-configmap.yaml
	@kubectl apply -f daemonset.yaml
	@echo "✅ Deployment complete"

# Restart daemonset
restart:
	@echo "🔄 Restarting daemonset..."
	@kubectl rollout restart daemonset node-daemon -n $(NAMESPACE)
	@echo "✅ Daemonset restarted"

# Full redeploy (build, load, restart)
redeploy: docker-load restart
	@echo "✅ Full redeploy complete"

# Start dashboard
dashboard: build-dashboard
	@echo "🌐 Starting dashboard server..."
	@./$(DASHBOARD_BINARY)

# Check pod status
status:
	@echo "📊 Pod status:"
	@kubectl get pods -n $(NAMESPACE) -l app=node-daemon -o wide

# View logs
logs:
	@echo "📜 Viewing pod logs..."
	@kubectl logs -f -l app=node-daemon -n $(NAMESPACE) --all-containers=true

# Run tests (placeholder)
test:
	@echo "🧪 Running tests..."
	@go test -v ./...

# Help
help:
	@echo "P2P Node Daemon - Available commands:"
	@echo ""
	@echo "  make build           - Build all binaries"
	@echo "  make build-daemon    - Build daemon binary only"
	@echo "  make build-dashboard - Build dashboard server only"
	@echo "  make clean           - Remove build artifacts"
	@echo ""
	@echo "  make docker-build    - Build Docker image"
	@echo "  make docker-load     - Build and load image to Kind"
	@echo "  make deploy          - Deploy to Kubernetes"
	@echo "  make restart         - Restart daemonset"
	@echo "  make redeploy        - Full rebuild and restart"
	@echo ""
	@echo "  make dashboard       - Start dashboard server"
	@echo "  make status          - Check pod status"
	@echo "  make logs            - View pod logs"
	@echo ""
	@echo "  make help            - Show this help message"
