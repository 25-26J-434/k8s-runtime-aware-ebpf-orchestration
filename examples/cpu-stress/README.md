# CPU Stress Test Service

A CPU-intensive service designed to generate scheduling latency metrics for eBPF monitoring.

## Features

- **Multiple CPU load levels**: Light, Medium, Heavy
- **Burst mode**: Parallel CPU tasks
- **Sustained load**: Configurable duration
- **Web UI**: Interactive endpoint testing

## Endpoints

- `GET /` - Web UI with service information
- `GET /health` - Health check
- `GET /metrics` - Service metrics (JSON)
- `GET /cpu/light` - Light CPU load (primes up to 10,000)
- `GET /cpu/medium` - Medium CPU load (primes up to 50,000 + hash)
- `GET /cpu/heavy` - Heavy CPU load (matrix multiplication + fibonacci)
- `GET /cpu/burst` - Burst load (10 parallel tasks)
- `GET /cpu/sustained?duration=10` - Sustained load (duration in seconds)

## Running Locally

```bash
go run main.go
```

## Building Docker Image

```bash
docker build -t cpu-stress:latest .
```

## Deploying to Kubernetes

See the k8s/test-services.yaml file for deployment configuration.

## Testing Scheduling Latency

1. Deploy the service to Kubernetes
2. Access the service via port-forward or service endpoint
3. Trigger different CPU loads
4. Monitor scheduling latency metrics via the eBPF daemon API

```bash
# Trigger medium CPU load
curl http://<service-ip>:8080/cpu/medium

# Trigger burst load
curl http://<service-ip>:8080/cpu/burst

# Trigger sustained load for 30 seconds
curl http://<service-ip>:8080/cpu/sustained?duration=30
```

