import { formatCount, formatNanos } from "@/lib/format/units";
import type { ScalingMetric } from "@/types/cluster";

interface MetricInfo {
  label: string;
  /** Unit of the stored threshold and of the daemon's latest value. */
  unit: "ns" | "count";
  hint: string;
}

/**
 * The scaling service compares thresholds against the daemon's raw values: latencies in
 * nanoseconds, retransmissions as a count (daemon/pkg/scaling/metrics.go). The payload is
 * sent untouched; only the labels here say what unit it is in.
 */
export const METRICS: Record<ScalingMetric, MetricInfo> = {
  dns_latency: { label: "DNS latency", unit: "ns", hint: "Last observed DNS lookup latency. 1 ms = 1,000,000 ns." },
  rtt: { label: "Round-trip time", unit: "ns", hint: "Last observed TCP round-trip time. 1 ms = 1,000,000 ns." },
  tcp_retrans: { label: "TCP retransmissions", unit: "count", hint: "Total retransmissions counted on the node." },
  disk_read_latency: { label: "Disk read latency", unit: "ns", hint: "Average disk read latency on the node." },
  disk_write_latency: { label: "Disk write latency", unit: "ns", hint: "Average disk write latency on the node." },
};

export const METRIC_OPTIONS = (Object.keys(METRICS) as ScalingMetric[]).map((m) => ({ value: m, label: METRICS[m].label }));

export const formatMetricValue = (metric: ScalingMetric, value: number | undefined) =>
  value === undefined ? "—" : METRICS[metric].unit === "count" ? formatCount(value) : formatNanos(value);

export const formatThreshold = (metric: ScalingMetric, value: number) =>
  METRICS[metric].unit === "count" ? formatCount(value) : `${formatNanos(value)} (${value.toLocaleString()} ns)`;
