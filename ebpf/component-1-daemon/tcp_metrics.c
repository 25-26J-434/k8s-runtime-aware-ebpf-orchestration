// TCP Metrics eBPF Program
// Collects comprehensive TCP metrics: RTT (smoothed, min), retransmissions,
// congestion window, packet loss, state transitions, round-trip samples, bad handshakes
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

char LICENSE[] SEC("license") = "GPL";

// TCP state definitions
#define TCP_ESTABLISHED 1
#define TCP_SYN_SENT    2
#define TCP_SYN_RECV    3
#define TCP_FIN_WAIT1   4
#define TCP_FIN_WAIT2   5
#define TCP_TIME_WAIT   6
#define TCP_CLOSE       7
#define TCP_CLOSE_WAIT  8
#define TCP_LAST_ACK    9
#define TCP_LISTEN      10
#define TCP_CLOSING     11

// TCP metrics event
struct tcp_metrics_event {
    __u32 pid;
    __u32 saddr;
    __u32 daddr;
    __u16 sport;
    __u16 dport;
    __u8  event_type;  // 1=RTT, 2=Retransmission, 3=CWND, 4=PacketLoss, 5=StateTransition, 6=BadHandshake
    __u8  tcp_state;   // Current TCP state
    __u32 srtt_us;     // Smoothed RTT in microseconds
    __u32 min_rtt_us;  // Minimum RTT in microseconds
    __u32 cwnd;        // Congestion window
    __u32 retrans_count; // Retransmission count
    __u64 timestamp_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 24); // 16MB
} tcp_metrics_events SEC(".maps");

// Track TCP connection info
struct tcp_conn_info {
    __u32 pid;
    __u32 saddr;
    __u32 daddr;
    __u16 sport;
    __u16 dport;
    __u8  state;
    __u32 srtt_us;
    __u32 min_rtt_us;
    __u32 cwnd;
    __u32 retrans_count;
    __u64 last_update_ns;
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, __u64);  // Connection key: socket pointer
    __type(value, struct tcp_conn_info);
} tcp_connections SEC(".maps");

// Helper to create connection key
static __always_inline __u64 make_conn_key(void *sk_ptr) {
    return (__u64)(long)sk_ptr;
}

// Helper to submit metrics event
static __always_inline void submit_event(__u32 pid, struct sock *sk, __u8 event_type, __u8 state, 
                                         __u32 srtt, __u32 min_rtt, __u32 cwnd, __u32 retrans) {
    struct tcp_metrics_event *e = bpf_ringbuf_reserve(&tcp_metrics_events, sizeof(struct tcp_metrics_event), 0);
    if (!e) return;
    
    __u32 saddr = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
    __u32 daddr = BPF_CORE_READ(sk, __sk_common.skc_daddr);
    __u16 sport = __builtin_bswap16(BPF_CORE_READ(sk, __sk_common.skc_num));
    __u16 dport = __builtin_bswap16(BPF_CORE_READ(sk, __sk_common.skc_dport));
    
    e->pid = pid;
    e->saddr = saddr;
    e->daddr = daddr;
    e->sport = sport;
    e->dport = dport;
    e->event_type = event_type;
    e->tcp_state = state;
    e->srtt_us = srtt;
    e->min_rtt_us = min_rtt;
    e->cwnd = cwnd;
    e->retrans_count = retrans;
    e->timestamp_ns = bpf_ktime_get_ns();
    
    bpf_ringbuf_submit(e, 0);
}

// Trace TCP state changes
SEC("kprobe/tcp_set_state")
int BPF_KPROBE(tcp_set_state_probe, struct sock *sk, int state)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u64 conn_key = make_conn_key(sk);
    
    struct tcp_conn_info *conn = bpf_map_lookup_elem(&tcp_connections, &conn_key);
    if (!conn) {
        // New connection
        struct tcp_conn_info new_conn = {0};
        new_conn.pid = pid;
        new_conn.saddr = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
        new_conn.daddr = BPF_CORE_READ(sk, __sk_common.skc_daddr);
        new_conn.sport = __builtin_bswap16(BPF_CORE_READ(sk, __sk_common.skc_num));
        new_conn.dport = __builtin_bswap16(BPF_CORE_READ(sk, __sk_common.skc_dport));
        new_conn.state = (__u8)state;
        new_conn.last_update_ns = bpf_ktime_get_ns();
        bpf_map_update_elem(&tcp_connections, &conn_key, &new_conn, BPF_ANY);
    } else {
        __u8 old_state = conn->state;
        conn->state = (__u8)state;
        conn->last_update_ns = bpf_ktime_get_ns();
        bpf_map_update_elem(&tcp_connections, &conn_key, conn, BPF_ANY);
        
        // Submit state transition event
        if (old_state != (__u8)state) {
            submit_event(pid, sk, 5, (__u8)state, 0, 0, 0, 0);
        }
    }
    
    return 0;
}

