# Complete Codebase Guide

This document explains every file in the project, what it does, what should be committed to git, and what needs to be generated.

## Table of Contents
1. [Project Structure Overview](#project-structure-overview)
2. [What to Commit to Git](#what-to-commit-to-git)
3. [What NOT to Commit (Auto-generated)](#what-not-to-commit-auto-generated)
4. [Build Process & Generated Files](#build-process--generated-files)
5. [File-by-File Explanation](#file-by-file-explanation)
6. [Getting Started Workflow](#getting-started-workflow)

---

## Project Structure Overview

```
k8s-runtime-aware-ebpf-orchestration/
├── ebpf/                    # eBPF C source code (kernel programs)
├── daemon/                  # Go daemon application
├── frontend/                # React/TypeScript dashboard
├── k8s/                     # Kubernetes manifests
├── examples/                # Example test services
├── scripts/                 # Build scripts
└── bin/                     # Compiled binaries (GENERATED - don't commit)
```

---

## What to Commit to Git

###  Source Code Files (ALWAYS commit)
- **eBPF C source**: `ebpf/**/*.c`, `ebpf/**/*.h`
- **Go source**: `daemon/**/*.go`
- **TypeScript/React**: `frontend/src/**/*.tsx`, `frontend/src/**/*.ts`, `frontend/src/**/*.css`
- **Kubernetes manifests**: `k8s/**/*.yaml`
- **Dockerfiles**: `**/Dockerfile`
- **Build scripts**: `scripts/**/*.sh`, `*.sh`
- **Configuration files**: `Makefile`, `go.mod`, `go.sum`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`
- **Documentation**: `*.md`, `LICENSE`

### Special Cases
- **`go.sum`**: Commit this (dependency checksums)
- **`package-lock.json`**: Commit this (npm dependency lock)
- **`daemon/pkg/loader/bpf/*.o`**: These are embedded in the Go binary - commit them (they're needed for the build)

---

## What NOT to Commit (Auto-generated)

### Build Artifacts (in .gitignore)
- **Compiled eBPF objects**: `ebpf/**/*.o` (except `daemon/pkg/loader/bpf/*.o`)
- **Go binaries**: `daemon/ebpf-daemon`, `bin/ebpf-daemon`
- **Frontend build**: `frontend/dist/`, `frontend/.vite/`, `frontend/.cache/`
- **Node modules**: `node_modules/`, `frontend/node_modules/`
- **IDE files**: `.vscode/`, `.idea/`, `.cursor/`
- **OS files**: `.DS_Store`, `Thumbs.db`
- **Logs**: `*.log`, `logs/`
- **Temporary files**: `*.tmp`, `*.bak`, `*.swp`

---

## Build Process & Generated Files

### Step 1: Build eBPF Programs
**Script**: `scripts/build-ebpf.sh`
**Generates**: 
- `ebpf/component-1-daemon/*.o` (temporary, deleted after)
- `daemon/pkg/loader/bpf/*.o` (copied here, embedded in Go binary)

**What it does**:
1. Compiles `.c` files to `.o` using `clang`
2. Copies `.o` files to `daemon/pkg/loader/bpf/`
3. These `.o` files are embedded in the Go binary at build time

### Step 2: Build Go Daemon
**Command**: `cd daemon && go build -o ebpf-daemon ./cmd/daemon`
**Generates**: `daemon/ebpf-daemon` (binary)

**What it does**:
1. Embeds `.o` files from `daemon/pkg/loader/bpf/` into the binary
2. Compiles all Go code
3. Creates a single executable binary

### Step 3: Build Docker Image
**Command**: `docker build -t ebpf-daemon:latest daemon/`
**Generates**: Docker image with the binary

### Step 4: Build Frontend
**Command**: `cd frontend && npm run build`
**Generates**: `frontend/dist/` (production build)

**Development**: `npm run dev` (no build, runs dev server)

---

## File-by-File Explanation

### Root Directory

#### `Makefile`
**Purpose**: Build automation and common tasks
**What it does**:
- `make build-ebpf`: Compiles eBPF programs
- `make build-daemon`: Builds Go binary
- `make build-images`: Builds Docker images
- `make deploy-all`: Deploys to Kubernetes
- `make clean`: Removes build artifacts

**Commit**:  Yes

#### `README.md`
**Purpose**: Main project documentation
**Commit**:  Yes

#### `ARCHITECTURE.md`
**Purpose**: System architecture documentation
**Commit**: Yes

#### `API_DOCUMENTATION.md`
**Purpose**: API endpoint documentation
**Commit**: Yes

#### `LICENSE`
**Purpose**: Project license
**Commit**: Yes

#### `rebuild-and-start.sh`
**Purpose**: Complete rebuild and start script
**What it does**:
1. Rebuilds eBPF programs
2. Rebuilds Go daemon
3. Builds Docker image
4. Loads into Kind cluster
5. Restarts daemon pod
6. Sets up port forwarding
7. Starts frontend dev server

**Commit**: Yes

#### `rebuild-daemon.sh`
**Purpose**: Rebuild just the daemon
**Commit**: Yes

#### `setup-kind-cluster.sh`
**Purpose**: Sets up Kind Kubernetes cluster
**Commit**:  Yes

---

### `ebpf/` Directory

#### `ebpf/common/`
**Purpose**: Shared eBPF header files

**Files**:
- `dns_latency.h`: DNS latency event structures
- `maps.h`: eBPF map definitions (ring buffers, etc.)
- `rtt.h`: RTT event structures

**Commit**:  Yes (source code)

#### `ebpf/component-1-daemon/`
**Purpose**: eBPF programs for the daemon

**Files**:
- `dns_latency.c`: Monitors DNS queries, measures latency
- `rtt.c`: Monitors TCP RTT (Round-Trip Time)
- `tcp_metrics.c`: Monitors TCP metrics (SRTT, retransmissions, packet loss, etc.)
- `socket_count.c`: Counts active sockets
- `kernel_monitor.c`: General kernel monitoring
- `vmlinux.h`: Kernel type definitions (auto-generated, but commit it)

**Generated**: `*.o` files (compiled objects) - these are NOT committed

**Commit**: Yes (`.c` files and `vmlinux.h`)

---

### `daemon/` Directory

#### `daemon/cmd/daemon/main.go`
**Purpose**: Main entry point for the daemon
**What it does**:
1. Loads eBPF programs
2. Initializes collectors (DNS, RTT, TCP, Node System, etc.)
3. Starts API server
4. Runs forever until SIGTERM

**Commit**: Yes

#### `daemon/go.mod` & `daemon/go.sum`
**Purpose**: Go module dependencies
- `go.mod`: Dependency list
- `go.sum`: Dependency checksums (for security)

**Commit**:  Yes (both)

#### `daemon/Dockerfile`
**Purpose**: Docker image definition for daemon
**What it does**:
1. Uses Go base image
2. Copies source code
3. Builds the binary
4. Creates minimal runtime image

**Commit**: Yes

#### `daemon/pkg/api/`
**Purpose**: HTTP API server

**Files**:
- `api.go`: Main API server, endpoints (`/health`, `/metrics`, `/api/metrics`)
- `k8s_client.go`: Kubernetes client for pod discovery
- `unified_metrics.go`: Unified metrics endpoint that aggregates all collectors

**Commit**:  Yes

#### `daemon/pkg/loader/`
**Purpose**: eBPF program loader

**Files**:
- `loader.go`: Loads DNS, RTT eBPF programs
- `tcp_metrics_loader.go`: Loads TCP metrics eBPF program
- `bpf/*.o`: Compiled eBPF objects (embedded in Go binary)

**Commit**: Yes (Go files)
** Special**: `bpf/*.o` files ARE committed (they're embedded in the binary)

#### `daemon/pkg/telemetry/`
**Purpose**: Metric collectors

**Files**:
- `types.go`: Common types and interfaces
- `dns_latency_collector.go`: Reads DNS events from eBPF ring buffer
- `rtt_collector.go`: Reads RTT events from eBPF ring buffer
- `tcp_metrics_collector.go`: Reads TCP metrics from eBPF ring buffer
- `node_system_collector.go`: Reads CPU/RAM from `/proc`
- `packet_distribution_collector.go`: Packet distribution metrics
- `service_health_collector.go`: Kubernetes service health checks
- `nat_metadata_collector.go`: NAT/connection tracking metrics

**Commit**: Yes

#### `daemon/pkg/plugins/`
**Purpose**: Optional components that use telemetry data

**Files**:
- `base_plugin.go`: Base plugin interface
- `routing/latency_router.go`: Example routing component

**Commit**:  Yes

---

### `frontend/` Directory

#### `frontend/package.json` & `frontend/package-lock.json`
**Purpose**: npm dependencies
**Commit**: Yes (both)

#### `frontend/tsconfig.json` & `frontend/tsconfig.node.json`
**Purpose**: TypeScript configuration
**Commit**: Yes

#### `frontend/vite.config.ts`
**Purpose**: Vite build tool configuration
**Commit**: Yes

#### `frontend/src/main.tsx`
**Purpose**: React app entry point
**Commit**: Yes

#### `frontend/src/App.tsx`
**Purpose**: Main React component, routing
**Commit**: Yes

#### `frontend/src/pages/`
**Purpose**: Page components

**Files**:
- `Landing.tsx` & `Landing.css`: Landing page ("Kernel Eye")
- `Dashboard.tsx`: Main dashboard with all metrics
- `Routing.tsx`, `Scheduling.tsx`, `Federation.tsx`: Placeholder pages

**Commit**:  Yes

#### `frontend/src/components/`
**Purpose**: Reusable React components

**Files**:
- `SystemHealth.tsx`: System health overview
- `TopPerformers.tsx`: Best/worst performing pods
- `NetworkStats.tsx`: Network statistics
- `DNSLatencyChart.tsx`: DNS latency chart
- `TCPMetricsChart.tsx`: TCP RTT chart
- `TCPIssuesChart.tsx`: Retransmissions/packet loss chart
- `SystemResourcesChart.tsx`: CPU/Memory chart
- `PacketDistributionChart.tsx`: Packet distribution chart
- `Navigation.tsx`: Navigation sidebar

**Commit**: Yes

#### `frontend/src/hooks/`
**Purpose**: React custom hooks

**Files**:
- `useMetrics.ts`: Fetches metrics from API
- `useClusterInfo.ts`: Fetches cluster topology

**Commit**:  Yes

#### `frontend/src/services/api.ts`
**Purpose**: API client functions
**Commit**:  Yes

#### `frontend/src/types/api.ts`
**Purpose**: TypeScript type definitions for API
**Commit**: Yes

#### `frontend/dist/`
**Purpose**: Production build output
**Generated**: By `npm run build`
**Commit**:  No (in .gitignore)

#### `frontend/node_modules/`
**Purpose**: npm dependencies
**Generated**: By `npm install`
**Commit**:  No (in .gitignore)

---

### `k8s/` Directory

**Purpose**: Kubernetes manifests

**Files**:
- `namespace.yaml`: Creates `ebpf-telemetry` namespace
- `daemonset.yaml`: Deploys daemon on each node
- `dashboard.yaml`: Dashboard deployment (if needed)
- `kind-config.yaml`: Kind cluster configuration
- `test-services.yaml`: Test services (service-a, service-b, tcp-client)
- `simple-test-pods.yaml`: Simple test pods

**Commit**:  Yes

---

### `examples/` Directory

**Purpose**: Example test services

**Files**:
- `service-a/`: Python service A
- `service-b/`: Python service B
- `tcp-client/`: TCP client for testing

Each has:
- `app.py`: Python application
- `Dockerfile`: Docker image definition
- `requirements.txt`: Python dependencies

**Commit**: Yes

---

### `bin/` Directory

**Purpose**: Compiled binaries
**Generated**: Build artifacts
**Commit**: No (in .gitignore)

---

## Getting Started Workflow

### First Time Setup

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd k8s-runtime-aware-ebpf-orchestration
   ```

2. **Install dependencies**
   ```bash
   # Go dependencies (auto-downloaded on build)
   cd daemon && go mod download
   
   # Frontend dependencies
   cd ../frontend && npm install
   ```

3. **Build eBPF programs**
   ```bash
   ./scripts/build-ebpf.sh
   ```
   This generates: `daemon/pkg/loader/bpf/*.o`

4. **Build Go daemon**
   ```bash
   cd daemon && go build -o ebpf-daemon ./cmd/daemon
   ```
   This generates: `daemon/ebpf-daemon`

5. **Build Docker image**
   ```bash
   docker build -t ebpf-daemon:latest daemon/
   ```

6. **Setup Kind cluster**
   ```bash
   ./setup-kind-cluster.sh
   ```

7. **Load image and deploy**
   ```bash
   kind load docker-image ebpf-daemon:latest --name ebpf-cluster
   kubectl apply -f k8s/namespace.yaml
   kubectl apply -f k8s/daemonset.yaml
   ```

8. **Start frontend**
   ```bash
   cd frontend && npm run dev
   ```

### Daily Development Workflow

**Quick rebuild everything**:
```bash
./rebuild-and-start.sh
```

**Or step by step**:
```bash
# 1. Rebuild eBPF
./scripts/build-ebpf.sh

# 2. Rebuild daemon
cd daemon && go build -o ebpf-daemon ./cmd/daemon

# 3. Rebuild Docker image
docker build -t ebpf-daemon:latest daemon/

# 4. Load into Kind
kind load docker-image ebpf-daemon:latest --name ebpf-cluster

# 5. Restart daemon pod
kubectl -n ebpf-telemetry delete pod -l app=ebpf-daemon

# 6. Port forward
kubectl -n ebpf-telemetry port-forward svc/ebpf-daemon 8080:8080 &

# 7. Start frontend
cd frontend && npm run dev
```

---

## Key Concepts

### eBPF Programs
- Written in C
- Compiled to `.o` files
- Loaded into kernel at runtime
- Send events to user-space via ring buffers

### Go Daemon
- Reads events from eBPF ring buffers
- Aggregates metrics per pod and node
- Exposes HTTP API
- Runs as DaemonSet (one per node)

### Frontend
- React/TypeScript dashboard
- Fetches metrics from daemon API
- Displays real-time visualizations
- Runs in browser, connects to daemon via port-forward

### Kubernetes
- DaemonSet ensures one daemon per node
- Each daemon only sees metrics for its node
- Pods are discovered via Kubernetes API

---

## Important Notes

1. **`daemon/pkg/loader/bpf/*.o` files**: These ARE committed because they're embedded in the Go binary. They're generated from `ebpf/**/*.c` but need to be in git for the build to work.

2. **`vmlinux.h`**: This is a large auto-generated file (kernel type definitions). It's committed because it's needed for eBPF compilation.

3. **`go.sum`**: Always commit this - it ensures dependency integrity.

4. **`package-lock.json`**: Always commit this - it locks npm dependency versions.

5. **Build artifacts**: Never commit `.o` files in `ebpf/component-1-daemon/` (they're temporary). Only commit the ones in `daemon/pkg/loader/bpf/`.

---

## Summary Checklist

###  Commit to Git
- All `.c`, `.h` files (eBPF source)
- All `.go` files (Go source)
- All `.tsx`, `.ts`, `.css` files (Frontend source)
- All `.yaml` files (K8s manifests)
- All `Dockerfile` files
- All `.sh` scripts
- `go.mod`, `go.sum`
- `package.json`, `package-lock.json`
- `Makefile`
- `daemon/pkg/loader/bpf/*.o` (embedded binaries)
- `vmlinux.h` (needed for compilation)
- All `.md` documentation

### Don't Commit
- `ebpf/**/*.o` (except `daemon/pkg/loader/bpf/*.o`)
- `daemon/ebpf-daemon` (binary)
- `bin/` directory
- `frontend/dist/`
- `frontend/node_modules/`
- `*.log` files
- IDE files (`.vscode/`, `.idea/`)
- OS files (`.DS_Store`)

---

This guide should help you understand the entire codebase structure and what needs to be managed in git!



