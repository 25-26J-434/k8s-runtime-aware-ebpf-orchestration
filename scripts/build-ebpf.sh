#!/bin/bash
clang -O2 -target bpf -c ebpf/component-1-daemon/kernel_monitor.c -o kernel_monitor.o
