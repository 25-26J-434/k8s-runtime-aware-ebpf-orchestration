export interface PodHealth {
  name: string;
  namespace: string;
  node: string;
  phase: string;
  ready: boolean;
  restart_count: number;
  healthy: boolean;            // true = healthy, false = unhealthy
  health_reasons?: string[];
}

export type Freshness = 'live' | 'stale' | 'offline';

export interface NodeHealthUpdate {
  timestamp: string;
  node_name: string;
  node_ip?: string;
  status: string;
  healthy: boolean;            // true = healthy, false = unhealthy
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

export interface HealthAlert {
  id?: string;
  state?: 'firing' | 'resolved';
  timestamp: string;
  last_seen?: string;
  resolved_at?: string;
  severity: 'critical' | 'warning' | 'info';
  source: 'node' | 'pod';
  node_name: string;
  pod_name?: string;
  namespace?: string;
  message: string;
  details?: Record<string, any>;
}

export interface ClusterHealthSummary {
  nodes_live: number;
  nodes_stale: number;
  nodes_offline: number;
  critical_alerts: number;
  warning_alerts: number;
  info_alerts: number;
}

export interface ClusterHealthResponse {
  timestamp: string;
  seq?: number;
  summary?: ClusterHealthSummary;
  nodes: Record<string, NodeHealthUpdate>;
  alerts?: HealthAlert[];
}

export interface HealthAlertHistoryResponse {
  timestamp: string;
  active: HealthAlert[];
  history: HealthAlert[];
}

export interface UnifiedMetricsResponse {
  timestamp: string;
  node_name?: string;
  node_ip?: string;
  health?: NodeHealthUpdate;
  node?: Record<string, any>;
  pods?: Record<string, Record<string, any>>;
  containers?: Record<string, Record<string, any>>;
}

export interface HealthStats {
  totalNodes: number;
  healthyNodes: number;
  unhealthyNodes: number;
  totalPods: number;
  healthyPods: number;
  unhealthyPods: number;
  unknownPods: number;
  criticalAlerts: number;
  warningAlerts: number;
}