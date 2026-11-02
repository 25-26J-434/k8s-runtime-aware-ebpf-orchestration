import type { PodWire } from "@/types/metrics";

export type Severity = "high" | "medium" | "low";

/** Same fields and defaults as the legacy console's pod-recommendation thresholds. Latencies in µs. */
export interface RecommendationThresholds {
  dns_latency_critical: number;
  dns_latency_high: number;
  dns_latency_medium: number;
  tcp_retrans_critical: number;
  tcp_retrans_high: number;
  tcp_retrans_medium: number;
  packet_loss_critical: number;
  packet_loss_high: number;
  packet_loss_medium: number;
  cpu_latency_critical: number;
  cpu_latency_high: number;
}

export const DEFAULT_THRESHOLDS: RecommendationThresholds = {
  dns_latency_critical: 10000,
  dns_latency_high: 5000,
  dns_latency_medium: 2000,
  tcp_retrans_critical: 10,
  tcp_retrans_high: 3,
  tcp_retrans_medium: 1,
  packet_loss_critical: 5,
  packet_loss_high: 2,
  packet_loss_medium: 0,
  cpu_latency_critical: 20000,
  cpu_latency_high: 10000,
};

export interface Recommendation {
  key: string;
  namespace: string;
  pod: string;
  node?: string;
  severity: Severity;
  issues: string[];
  action: string;
  advice: string;
  metrics: { dnsUs: number; retrans: number; packetLoss: number; cpuLatencyUs: number };
}

const RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

interface Finding {
  severity: Severity;
  issue: string;
  action: string;
  advice: string;
}

/** Drops stored values that are missing or not numbers, so a stale localStorage entry cannot break the page. */
export function sanitizeThresholds(raw: unknown): RecommendationThresholds {
  const out = { ...DEFAULT_THRESHOLDS };
  if (typeof raw !== "object" || raw === null) return out;
  for (const k of Object.keys(out) as (keyof RecommendationThresholds)[]) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

function findings(p: PodWire, t: RecommendationThresholds) {
  const dnsUs = (p.dns_latency?.avg_latency_ns ?? 0) / 1000;
  const retrans = p.tcp_metrics?.retransmissions ?? 0;
  const packetLoss = p.tcp_metrics?.packet_loss ?? 0;
  const cpuLatencyUs = p.sched_latency?.avg_runqueue_latency_us ?? 0;
  const out: Finding[] = [];

  if (dnsUs > t.dns_latency_critical) out.push({ severity: "high", issue: "Critical DNS latency", action: "Restart pod", advice: "DNS resolution is severely degraded. Restart the pod to re-establish its DNS connections." });
  else if (dnsUs > t.dns_latency_high) out.push({ severity: "high", issue: "High DNS latency", action: "Investigate DNS", advice: "DNS queries are slow. Check DNS server health or add a local DNS cache." });
  else if (dnsUs > t.dns_latency_medium) out.push({ severity: "medium", issue: "Elevated DNS latency", action: "Monitor DNS", advice: "DNS latency is above optimal. Keep watching it and consider optimising." });

  if (retrans > t.tcp_retrans_critical) out.push({ severity: "high", issue: "Excessive TCP retransmissions", action: "Migrate pod", advice: "The network path is unreliable. Move the pod to a node with better connectivity." });
  else if (retrans > t.tcp_retrans_high) out.push({ severity: "medium", issue: "TCP retransmissions detected", action: "Monitor network", advice: "Retransmissions suggest congestion. Watch node network metrics and consider QoS policies." });
  else if (retrans > t.tcp_retrans_medium) out.push({ severity: "low", issue: "Minor TCP retransmissions", action: "Monitor", advice: "Some retransmissions are normal, but worth watching if they increase." });

  if (packetLoss > t.packet_loss_critical) out.push({ severity: "high", issue: "Critical packet loss", action: "Urgent: migrate pod", advice: "Severe packet loss. The network interface may be failing; migrate the pod now." });
  else if (packetLoss > t.packet_loss_high) out.push({ severity: "high", issue: "Packet loss detected", action: "Check network", advice: "Packet loss is hurting performance. Check interface health and network saturation." });
  else if (packetLoss > t.packet_loss_medium) out.push({ severity: "medium", issue: "Minor packet loss", action: "Monitor network", advice: "Some packet loss detected. Watch that it does not get worse." });

  if (cpuLatencyUs > t.cpu_latency_critical) out.push({ severity: "medium", issue: "High CPU scheduling latency", action: "Reduce CPU load", advice: "The pod is starved of CPU. Raise its CPU limits or move it to a less loaded node." });
  else if (cpuLatencyUs > t.cpu_latency_high) out.push({ severity: "medium", issue: "Moderate CPU scheduling latency", action: "Monitor CPU", advice: "Scheduling latency is elevated. Watch CPU usage and consider adjusting limits." });

  return { out, metrics: { dnsUs, retrans, packetLoss, cpuLatencyUs } };
}

/** One recommendation per pod with at least one finding; the most severe finding sets action and advice. */
export function recommend(pods: Record<string, PodWire>, t: RecommendationThresholds, nodeName?: string): Recommendation[] {
  const result: Recommendation[] = [];
  for (const [key, wire] of Object.entries(pods)) {
    const { out, metrics } = findings(wire, t);
    if (out.length === 0) continue;
    const lead = out.reduce((a, b) => (RANK[b.severity] >= RANK[a.severity] ? b : a));
    const slash = key.indexOf("/");
    result.push({
      key: nodeName ? `${nodeName}|${key}` : key,
      namespace: slash === -1 ? "default" : key.slice(0, slash),
      pod: slash === -1 ? key : key.slice(slash + 1),
      node: nodeName,
      severity: lead.severity,
      issues: out.map((f) => f.issue),
      action: lead.action,
      advice: lead.advice,
      metrics,
    });
  }
  return result.sort((a, b) => RANK[b.severity] - RANK[a.severity]);
}
