# Quick Component Integration Guide

## TL;DR

**Other components in this repo can use eBPF metrics with just 3 lines:**

```go
import "github.com/.../daemon/pkg/telemetry"

podDNS := telemetry.GetPodDNSMetrics()  // Get DNS metrics
podRTT := telemetry.GetPodRTTMetrics()  // Get RTT metrics
```

**No HTTP, no ports, no configuration needed!**

---

## Architecture

All components run in the **same Go binary** and share data through **in-memory function calls**:

```
┌─────────────────────────────────────────────────────────────┐
│              Single Go Binary (daemon)                       │
│                                                              │
│  Component 2       Component 3       Component 4            │
│  (Routing)         (Scheduling)      (Federation)           │
│      │                 │                  │                 │
│      └─────────────────┴──────────────────┘                 │
│                        │                                     │
│              import "telemetry"                              │
│                        │                                     │
│                        ▼                                     │
│        ┌───────────────────────────────────┐                │
│        │  Telemetry Package Functions      │                │
│        │                                   │                │
│        │  GetPodDNSMetrics()               │                │
│        │  GetPodRTTMetrics()               │                │
│        │  GlobalRegistry.Get().Subscribe() │                │
│        └───────────────┬───────────────────┘                │
│                        │                                     │
│                        ▼                                     │
│        ┌───────────────────────────────────┐                │
│        │    In-Memory Maps (sync.Map)     │                │
│        │    - podDNSMetrics                │                │
│        │    - podRTTMetrics                │                │
│        └───────────────┬───────────────────┘                │
│                        ▲                                     │
│                        │ updates                             │
│        ┌───────────────┴───────────────────┐                │
│        │  eBPF Collectors (goroutines)     │                │
│        │  - StartDNSLatencyCollector()     │                │
│        │  - StartRTTCollector()            │                │
│        └───────────────┬───────────────────┘                │
└────────────────────────┼────────────────────────────────────┘
                         │ ring buffer
                    ┌────▼──────┐
                    │   Kernel  │
                    │   eBPF    │
                    └───────────┘
```

---

## How to Add Your Component

### Option 1: Simple Function Calls (Get Current State)

```go
package mycomponent

import "github.com/.../daemon/pkg/telemetry"

func DoSomething() {
    // Get current metrics - simple as that!
    podDNS := telemetry.GetPodDNSMetrics()
    podRTT := telemetry.GetPodRTTMetrics()
    
    // Use the data
    for podKey, dns := range podDNS {
        avgLatency := float64(dns.TotalLatencyNs) / float64(dns.TotalEvents)
        // Make decisions based on latency
    }
}
```

### Option 2: Real-Time Subscriptions (React to Changes)

```go
func WatchForChanges() {
    // Subscribe to receive updates as they happen
    collector, _ := telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS)
    updates := collector.Subscribe()
    
    for metric := range updates {
        // React immediately to latency changes
        // No polling needed!
    }
}
```

---

## Example: Intelligent Routing Component

See `daemon/pkg/plugins/routing/latency_router.go` for a complete example.

**Key features:**
- Finds best/worst performing pods
- Subscribes to real-time metric updates
- Makes routing decisions based on combined DNS + RTT latency
- No HTTP client needed!

**To enable it:** Edit `daemon/cmd/daemon/main.go`:

```go
import "github.com/.../daemon/pkg/plugins/routing"

func main() {
    // ... existing setup ...
    
    router := routing.NewRouter(nodeName)
    go router.Start()
    
    // ... rest ...
}
```

---

## Available Functions

| Function | Description | Returns |
|----------|-------------|---------|
| `GetPodDNSMetrics()` | Per-pod DNS stats | `map[string]PodDNSMetrics` |
| `GetDNSMetrics()` | Node-level DNS stats | `DNSMetrics` |
| `GetPodRTTMetrics()` | Per-pod RTT stats | `map[string]PodRTTMetrics` |
| `GetRTTMetrics()` | Node-level RTT stats | `RTTMetrics` |
| `GlobalRegistry.Get(type)` | Get collector | `Collector` interface |
| `collector.Subscribe()` | Real-time stream | `<-chan Metric` |

**Map keys** are in format `"namespace/podname"`, e.g., `"default/web-app-7d5f9c"`

---

## Data Structures

### PodDNSMetrics

```go
type PodDNSMetrics struct {
    Namespace      string
    PodName        string
    TotalEvents    uint64  // Number of DNS queries
    TotalLatencyNs uint64  // Sum of all latencies
    LastLatencyNs  uint64  // Most recent latency
    MaxLatencyNs   uint64  // Worst latency seen
    MinLatencyNs   uint64  // Best latency seen
}

// Calculate average:
avg := float64(metrics.TotalLatencyNs) / float64(metrics.TotalEvents)
avgMs := avg / 1e6  // Convert to milliseconds
```

