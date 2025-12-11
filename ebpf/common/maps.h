#pragma once
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>

struct dns_event {
    __u64 timestamp_ns;
    __u32 pid;
    __u32 saddr;        // Source IP address
    __u32 latency_ns;
    char   domain[256];
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 24);
} dns_events SEC(".maps");
