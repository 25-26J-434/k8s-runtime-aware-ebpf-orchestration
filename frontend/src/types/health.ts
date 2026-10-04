// Types for the cluster health monitoring API (/api/health/*).

export type HealthLevel = 'excellent' | 'good' | 'warning' | 'critical' | 'unknown';

export interface HealthBand {
    excellent: number;
    good: number;
    warning: number; // values >= warning are critical
}

export interface HealthComponent {
    id: string;
    label: string;
    unit: string;
    value: number;
    level: HealthLevel;
    score: number;
    band: HealthBand;
}

export interface NodeHealth {
    node: string;
    ip?: string;
    score: number;
    level: HealthLevel;
    stale: boolean;
    components: HealthComponent[] | null;
    timestamp: string;
}

export interface ClusterHealth {
    score: number;
    level: HealthLevel;
    nodes: NodeHealth[];
    counts: Partial<Record<HealthLevel, number>> | null;
    timestamp: string;
}

export type PeerState = 'up' | 'degraded' | 'down' | 'unknown';

export interface PeerStatus {
    ip: string;
    name?: string;
    status: PeerState;
    latency_ms: number;
    last_seen?: string;
    last_checked?: string;
    consecutive_failures: number;
    last_error?: string;
}

export interface ClusterHealthResponse {
    cluster: ClusterHealth;
    peers: PeerStatus[] | null;
    firing_alerts: number;
}

export interface HealthPoint {
    time: string;
    score: number;
    level: HealthLevel;
}

export interface HealthHistoryResponse {
    history: Record<string, HealthPoint[] | null>;
}

export interface HealthAlert {
    id: string;
    key: string;
    node: string;
    metric: string;
    severity: HealthLevel;
    message: string;
    value: number;
    status: 'firing' | 'resolved';
    fired_at: string;
    updated_at: string;
    resolved_at?: string;
}

export interface ThresholdMetric {
    id: string;
    label: string;
    unit: string;
    standard: HealthBand;
    custom?: HealthBand;
    active: HealthBand;
    is_custom: boolean;
}

export interface ThresholdsResponse {
    metrics: ThresholdMetric[];
}
