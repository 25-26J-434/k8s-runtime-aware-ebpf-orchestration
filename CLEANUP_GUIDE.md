# Project Cleanup Guide

## Safe to Delete

### 1. Compiled eBPF Objects (Source Directories)
```bash
./ebpf/component-1-daemon/dns_latency.o
./ebpf/component-1-daemon/rtt.o
```
**Why**: These are build artifacts that can be regenerated with `./scripts/build-ebpf.sh`

**⚠️ KEEP**: `daemon/pkg/loader/bpf/*.o` - These are embedded in the Go binary

### 2. Downloaded Kind Binary
```bash
./kind (6.2MB)
```
**Why**: Already installed to `/usr/local/bin/kind`, this is just the download

### 3. Daemon Binary
```bash
./daemon/ebpf-daemon (48MB)
```
**Why**: Rebuilt every time you run `./rebuild-daemon.sh`

### 4. Temporary Files
- `*~` - Editor backup files
- `*.swp` - Vim swap files
- `.DS_Store` - macOS metadata

## Important - DO NOT Delete

### Source Code
- `daemon/` - Go source code for daemon
- `ebpf/` - eBPF C source code
- `ui/` - Dashboard UI files

### Configuration
- `k8s/` - Kubernetes manifests
- `Makefile` - Build configuration
- `.gitignore` - Git configuration

### Scripts
- `rebuild-daemon.sh` - Daemon rebuild script
- `setup-kind-cluster.sh` - Kind cluster setup
- `scripts/build-ebpf.sh` - eBPF build script
- `cleanup.sh` - This cleanup script

### Documentation
- `README.md` - Project documentation
- `KIND_SETUP.md` - Kind setup guide
- `LICENSE` - Project license

### Embedded Files (Critical!)
- `daemon/pkg/loader/bpf/*.o` - eBPF objects embedded in Go binary
- `daemon/go.mod`, `daemon/go.sum` - Go dependencies

## Automated Cleanup

Run the cleanup script:
```bash
./cleanup.sh
```

This will:
1. Show you what will be deleted
2. Ask for confirmation
3. Safely remove temporary files
4. Preserve all important files

## Manual Cleanup

If you prefer manual cleanup:
```bash
# Remove source eBPF objects (can be rebuilt)
rm -f ebpf/component-1-daemon/*.o

# Remove downloaded kind binary (already installed)
rm -f kind

# Remove daemon binary (will be rebuilt)
rm -f daemon/ebpf-daemon

# Remove temporary files
find . -name "*~" -delete
find . -name "*.swp" -delete
```

## Space Breakdown

Current sizes:
- `daemon/` - 116MB (includes ebpf-daemon binary ~48MB)
- `kind` - 6.2MB (can be deleted)
- `ebpf/` - 5.1MB (includes .o files ~2MB)
- `.git/` - 576KB
- `ui/` - 76KB
- `examples/` - 44KB
- `k8s/` - 28KB
- `scripts/` - 12KB

**Potential savings**: ~56MB (kind binary + daemon binary + .o files)

## After Cleanup

To rebuild everything:
```bash
# Rebuild eBPF programs
./scripts/build-ebpf.sh

# Rebuild and deploy daemon
./rebuild-daemon.sh
```
