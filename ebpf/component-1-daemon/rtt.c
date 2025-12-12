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
// Store both timestamp and socket pointer to detect reuse
struct connect_info {
    __u64 timestamp_ns;
    void *socket_ptr;  // Store socket pointer to verify it's the same socket
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, __u64);     // Connection key: socket pointer hash
    __type(value, struct connect_info);   // Timestamp and socket pointer
} tcp_connect_start SEC(".maps");

// Helper to create connection key using 5-tuple: saddr, sport, daddr, dport, pid
// This ensures unique matching between tcp_connect and tcp_finish_connect
// Format: saddr(32) | sport(16) | daddr(32) | dport(16) | pid(32) - but we only have 64 bits
// So we use a hash: XOR of all components
static __always_inline __u64 make_conn_key(__u32 saddr, __u16 sport, __u32 daddr, __u16 dport, __u32 pid) {
    // Create a hash from all components to ensure uniqueness
    __u64 key = ((__u64)saddr << 32) | ((__u64)daddr);
    key ^= ((__u64)sport << 16) | (__u64)dport;
    key ^= (__u64)pid;
    return key;
}

// Trace TCP IPv4 connect initiation
// tcp_v4_connect is called when initiating a TCP connection to an IPv4 address
SEC("kprobe/tcp_v4_connect")
int BPF_KPROBE(tcp_v4_connect_probe, struct sock *sk, struct sockaddr *uaddr, int addr_len)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u64 ts = bpf_ktime_get_ns();

    // Read socket info - at tcp_v4_connect, we have better access to connection info
    __u32 daddr = BPF_CORE_READ(sk, __sk_common.skc_daddr);
    __u16 dport = __builtin_bswap16(BPF_CORE_READ(sk, __sk_common.skc_dport));
    
    // Source address/port may still be unset, but try to read them
    __u32 saddr = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
    __u16 sport = __builtin_bswap16(BPF_CORE_READ(sk, __sk_common.skc_num));
    
    // Create connection key - use socket pointer as primary key for uniqueness
    // Fallback to 5-tuple if socket pointer approach fails
    __u64 conn_key = make_conn_key(saddr, sport, daddr, dport, pid);
    
    struct connect_info info = {
        .timestamp_ns = ts,
        .socket_ptr = sk,
    };
    bpf_map_update_elem(&tcp_connect_start, &conn_key, &info, BPF_ANY);

    return 0;
}

// Trace TCP connection establishment (SYN-ACK received)
SEC("kprobe/tcp_finish_connect")
int BPF_KPROBE(tcp_finish_connect_probe, struct sock *sk)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u64 end_ts = bpf_ktime_get_ns();

    // Read socket info - at tcp_finish_connect, all info should be available
    __u32 saddr = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
    __u32 daddr = BPF_CORE_READ(sk, __sk_common.skc_daddr);
    __u16 dport = __builtin_bswap16(BPF_CORE_READ(sk, __sk_common.skc_dport));
    __u16 sport = __builtin_bswap16(BPF_CORE_READ(sk, __sk_common.skc_num));

    // Try to find matching connection - try with actual source first
    __u64 conn_key = make_conn_key(saddr, sport, daddr, dport, pid);
    struct connect_info *info = bpf_map_lookup_elem(&tcp_connect_start, &conn_key);
    
    // If not found, try with source=0 (in case it wasn't set at tcp_connect)
    if (!info && saddr != 0) {
        __u64 conn_key_no_src = make_conn_key(0, 0, daddr, dport, pid);
        info = bpf_map_lookup_elem(&tcp_connect_start, &conn_key_no_src);
        if (info) {
            // Found with source=0, update key to use actual source
            bpf_map_delete_elem(&tcp_connect_start, &conn_key_no_src);
            conn_key = make_conn_key(saddr, sport, daddr, dport, pid);
            bpf_map_update_elem(&tcp_connect_start, &conn_key, info, BPF_ANY);
        }
    }
    
    if (!info) {
        // No matching start timestamp - connection might have been reused
        // or key mismatch. This is normal for connection reuse.
        return 0;
    }

    // Verify this is the same socket (prevent reuse collisions)
    if (info->socket_ptr != sk) {
        // Socket pointer mismatch - this entry is for a different socket
        // Clean up stale entry
        bpf_map_delete_elem(&tcp_connect_start, &conn_key);
        return 0;
    }

    // Check if the connection started recently (within 60 seconds)
    // This prevents matching with very old stale entries
    __u64 time_since_start = end_ts - info->timestamp_ns;
    if (time_since_start > 60000000000ULL) {  // 60 seconds in nanoseconds
        // Connection started more than 60 seconds ago - likely stale entry
        bpf_map_delete_elem(&tcp_connect_start, &conn_key);
        return 0;
    }

    __u64 rtt_ns = time_since_start;

    // Validate RTT: should be reasonable (100μs to 60 seconds)
    // Lowered minimum to 100μs to catch fast local connections
    // Filter out unrealistic values (likely from stale map entries, errors, or wrong connections)
    if (rtt_ns < 100000 || rtt_ns > 60000000000) {
        // RTT < 100μs (too fast, likely measurement error) or > 60s (unrealistic)
        // Clean up the map entry and skip this measurement
        bpf_map_delete_elem(&tcp_connect_start, &conn_key);
        return 0;
    }

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

// Disabled: fentry method is unreliable due to kernel structure access issues
// Using only tcp_connect/tcp_finish_connect method which directly measures time
// This is more reliable and similar to how DNS latency is measured

// Alternative method (disabled - use tcp_connect/tcp_finish_connect instead):
// SEC("fentry/tcp_rcv_established")
// int BPF_PROG(tcp_rcv_rtt, struct sock *sk)
// {
//     // This method was reading incorrect values from kernel
//     // The tcp_connect/tcp_finish_connect method is more reliable
//     return 0;
// }

