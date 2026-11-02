import { nsToUs } from "@/lib/format/units";
import type {
  LatencyStats,
  NodeView,
  NsLatency,
  NsRtt,
  PodView,
  PodWire,
  TcpStats,
  TcpWire,
  UnifiedMetrics,
} from "@/types/metrics";

/**
 * The only place raw daemon metrics become UI view models. DNS and RTT arrive in
 * nanoseconds and are converted to microseconds here; TCP is already microseconds.
 */

function dnsStats(d?: NsLatency): LatencyStats {
  return {
    totalEvents: d?.total_events ?? 0,
    avgUs: nsToUs(d?.avg_latency_ns ?? 0),
    lastUs: nsToUs(d?.last_latency_ns ?? 0),
    minUs: nsToUs(d?.min_latency_ns ?? 0),
    maxUs: nsToUs(d?.max_latency_ns ?? 0),
  };
}

function rttStats(r?: NsRtt): LatencyStats {
  return {
    totalEvents: r?.total_events ?? 0,
    avgUs: nsToUs(r?.avg_rtt_ns ?? 0),
    lastUs: nsToUs(r?.last_rtt_ns ?? 0),
    minUs: nsToUs(r?.min_rtt_ns ?? 0),
    maxUs: nsToUs(r?.max_rtt_ns ?? 0),
  };
}

function tcpStats(t?: TcpWire): TcpStats {
  return {
    totalEvents: t?.total_events ?? 0,
    avgSrttUs: t?.avg_srtt_us ?? 0,
    lastSrttUs: t?.last_srtt_us ?? 0,
    lastMinRttUs: t?.last_min_rtt_us ?? 0,
    retransmissions: t?.retransmissions ?? 0,
    packetLoss: t?.packet_loss ?? 0,
    badHandshakes: t?.bad_handshakes ?? 0,
    lastCwnd: t?.last_cwnd ?? 0,
    recentEvents: t?.recent_events ?? [],
  };
}

export function splitPodKey(key: string): { namespace: string; name: string } {
  const i = key.indexOf("/");
  return i === -1 ? { namespace: "", name: key } : { namespace: key.slice(0, i), name: key.slice(i + 1) };
}

function podView(key: string, p: PodWire): PodView {
  const { namespace, name } = splitPodKey(key);
  return {
    key,
    name: p.sched_latency?.pod_name ?? name,
    namespace: p.sched_latency?.namespace ?? namespace,
    dns: p.dns_latency ? dnsStats(p.dns_latency) : undefined,
    rtt: p.rtt ? rttStats(p.rtt) : undefined,
    tcp: p.tcp_metrics ? tcpStats(p.tcp_metrics) : undefined,
    sched: p.sched_latency
      ? {
          avgRunqueueUs: p.sched_latency.avg_runqueue_latency_us ?? 0,
          maxRunqueueUs: p.sched_latency.max_runqueue_latency_us ?? 0,
          starvation: p.sched_latency.cpu_starvation_count ?? 0,
        }
      : undefined,
    disk: p.disk_io
      ? {
          avgIoLatencyUs: nsToUs(p.disk_io.avg_io_latency_ns ?? 0),
          operations: p.disk_io.total_io_operations ?? 0,
        }
      : undefined,
  };
}

export function toNodeView(key: string, m: UnifiedMetrics): NodeView {
  const node = m.node ?? {};
  return {
    key,
    name: m.node_name ?? key,
    ip: m.node_ip ?? "",
    timestamp: m.timestamp,
    dns: dnsStats(node.dns_latency),
    rtt: rttStats(node.rtt),
    tcp: tcpStats(node.tcp_metrics),
    system: node.node_system,
    disk: node.disk_io,
    sched: node.sched_latency,
    packets: node.packet_distribution,
    services: node.service_health,
    pods: Object.entries(m.pods ?? {}).map(([k, p]) => podView(k, p)),
  };
}
