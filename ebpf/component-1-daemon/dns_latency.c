#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>
#include "../common/maps.h"
#include "../common/dns_latency.h"

char LICENSE[] SEC("license") = "GPL";

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, __u32);
    __type(value, __u64);
} dns_start SEC(".maps");

SEC("kprobe/udp_sendmsg")
int BPF_KPROBE(dns_start_probe, struct sock *sk)
{
    __u32 pid = bpf_get_current_pid_tgid();
    __u64 ts = bpf_ktime_get_ns();
    bpf_map_update_elem(&dns_start, &pid, &ts, BPF_ANY);
    return 0;
}

SEC("kprobe/udp_recvmsg")
int BPF_KPROBE(dns_end_probe, struct sock *sk)
{
    __u32 pid = bpf_get_current_pid_tgid();
    __u64 *start_ts = bpf_map_lookup_elem(&dns_start, &pid);
    if (!start_ts)
        return 0;

    __u64 end_ts = bpf_ktime_get_ns();
    __u64 diff_ns = end_ts - *start_ts;

    struct dns_event *e = bpf_ringbuf_reserve(&dns_events, sizeof(struct dns_event), 0);
    if (!e)
        return 0;

    e->timestamp_ns = end_ts;
    e->pid = pid;
    // Capture source IP - use skc_daddr for destination (DNS server) or skc_rcv_saddr for local bind
    // For DNS queries, we want the source IP of the sender (local IP that sent the query)
    // Try skc_rcv_saddr first (local bind address), fallback to skc_daddr
    __u32 saddr = BPF_CORE_READ(sk, __sk_common.skc_rcv_saddr);
    if (saddr == 0) {
        // If no local bind, try to get from socket state
        saddr = BPF_CORE_READ(sk, __sk_common.skc_daddr);
    }
    e->saddr = saddr;
    e->latency_ns = diff_ns;

    bpf_ringbuf_submit(e, 0);
    bpf_map_delete_elem(&dns_start, &pid);

    return 0;
}
