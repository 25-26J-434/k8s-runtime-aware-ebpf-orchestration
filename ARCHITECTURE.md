# Architecture: Modular Component Design

## Overview

This project uses a **shared-library architecture** where all components run in the same process and share the eBPF telemetry data through **Go packages** and **function calls**, not HTTP APIs.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Single Go Binary Process                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Component 2: Intelligent Routing                          │ │
│  │  - Imports: daemon/pkg/telemetry                           │ │
│  │  - Calls: telemetry.GetPodDNSMetrics()                     │ │
│  │  - Calls: telemetry.GetPodRTTMetrics()                     │ │
│  └────────────────┬───────────────────────────────────────────┘ │
│                   │                                              │
│  ┌────────────────▼───────────────────────────────────────────┐ │
│  │  Component 3: Latency-Aware Scheduling                     │ │
│  │  - Imports: daemon/pkg/telemetry                           │ │
│  │  - Calls: telemetry.GlobalRegistry.GetNodeMetrics()        │ │
│  │  - Subscribes: telemetry.Subscribe() → realtime updates    │ │
│  └────────────────┬───────────────────────────────────────────┘ │
│                   │                                              │
│  ┌────────────────▼───────────────────────────────────────────┐ │
│  │  Component 1: eBPF Telemetry (Core)                        │ │
│  │                                                             │ │
│  │  Package: daemon/pkg/telemetry                             │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │  Public API (for other components):                  │  │ │
│  │  │                                                       │  │ │
│  │  │  // Get current metrics                              │  │ │
│  │  │  func GetDNSMetrics() DNSMetrics                     │  │ │
│  │  │  func GetPodDNSMetrics() map[string]PodDNSMetrics    │  │ │
│  │  │  func GetRTTMetrics() RTTMetrics                     │  │ │
│  │  │  func GetPodRTTMetrics() map[string]PodRTTMetrics    │  │ │
│  │  │                                                       │  │ │
│  │  │  // Subscribe to real-time updates                   │  │ │
│  │  │  func Subscribe() <-chan Metric                      │  │ │
│  │  │  func GlobalRegistry.Subscribe(type) <-chan Metric   │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  │                                                             │ │
│  │  eBPF Kernel Data Collection (Internal)                    │ │
│  │  - StartDNSLatencyCollector() → goroutine                  │ │
│  │  - StartRTTCollector() → goroutine                         │ │
│  │  - Reads from kernel ring buffers                          │ │
│  │  - Aggregates metrics in memory                            │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  HTTP API Server (For External Consumers)                  │ │
│  │  - React Dashboard                                         │ │
│  │  - Prometheus/Grafana                                      │ │
│  │  - External monitoring tools                               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────────┐
                    │   Linux Kernel       │
                    │   eBPF Programs      │
                    └──────────────────────┘
```

## How Components Share Data

### Method 1: Direct Function Calls (Recommended for Internal Components)

Components 2, 3, 4 **import the telemetry package** and call functions directly:

```go
// Component 2: pkg/plugins/routing/latency_router.go

package routing

