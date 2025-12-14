# Intent Routing -- eBPF Kernel Programming Practical Guide

### *All steps completed on Ubuntu 24.04 with Minikube + Cilium environment*

## 1. Environment Setup (Ubuntu Machine)

``` bash
sudo apt update
sudo apt install -y \
  clang llvm libelf-dev libbpf-dev \
  gcc make iproute2 iputils-ping \
  linux-headers-$(uname -r)
```

## 2. Project Structure

``` bash
cd ~
mkdir -p intent-routing/{src,policies,scripts,test}
cd intent-routing
touch README.md
```

## 3. Intent Policy File

``` json
{
  "intent": "low-latency",
  "threshold_ms": 100,
  "action": "reroute"
}
```

## 4. Simulate Intent Decision Logic

Python script to simulate decisions:

``` python
import json
import random
from pathlib import Path

policy_path = Path(__file__).parent.parent / "policies" / "latency-intent.json"
with open(policy_path) as f:
    intent = json.load(f)

latency = random.randint(50, 200)
threshold = intent["threshold_ms"]

if latency > threshold:
    print(f"Latency {latency}ms > {threshold}ms → REROUTE triggered")
else:
    print(f"Latency {latency}ms OK → no action")
```

## 5. Generate Kernel BTF Header

``` bash
cd src
sudo bpftool btf dump file /sys/kernel/btf/vmlinux format c > vmlinux.h
```

## 6. eBPF Kernel Program

``` c
#include "vmlinux.h"

typedef unsigned char      __u8;
typedef unsigned short     __u16;
typedef unsigned int       __u32;
typedef unsigned long long __u64;
typedef int                __s32;
typedef long long          __s64;

typedef __u16 __be16;
typedef __u32 __be32;
typedef __u32 __wsum;

#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

char LICENSE[] SEC("license") = "GPL";

SEC("kprobe/tcp_v4_connect")
int BPF_KPROBE(bpf_prog)
{
    bpf_printk("Intercepted TCP connection\n");
    return 0;
}
```

## 7. Compile the eBPF Program

``` bash
cd ~/intent-routing
clang -O2 -g -target bpf -D__TARGET_ARCH_x86 \
  -I./src \
  -c src/intent_router.c \
  -o intent_router.o
```

## 8. Install Working bpftool Binary

``` bash
cd ~
curl -LO https://github.com/libbpf/bpftool/releases/download/v7.5.0/bpftool-v7.5.0-x86_64
chmod +x bpftool-v7.5.0-x86_64
sudo mv bpftool-v7.5.0-x86_64 /usr/local/bin/bpftool
hash -r
```

## 9. Load Program into Kernel

``` bash
sudo rm -f /sys/fs/bpf/intent_router
sudo bpftool prog load intent_router.o /sys/fs/bpf/intent_router type kprobe
```

## 10. Attach Program to Hook

``` bash
sudo bpftool prog attach pinned /sys/fs/bpf/intent_router \
  kprobe tcp_v4_connect
```

## 11. View Kernel Output

Terminal 1:

``` bash
sudo cat /sys/kernel/debug/tracing/trace_pipe
```

Terminal 2:

``` bash
curl https://example.com
curl https://google.com
```

Output (expected):

    Intercepted TCP connection
    Intercepted TCP connection
