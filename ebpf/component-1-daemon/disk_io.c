//go:build ignore

#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>
#include <bpf/bpf_core_read.h>

char LICENSE[] SEC("license") = "Dual BSD/GPL";

// Disk I/O event types
#define IO_TYPE_READ 0
#define IO_TYPE_WRITE 1
#define IO_TYPE_OPEN 2
#define IO_TYPE_CLOSE 3

// Event structure for disk I/O
struct disk_io_event {
    __u32 pid;
    __u32 tgid;
    __u64 timestamp_ns;
    __u64 latency_ns;
    __u32 size_bytes;
    __u8 io_type;
    char comm[16];
    char filename[64];
};

// Structure to track I/O start time
struct io_start {
    __u64 start_ns;
    __u32 size;
};

// Maps
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} disk_io_events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 10240);
    __type(key, __u64);
    __type(value, struct io_start);
} io_start_map SEC(".maps");

// Queue depth tracking
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);  // device number
    __type(value, __u64); // queue depth counter
} queue_depth_map SEC(".maps");

// Block I/O tracepoints for read/write latency

SEC("tp/block/block_rq_issue")
int trace_block_rq_issue(void *ctx)
{
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u32 tgid = pid_tgid;
    
    if (pid == 0) return 0; // Skip kernel threads
    
    struct io_start start = {};
    start.start_ns = bpf_ktime_get_ns();
    
    // Read size from request
    __u32 size = 0;
    bpf_probe_read(&size, sizeof(size), (void *)ctx + 32); // Approximate offset
    start.size = size;
    
    bpf_map_update_elem(&io_start_map, &pid_tgid, &start, BPF_ANY);
    
    // Increment queue depth
    __u32 dev = 0;
    __u64 *depth = bpf_map_lookup_elem(&queue_depth_map, &dev);
    if (depth) {
        __sync_fetch_and_add(depth, 1);
    } else {
        __u64 init_depth = 1;
        bpf_map_update_elem(&queue_depth_map, &dev, &init_depth, BPF_ANY);
    }
    
    return 0;
}

SEC("tp/block/block_rq_complete")
int trace_block_rq_complete(void *ctx)
{
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u32 tgid = pid_tgid;
    
    if (pid == 0) return 0;
    
    struct io_start *start = bpf_map_lookup_elem(&io_start_map, &pid_tgid);
    if (!start) return 0;
    
    __u64 now = bpf_ktime_get_ns();
    __u64 latency = now - start->start_ns;
    
    // Emit event
    struct disk_io_event *e = bpf_ringbuf_reserve(&disk_io_events, sizeof(*e), 0);
    if (!e) {
        bpf_map_delete_elem(&io_start_map, &pid_tgid);
        return 0;
    }
    
    e->pid = tgid;
    e->tgid = tgid;
    e->timestamp_ns = now;
    e->latency_ns = latency;
    e->size_bytes = start->size;
    e->io_type = IO_TYPE_WRITE; // Default to write
    
    bpf_get_current_comm(&e->comm, sizeof(e->comm));
    __builtin_memset(e->filename, 0, sizeof(e->filename));
    
    bpf_ringbuf_submit(e, 0);
    bpf_map_delete_elem(&io_start_map, &pid_tgid);
    
    // Decrement queue depth
    __u32 dev = 0;
    __u64 *depth = bpf_map_lookup_elem(&queue_depth_map, &dev);
    if (depth && *depth > 0) {
        __sync_fetch_and_add(depth, -1);
    }
    
    return 0;
}

// VFS (Virtual File System) tracepoints for file operations

SEC("kprobe/vfs_read")
int BPF_KPROBE(kprobe_vfs_read, struct file *file, char *buf, size_t count)
{
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u32 tgid = pid_tgid;
    
    if (pid == 0) return 0;
    
    struct io_start start = {};
    start.start_ns = bpf_ktime_get_ns();
    start.size = count;
    
    bpf_map_update_elem(&io_start_map, &pid_tgid, &start, BPF_ANY);
    
    return 0;
}