import (
    "log"
    "github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

type LatencyAwareRouter struct {
    // No HTTP client needed!
}

func (r *LatencyAwareRouter) SelectBestPod(serviceName string) string {
    // Direct function call - no network overhead!
    podDNSMetrics := telemetry.GetPodDNSMetrics()
    podRTTMetrics := telemetry.GetPodRTTMetrics()
    
    bestPod := ""
    minLatency := float64(99999999)
    
    for podKey, dns := range podDNSMetrics {
        rtt := podRTTMetrics[podKey]
        
        // Calculate combined latency
        avgDNS := float64(dns.TotalLatencyNs) / float64(dns.TotalEvents)
        avgRTT := float64(0)
        if rtt.TotalEvents > 0 {
            avgRTT = float64(rtt.TotalRTTNs) / float64(rtt.TotalEvents)
        }
        
        combinedLatency := avgDNS + avgRTT
        
        if combinedLatency < minLatency {
            minLatency = combinedLatency
            bestPod = podKey
        }
    }
    
    return bestPod
}
```

### Method 2: Real-Time Subscriptions (Advanced)

Components can **subscribe to metrics updates** for real-time decision making:

```go
// Component 3: pkg/plugins/scheduling/scheduler.go

package scheduling

import (
    "github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

type NetworkAwareScheduler struct {
    metricsChan <-chan telemetry.Metric
}

func NewScheduler() *NetworkAwareScheduler {
    s := &NetworkAwareScheduler{}
    
    // Subscribe to DNS collector for real-time updates
    if dnsCollector, ok := telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS); ok {
        s.metricsChan = dnsCollector.Subscribe()
        go s.processMetrics()
    }
    
    return s
}

func (s *NetworkAwareScheduler) processMetrics() {
    for metric := range s.metricsChan {
        // Receive real-time metric updates!
        // No polling needed - push-based
        
        if podMetric, ok := metric.(telemetry.PodMetric); ok {
            log.Printf("Pod %s latency changed: %v", 
                podMetric.PodName, podMetric.Value)
            
            // Make scheduling decisions immediately
            s.rescheduleIfNeeded(podMetric)
        }
    }
}
```

## Component Structure in Repository

```
k8s-runtime-aware-ebpf-orchestration/
├── daemon/
│   ├── cmd/daemon/main.go              # Main entry point (starts all components)
│   └── pkg/
│       ├── telemetry/                  # Component 1 (Core)
│       │   ├── dns_latency_collector.go
│       │   ├── rtt_collector.go
│       │   ├── types.go                # Shared interfaces
│       │   └── dns_collector_impl.go   # Collector implementation
│       │
│       ├── plugins/
│       │   ├── base_plugin.go          # Plugin interface
│       │   │
│       │   ├── routing/                # Component 2
│       │   │   └── latency_router.go   # ← Imports telemetry package
│       │   │
│       │   ├── scheduling/             # Component 3
│       │   │   └── network_scheduler.go # ← Imports telemetry package
│       │   │
│       │   └── federation/             # Component 4
│       │       └── cluster_coordinator.go # ← Imports telemetry package
│       │
│       ├── api/                        # HTTP API (for external use only)
│       │   ├── api.go
│       │   └── unified_metrics.go
│       │
│       └── loader/                     # eBPF program loader
│           └── loader.go
│
├── ebpf/
│   ├── common/                         # Shared headers
│   └── component-1-daemon/             # eBPF C programs
│       ├── dns_latency.c
│       └── rtt.c
│
└── frontend/                           # External dashboard (uses HTTP API)
    └── src/
```

## Example: Component 2 Implementation

Create a new file: `daemon/pkg/plugins/routing/latency_router.go`

```go
package routing

import (
    "log"
    "github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

type LatencyBasedRouter struct {
    nodeName string
}

func NewRouter(nodeName string) *LatencyBasedRouter {
    log.Println("[Routing] Initializing Latency-Based Router...")
    return &LatencyBasedRouter{nodeName: nodeName}
}

// Start the routing logic
func (r *LatencyBasedRouter) Start() {
    log.Println("[Routing] Starting latency-based routing...")
    
    // Subscribe to real-time metric updates
    if collector, ok := telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS); ok {
        updatesChan := collector.Subscribe()
        go r.handleMetricUpdates(updatesChan)
    }
}

func (r *LatencyBasedRouter) handleMetricUpdates(updates <-chan telemetry.Metric) {
    for metric := range updates {
        // Process each metric update
        r.updateRoutingTable(metric)
    }
}

func (r *LatencyBasedRouter) SelectEndpoint(serviceName string) string {
    // Get current metrics using direct function call
    podDNS := telemetry.GetPodDNSMetrics()
    podRTT := telemetry.GetPodRTTMetrics()
    
    // Your routing logic here
    return r.calculateBestEndpoint(podDNS, podRTT, serviceName)
}
```

## Main Entry Point

Update `daemon/cmd/daemon/main.go` to start all components:

```go
package main

import (
    "github.com/.../daemon/pkg/telemetry"
    "github.com/.../daemon/pkg/plugins/routing"
    "github.com/.../daemon/pkg/plugins/scheduling"
    "github.com/.../daemon/pkg/api"
)

func main() {
    // Load eBPF programs
    loader.LoadDNSLatencyBPF()
    loader.LoadRTTBPF()
    
    // Initialize telemetry collectors
    telemetry.InitDNSCollector(nodeName)
    go telemetry.StartDNSLatencyCollector()
    go telemetry.StartRTTCollector()
    
    // Start Component 2: Routing
    router := routing.NewRouter(nodeName)
    go router.Start()
    
    // Start Component 3: Scheduling  
    scheduler := scheduling.NewScheduler(nodeName)
    go scheduler.Start()
    
    // Start Component 4: Federation
    // federator := federation.NewCoordinator(nodeName)
    // go federator.Start()
    
    // Start HTTP API (for external consumers only)
    go api.StartServer()
    
    // Wait for shutdown
    <-sig
}
```

## Key Advantages of This Design

1. **Zero Network Overhead** - Direct function calls, no HTTP
2. **Type Safety** - Go compiler checks at build time
3. **Shared Memory** - All components access same metrics
4. **Real-Time** - Subscribe to channels for push updates
5. **Simple** - Just `import` and call functions
6. **Efficient** - No serialization/deserialization

## Available Functions for Other Components

### DNS Metrics
```go
import "github.com/.../daemon/pkg/telemetry"

// Get all DNS metrics
metrics := telemetry.GetDNSMetrics()           // Node-level
podMetrics := telemetry.GetPodDNSMetrics()     // Per-pod

// Subscribe to updates
collector := telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS)
updates := collector.Subscribe()               // Real-time channel
```

### RTT Metrics
```go
// Get all RTT metrics
metrics := telemetry.GetRTTMetrics()           // Node-level
podMetrics := telemetry.GetPodRTTMetrics()     // Per-pod

