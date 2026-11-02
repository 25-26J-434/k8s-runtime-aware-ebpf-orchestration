/**
 * Policy records come back in two shapes (flat legacy fields and nested frontend/telemetry/action
 * objects), so every field is optional and read through the resolvers in features/routing/lib/policy.ts.
 */
export interface PolicyAction {
  type?: string;
  backend_selector?: string;
  backend_port?: string | number;
  target_namespace?: string;
  protocol?: string;
  ttl_seconds?: string | number;
  strategy?: string;
  backend_candidates_selector?: string;
  winner_label?: string;
}

export interface PolicyRecord {
  id?: string;
  policy_name?: string;
  namespace?: string;
  scope?: string;
  frontend_service?: string;
  frontend_service_port?: string | number;
  redirect_backend_label?: string;
  redirect_backend_port?: string | number;
  redirect_backend_protocol?: string;
  ttl_seconds?: string | number;
  metric?: string;
  violation_threshold?: string | number;
  action?: string | PolicyAction;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  frontend?: { service?: string; port?: number | string };
  telemetry?: { metric?: string; violation_threshold?: number | string; monitor_pod_contains?: string };
  monitor_pod_contains?: string;
  strategy?: string;
  backend_selector?: string;
  backend_candidates_selector?: string;
  winner_label?: string;
  action_target_namespace?: string;
  status?: Record<string, unknown>;
  [extra: string]: unknown;
}

export interface ClusterService {
  name: string;
  namespace: string;
  selector?: Record<string, string>;
  ports?: { port?: number }[];
}

export interface ClusterPodInfo {
  name: string;
  namespace: string;
  node?: string;
  labels?: Record<string, string>;
  containers?: { ports?: { containerPort?: number }[] }[];
}

export interface ClusterSummary {
  nodes?: { name: string }[];
  namespaces?: string[];
  pods?: ClusterPodInfo[];
  services?: ClusterService[];
}

export interface ApplyResult {
  message: string;
  applied?: boolean;
  target_backend?: string;
  ttl_seconds?: number;
  details?: string[];
  metric_average?: number;
  metric?: string;
  violation?: boolean;
  stdout?: string;
  stderr?: string;
  helper?: string;
  rule?: string;
}

export type RedirectionStatus = "applied" | "expired" | "deleted" | "skipped" | "observed";

export interface RedirectionEvent {
  id?: string;
  policy_name: string;
  frontend_service?: string;
  planned_backend_service?: string;
  planned_backend_label?: string;
  planned_backend_port?: string;
  final_backend_service?: string;
  final_backend_label?: string;
  final_backend_port?: string;
  redirect_backend_label?: string;
  redirect_backend_port?: string;
  violation_triggered: boolean;
  accepted_service?: string;
  status?: RedirectionStatus;
  notes?: string;
  occurred_at?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProbeResult {
  raw: string;
  service: string;
  pod: string;
  node: string;
  winnerLabel: string;
  winnerLabelPresent: boolean;
  podLabels: Record<string, string>;
}
