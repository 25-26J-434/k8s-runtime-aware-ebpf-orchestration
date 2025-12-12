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
    node_name?: string;
    node_ip?: string;
    node?: Record<string, any>;
    pods?: Record<string, Record<string, any>>;
}

export interface TCPEvent {
    timestamp: string;
    pod_key: string;
    pod_name: string;
    namespace: string;
    source_ip: string;
    dest_ip: string;
    source_port: number;
    dest_port: number;
    event_type: 'retransmission' | 'packet_loss';
    srtt_us: number;
    min_rtt_us: number;
    cwnd: number;
    retrans_count: number;
}

export interface TCPMetrics {
    total_events: number;
    avg_srtt_us: number;
    last_srtt_us: number;
    last_min_rtt_us: number;
    retransmissions: number;
    packet_loss: number;
    bad_handshakes: number;
    last_cwnd: number;
    recent_events?: TCPEvent[];
    pods?: Record<string, TCPPodMetrics>;
}

export interface TCPPodMetrics {
    total_events: number;
    avg_srtt_us: number;
    last_srtt_us: number;
    last_min_rtt_us: number;
    retransmissions: number;
    packet_loss: number;
    bad_handshakes: number;
    last_cwnd: number;
    recent_events?: TCPEvent[];
}

export interface NodeSystemMetrics {
    cpu_usage_percent: number;
    memory_total_mb: number;
    memory_used_mb: number;
    memory_free_mb: number;
    memory_usage_percent: number;
    load_avg_1min: number;
    load_avg_5min: number;
    load_avg_15min: number;
}

export interface PacketDistributionMetrics {
    total_packets: number;
    packets_by_pod: Record<string, number>;
    packets_by_protocol: Record<string, number>;
    bytes_by_pod: Record<string, number>;
}

export interface ServiceHealthMetrics {
    total_services: number;
    healthy_services: number;
    unhealthy_services: number;
    service_details: Record<string, ServiceHealth>;
}

export interface ServiceHealth {
    name: string;
    namespace: string;
    cluster_ip: string;
    type: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    total_endpoints: number;
    ready_endpoints: number;
    endpoint_health: Record<string, EndpointHealth>;
    last_check: string;
}

export interface EndpointHealth {
    pod_name: string;
    pod_ip: string;
    status: 'ready' | 'not_ready';
    http_check: boolean;
    latency_ms: number;
    last_check: string;
}

export interface NATMetadataMetrics {
    total_connections: number;
    active_connections: number;
    connections_by_pod: Record<string, number>;
    snat_translations: number;
    dnat_translations: number;
    translation_errors: number;
}

export interface MetricsResponse {
    timestamp: string;
    node_name?: string;
    node_ip?: string;
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
    tcp?: TCPMetrics;
    node_system?: NodeSystemMetrics;
    packet_distribution?: PacketDistributionMetrics;
    service_health?: ServiceHealthMetrics;
    nat_metadata?: NATMetadataMetrics;
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