// Subscribe to updates
collector := telemetry.GlobalRegistry.Get(telemetry.MetricTypeRTT)
updates := collector.Subscribe()               // Real-time channel
```

### Pod IP Mapping (Kubernetes Integration)
```go
// Get pod info
mapping := telemetry.GetPodIPMapping()         // IP → "namespace/podname"
```

## When to Use HTTP API vs Direct Calls

### Use Direct Function Calls (Internal Components):
- Component 2: Routing (same repo)
- Component 3: Scheduling (same repo)
- Component 4: Federation (same repo)
- Any Go code in this repository

### Use HTTP API (External Consumers):
- React dashboard (frontend)
- Prometheus/Grafana
- External monitoring tools
- Other applications not in this codebase

## Example: Adding Component 2

**Step 1:** Create the routing plugin

```bash
mkdir -p daemon/pkg/plugins/routing
touch daemon/pkg/plugins/routing/latency_router.go
```

**Step 2:** Implement using telemetry functions

```go
package routing

import "github.com/.../daemon/pkg/telemetry"

func SelectBestPod(service string) string {
    // Direct call - no HTTP needed!
    pods := telemetry.GetPodDNSMetrics()
    
    // Your logic here
    return bestPod
}
```

**Step 3:** Start it in main.go

```go
import "github.com/.../daemon/pkg/plugins/routing"

func main() {
    // ... load eBPF ...
    
    router := routing.NewRouter()
    go router.Start()
    
    // ... rest of code ...
}
```

**That's it!** No ports, no HTTP, no configuration needed.

## Data Flow

```
Kernel (eBPF)
    ↓ Ring Buffer
Telemetry Collectors (goroutines)
    ↓ Function Calls
In-Memory Maps (sync.Map)
    ↓
    ├→ Component 2 (Direct Call)     telemetry.GetPodDNSMetrics()
    ├→ Component 3 (Direct Call)     telemetry.GetPodRTTMetrics()  
    ├→ Component 4 (Direct Call)     telemetry.Subscribe()
    └→ HTTP API (External Only)      http://localhost:8080/metrics/json
```

## Benefits

1. **Simple Integration** - Just import and call
2. **No Configuration** - No ports, no URLs, no endpoints
3. **Type Safe** - Compiler checks
4. **Fast** - In-memory, no network
5. **Reliable** - No network failures
6. **Testable** - Easy to mock and test

## Summary

**For Other Components:**
- Import: `daemon/pkg/telemetry`
- Call: `telemetry.GetPodDNSMetrics()`
- Subscribe: `collector.Subscribe()` for real-time
- No HTTP, no ports, no APIs needed!

**HTTP API exists only for:**
- External dashboards (React)
- Monitoring tools (Prometheus)
- Cross-cluster communication

**Everything in this repo shares the same eBPF data through simple Go function calls.**