SEC("kretprobe/vfs_read")
int BPF_KRETPROBE(kretprobe_vfs_read, ssize_t ret)
{
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u32 tgid = pid_tgid;
    
    if (pid == 0) return 0;
    
    struct io_start *start = bpf_map_lookup_elem(&io_start_map, &pid_tgid);
    if (!start) return 0;
    
    __u64 now = bpf_ktime_get_ns();
    __u64 latency = now - start->start_ns;
    
    struct disk_io_event *e = bpf_ringbuf_reserve(&disk_io_events, sizeof(*e), 0);
    if (!e) {
        bpf_map_delete_elem(&io_start_map, &pid_tgid);
        return 0;
    }
    
    e->pid = tgid;
    e->tgid = tgid;
    e->timestamp_ns = now;
    e->latency_ns = latency;
    e->size_bytes = ret > 0 ? ret : 0;
    e->io_type = IO_TYPE_READ;
    
    bpf_get_current_comm(&e->comm, sizeof(e->comm));
    __builtin_memset(e->filename, 0, sizeof(e->filename));
    
    bpf_ringbuf_submit(e, 0);
    bpf_map_delete_elem(&io_start_map, &pid_tgid);
    
    return 0;
}

SEC("kprobe/vfs_write")
int BPF_KPROBE(kprobe_vfs_write, struct file *file, const char *buf, size_t count)
{
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    
    if (pid == 0) return 0;
    
    struct io_start start = {};
    start.start_ns = bpf_ktime_get_ns();
    start.size = count;
    
    bpf_map_update_elem(&io_start_map, &pid_tgid, &start, BPF_ANY);
    
    return 0;
}

SEC("kretprobe/vfs_write")
int BPF_KRETPROBE(kretprobe_vfs_write, ssize_t ret)
{
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u32 tgid = pid_tgid;
    
    if (pid == 0) return 0;
    
    struct io_start *start = bpf_map_lookup_elem(&io_start_map, &pid_tgid);
    if (!start) return 0;
    
    __u64 now = bpf_ktime_get_ns();
    __u64 latency = now - start->start_ns;
    
    struct disk_io_event *e = bpf_ringbuf_reserve(&disk_io_events, sizeof(*e), 0);
    if (!e) {
        bpf_map_delete_elem(&io_start_map, &pid_tgid);
        return 0;
    }
    
    e->pid = tgid;
    e->tgid = tgid;
    e->timestamp_ns = now;
    e->latency_ns = latency;
    e->size_bytes = ret > 0 ? ret : 0;
    e->io_type = IO_TYPE_WRITE;
    
    bpf_get_current_comm(&e->comm, sizeof(e->comm));
    __builtin_memset(e->filename, 0, sizeof(e->filename));
    
    bpf_ringbuf_submit(e, 0);
    bpf_map_delete_elem(&io_start_map, &pid_tgid);
    
    return 0;
}

SEC("kprobe/vfs_open")
int BPF_KPROBE(kprobe_vfs_open, const struct path *path, struct file *file)
{
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 tgid = pid_tgid;
    
    struct disk_io_event *e = bpf_ringbuf_reserve(&disk_io_events, sizeof(*e), 0);
    if (!e) return 0;
    
    e->pid = tgid;
    e->tgid = tgid;
    e->timestamp_ns = bpf_ktime_get_ns();
    e->latency_ns = 0;
    e->size_bytes = 0;
    e->io_type = IO_TYPE_OPEN;
    
    bpf_get_current_comm(&e->comm, sizeof(e->comm));
    
    // Try to read filename from path
    struct dentry *dentry = BPF_CORE_READ(path, dentry);
    if (dentry) {
        struct qstr d_name = BPF_CORE_READ(dentry, d_name);
        bpf_probe_read_kernel_str(e->filename, sizeof(e->filename), d_name.name);
    }
    
    bpf_ringbuf_submit(e, 0);
    
    return 0;
}

SEC("kprobe/filp_close")
int BPF_KPROBE(kprobe_filp_close, struct file *file)
{
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 tgid = pid_tgid;
    
    struct disk_io_event *e = bpf_ringbuf_reserve(&disk_io_events, sizeof(*e), 0);
    if (!e) return 0;
    
    e->pid = tgid;
    e->tgid = tgid;
    e->timestamp_ns = bpf_ktime_get_ns();
    e->latency_ns = 0;
    e->size_bytes = 0;
    e->io_type = IO_TYPE_CLOSE;
    
    bpf_get_current_comm(&e->comm, sizeof(e->comm));
    
    // Try to read filename from file
    struct path f_path = BPF_CORE_READ(file, f_path);
    struct dentry *dentry = BPF_CORE_READ(&f_path, dentry);
    if (dentry) {
        struct qstr d_name = BPF_CORE_READ(dentry, d_name);
        bpf_probe_read_kernel_str(e->filename, sizeof(e->filename), d_name.name);
    }
    
    bpf_ringbuf_submit(e, 0);
    
    return 0;
}

