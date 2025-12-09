// RTT (Round-Trip Time) eBPF Program
// Measures TCP connection latency by tracing tcp_rcv_established
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

char LICENSE[] SEC("license") = "GPL";

struct rtt_event {
    __u32 pid;
    __u32 saddr;
    __u32 daddr;
    __u64 rtt_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 24); // 16MB
} rtt_events SEC(".maps");

// Track TCP connection timestamps
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, __u64);     // Connection key: saddr:sport:daddr:dport
    __type(value, __u64);   // Timestamp when SYN was sent
} tcp_connect_start SEC(".maps");

// Helper to create connection key
static __always_inline __u64 make_conn_key(__u32 saddr, __u16 sport, __u32 daddr, __u16 dport) {
    return ((__u64)saddr << 32) | ((__u64)daddr);
}

// Trace TCP connect initiation
SEC("kprobe/tcp_connect")
int BPF_KPROBE(tcp_connect_probe, struct sock *sk)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u64 ts = bpf_ktime_get_ns();

    // Read socket info
    __u32 saddr = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
    __u32 daddr = BPF_CORE_READ(sk, __sk_common.skc_daddr);
    __u16 sport = BPF_CORE_READ(sk, __sk_common.skc_num);
    __u16 dport = BPF_CORE_READ(sk, __sk_common.skc_dport);

    __u64 conn_key = make_conn_key(saddr, sport, daddr, dport);
    bpf_map_update_elem(&tcp_connect_start, &conn_key, &ts, BPF_ANY);

    return 0;
}

// Trace TCP connection establishment (SYN-ACK received)
SEC("kprobe/tcp_finish_connect")
int BPF_KPROBE(tcp_finish_connect_probe, struct sock *sk)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u64 end_ts = bpf_ktime_get_ns();

    // Read socket info
    __u32 saddr = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
    __u32 daddr = BPF_CORE_READ(sk, __sk_common.skc_daddr);
    __u16 sport = BPF_CORE_READ(sk, __sk_common.skc_num);
    __u16 dport = BPF_CORE_READ(sk, __sk_common.skc_dport);

    __u64 conn_key = make_conn_key(saddr, sport, daddr, dport);

    __u64 *start_ts = bpf_map_lookup_elem(&tcp_connect_start, &conn_key);
    if (!start_ts)
        return 0;

    __u64 rtt_ns = end_ts - *start_ts;

    // Submit event to ring buffer
    struct rtt_event *e = bpf_ringbuf_reserve(&rtt_events, sizeof(struct rtt_event), 0);
    if (!e)
        return 0;

    e->pid = pid;
    e->saddr = saddr;
    e->daddr = daddr;
    e->rtt_ns = rtt_ns;

    bpf_ringbuf_submit(e, 0);
    bpf_map_delete_elem(&tcp_connect_start, &conn_key);

    return 0;
}

// Alternative: Use fentry for better performance on newer kernels
SEC("fentry/tcp_rcv_established")
int BPF_PROG(tcp_rcv_rtt, struct sock *sk)
{
    // Get the smoothed RTT from tcp_sock
    struct tcp_sock *tp = (struct tcp_sock *)sk;
    __u32 srtt_us = BPF_CORE_READ(tp, srtt_us) >> 3; // srtt_us is stored as 8x actual value
    
    if (srtt_us == 0)
        return 0;

    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u32 saddr = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
    __u32 daddr = BPF_CORE_READ(sk, __sk_common.skc_daddr);

    // Submit RTT event
    struct rtt_event *e = bpf_ringbuf_reserve(&rtt_events, sizeof(struct rtt_event), 0);
    if (!e)
        return 0;

    e->pid = pid;
    e->saddr = saddr;
    e->daddr = daddr;
    e->rtt_ns = (__u64)srtt_us * 1000; // Convert μs to ns

    bpf_ringbuf_submit(e, 0);

    return 0;
}

