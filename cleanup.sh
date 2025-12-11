#!/bin/bash

echo "========================================="
echo "  Project Cleanup Script"
echo "========================================="
echo ""

# Files that can be safely removed:
# 1. Compiled eBPF .o files (can be rebuilt)
# 2. Downloaded kind binary (already installed)
# 3. Temporary build artifacts
# 4. Go build cache

echo "Files to be removed:"
echo ""

# Show what will be deleted
echo "📦 Compiled eBPF objects (.o files):"
find . -name "*.o" -type f 2>/dev/null

echo ""
echo "📦 Downloaded kind binary (already installed):"
ls -lh kind 2>/dev/null || echo "  (not found)"

echo ""
echo "📦 Daemon binary (will be rebuilt):"
ls -lh daemon/ebpf-daemon 2>/dev/null || echo "  (not found)"

echo ""
echo "📦 Temporary files:"
find . -name "*~" -o -name "*.swp" -o -name ".DS_Store" 2>/dev/null || echo "  (none found)"

echo ""
echo "========================================="
read -p "Proceed with cleanup? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cleanup cancelled."
    exit 0
fi

echo ""
echo "🧹 Cleaning up..."

# Remove compiled eBPF objects (these are copied to daemon/pkg/loader/bpf/)
echo "Removing eBPF .o files from source directories..."
find ./ebpf/component-1-daemon -name "*.o" -type f -delete 2>/dev/null
echo "  ✓ Removed from ebpf/component-1-daemon/"

# Keep the .o files in daemon/pkg/loader/bpf/ as they're embedded in the binary
echo "Keeping .o files in daemon/pkg/loader/bpf/ (embedded in binary)"

# Remove downloaded kind binary (already installed to /usr/local/bin)
if [ -f "kind" ]; then
    echo "Removing downloaded kind binary..."
    rm -f kind
    echo "  ✓ Removed kind binary (installed version in /usr/local/bin)"
fi

# Remove daemon binary (will be rebuilt)
if [ -f "daemon/ebpf-daemon" ]; then
    echo "Removing daemon binary..."
    rm -f daemon/ebpf-daemon
    echo "  ✓ Removed daemon/ebpf-daemon (will be rebuilt)"
fi

# Remove temporary files
echo "Removing temporary files..."
find . -name "*~" -type f -delete 2>/dev/null
find . -name "*.swp" -type f -delete 2>/dev/null
find . -name ".DS_Store" -type f -delete 2>/dev/null
echo "  ✓ Removed temporary files"

# Clean Go build cache (optional)
echo ""
read -p "Clean Go build cache? This is safe but will slow down next build (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd daemon
    go clean -cache
    echo "  ✓ Cleaned Go build cache"
    cd ..
fi

echo ""
echo "========================================="
echo "  ✅ Cleanup Complete!"
echo "========================================="
echo ""
echo "Space saved:"
du -sh . 2>/dev/null
echo ""
echo "Important files preserved:"
echo "  ✓ Source code (daemon/, ebpf/, ui/)"
echo "  ✓ Kubernetes manifests (k8s/)"
echo "  ✓ Scripts (rebuild-daemon.sh, setup-kind-cluster.sh)"
echo "  ✓ Documentation (README.md, KIND_SETUP.md)"
echo "  ✓ Embedded eBPF objects (daemon/pkg/loader/bpf/*.o)"
echo ""
echo "To rebuild:"
echo "  ./scripts/build-ebpf.sh  # Rebuild eBPF programs"
echo "  ./rebuild-daemon.sh      # Rebuild and deploy daemon"
echo ""
