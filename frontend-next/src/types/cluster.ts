export interface ClusterPod {
  name: string;
  namespace: string;
  ip: string;
  node: string;
  status: string;
}

export interface ClusterNode {
  name: string;
  status: string;
  ip?: string;
  role?: string;
  pods: ClusterPod[];
}

export interface ClusterTopology {
  cluster?: string;
  nodes: ClusterNode[];
}

export interface DeploymentInfo {
  namespace: string;
  name: string;
  replicas: number;
  availableReplicas?: number;
}

export type ScalingMetric =
  | "dns_latency"
  | "rtt"
  | "tcp_retrans"
  | "disk_read_latency"
  | "disk_write_latency";

export interface LatestMetric {
  namespace: string;
  deployment: string;
  metric: ScalingMetric;
  value: number;
  timestamp?: string;
}
