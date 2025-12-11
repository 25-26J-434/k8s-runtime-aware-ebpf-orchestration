#Chaneg this content to architecture-aware content : Will not effect to the strcture

#!/bin/bash
set -euo pipefail

ARCH=$(uname -m)
ARCH_INCLUDE="/usr/include/${ARCH}-linux-gnu"

clang -O2 -target bpf \
  -I/usr/include \
  -I${ARCH_INCLUDE} \
  -c ebpf/component-1-daemon/kernel_monitor.c \
  -o kernel_monitor.o
