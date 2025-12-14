#Chaneg this content to architecture-aware content : Will not effect to the strcture

#!/bin/bash
# eBPF Build Script for Runtime-Aware Telemetry Daemon
# This script compiles the eBPF programs and prepares them for embedding in the Go binary

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
EBPF_DIR="$PROJECT_ROOT/ebpf"
DAEMON_DIR="$PROJECT_ROOT/daemon"
COMMON_DIR="$EBPF_DIR/common"
COMPONENT_DIR="$EBPF_DIR/component-1-daemon"
OUTPUT_DIR="$DAEMON_DIR/pkg/loader/bpf"

echo "=========================================="
echo "  eBPF Build Script"
echo "  Project: Runtime-Aware Telemetry"
echo "=========================================="

# Check for required tools
check_tools() {
    echo "[CHECK] Verifying required tools..."
    
    if ! command -v clang &> /dev/null; then
        echo "[ERROR] clang is required but not installed"
        echo "Install with: sudo apt install clang"
        exit 1
    fi
    
    if ! command -v llc &> /dev/null; then
        echo "[ERROR] llc is required but not installed"
        echo "Install with: sudo apt install llvm"
        exit 1
    fi
    
    if ! command -v bpftool &> /dev/null; then
        echo "[WARN] bpftool not found - vmlinux.h generation may fail"
        echo "Install with: sudo apt install linux-tools-$(uname -r)"
    fi
    
    echo "[OK] All required tools found"
}

# Generate vmlinux.h if it doesn't exist
generate_vmlinux() {
    VMLINUX_H="$COMPONENT_DIR/vmlinux.h"
    
    if [ -f "$VMLINUX_H" ]; then
        echo "[OK] vmlinux.h already exists"
        return
    fi
    
    echo "[BUILD] Generating vmlinux.h..."
    
    if command -v bpftool &> /dev/null; then
        if [ -f "/sys/kernel/btf/vmlinux" ]; then
            bpftool btf dump file /sys/kernel/btf/vmlinux format c > "$VMLINUX_H"
            echo "[OK] Generated vmlinux.h from kernel BTF"
        else
            echo "[WARN] /sys/kernel/btf/vmlinux not found"
            echo "[WARN] Using minimal vmlinux.h - some features may not work"
            create_minimal_vmlinux
        fi
    else
        echo "[WARN] bpftool not available, creating minimal vmlinux.h"
        create_minimal_vmlinux
    fi
}

create_minimal_vmlinux() {
    cat > "$COMPONENT_DIR/vmlinux.h" << 'EOF'
#ifndef __VMLINUX_H__
#define __VMLINUX_H__

typedef unsigned char __u8;
typedef short int __s16;
typedef short unsigned int __u16;
typedef int __s32;
typedef unsigned int __u32;
typedef long long int __s64;
typedef long long unsigned int __u64;
typedef __u8 u8;
typedef __u16 u16;
typedef __u32 u32;
typedef __u64 u64;
typedef __s64 s64;

typedef int bool;
#define true 1
#define false 0

struct sock_common {
    __u32 skc_rcv_saddr;
    __u32 skc_daddr;
    __u16 skc_num;
    __u16 skc_dport;
    unsigned short skc_family;
};

struct sock {
    struct sock_common __sk_common;
};

struct tcp_sock {
    struct sock sk;
    __u32 srtt_us;  // smoothed round trip time << 3 in usecs
    __u32 rttvar_us;
    __u32 mdev_us;
    __u32 rcv_rtt_est;
};

struct pt_regs {
    unsigned long r15;
    unsigned long r14;
    unsigned long r13;
    unsigned long r12;
    unsigned long bp;
    unsigned long bx;
    unsigned long r11;
    unsigned long r10;
    unsigned long r9;
    unsigned long r8;
    unsigned long ax;
    unsigned long cx;
    unsigned long dx;
    unsigned long si;
    unsigned long di;
    unsigned long orig_ax;
    unsigned long ip;
    unsigned long cs;
    unsigned long flags;
    unsigned long sp;
    unsigned long ss;
};

#endif /* __VMLINUX_H__ */
EOF
    echo "[OK] Created minimal vmlinux.h"
}

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Check tools
check_tools

# Generate vmlinux.h if needed
generate_vmlinux

