// Socket Count eBPF Program
// Tracks active TCP and UDP sockets per process (for pod-level aggregation)
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

char LICENSE[] SEC("license") = "GPL";

// Socket count event
struct socket_count_event {
    __u32 pid;
    __u32 saddr;      // Source IP
    __u8 socket_type; // 1=TCP, 2=UDP
    __u8 action;      // 1=create, 0=destroy
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 24); // 16MB
} socket_count_events SEC(".maps");

// Track socket counts per PID
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, __u32);  // PID
    __type(value, __u64); // Socket count (TCP in upper 32 bits, UDP in lower 32 bits)
} socket_counts SEC(".maps");

// Trace TCP socket creation
SEC("kprobe/inet_csk_accept")
int BPF_KPROBE(tcp_accept_probe, struct sock *newsk)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u32 saddr = BPF_CORE_READ(newsk, __sk_common.skc_rcv_saddr);
    
    struct socket_count_event *e = bpf_ringbuf_reserve(&socket_count_events, sizeof(struct socket_count_event), 0);
    if (!e) return 0;
    
    e->pid = pid;
    e->saddr = saddr;
    e->socket_type = 1; // TCP
    e->action = 1; // create
    
    bpf_ringbuf_submit(e, 0);
    return 0;
}

// Trace TCP socket close
SEC("kprobe/tcp_close")
int BPF_KPROBE(tcp_close_probe, struct sock *sk)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u32 saddr = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
    
    struct socket_count_event *e = bpf_ringbuf_reserve(&socket_count_events, sizeof(struct socket_count_event), 0);
    if (!e) return 0;
    
    e->pid = pid;
    e->saddr = saddr;
    e->socket_type = 1; // TCP
    e->action = 0; // destroy
    
    bpf_ringbuf_submit(e, 0);
    return 0;
}

// Trace UDP socket creation (simplified - track sendmsg/recvmsg)
SEC("kprobe/udp_sendmsg")
int BPF_KPROBE(udp_sendmsg_probe, struct sock *sk)
{
    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    __u32 saddr = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
    
    // Check if this is a new socket (simplified tracking)
    __u64 *count = bpf_map_lookup_elem(&socket_counts, &pid);
    if (!count || (*count & 0xFFFFFFFF) == 0) {
        // First UDP socket for this PID
        struct socket_count_event *e = bpf_ringbuf_reserve(&socket_count_events, sizeof(struct socket_count_event), 0);
        if (e) {
            e->pid = pid;
            e->saddr = saddr;
            e->socket_type = 2; // UDP
            e->action = 1; // create
            bpf_ringbuf_submit(e, 0);
        }
    }
    
    return 0;
}


