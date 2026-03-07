export type MetricType = 'dns_latency' | 'rtt' | 'tcp_retrans' | 'disk_read_latency' | 'disk_write_latency';
export type OperatorType = '>' | '<';
export type ScalingAction = 'scale_up' | 'scale_down';

export interface ScalingRule {
    _id: string;
    enabled: boolean;
    namespace: string;
    deployment: string;
    metric: MetricType;
    operator: OperatorType;
    threshold: number;
    minReplicas: number;
    maxReplicas: number;
    step: number;
    action?: ScalingAction;
    lastAction?: string;
    lastActionAt?: string;
    lastValue?: number;
    lastFrom?: number;
    lastTo?: number;
}

export interface LatestMetric {
    namespace: string;
    deployment: string;
    metric: MetricType;
    value: number;
    timestamp?: string;
}

export interface DeploymentInfo {
    namespace: string;
    name: string;
    replicas: number;
    availableReplicas?: number;
}

export interface ScalingPlacementPod {
    name: string;
    node: string;
    phase: string;
    ready: boolean;
    startTime?: string;
    ageSeconds: number;
}

export interface ScalingPlacementResponse {
    namespace: string;
    deployment: string;
    pods: ScalingPlacementPod[];
    nodeCounts: Record<string, number>;
}