// Trace TCP retransmissions
SEC("kprobe/tcp_retransmit_skb")
int BPF_KPROBE(tcp_retransmit_skb_probe, struct sock *sk, struct sk_buff *skb, int segs)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u64 conn_key = make_conn_key(sk);
    
    struct tcp_conn_info *conn = bpf_map_lookup_elem(&tcp_connections, &conn_key);
    if (conn) {
        conn->retrans_count++;
        conn->last_update_ns = bpf_ktime_get_ns();
        bpf_map_update_elem(&tcp_connections, &conn_key, conn, BPF_ANY);
        
        // Submit retransmission event
        submit_event(pid, sk, 2, conn->state, conn->srtt_us, conn->min_rtt_us, conn->cwnd, conn->retrans_count);
    }
    
    return 0;
}

// Trace TCP RTT updates (smoothed RTT and min RTT)
SEC("kprobe/tcp_rtt_estimator")
int BPF_KPROBE(tcp_rtt_estimator_probe, struct sock *sk, __u32 mrtt_us)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u64 conn_key = make_conn_key(sk);
    
    struct tcp_conn_info *conn = bpf_map_lookup_elem(&tcp_connections, &conn_key);
    if (!conn) {
        // Try to initialize connection
        struct tcp_conn_info new_conn = {0};
        new_conn.pid = pid;
        new_conn.saddr = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
        new_conn.daddr = BPF_CORE_READ(sk, __sk_common.skc_daddr);
        new_conn.sport = __builtin_bswap16(BPF_CORE_READ(sk, __sk_common.skc_num));
        new_conn.dport = __builtin_bswap16(BPF_CORE_READ(sk, __sk_common.skc_dport));
        new_conn.state = TCP_ESTABLISHED;
        new_conn.srtt_us = mrtt_us;
        new_conn.min_rtt_us = mrtt_us;
        new_conn.last_update_ns = bpf_ktime_get_ns();
        bpf_map_update_elem(&tcp_connections, &conn_key, &new_conn, BPF_ANY);
        conn = bpf_map_lookup_elem(&tcp_connections, &conn_key);
    }
    
    if (conn) {
        // Read SRTT and min RTT from tcp_sock structure directly
        // tcp_sock is a cast of sock, so we can access TCP-specific fields
        struct tcp_sock *tp = (struct tcp_sock *)sk;
        
        // srtt_us in kernel is stored in microseconds
        // In some kernel versions, it might be stored as (srtt >> 3) * 8
        // Let's read it directly and validate
        __u32 srtt = 0;
        __u32 min_rtt = 0;
        
        // Try to read srtt_us field (may vary by kernel version)
        srtt = BPF_CORE_READ(tp, srtt_us);
        
        // If srtt_us is 0 or invalid, try alternative field names
        // Some kernels use different field names or storage
        if (srtt == 0 || srtt > 60000000) { // > 60 seconds is unrealistic
            // Fallback: use mrtt_us parameter if available (measured RTT)
            // This is less accurate but better than nothing
            srtt = mrtt_us;
        }
        
        // Read min RTT (rcv_rtt_est.rtt_us)
        min_rtt = BPF_CORE_READ(tp, rcv_rtt_est.rtt_us);
        if (min_rtt == 0 || min_rtt > 60000000) {
            // Fallback to mrtt_us
            min_rtt = mrtt_us;
        }
        
        // Validate and update connection info
        // Filter unrealistic values (> 60 seconds = 60,000,000 microseconds)
        if (srtt > 0 && srtt < 60000000) {
            conn->srtt_us = srtt;
        }
        
        if (min_rtt > 0 && min_rtt < 60000000) {
            if (min_rtt < conn->min_rtt_us || conn->min_rtt_us == 0) {
                conn->min_rtt_us = min_rtt;
            }
        }
        
        conn->last_update_ns = bpf_ktime_get_ns();
        bpf_map_update_elem(&tcp_connections, &conn_key, conn, BPF_ANY);
        
        // Only submit if we have valid RTT data
        if (conn->srtt_us > 0 && conn->srtt_us < 60000000) {
            submit_event(pid, sk, 1, conn->state, conn->srtt_us, conn->min_rtt_us, conn->cwnd, conn->retrans_count);
        }
    }
    
    return 0;
}

