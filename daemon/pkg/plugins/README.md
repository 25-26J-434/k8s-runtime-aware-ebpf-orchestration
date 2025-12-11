# Components / Plugins

This directory contains additional components that use the eBPF telemetry data.

## Adding a New Component

It's simple - just import and call functions!

### Step 1: Create Your Component

Create a new directory and Go file:

```bash
mkdir -p daemon/pkg/plugins/mycomponent
touch daemon/pkg/plugins/mycomponent/mycomponent.go
```

### Step 2: Import Telemetry Package

```go
package mycomponent

import (
    "log"
    "github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

type MyComponent struct {
    nodeName string
}

func NewComponent(nodeName string) *MyComponent {
    return &MyComponent{nodeName: nodeName}
}

func (c *MyComponent) Start() {
    log.Println("[MyComponent] Starting...")
    
    // Method 1: Get current metrics anytime
    podDNS := telemetry.GetPodDNSMetrics()
    podRTT := telemetry.GetPodRTTMetrics()
    
    // Use the data
    for podKey, dns := range podDNS {
        log.Printf("Pod %s: %d DNS events", podKey, dns.TotalEvents)
    }
    
    // Method 2: Subscribe for real-time updates
    if collector, ok := telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS); ok {
        updatesChan := collector.Subscribe()
        go c.handleUpdates(updatesChan)
    }
}

func (c *MyComponent) handleUpdates(updates <-chan telemetry.Metric) {
    for metric := range updates {
        // React immediately to metric changes
        log.Printf("[MyComponent] Received update: %+v", metric)
    }
}
```

### Step 3: Enable in main.go

Edit `daemon/cmd/daemon/main.go`:

```go
import "yourrepo/daemon/pkg/plugins/mycomponent"

func main() {
    // ... existing code ...
    
    // Start your component
    component := mycomponent.NewComponent(nodeName)
    go component.Start()
    
    // ... rest of code ...
}
```

**That's it!** No HTTP clients, no configuration, no ports needed.

## Available Data

### DNS Metrics (Per-Pod and Node-Level)

```go
// Get all pod DNS metrics
podMetrics := telemetry.GetPodDNSMetrics()
// Returns: map[string]PodDNSMetrics
// Key format: "namespace/podname"

for podKey, metrics := range podMetrics {
    avgLatency := float64(metrics.TotalLatencyNs) / float64(metrics.TotalEvents)
    log.Printf("%s: avg=%.2fms, max=%.2fms, min=%.2fms",
        podKey,
        avgLatency/1e6,
        float64(metrics.MaxLatencyNs)/1e6,
        float64(metrics.MinLatencyNs)/1e6)
}

// Get node-level aggregated DNS metrics
nodeMetrics := telemetry.GetDNSMetrics()
```

### RTT Metrics (Per-Pod and Node-Level)

```go
// Get all pod RTT metrics
podRTT := telemetry.GetPodRTTMetrics()
// Returns: map[string]PodRTTMetrics

for podKey, metrics := range podRTT {
    avgRTT := float64(metrics.TotalRTTNs) / float64(metrics.TotalEvents)
    log.Printf("%s: avg RTT=%.2fms", podKey, avgRTT/1e6)
}

// Get node-level aggregated RTT
nodeRTT := telemetry.GetRTTMetrics()
```

### Real-Time Subscriptions

```go
// Subscribe to DNS metrics
dnsCollector, _ := telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS)
dnsChan := dnsCollector.Subscribe()

// Subscribe to RTT metrics
rttCollector, _ := telemetry.GlobalRegistry.Get(telemetry.MetricTypeRTT)
rttChan := rttCollector.Subscribe()

// Process updates
for {
    select {
    case metric := <-dnsChan:
        // Handle DNS update
    case metric := <-rttChan:
        // Handle RTT update
    }
}
```

## Example Components

### Component 2: Routing (`routing/`)

Demonstrates latency-based pod selection:
- Uses `GetPodDNSMetrics()` and `GetPodRTTMetrics()`
- Subscribes to real-time updates
- Finds best/worst performing pods
- See: `routing/latency_router.go`

### Component 3: Scheduling (Coming Soon)

Will demonstrate network-aware pod scheduling.

### Component 4: Federation (Coming Soon)

Will demonstrate multi-cluster coordination.

## Key Advantages

1. **Zero Network Overhead** - Direct function calls in same process
2. **Type Safe** - Go compiler checks at build time
3. **Fast** - In-memory access, no serialization
4. **Simple** - Just import and call
5. **Reliable** - No network failures possible
6. **Real-Time** - Subscribe to channels for push updates

## Architecture

```
┌────────────────────────────────────────────────────┐
│            Single Go Binary Process                 │
│                                                     │
│  Your Component                                     │
│       │                                             │
│       │ import "telemetry"                          │
│       │                                             │
│       ▼                                             │
│  telemetry.GetPodDNSMetrics()  ◄─────────┐         │
│  telemetry.GetPodRTTMetrics()            │         │
│       │                                   │         │
│       │ returns data                      │ writes  │
│       ▼                                   │         │
│  In-Memory Maps ──────────────────────────┘         │
│       ▲                                             │
│       │ updates from kernel                         │
│       │                                             │
│  eBPF Collectors (goroutines)                       │
│       ▲                                             │
└───────┼─────────────────────────────────────────────┘
        │ ring buffer
    ┌───┴────┐
    │ Kernel │
    │ eBPF   │
    └────────┘
```

## Need HTTP API Instead?

If your component is **external** (not in this repo), use the HTTP API:
- Endpoint: `http://ebpf-daemon:8080/metrics/json`
- See: `API_DOCUMENTATION.md`

For **internal** components (in this repo), use direct function calls as shown above.

