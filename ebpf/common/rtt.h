#ifndef __RTT_H
#define __RTT_H

struct rtt_event {
    __u32 pid;
    __u32 saddr;
    __u32 daddr;
    __u64 rtt_ns;
};

#endif
