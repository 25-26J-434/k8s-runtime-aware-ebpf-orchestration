# Makefile for eBPF Runtime-Aware Kubernetes Telemetry
# Component 1: Sidecar-less Orchestration Daemon

.PHONY: all build build-ebpf build-daemon build-images clean deploy test help

# Configuration
DAEMON_DIR := daemon
EBPF_DIR := ebpf
SCRIPTS_DIR := scripts
K8S_DIR := k8s
EXAMPLES_DIR := examples

# Docker image names (no registry prefix for local kind)
DAEMON_IMAGE := ebpf-daemon
SERVICE_A_IMAGE := service-a
SERVICE_B_IMAGE := service-b
TCP_CLIENT_IMAGE := tcp-client
CPU_STRESS_IMAGE := cpu-stress
IMAGE_TAG ?= latest

all: build

## Build targets

build: build-ebpf build-daemon ## Build everything

build-ebpf: ## Compile eBPF programs
	@echo "=== Building eBPF programs ==="
	chmod +x $(SCRIPTS_DIR)/build-ebpf.sh
	$(SCRIPTS_DIR)/build-ebpf.sh

build-daemon: ## Build the Go daemon binary
	@echo "=== Building Go daemon ==="
	cd $(DAEMON_DIR) && go build -o ebpf-daemon ./cmd/daemon
	@echo "Binary: $(DAEMON_DIR)/ebpf-daemon"

build-images: build-ebpf ## Build all Docker images
	@echo "=== Building Docker images ==="
	docker build -t $(DAEMON_IMAGE):$(IMAGE_TAG) $(DAEMON_DIR)
	docker build -t $(SERVICE_A_IMAGE):$(IMAGE_TAG) $(EXAMPLES_DIR)/service-a
	docker build -t $(SERVICE_B_IMAGE):$(IMAGE_TAG) $(EXAMPLES_DIR)/service-b
	docker build -t $(TCP_CLIENT_IMAGE):$(IMAGE_TAG) $(EXAMPLES_DIR)/tcp-client
	docker build -t $(CPU_STRESS_IMAGE):$(IMAGE_TAG) $(EXAMPLES_DIR)/cpu-stress
	@echo "Images built successfully"

push-images: build-images ## Push images to registry (if using remote registry)
	@echo "=== Pushing images ==="
	docker push $(DAEMON_IMAGE):$(IMAGE_TAG)
	docker push $(SERVICE_A_IMAGE):$(IMAGE_TAG)
	docker push $(SERVICE_B_IMAGE):$(IMAGE_TAG)

## Development targets

run-daemon: build ## Build and run daemon locally (requires root)
	@echo "=== Running eBPF daemon (requires sudo) ==="
	sudo $(DAEMON_DIR)/ebpf-daemon

test-api: ## Test the daemon API endpoints
	@echo "=== Testing daemon API ==="
	@echo "Health check:"
	curl -s http://localhost:8080/health
	@echo "\n\nMetrics (JSON):"
	curl -s http://localhost:8080/metrics/json | jq .
	@echo "\nMetrics (Prometheus):"
	curl -s http://localhost:8080/metrics

## Kubernetes deployment

deploy-namespace: ## Create Kubernetes namespaces
	kubectl apply -f $(K8S_DIR)/namespace.yaml

deploy-daemon: deploy-namespace ## Deploy eBPF daemon DaemonSet
	kubectl apply -f $(K8S_DIR)/daemonset.yaml

deploy-test-services: ## Deploy test services
	kubectl apply -f $(K8S_DIR)/test-services.yaml

deploy-all: deploy-daemon deploy-test-services ## Deploy everything
	@echo "=== Deployment complete ==="
	@echo "Wait for pods to be ready..."
	kubectl -n ebpf-telemetry wait --for=condition=ready pod -l app=ebpf-daemon --timeout=120s
	kubectl -n test-services wait --for=condition=ready pod -l app=service-a --timeout=60s
	kubectl -n test-services wait --for=condition=ready pod -l app=service-b --timeout=60s
	kubectl -n test-services wait --for=condition=ready pod -l app=tcp-client --timeout=60s
	@echo "All pods ready!"

undeploy: ## Remove all deployments
	kubectl delete -f $(K8S_DIR)/test-services.yaml --ignore-not-found
	kubectl delete -f $(K8S_DIR)/daemonset.yaml --ignore-not-found
	kubectl delete -f $(K8S_DIR)/namespace.yaml --ignore-not-found

## Kind cluster helpers

kind-setup: ## Setup kind cluster
	@echo "=== Setting up kind cluster ==="
	kind create cluster --name ebpf-cluster --config=$(K8S_DIR)/kind-config.yaml || true
	@echo "Kind cluster ready!"

kind-load-images: build-images ## Load images into kind
	@echo "=== Loading images into kind ==="
	kind load docker-image $(DAEMON_IMAGE):$(IMAGE_TAG) --name ebpf-cluster
	kind load docker-image $(SERVICE_A_IMAGE):$(IMAGE_TAG) --name ebpf-cluster
	kind load docker-image $(SERVICE_B_IMAGE):$(IMAGE_TAG) --name ebpf-cluster
	kind load docker-image $(TCP_CLIENT_IMAGE):$(IMAGE_TAG) --name ebpf-cluster
	kind load docker-image $(CPU_STRESS_IMAGE):$(IMAGE_TAG) --name ebpf-cluster
	@echo "Images loaded!"

## Monitoring and debugging

logs-daemon: ## View eBPF daemon logs
	kubectl -n ebpf-telemetry logs -l app=ebpf-daemon -f

logs-service-a: ## View service-a logs
	kubectl -n test-services logs -l app=service-a -f

metrics: ## Get metrics from daemon
	@POD=$$(kubectl -n ebpf-telemetry get pod -l app=ebpf-daemon -o jsonpath='{.items[0].metadata.name}') && \
	kubectl -n ebpf-telemetry exec -it $$POD -- curl -s http://localhost:8080/metrics/json | jq .

port-forward: ## Port forward daemon API
	kubectl -n ebpf-telemetry port-forward svc/ebpf-daemon 8080:8080

## Cleanup

clean: ## Clean build artifacts
	rm -f $(DAEMON_DIR)/ebpf-daemon
	rm -f $(EBPF_DIR)/component-1-daemon/*.o
	rm -f $(DAEMON_DIR)/pkg/loader/bpf/*.o

clean-images: ## Remove Docker images
	docker rmi $(DAEMON_IMAGE):$(IMAGE_TAG) || true
	docker rmi $(SERVICE_A_IMAGE):$(IMAGE_TAG) || true
	docker rmi $(SERVICE_B_IMAGE):$(IMAGE_TAG) || true

## Help

help: ## Show this help
	@echo "eBPF Runtime-Aware Kubernetes Telemetry"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

