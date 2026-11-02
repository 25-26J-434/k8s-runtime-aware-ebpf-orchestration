import { describe, expect, it } from "vitest";
import { formatBytes, formatCount, formatMicros, formatNanos, formatPercent } from "@/lib/format/units";
import { splitPodKey, toNodeView } from "./transform";
import type { UnifiedMetrics } from "@/types/metrics";

describe("toNodeView", () => {
  const raw: UnifiedMetrics = {
    timestamp: "2026-01-01T00:00:00Z",
    node_name: "worker-1",
    node_ip: "10.0.0.1",
    node: {
      dns_latency: { total_events: 10, avg_latency_ns: 2_000_000, last_latency_ns: 3_000_000, min_latency_ns: 500_000, max_latency_ns: 9_000_000 },
      rtt: { total_events: 4, avg_rtt_ns: 800_000 },
      tcp_metrics: { total_events: 7, avg_srtt_us: 1500, last_srtt_us: 1800, retransmissions: 3 },
    },
    pods: {
      "default/web-1": { dns_latency: { avg_latency_ns: 4_000_000 }, sched_latency: { avg_runqueue_latency_us: 120 }, disk_io: { avg_io_latency_ns: 2_000_000, total_io_operations: 9 } },
    },
  };

  it("converts DNS and RTT from nanoseconds to microseconds", () => {
    const v = toNodeView("k", raw);
    expect(v.dns).toMatchObject({ avgUs: 2000, lastUs: 3000, minUs: 500, maxUs: 9000, totalEvents: 10 });
    expect(v.rtt.avgUs).toBe(800);
  });

  it("leaves TCP values, which the daemon already reports in microseconds, untouched", () => {
    expect(toNodeView("k", raw).tcp).toMatchObject({ avgSrttUs: 1500, lastSrttUs: 1800, retransmissions: 3 });
  });

  it("converts pod disk latency from ns and splits the pod key", () => {
    const pod = toNodeView("k", raw).pods[0];
    expect(pod).toMatchObject({ name: "web-1", namespace: "default", disk: { avgIoLatencyUs: 2000, operations: 9 }, sched: { avgRunqueueUs: 120 } });
    expect(pod?.dns?.avgUs).toBe(4000);
  });

  it("tolerates a node with nothing reported", () => {
    const v = toNodeView("k", { timestamp: "t" });
    expect(v.name).toBe("k");
    expect(v.dns.avgUs).toBe(0);
    expect(v.pods).toEqual([]);
  });
});

describe("splitPodKey", () => {
  it("splits on the first slash only", () => {
    expect(splitPodKey("ns/a/b")).toEqual({ namespace: "ns", name: "a/b" });
    expect(splitPodKey("bare")).toEqual({ namespace: "", name: "bare" });
  });
});

describe("unit formatting", () => {
  it("picks µs, ms or s", () => {
    expect(formatMicros(250)).toBe("250 µs");
    expect(formatMicros(1500)).toBe("1.5 ms");
    expect(formatMicros(2_500_000)).toBe("2.5 s");
  });
  it("formats nanoseconds via microseconds", () => {
    expect(formatNanos(5_000_000)).toBe("5 ms");
    expect(formatNanos(undefined)).toBe("—");
  });
  it("renders missing and non-finite values as a dash", () => {
    expect(formatMicros(NaN)).toBe("—");
    expect(formatPercent(null)).toBe("—");
    expect(formatCount(undefined)).toBe("—");
  });
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
});
