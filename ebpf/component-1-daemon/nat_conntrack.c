// SPDX-License-Identifier: GPL-2.0
// NAT Connection Tracking - Monitor SNAT/DNAT translations
// Hooks into Linux connection tracking (conntrack) to observe NAT operations

#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_endian.h>

char LICENSE[] SEC("license") = "GPL";

// NAT event types
#define NAT_TYPE_SNAT 1
#define NAT_TYPE_DNAT 2
#define NAT_ERROR 3

// NAT event structure sent to userspace
struct nat_event {
    __u32 pid;
    __u32 nat_type;        // SNAT=1, DNAT=2, ERROR=3
    __u32 orig_saddr;      // Original source IP
    __u32 orig_daddr;      // Original destination IP
    __u16 orig_sport;      // Original source port
    __u16 orig_dport;      // Original destination port
    __u32 nat_saddr;       // Translated source IP
    __u32 nat_daddr;       // Translated destination IP
    __u16 nat_sport;       // Translated source port
    __u16 nat_dport;       // Translated destination port
    __u8 protocol;         // TCP=6, UDP=17
    __u64 timestamp;
};

// Ring buffer for sending events to userspace
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024); // 256KB
} nat_events SEC(".maps");

// Map to track active NAT connections
struct nat_conn_key {
    __u32 saddr;
    __u32 daddr;
    __u16 sport;
    __u16 dport;
    __u8 protocol;
};

struct nat_conn_value {
    __u32 nat_saddr;
    __u32 nat_daddr;
    __u16 nat_sport;
    __u16 nat_dport;
    __u64 first_seen;
    __u64 last_seen;
    __u32 packet_count;
    __u8 nat_type;
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10000);
    __type(key, struct nat_conn_key);
    __type(value, struct nat_conn_value);
} nat_connections SEC(".maps");

// Helper to check if IP is from pod CIDR (typically 10.244.0.0/16)
static __always_inline bool is_pod_ip(__u32 ip) {
    // 10.244.0.0/16 = 0x0AF40000 with mask 0xFFFF0000
    return (bpf_ntohl(ip) & 0xFFFF0000) == 0x0AF40000;
}

// Helper to check if IP is service CIDR (typically 10.96.0.0/12)
static __always_inline bool is_service_ip(__u32 ip) {
    // 10.96.0.0/12 = 0x0A600000 with mask 0xFFF00000
    return (bpf_ntohl(ip) & 0xFFF00000) == 0x0A600000;
}

