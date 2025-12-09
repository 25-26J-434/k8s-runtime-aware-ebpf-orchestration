# Dockerfile for eBPF Daemon
# Build from the daemon directory with pre-compiled BPF objects

FROM golang:1.22-bookworm AS builder

WORKDIR /build

# Copy go module files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code (including pre-compiled BPF objects in pkg/loader/bpf/)
COPY . .

# Add build argument to bust cache
ARG CACHEBUST=1

# Build the daemon (with -a to force rebuild all packages)
RUN CGO_ENABLED=0 GOOS=linux go build -a -o ebpf-daemon ./cmd/daemon

# Final runtime image
FROM ubuntu:22.04

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled daemon
COPY --from=builder /build/ebpf-daemon .

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O - http://localhost:8080/health || exit 1

# Expose metrics and API port
EXPOSE 8080

# Run as root (required for eBPF operations)
USER root

ENTRYPOINT ["./ebpf-daemon"]