// Trace congestion window updates
SEC("kprobe/tcp_cwnd_restart")
int BPF_KPROBE(tcp_cwnd_restart_probe, struct sock *sk, __u32 cwnd)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u64 conn_key = make_conn_key(sk);
    
    struct tcp_conn_info *conn = bpf_map_lookup_elem(&tcp_connections, &conn_key);
    if (conn) {
        conn->cwnd = cwnd;
        conn->last_update_ns = bpf_ktime_get_ns();
        bpf_map_update_elem(&tcp_connections, &conn_key, conn, BPF_ANY);
        
        // Submit CWND update event
        submit_event(pid, sk, 3, conn->state, conn->srtt_us, conn->min_rtt_us, cwnd, conn->retrans_count);
    }
    
    return 0;
}

// Trace packet loss (via duplicate ACKs or timeouts)
SEC("kprobe/tcp_enter_loss")
int BPF_KPROBE(tcp_enter_loss_probe, struct sock *sk)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u64 conn_key = make_conn_key(sk);
    
    struct tcp_conn_info *conn = bpf_map_lookup_elem(&tcp_connections, &conn_key);
    if (conn) {
        conn->last_update_ns = bpf_ktime_get_ns();
        bpf_map_update_elem(&tcp_connections, &conn_key, conn, BPF_ANY);
        
        // Submit packet loss event
        submit_event(pid, sk, 4, conn->state, conn->srtt_us, conn->min_rtt_us, conn->cwnd, conn->retrans_count);
    }
    
    return 0;
}

// Detect bad handshakes (SYN timeout, connection refused, etc.)
SEC("kprobe/tcp_v4_connect")
int BPF_KPROBE(tcp_v4_connect_start_probe, struct sock *sk, struct sockaddr *uaddr, int addr_len)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u64 conn_key = make_conn_key(sk);
    __u64 ts = bpf_ktime_get_ns();
    
    // Initialize connection tracking
    struct tcp_conn_info conn = {0};
    conn.pid = pid;
    conn.saddr = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
    conn.daddr = BPF_CORE_READ(sk, __sk_common.skc_daddr);
    conn.sport = __builtin_bswap16(BPF_CORE_READ(sk, __sk_common.skc_num));
    conn.dport = __builtin_bswap16(BPF_CORE_READ(sk, __sk_common.skc_dport));
    conn.state = TCP_SYN_SENT;
    conn.last_update_ns = ts;
    bpf_map_update_elem(&tcp_connections, &conn_key, &conn, BPF_ANY);
    
    return 0;
}

// Detect failed handshakes (timeout after SYN_SENT)
SEC("kprobe/tcp_syn_retransmit")
int BPF_KPROBE(tcp_syn_retransmit_probe, struct sock *sk)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u64 conn_key = make_conn_key(sk);
    
    struct tcp_conn_info *conn = bpf_map_lookup_elem(&tcp_connections, &conn_key);
    if (conn && conn->state == TCP_SYN_SENT) {
        // Multiple SYN retransmissions indicate bad handshake
        __u64 time_since_syn = bpf_ktime_get_ns() - conn->last_update_ns;
        if (time_since_syn > 3000000000ULL) { // 3 seconds
            // Bad handshake detected
            submit_event(pid, sk, 6, conn->state, 0, 0, 0, conn->retrans_count);
        }
    }
    
    return 0;
}

// Clean up closed connections
SEC("kprobe/tcp_close")
int BPF_KPROBE(tcp_close_probe, struct sock *sk)
{
    __u64 conn_key = make_conn_key(sk);
    bpf_map_delete_elem(&tcp_connections, &conn_key);
    return 0;
}

