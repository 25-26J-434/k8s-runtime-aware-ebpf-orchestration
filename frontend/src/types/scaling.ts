export type MetricType = 'dns_latency' | 'rtt' | 'tcp_retrans';
export type OperatorType = '>' | '<';

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