# Define architecture
ARCH=$(uname -m)
case "$ARCH" in
    x86_64)
        TARGET_ARCH="x86"
        ;;
    aarch64)
        TARGET_ARCH="arm64"
        ;;
    *)
        echo "[WARN] Unknown architecture: $ARCH, defaulting to x86"
        TARGET_ARCH="x86"
        ;;
esac

echo "[BUILD] Target architecture: $TARGET_ARCH"

# Common clang flags for eBPF compilation
CLANG_FLAGS="-O2 -g -target bpf -D__TARGET_ARCH_${TARGET_ARCH} -I${COMMON_DIR} -I${COMPONENT_DIR}"

# Build DNS Latency eBPF program
echo "[BUILD] Compiling dns_latency.c..."
clang $CLANG_FLAGS \
    -c "$COMPONENT_DIR/dns_latency.c" \
    -o "$COMPONENT_DIR/dns_latency.o"

echo "[OK] dns_latency.o compiled"

# Copy to loader's bpf directory for embedding
cp "$COMPONENT_DIR/dns_latency.o" "$OUTPUT_DIR/dns_latency.o"
echo "[OK] Copied dns_latency.o to $OUTPUT_DIR"

# Build RTT eBPF program (if exists)
if [ -f "$COMPONENT_DIR/rtt.c" ]; then
    echo "[BUILD] Compiling rtt.c..."
    clang $CLANG_FLAGS \
        -c "$COMPONENT_DIR/rtt.c" \
        -o "$COMPONENT_DIR/rtt.o" 2>&1 || {
        echo "[WARN] RTT program compilation failed - this may require BTF support"
        echo "[WARN] Continuing without RTT..."
    }
    
    if [ -f "$COMPONENT_DIR/rtt.o" ]; then
        cp "$COMPONENT_DIR/rtt.o" "$OUTPUT_DIR/rtt.o"
        echo "[OK] Copied rtt.o to $OUTPUT_DIR"
    fi
fi

# Build Socket Count eBPF program (if exists)
if [ -f "$COMPONENT_DIR/socket_count.c" ]; then
    echo "[BUILD] Compiling socket_count.c..."
    clang $CLANG_FLAGS \
        -c "$COMPONENT_DIR/socket_count.c" \
        -o "$COMPONENT_DIR/socket_count.o" 2>&1 || {
        echo "[WARN] Socket count program compilation failed"
        echo "[WARN] Continuing without socket count..."
    }
    
    if [ -f "$COMPONENT_DIR/socket_count.o" ]; then
        cp "$COMPONENT_DIR/socket_count.o" "$OUTPUT_DIR/socket_count.o"
        echo "[OK] Copied socket_count.o to $OUTPUT_DIR"
    fi
fi

# Build TCP Metrics eBPF program (if exists)
if [ -f "$COMPONENT_DIR/tcp_metrics.c" ]; then
    echo "[BUILD] Compiling tcp_metrics.c..."
    clang $CLANG_FLAGS \
        -c "$COMPONENT_DIR/tcp_metrics.c" \
        -o "$COMPONENT_DIR/tcp_metrics.o" 2>&1 || {
        echo "[WARN] TCP metrics program compilation failed"
        echo "[WARN] Continuing without TCP metrics..."
    }
    
    if [ -f "$COMPONENT_DIR/tcp_metrics.o" ]; then
        cp "$COMPONENT_DIR/tcp_metrics.o" "$OUTPUT_DIR/tcp_metrics.o"
        echo "[OK] Copied tcp_metrics.o to $OUTPUT_DIR"
    fi
fi

# Verify the compiled objects
echo ""
echo "[VERIFY] Checking compiled eBPF objects..."
for obj in "$OUTPUT_DIR"/*.o; do
    if [ -f "$obj" ]; then
        echo "  - $(basename $obj): $(ls -lh $obj | awk '{print $5}')"
        
        # Show sections if llvm-objdump is available
        if command -v llvm-objdump &> /dev/null; then
            echo "    Sections:"
            llvm-objdump -h "$obj" 2>/dev/null | grep -E "^\s+[0-9]+" | awk '{print "      " $2}' || true
        fi
    fi
done

echo ""
echo "=========================================="
echo "  Build Complete!"
echo "  Output: $OUTPUT_DIR"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. cd $DAEMON_DIR"
echo "  2. go build -o ebpf-daemon ./cmd/daemon"
echo "  3. sudo ./ebpf-daemon"
