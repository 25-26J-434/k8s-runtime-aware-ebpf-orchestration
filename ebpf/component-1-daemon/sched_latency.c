// CPU Scheduling Latency eBPF Program
// Measures how long processes wait in the CPU run queue before getting CPU time
// Attaches to scheduler tracepoints: sched_switch and sched_wakeup
#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

char LICENSE[] SEC("license") = "GPL";

#define TASK_COMM_LEN 16
#define MAX_CPUS 128

// Scheduling latency event
struct sched_latency_event {
    __u32 pid;
    __u32 tid;
    __u32 cpu;
    __u64 wakeup_time_ns;      // When task was woken up
    __u64 schedule_time_ns;    // When task actually got CPU
    __u64 runqueue_latency_ns; // Time spent waiting in run queue
    __u64 cpu_time_ns;         // Actual CPU execution time (from previous run)
    __u8  prev_state;          // Previous task state
    char  comm[TASK_COMM_LEN]; // Task command name
};

// Track when tasks are woken up (added to run queue)
struct wakeup_info {
    __u64 wakeup_time_ns;
    __u64 last_run_time_ns;    // When it last ran
    __u64 last_schedule_time_ns; // When it was last scheduled
};

// Ring buffer for sending events to userspace
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 24); // 16MB
} sched_events SEC(".maps");

// Track wakeup times per task (key: pid)
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, __u32);  // PID
    __type(value, struct wakeup_info);
} wakeup_times SEC(".maps");

// Per-CPU run queue depth counter
struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __uint(max_entries, 1);
    __type(key, __u32);
    __type(value, __u64);
} runqueue_depth SEC(".maps");

// Define tracepoint context structures using BPF helpers
// We'll read fields using bpf_probe_read instead of direct access

// Tracepoint: sched_wakeup
// Called when a task is woken up and added to run queue
SEC("tp/sched/sched_wakeup")
int trace_sched_wakeup(void *ctx) {
    // Read PID from tracepoint args (offset 16 bytes from ctx for pid field)
    __u32 pid = 0;
    bpf_probe_read(&pid, sizeof(pid), (void *)ctx + 16);
    
    __u64 now = bpf_ktime_get_ns();
    
    struct wakeup_info info = {
        .wakeup_time_ns = now,
        .last_run_time_ns = 0,
        .last_schedule_time_ns = 0,
    };
    
    bpf_map_update_elem(&wakeup_times, &pid, &info, BPF_ANY);
    
    return 0;
}

// Tracepoint: sched_wakeup_new
// Called when a new task is woken up for the first time
SEC("tp/sched/sched_wakeup_new")
int trace_sched_wakeup_new(void *ctx) {
    // Read PID from tracepoint args
    __u32 pid = 0;
    bpf_probe_read(&pid, sizeof(pid), (void *)ctx + 16);
    
    __u64 now = bpf_ktime_get_ns();
    
    struct wakeup_info info = {
        .wakeup_time_ns = now,
        .last_run_time_ns = 0,
        .last_schedule_time_ns = 0,
    };
    
    bpf_map_update_elem(&wakeup_times, &pid, &info, BPF_ANY);
    
    return 0;
}

// Tracepoint: sched_switch
// Called when the scheduler switches from one task to another
SEC("tp/sched/sched_switch")
int trace_sched_switch(void *ctx) {
    __u64 now = bpf_ktime_get_ns();
    
    // Read fields from tracepoint context
    // Format from /sys/kernel/debug/tracing/events/sched/sched_switch/format:
    // prev_comm[16] at offset 8, prev_pid at offset 24, prev_prio at offset 28, prev_state at offset 32
    // next_comm[16] at offset 40, next_pid at offset 56, next_prio at offset 60
    __u32 prev_pid = 0;
    __u32 next_pid = 0;
    __u8 prev_state = 0;
    char next_comm[16] = {};
    
    bpf_probe_read(&prev_pid, sizeof(prev_pid), (void *)ctx + 24); // prev_pid at offset 24
    bpf_probe_read(&prev_state, sizeof(prev_state), (void *)ctx + 32); // prev_state at offset 32
    bpf_probe_read(&next_comm, sizeof(next_comm), (void *)ctx + 40); // next_comm at offset 40
    bpf_probe_read(&next_pid, sizeof(next_pid), (void *)ctx + 56); // next_pid at offset 56
    
    __u32 cpu = bpf_get_smp_processor_id();
    
    // Handle the task being scheduled OUT (prev_task)
    if (prev_pid > 0) {
        struct wakeup_info *prev_info = bpf_map_lookup_elem(&wakeup_times, &prev_pid);
        if (prev_info) {
            // Calculate CPU time for the task being switched out
            if (prev_info->last_schedule_time_ns > 0) {
                prev_info->last_run_time_ns = now - prev_info->last_schedule_time_ns;
            }
        }
    }
    
    // Handle the task being scheduled IN (next_task)
    if (next_pid > 0) {
        struct wakeup_info *next_info = bpf_map_lookup_elem(&wakeup_times, &next_pid);
        if (next_info && next_info->wakeup_time_ns > 0) {
            // Calculate run queue latency (time from wakeup to actually getting CPU)
            __u64 runqueue_latency = now - next_info->wakeup_time_ns;
            
            // Only record if latency is reasonable (< 10 seconds to avoid stale entries)
            if (runqueue_latency < 10000000000ULL) {
                struct sched_latency_event *e = bpf_ringbuf_reserve(&sched_events, sizeof(*e), 0);
                if (e) {
                    e->pid = next_pid;
                    e->tid = next_pid; // For threads, tid might differ from pid
                    e->cpu = cpu;
                    e->wakeup_time_ns = next_info->wakeup_time_ns;
                    e->schedule_time_ns = now;
                    e->runqueue_latency_ns = runqueue_latency;
                    e->cpu_time_ns = next_info->last_run_time_ns;
                    e->prev_state = prev_state;
                    
                    // Copy task name
                    __builtin_memcpy(&e->comm, next_comm, sizeof(e->comm));
                    
                    bpf_ringbuf_submit(e, 0);
                }
            }
            
            // Update schedule time for next run
            next_info->last_schedule_time_ns = now;
            
            // Clear wakeup time to avoid double counting
            next_info->wakeup_time_ns = 0;
        }
    }
    
    return 0;
}

// Optional: Track per-CPU run queue depth
SEC("tp/sched/sched_stat_wait")
int trace_sched_stat_wait(struct trace_event_raw_sched_stat_template *ctx) {
    __u32 key = 0;
    __u64 *depth = bpf_map_lookup_elem(&runqueue_depth, &key);
    if (depth) {
        __sync_fetch_and_add(depth, 1);
    }
    
    return 0;
}

