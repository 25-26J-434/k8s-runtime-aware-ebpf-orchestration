/** Backend (daemon) wire types. Field names and units match the Go daemon exactly. */

export interface NsLatency {
  total_events?: number;
  avg_latency_ns?: number;
  min_latency_ns?: number;
  max_latency_ns?: number;
  last_latency_ns?: number;
}

export interface NsRtt {
  total_events?: number;
  avg_rtt_ns?: number;
  min_rtt_ns?: number;
  max_rtt_ns?: number;
  last_rtt_ns?: number;
}

export interface TcpEvent {
  timestamp: string;
  pod_key: string;
  pod_name: string;
  namespace: string;
  source_ip: string;
  dest_ip: string;
  source_port: number;
  dest_port: number;
  event_type: "retransmission" | "packet_loss";
  srtt_us: number;
  min_rtt_us: number;
  cwnd: number;
  retrans_count: number;
}

export interface TcpWire {
  total_events?: number;
  avg_srtt_us?: number;
  last_srtt_us?: number;
  last_min_rtt_us?: number;
  retransmissions?: number;
  packet_loss?: number;
  bad_handshakes?: number;
  last_cwnd?: number;
  recent_events?: TcpEvent[];
}

export interface NodeSystem {
  cpu_usage_percent: number;
  memory_total_mb: number;
  memory_used_mb: number;
  memory_free_mb: number;
  memory_usage_percent: number;
  load_avg_1min: number;
  load_avg_5min: number;
  load_avg_15min: number;
}

export interface DiskIo {
  total_reads: number;
  avg_read_latency_ns: number;
  max_read_latency_ns: number;
  total_read_bytes: number;
  total_writes: number;
  avg_write_latency_ns: number;
  max_write_latency_ns: number;
  total_write_bytes: number;
  total_opens: number;
  total_closes: number;
  current_queue_depth: number;
  max_queue_depth: number;
  avg_queue_depth: number;
  total_io_operations: number;
  total_io_bytes: number;
  avg_io_latency_ns: number;
}

export interface SchedLatency {
  total_events: number;
  avg_runqueue_latency_us: number;
  max_runqueue_latency_us: number;
  min_runqueue_latency_us: number;
  p50_runqueue_latency_us: number;
  p95_runqueue_latency_us: number;
  p99_runqueue_latency_us: number;
  avg_cpu_time_us: number;
  cpu_starvation_count: number;
}

export interface PacketDistribution {
  total_packets: number;
  packets_by_pod: Record<string, number>;
  packets_by_protocol: Record<string, number>;
  bytes_by_pod: Record<string, number>;
}

export interface EndpointHealth {
  pod_name: string;
  pod_ip: string;
  status: "ready" | "not_ready";
  http_check: boolean;
  latency_ms: number;
  last_check: string;
}

export interface ServiceHealth {
  name: string;
  namespace: string;
  cluster_ip: string;
  type: string;
  status: "healthy" | "degraded" | "unhealthy";
  total_endpoints: number;
  ready_endpoints: number;
  endpoint_health: Record<string, EndpointHealth>;
  last_check: string;
}

export interface ServiceHealthSummary {
  total_services: number;
  healthy_services: number;
  unhealthy_services: number;
  service_details: Record<string, ServiceHealth>;
}

export interface PodWire {
  dns_latency?: NsLatency;
  rtt?: NsRtt;
  tcp_metrics?: TcpWire;
  sched_latency?: Partial<SchedLatency> & { pod_name?: string; namespace?: string };
  disk_io?: Partial<DiskIo>;
}

export interface NodeWire {
  dns_latency?: NsLatency;
  rtt?: NsRtt;
  tcp_metrics?: TcpWire;
  node_system?: NodeSystem;
  disk_io?: DiskIo;
  sched_latency?: SchedLatency;
  packet_distribution?: PacketDistribution;
  service_health?: ServiceHealthSummary;
}

/** One node's entry in /api/metrics and in the metrics WebSocket. */
export interface UnifiedMetrics {
  timestamp: string;
  node_name?: string;
  node_ip?: string;
  node?: NodeWire;
  pods?: Record<string, PodWire>;
  containers?: Record<string, PodWire>;
}

/** WebSocket frames from /api/metrics/ws. */
export type MetricsFrame =
  | { type: "snapshot"; nodes: Record<string, UnifiedMetrics> }
  | { type: "node_update"; node: string; metrics: UnifiedMetrics };

/* ---- UI view model (microseconds everywhere, ns already converted) ---- */

export interface LatencyStats {
  totalEvents: number;
  avgUs: number;
  lastUs: number;
  minUs: number;
  maxUs: number;
}

export interface TcpStats {
  totalEvents: number;
  avgSrttUs: number;
  lastSrttUs: number;
  lastMinRttUs: number;
  retransmissions: number;
  packetLoss: number;
  badHandshakes: number;
  lastCwnd: number;
  recentEvents: TcpEvent[];
}

export interface PodView {
  key: string;
  name: string;
  namespace: string;
  dns?: LatencyStats;
  rtt?: LatencyStats;
  tcp?: TcpStats;
  sched?: { avgRunqueueUs: number; maxRunqueueUs: number; starvation: number };
  disk?: { avgIoLatencyUs: number; operations: number };
}

export interface NodeView {
  key: string;
  name: string;
  ip: string;
  timestamp: string;
  dns: LatencyStats;
  rtt: LatencyStats;
  tcp: TcpStats;
  system?: NodeSystem;
  disk?: DiskIo;
  sched?: SchedLatency;
  packets?: PacketDistribution;
  services?: ServiceHealthSummary;
  pods: PodView[];
}