### PodRTTMetrics

```go
type PodRTTMetrics struct {
    PodName      string
    Namespace    string
    TotalEvents  uint64  // Number of TCP connections
    TotalRTTNs   uint64  // Sum of all RTTs
    LastRTTNs    uint64  // Most recent RTT
    MaxRTTNs     uint64  // Worst RTT seen
    MinRTTNs     uint64  // Best RTT seen
}
```

---

## When to Use What

### Use Direct Function Calls When:
- You want current state snapshot
- Polling on a timer is acceptable
- Simple periodic analysis
- Example: Every 10 seconds, find best pod

### Use Subscriptions When:
- You need immediate reaction to changes
- Low latency decision making
- Event-driven architecture
- Example: Reroute traffic instantly if pod latency spikes

---

## Comparison: HTTP vs Direct Calls

| Aspect | HTTP API | Direct Function Calls |
|--------|----------|----------------------|
| **Location** | External apps | Same repository/binary |
| **Performance** | Network overhead | In-memory (fastest) |
| **Setup** | Port config, HTTP client | Just `import` |
| **Type Safety** | Parse JSON manually | Go compiler checks |
| **Failure Mode** | Network errors possible | No network = no failures |
| **Use Case** | Dashboard, Prometheus | Internal components |

---

## Full Integration Example

```go
package mycomponent

import (
    "log"
    "time"
    "github.com/.../daemon/pkg/telemetry"
)

type MyComponent struct {
    nodeName string
    stopChan chan struct{}
}

func NewComponent(nodeName string) *MyComponent {
    return &MyComponent{
        nodeName: nodeName,
        stopChan: make(chan struct{}),
    }
}

func (c *MyComponent) Start() {
    log.Println("[MyComponent] Starting...")
    
    // Method 1: Periodic polling
    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()
    
    // Method 2: Real-time subscription
    collector, _ := telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS)
    updatesChan := collector.Subscribe()
    
    for {
        select {
        case <-ticker.C:
            // Periodic analysis
            c.analyzeMetrics()
            
        case metric := <-updatesChan:
            // Immediate reaction
            c.handleUpdate(metric)
            
        case <-c.stopChan:
            return
        }
    }
}

func (c *MyComponent) analyzeMetrics() {
    podDNS := telemetry.GetPodDNSMetrics()
    podRTT := telemetry.GetPodRTTMetrics()
    
    for podKey, dns := range podDNS {
        if dns.TotalEvents == 0 {
            continue
        }
        
        // Calculate metrics
        avgDNS := float64(dns.TotalLatencyNs) / float64(dns.TotalEvents)
        
        avgRTT := float64(0)
        if rtt, exists := podRTT[podKey]; exists && rtt.TotalEvents > 0 {
            avgRTT = float64(rtt.TotalRTTNs) / float64(rtt.TotalEvents)
        }
        
        totalLatency := avgDNS + avgRTT
        
        log.Printf("[MyComponent] %s: total=%.2fms (DNS=%.2fms, RTT=%.2fms)",
            podKey, totalLatency/1e6, avgDNS/1e6, avgRTT/1e6)
        
        // Make decisions based on latency
        if totalLatency > 50*1e6 { // > 50ms
            log.Printf("[MyComponent] High latency detected for %s!", podKey)
            // Take action...
        }
    }
}

func (c *MyComponent) handleUpdate(metric telemetry.Metric) {
    if podMetric, ok := metric.(telemetry.PodMetric); ok {
        log.Printf("[MyComponent] Real-time update: %s", podMetric.PodName)
        // React immediately
    }
}

func (c *MyComponent) Stop() {
    close(c.stopChan)
}
```

---

## Summary

1. **Import once:** `import "telemetry"`
2. **Call functions:** `GetPodDNSMetrics()`, `GetPodRTTMetrics()`
3. **That's it!** No HTTP, no ports, no config

The eBPF data collection is a **shared service** that all components can use through simple Go function calls.

For detailed architecture and more examples, see:
- `ARCHITECTURE.md` - Full architectural design
- `daemon/pkg/plugins/README.md` - Plugin development guide
- `daemon/pkg/plugins/routing/` - Example routing component
- `README.md` - Complete project documentation

---

## Questions?

**Q: Do I need to start port forwarding for my component?**
A: No! Port forwarding is only for external access (like the React dashboard). Internal components use function calls.

**Q: Do I need kubectl to get metrics?**
A: No! The eBPF collectors get data directly from the kernel. Kubectl is only used to map IPs to pod names.

**Q: Can multiple components read metrics simultaneously?**
A: Yes! All components share the same in-memory data. No conflicts, thread-safe.

**Q: How do I test my component?**
A: Just add it to `main.go` and rebuild the daemon. It will have immediate access to all telemetry data.