// Detect SNAT: Pod IP → External IP becomes Node IP → External IP
SEC("kprobe/nf_nat_inet_fn")
int BPF_KPROBE(trace_nf_nat_inet_fn, void *priv, struct sk_buff *skb) {
    struct nat_event *e;
    struct iphdr *iph;
    __u32 saddr, daddr;
    __u16 sport = 0, dport = 0;
    __u8 protocol;

    // Read IP header
    iph = (struct iphdr *)(BPF_CORE_READ(skb, head) + BPF_CORE_READ(skb, network_header));
    if (!iph)
        return 0;

    saddr = BPF_CORE_READ(iph, saddr);
    daddr = BPF_CORE_READ(iph, daddr);
    protocol = BPF_CORE_READ(iph, protocol);

    // Only track TCP and UDP
    if (protocol != IPPROTO_TCP && protocol != IPPROTO_UDP)
        return 0;

    // Read ports for TCP/UDP
    if (protocol == IPPROTO_TCP) {
        struct tcphdr *tcph = (struct tcphdr *)((__u8 *)iph + (BPF_CORE_READ(iph, ihl) * 4));
        sport = bpf_ntohs(BPF_CORE_READ(tcph, source));
        dport = bpf_ntohs(BPF_CORE_READ(tcph, dest));
    } else if (protocol == IPPROTO_UDP) {
        struct udphdr *udph = (struct udphdr *)((__u8 *)iph + (BPF_CORE_READ(iph, ihl) * 4));
        sport = bpf_ntohs(BPF_CORE_READ(udph, source));
        dport = bpf_ntohs(BPF_CORE_READ(udph, dest));
    }

    // Detect NAT type
    __u8 nat_type = 0;
    
    // SNAT: Pod IP going to external (will be NATed to node IP)
    if (is_pod_ip(saddr) && !is_pod_ip(daddr) && !is_service_ip(daddr)) {
        nat_type = NAT_TYPE_SNAT;
    }
    // DNAT: Traffic to service IP (will be NATed to pod IP)
    else if (is_service_ip(daddr)) {
        nat_type = NAT_TYPE_DNAT;
    } else {
        return 0; // Not interesting NAT
    }

    // Reserve space in ring buffer
    e = bpf_ringbuf_reserve(&nat_events, sizeof(*e), 0);
    if (!e)
        return 0;

    // Fill event (we see pre-NAT state here, post-NAT will be in conntrack)
    e->pid = bpf_get_current_pid_tgid() >> 32;
    e->nat_type = nat_type;
    e->orig_saddr = saddr;
    e->orig_daddr = daddr;
    e->orig_sport = sport;
    e->orig_dport = dport;
    e->protocol = protocol;
    e->timestamp = bpf_ktime_get_ns();
    
    // Post-NAT IPs will be filled by userspace from conntrack
    e->nat_saddr = saddr;
    e->nat_daddr = daddr;
    e->nat_sport = sport;
    e->nat_dport = dport;

    // Update connection tracking
    struct nat_conn_key key = {
        .saddr = saddr,
        .daddr = daddr,
        .sport = sport,
        .dport = dport,
        .protocol = protocol,
    };

    struct nat_conn_value *val = bpf_map_lookup_elem(&nat_connections, &key);
    if (val) {
        val->last_seen = e->timestamp;
        val->packet_count++;
    } else {
        struct nat_conn_value new_val = {
            .nat_saddr = saddr,
            .nat_daddr = daddr,
            .nat_sport = sport,
            .nat_dport = dport,
            .first_seen = e->timestamp,
            .last_seen = e->timestamp,
            .packet_count = 1,
            .nat_type = nat_type,
        };
        bpf_map_update_elem(&nat_connections, &key, &new_val, BPF_ANY);
    }

    // Submit event
    bpf_ringbuf_submit(e, 0);
    return 0;
}

// Track connection tracking table updates
SEC("kprobe/__nf_conntrack_confirm")
int BPF_KPROBE(trace_conntrack_confirm, struct sk_buff *skb) {
    // Connection is being confirmed in conntrack table
    // This is where we'd see the final NAT state
    
    struct nat_event *e;
    struct iphdr *iph;
    
    iph = (struct iphdr *)(BPF_CORE_READ(skb, head) + BPF_CORE_READ(skb, network_header));
    if (!iph)
        return 0;

    __u32 saddr = BPF_CORE_READ(iph, saddr);
    __u32 daddr = BPF_CORE_READ(iph, daddr);
    __u8 protocol = BPF_CORE_READ(iph, protocol);

    // Only track TCP/UDP
    if (protocol != IPPROTO_TCP && protocol != IPPROTO_UDP)
        return 0;

    // Track successful connections being established through NAT
    struct nat_conn_key key = {
        .saddr = saddr,
        .daddr = daddr,
        .protocol = protocol,
    };

    struct nat_conn_value *val = bpf_map_lookup_elem(&nat_connections, &key);
    if (val) {
        val->last_seen = bpf_ktime_get_ns();
        val->packet_count++;
    }

    return 0;
}

// Track NAT failures
SEC("kprobe/nf_nat_setup_info")
int BPF_KPROBE(trace_nat_setup_info, void *ct, void *range) {
    // This is called when setting up NAT for a new connection
    // We can detect errors here
    
    struct nat_event *e = bpf_ringbuf_reserve(&nat_events, sizeof(*e), 0);
    if (!e)
        return 0;

    e->pid = bpf_get_current_pid_tgid() >> 32;
    e->nat_type = NAT_TYPE_SNAT; // Will be determined from context
    e->timestamp = bpf_ktime_get_ns();
    
    bpf_ringbuf_submit(e, 0);
    return 0;
}

