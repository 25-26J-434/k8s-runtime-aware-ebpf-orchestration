// API Response Types
export interface DNSMetricValue {
    total_events: number;
    total_latency_ns: number;
    avg_latency_ns: number;
    min_latency_ns: number;
    max_latency_ns: number;
    last_latency_ns: number;
}

export interface RTTMetricValue {
    total_events: number;
    total_rtt_ns: number;
    avg_rtt_ns: number;
    min_rtt_ns: number;
    max_rtt_ns: number;
    last_rtt_ns: number;
}

export interface PodMetric {
    type: string;
    timestamp: string;
    namespace: string;
    pod_name: string;
    pod_ip?: string;
    node_name?: string;
    value: DNSMetricValue | RTTMetricValue;
}

export interface UnifiedMetricsResponse {
    timestamp: string;
    node?: Record<string, any>;
    pods?: Record<string, Record<string, any>>;
}

export interface MetricsResponse {
    timestamp: string;
    dns: {
        total_events: number;
        avg_latency_us: number;
        last_latency_us: number;
        max_latency_us: number;
        min_latency_us: number;
        pods?: Record<string, PodStats>;
    };
    rtt: {
        total_events: number;
        avg_rtt_us: number;
        last_rtt_us: number;
        max_rtt_us: number;
        min_rtt_us: number;
        pods?: Record<string, PodStats>;
    };
}

export interface PodDNSStats {
    total_events: number;
    avg_latency_us: number;
    last_latency_us: number;
    max_latency_us: number;
    min_latency_us: number;
}

export interface PodStats {
    total_events: number;
    avg_latency_us: number;
    last_latency_us: number;
    max_latency_us: number;
    min_latency_us: number;
}

export interface Node {
    name: string;
    status: string;
    pods: Pod[];
}

export interface Pod {
    name: string;
    namespace: string;
    ip: string;
    node: string;
    status: string;
}

export interface ClusterTopology {
    nodes: Node[];
}

export interface Service {
    name: string;
    namespace: string;
    type: string;
    cluster_ip: string;
    ports: string[];
}
