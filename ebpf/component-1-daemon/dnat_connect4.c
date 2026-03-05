// TCP connect4 DNAT (cgroup/connect4)
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_endian.h>
#ifndef AF_INET
#define AF_INET 2
#endif

char LICENSE[] SEC("license") = "GPL";

struct dnat_key {
    __u32 dst_ip;
    __u16 dst_port;
    __u16 pad;
};

struct dnat_val {
    __u32 target_ip;
    __u16 target_port;
    __u16 pad;
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, struct dnat_key);
    __type(value, struct dnat_val);
} dnat_map SEC(".maps");

SEC("cgroup/connect4")
int dnat_connect4(struct bpf_sock_addr *ctx)
{
    if (ctx->user_family != AF_INET) {
        return 1;
    }

    struct dnat_key key = {};
    key.dst_ip = ctx->user_ip4;
    key.dst_port = ctx->user_port; // network byte order

    struct dnat_val *val = bpf_map_lookup_elem(&dnat_map, &key);
    if (!val) {
        return 1;
    }

    ctx->user_ip4 = val->target_ip;
    ctx->user_port = val->target_port; // network byte order

    return 1;
}
