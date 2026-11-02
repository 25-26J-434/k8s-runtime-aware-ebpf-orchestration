export interface PodHealth {
  name: string;
  namespace: string;
  node: string;
  phase: string;
  ready: boolean;
  restart_count: number;
  healthy: boolean;
  health_reasons?: string[];
}

export type Freshness = "live" | "stale" | "offline";

export interface NodeHealth {
  timestamp: string;
  node_name: string;
  node_ip?: string;
  status: string;
  healthy: boolean;
  health_reasons?: string[];
  total_pods: number;
  healthy_pods: number;
  unhealthy_pods: number;
  unknown_pods: number;
  pods: PodHealth[];
  error?: string;
  last_seen?: string;
  age_seconds?: number;
  freshness?: Freshness;
}

export type Severity = "critical" | "warning" | "info";

export interface HealthAlert {
  id?: string;
  state?: "firing" | "resolved";
  timestamp: string;
  last_seen?: string;
  resolved_at?: string;
  severity: Severity;
  source: "node" | "pod";
  node_name: string;
  pod_name?: string;
  namespace?: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ClusterHealthSummary {
  nodes_live: number;
  nodes_stale: number;
  nodes_offline: number;
  critical_alerts: number;
  warning_alerts: number;
  info_alerts: number;
}

export interface ClusterHealth {
  timestamp: string;
  seq?: number;
  summary?: ClusterHealthSummary;
  nodes: Record<string, NodeHealth>;
  alerts?: HealthAlert[];
}

export interface HealthAlertHistory {
  timestamp: string;
  active: HealthAlert[];
  history: HealthAlert[];
}

export interface MetricsConfig {
  dns_latency_threshold: number;
  tcp_retrans_threshold: number;
  packet_loss_threshold: number;
  rtt_threshold: number;
  restart_count_threshold: number;
}

export interface PodActionResult {
  success: boolean;
  message: string;
  error?: string;
  data?: unknown;
}
