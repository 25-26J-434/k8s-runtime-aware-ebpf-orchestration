import type { PodWire, UnifiedMetrics } from "@/types/metrics";
import type { ThresholdRow } from "@/types/extensions";

export interface RuleValue {
  key: string;
  level: "Node" | "Pod" | "Container";
  node: string;
  source: string;
  value: number;
  unit: string;
}

const nodeName = (key: string, m: UnifiedMetrics) => m.node_name ?? key;

const nsToUs = (ns?: number) => (ns == null ? undefined : ns / 1000);

type Picker = (w: PodWire) => { label: string; value: number }[];

const perWorkload: Record<string, { unit: string; pick: Picker }> = {
  dns_latency: { unit: "µs", pick: (w) => (w.dns_latency?.total_events ? [{ label: "", value: (w.dns_latency.avg_latency_ns ?? 0) / 1000 }] : []) },
  rtt: { unit: "µs", pick: (w) => (w.rtt?.total_events ? [{ label: "", value: (w.rtt.avg_rtt_ns ?? 0) / 1000 }] : []) },
  sched_latency: { unit: "µs", pick: (w) => (w.sched_latency?.avg_runqueue_latency_us != null ? [{ label: "", value: w.sched_latency.avg_runqueue_latency_us }] : []) },
  disk_io: { unit: "bytes", pick: (w) => (w.disk_io ? [{ label: "", value: (w.disk_io.total_read_bytes ?? 0) + (w.disk_io.total_write_bytes ?? 0) }] : []) },
  tcp_metrics: {
    unit: "count",
    pick: (w) => [
      ...(w.tcp_metrics?.packet_loss != null ? [{ label: " (loss)", value: w.tcp_metrics.packet_loss }] : []),
      ...(w.tcp_metrics?.retransmissions != null ? [{ label: " (retrans)", value: w.tcp_metrics.retransmissions }] : []),
    ],
  },
};

/** Units the daemon compares each metric in; used for headings. */
export const ruleUnit = (metric: string) => (metric === "node_system" ? "%" : (perWorkload[metric]?.unit ?? "count"));

/** Node-level readings for a metric, in the unit `ruleUnit` reports. */
function nodeValues(metric: string, m: UnifiedMetrics): { source: string; value: number }[] {
  const n = m.node;
  if (!n) return [];
  const out: { source: string; value: number }[] = [];
  const add = (source: string, value: number | undefined) => value != null && Number.isFinite(value) && out.push({ source, value });
  switch (metric) {
    case "dns_latency": add("Average", nsToUs(n.dns_latency?.avg_latency_ns)); break;
    case "rtt": add("Average", nsToUs(n.rtt?.avg_rtt_ns)); break;
    case "node_system": add("CPU", n.node_system?.cpu_usage_percent); add("Memory", n.node_system?.memory_usage_percent); break;
    case "sched_latency": add("Run queue", n.sched_latency?.avg_runqueue_latency_us); break;
    case "disk_io": {
      const pods = Object.values(m.pods ?? {});
      const total = pods.reduce((s, p) => s + (p.disk_io?.total_read_bytes ?? 0) + (p.disk_io?.total_write_bytes ?? 0), 0);
      if (total > 0) add("Sum of pods", total);
      break;
    }
    case "tcp_metrics": add("Packet loss", n.tcp_metrics?.packet_loss); add("Retransmissions", n.tcp_metrics?.retransmissions); break;
    case "service_health":
      add("Unhealthy services", n.service_health?.unhealthy_services);
      add("Healthy services", n.service_health?.healthy_services);
      add("Total services", n.service_health?.total_services);
      break;
    case "packet_distribution": add("Total packets", n.packet_distribution?.total_packets); break;
  }
  return out;
}

/**
 * What a rule is looking at right now, from the live metrics frame: node, then pod or container readings,
 * limited to the rule's node and pod when it names them.
 */
export function ruleValues(rule: Pick<ThresholdRow, "metric_type" | "level" | "node_name" | "pod_name">, nodes: Record<string, UnifiedMetrics>): RuleValue[] {
  const rows: RuleValue[] = [];
  const unit = ruleUnit(rule.metric_type);
  const podFilter = rule.pod_name?.trim() || null;

  for (const [key, m] of Object.entries(nodes)) {
    const name = nodeName(key, m);
    if (rule.node_name && rule.node_name !== name) continue;

    if (rule.level === "node") {
      nodeValues(rule.metric_type, m).forEach((v, i) => rows.push({ key: `${name}:${i}`, level: "Node", node: name, source: v.source, value: v.value, unit }));
      continue;
    }

    const spec = perWorkload[rule.metric_type];
    if (!spec) continue;
    const bucket = rule.level === "container" ? m.containers : m.pods;
    for (const [wk, w] of Object.entries(bucket ?? {})) {
      if (podFilter && (rule.level === "pod" ? wk !== podFilter : !wk.startsWith(`${podFilter}/`))) continue;
      spec.pick(w).forEach((v) => {
        if (Number.isFinite(v.value)) rows.push({ key: `${name}:${wk}${v.label}`, level: rule.level === "container" ? "Container" : "Pod", node: name, source: `${wk}${v.label}`, value: v.value, unit });
      });
    }
  }
  return rows;
}
