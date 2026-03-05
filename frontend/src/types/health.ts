export interface HealthLevel {
  level: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  score: number;
  reasons: string[];
}

export interface PodHealth {
  name: string;
  namespace: string;
  node: string;
  phase: string;
  ready: boolean;
  restart_count: number;
  health_level?: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  health_score?: number;
  health_reasons?: string[];
}

export interface NodeHealthUpdate {
  timestamp: string;
  node_name: string;
  node_ip?: string;
  status: string;
  health_level?: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  health_score?: number;
  health_reasons?: string[];
  total_pods: number;
  healthy_pods: number;
  unhealthy_pods: number;
  unknown_pods: number;
  pods: PodHealth[];
  error?: string;
}

export interface HealthAlert {
  timestamp: string;
  severity: 'critical' | 'warning' | 'info';
  source: 'node' | 'pod';
  node_name: string;
  pod_name?: string;
  namespace?: string;
  message: string;
  details?: Record<string, any>;
}

export interface ClusterHealthResponse {
  timestamp: string;
  nodes: Record<string, NodeHealthUpdate>;
  alerts?: HealthAlert[];
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
  degradedNodes: number;
  unhealthyNodes: number;
  totalPods: number;
  healthyPods: number;
  unhealthyPods: number;
  unknownPods: number;
  criticalAlerts: number;
  warningAlerts: number;
}