# Extensible Telemetry API Documentation

## Overview

The extensible telemetry API provides a unified interface to query metrics from multiple collectors at both node and pod levels.

## Endpoints

### 1. Unified Metrics API

**Endpoint:** `GET /api/metrics`

**Description:** Returns metrics from all registered collectors with optional filtering.

**Query Parameters:**
- `type` (optional): Filter by metric type (`dns_latency`, `rtt`, `socket_count`, etc.)
- `level` (optional): Filter by aggregation level (`node`, `pod`)

**Examples:**

```bash
# Get all metrics (node and pod level)
curl http://localhost:8080/api/metrics

# Get only DNS metrics
curl http://localhost:8080/api/metrics?type=dns_latency

# Get only pod-level metrics
curl http://localhost:8080/api/metrics?level=pod

# Get DNS metrics at pod level only
curl http://localhost:8080/api/metrics?type=dns_latency&level=pod
```

**Response Format:**

```json
{
  "timestamp": "2025-12-08T15:00:00Z",
  "node": {
    "dns_latency": {
      "total_events": 1000,
      "avg_latency_ns": 150000,
      "min_latency_ns": 5000,
      "max_latency_ns": 500000
    },
    "rtt": {
      "total_events": 500,
      "avg_rtt_ns": 200000
    }
  },
  "pods": {
    "default/pod-a": {
      "dns_latency": {
        "total_events": 100,
        "avg_latency_ns": 145000
      },
      "rtt": {
        "total_events": 50,
        "avg_rtt_ns": 195000
      }
    }
  }
}
```

### 2. Legacy Endpoints (Backward Compatible)

#### JSON Metrics
**Endpoint:** `GET /metrics/json`

Returns DNS and RTT metrics in the original format.

#### Prometheus Metrics
**Endpoint:** `GET /metrics`

Returns metrics in Prometheus format.

#### Per-Pod DNS Metrics
**Endpoint:** `GET /api/dns/pods`

Returns detailed DNS metrics for each pod.

## Using the API in Your Components

### Example 1: Query Specific Metric Type

```go
import (
    "github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

func getAverageDNSLatency(podName string) (float64, error) {
    // Get DNS collector from registry
    collector, ok := telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS)
    if !ok {
        return 0, fmt.Errorf("DNS collector not found")
    }
    
    // Get pod metrics
    podMetrics := collector.GetPodMetrics()
    
    // Find specific pod
    if metric, ok := podMetrics[podName]; ok {
        value := metric.Value.(telemetry.DNSMetricValue)
        return value.AvgLatencyNs, nil
    }
    
    return 0, fmt.Errorf("pod not found")
}
```

### Example 2: Subscribe to Real-Time Updates

```go
func watchDNSMetrics() {
    collector, _ := telemetry.GlobalRegistry.Get(telemetry.MetricTypeDNS)
    updates := collector.Subscribe()
    
    for metric := range updates {
        podMetric := metric.(telemetry.PodMetric)
        value := podMetric.Value.(telemetry.DNSMetricValue)
        
        log.Printf("Pod %s/%s: DNS latency = %.2fμs",
            podMetric.Namespace,
            podMetric.PodName,
            value.AvgLatencyNs/1000)
    }
}
```

### Example 3: Get All Metrics for a Pod

```go
func getAllPodMetrics(podKey string) map[telemetry.MetricType]interface{} {
    allPodMetrics := telemetry.GlobalRegistry.GetAllPodMetrics()
    
    if metrics, ok := allPodMetrics[podKey]; ok {
        result := make(map[telemetry.MetricType]interface{})
        for metricType, metric := range metrics {
            result[metricType] = metric.Value
        }
        return result
    }
    
    return nil
}
```

## Adding New Metric Types

To add a new metric type (e.g., socket counts):

1. **Define the metric type in `types.go`:**
```go
const (
    MetricTypeSocketCount MetricType = "socket_count"
)

type SocketCountMetricValue struct {
    TCPSockets   uint64 `json:"tcp_sockets"`
    UDPSockets   uint64 `json:"udp_sockets"`
    TotalSockets uint64 `json:"total_sockets"`
}
```

2. **Implement the Collector interface:**
```go
type SocketCountCollector struct {
    // ... implementation
}

func (c *SocketCountCollector) GetType() MetricType {
    return MetricTypeSocketCount
}

func (c *SocketCountCollector) GetNodeMetrics() NodeMetric {
    // ... return node-level socket counts
}

func (c *SocketCountCollector) GetPodMetrics() map[string]PodMetric {
    // ... return pod-level socket counts
}
```

3. **Register the collector:**
```go
socketCollector := NewSocketCountCollector(nodeName)
telemetry.GlobalRegistry.Register(socketCollector)
```

4. **Query the new metrics:**
```bash
curl http://localhost:8080/api/metrics?type=socket_count
```

## Metric Types

Currently supported:
- `dns_latency` - DNS query latency metrics
- `rtt` - TCP round-trip time metrics

Coming soon:
- `socket_count` - Active socket counts
- `packet_drop` - Packet drop statistics
- More...

## Best Practices

1. **Use the unified API** (`/api/metrics`) for new integrations
2. **Filter by type and level** to reduce response size
3. **Subscribe to updates** for real-time monitoring
4. **Use the registry** for programmatic access within the daemon
5. **Keep backward compatibility** when adding new metric types
