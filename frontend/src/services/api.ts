import type {
    MetricsResponse,
    ClusterTopology,
    Service,
    UnifiedMetricsResponse,
    RedirectionEvent,
    RedirectionEventPayload,
    CommStats,
    CommLogEntry,
} from '../types/api';
import type { ScalingRule, LatestMetric, DeploymentInfo, ScalingPlacementResponse } from '../types/scaling';

const API_BASE = '';  // Proxy handles routing
const ROUTING_API_BASE = (import.meta as any).env?.VITE_ROUTING_API || API_BASE || '';
const SCALING_API_BASE = (import.meta as any).env?.VITE_SCALING_API_BASE || API_BASE;

type ApplyResponse = {
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
    exitCode?: number;
    signal?: string;
};

// Transform unified metrics to expected format
export function transformUnifiedMetrics(data: UnifiedMetricsResponse): MetricsResponse {
    const node = data.node || {};
    const pods = data.pods || {};
    
    // Extract DNS metrics
    const dnsNode = node.dns_latency || {};
    const dnsPods: Record<string, any> = {};
    Object.entries(pods).forEach(([podKey, podMetrics]) => {
        if (podMetrics.dns_latency) {
            const dns = podMetrics.dns_latency;
            dnsPods[podKey] = {
                total_events: dns.total_events || 0,
                avg_latency_us: (dns.avg_latency_ns || 0) / 1000,
                last_latency_us: (dns.last_latency_ns || 0) / 1000,
                max_latency_us: (dns.max_latency_ns || 0) / 1000,
                min_latency_us: (dns.min_latency_ns || 0) / 1000,
            };
        }
    });
    
    // Extract RTT metrics
    const rttNode = node.rtt || {};
    const rttPods: Record<string, any> = {};
    Object.entries(pods).forEach(([podKey, podMetrics]) => {
        if (podMetrics.rtt) {
            const rtt = podMetrics.rtt;
            rttPods[podKey] = {
                total_events: rtt.total_events || 0,
                avg_latency_us: (rtt.avg_rtt_ns || 0) / 1000,
                last_latency_us: (rtt.last_rtt_ns || 0) / 1000,
                max_latency_us: (rtt.max_rtt_ns || 0) / 1000,
                min_latency_us: (rtt.min_rtt_ns || 0) / 1000,
            };
        }
    });
    
    return {
        timestamp: data.timestamp,
        node_name: data.node_name,
        node_ip: data.node_ip,
        dns: {
            total_events: dnsNode.total_events || 0,
            avg_latency_us: (dnsNode.avg_latency_ns || 0) / 1000,
            last_latency_us: (dnsNode.last_latency_ns || 0) / 1000,
            max_latency_us: (dnsNode.max_latency_ns || 0) / 1000,
            min_latency_us: (dnsNode.min_latency_ns || 0) / 1000,
            pods: dnsPods,
        },
        rtt: {
            total_events: rttNode.total_events || 0,
            avg_rtt_us: (rttNode.avg_rtt_ns || 0) / 1000,
            last_rtt_us: (rttNode.last_rtt_ns || 0) / 1000,
            max_rtt_us: (rttNode.max_rtt_ns || 0) / 1000,
            min_rtt_us: (rttNode.min_rtt_ns || 0) / 1000,
            pods: rttPods,
        },
        tcp: {
            total_events: (node.tcp_metrics as any)?.total_events || 0,
            avg_srtt_us: (node.tcp_metrics as any)?.avg_srtt_us || 0,
            last_srtt_us: (node.tcp_metrics as any)?.last_srtt_us || 0,
            last_min_rtt_us: (node.tcp_metrics as any)?.last_min_rtt_us || 0,
            retransmissions: (node.tcp_metrics as any)?.retransmissions || 0,
            packet_loss: (node.tcp_metrics as any)?.packet_loss || 0,
            bad_handshakes: (node.tcp_metrics as any)?.bad_handshakes || 0,
            last_cwnd: (node.tcp_metrics as any)?.last_cwnd || 0,
            recent_events: (node.tcp_metrics as any)?.recent_events || [], // Include recent events for timeline
            pods: (() => {
                const tcpPods: Record<string, any> = {};
                Object.entries(pods).forEach(([podKey, podMetrics]) => {
                    if (podMetrics.tcp_metrics) {
                        const tcp = podMetrics.tcp_metrics;
                        tcpPods[podKey] = {
                            total_events: tcp.total_events || 0,
                            avg_srtt_us: tcp.avg_srtt_us || 0,
                            last_srtt_us: tcp.last_srtt_us || 0,
                            last_min_rtt_us: tcp.last_min_rtt_us || 0,
                            retransmissions: tcp.retransmissions || 0,
                            packet_loss: tcp.packet_loss || 0,
                            bad_handshakes: tcp.bad_handshakes || 0,
                            last_cwnd: tcp.last_cwnd || 0,
                            recent_events: tcp.recent_events || [], // Include pod-level recent events
                        };
                    }
                });
                return tcpPods;
            })(),
        },
        // Include new metrics
        node_system: node.node_system || undefined,
        packet_distribution: node.packet_distribution || undefined,
        service_health: node.service_health || undefined,
        nat_metadata: node.nat_metadata || undefined,
        // Include raw pods data for topology
        pods: data.pods,
        // Include container-level metrics
        containers: data.containers || {},
    };
}

export const api = {
    async getMetrics(): Promise<MetricsResponse> {
        const response = await fetch(`${API_BASE}/api/metrics`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch metrics: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        // Transform unified metrics format to expected format
        return transformUnifiedMetrics(data);
    },
    
    async getUnifiedMetrics(): Promise<UnifiedMetricsResponse> {
        const response = await fetch(`${API_BASE}/api/metrics`);
        if (!response.ok) throw new Error('Failed to fetch unified metrics');
        return response.json();
    },

    async getServiceAWhoami(): Promise<string> {
        const response = await fetch(`${ROUTING_API_BASE}/api/probe/service-a`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to fetch service-a whoami: ${response.status} ${response.statusText} - ${text}`);
        }
        return response.text();
    },

    async probeService(service: string, namespace?: string, port?: number | string, path?: string): Promise<string> {
        const params = new URLSearchParams();
        if (namespace) params.set('namespace', namespace);
        if (port) params.set('port', String(port));
        if (path) params.set('path', path);
        const query = params.toString();
        const response = await fetch(
            `${ROUTING_API_BASE}/api/probe/${encodeURIComponent(service)}${query ? `?${query}` : ''}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            },
        );
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to probe ${service}: ${response.status} ${response.statusText} - ${text}`);
        }
        return response.text();
    },

    async getClusterTopology(): Promise<ClusterTopology> {
        const response = await fetch(`${API_BASE}/api/cluster/topology`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch cluster topology: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },

    async getServices(): Promise<Service[]> {
        const response = await fetch(`${API_BASE}/api/cluster/services`);
        if (!response.ok) throw new Error('Failed to fetch services');
        const data = await response.json();
        return data.services || [];
    },

    // Disk I/O endpoints
    async getDiskIOMetrics() {
        const response = await fetch(`${API_BASE}/api/disk/metrics`);
        if (!response.ok) throw new Error('Failed to fetch disk I/O metrics');
        return response.json();
    },

    async getDiskIOPods() {
        const response = await fetch(`${API_BASE}/api/disk/pods`);
        if (!response.ok) throw new Error('Failed to fetch disk I/O pod metrics');
        return response.json();
    },

    async getDiskIOContainers() {
        const response = await fetch(`${API_BASE}/api/disk/containers`);
        if (!response.ok) throw new Error('Failed to fetch disk I/O container metrics');
        return response.json();
    },

    async getPodDNSMetrics() {
        const response = await fetch(`${API_BASE}/api/dns/pods`);
        if (!response.ok) throw new Error('Failed to fetch pod DNS metrics');
        return response.json();
    },

    async getConnectionTopology(filter: string = 'established'): Promise<any> {
        const response = await fetch(`${API_BASE}/api/connections/topology?filter=${filter}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch connection topology: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },
    
    async getPodConnections(namespace: string, podName: string): Promise<any> {
        const response = await fetch(`${API_BASE}/api/connections/pod?namespace=${namespace}&pod=${podName}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch pod connections: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },

    async getSchedLatencyMetrics(limit: number = 50): Promise<any> {
        const response = await fetch(`${API_BASE}/api/sched/metrics?limit=${limit}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch scheduling latency metrics: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },

    async getSchedLatencyPods(): Promise<any> {
        const response = await fetch(`${API_BASE}/api/sched/pods`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch pod scheduling latency metrics: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },

    async getSchedLatencyRecords(limit: number = 100): Promise<any> {
        const response = await fetch(`${API_BASE}/api/sched/records?limit=${limit}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch scheduling latency records: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },

    async getSchedLatencyContainers(): Promise<any> {
        const response = await fetch(`${API_BASE}/api/sched/containers`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch container scheduling latency metrics: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },

    async getScalingRules(node?: string): Promise<ScalingRule[]> {
        const query = node ? `?node=${encodeURIComponent(node)}` : '';
        const response = await fetch(`${SCALING_API_BASE}/api/scaling/rules${query}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch scaling rules: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },

    async getNamespaces(node?: string): Promise<string[]> {
        const query = node ? `?node=${encodeURIComponent(node)}` : '';
        const response = await fetch(`${SCALING_API_BASE}/api/scaling/namespaces${query}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch namespaces: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },

    async getScalingPods(namespace: string, deployment: string): Promise<ScalingPlacementResponse> {
        const query = `?namespace=${encodeURIComponent(namespace)}&deployment=${encodeURIComponent(deployment)}`;
        const response = await fetch(`${SCALING_API_BASE}/api/scaling/pods${query}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch scaling pods: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },

    // Node Communication APIs (Component 4)
    async getCommStats(): Promise<CommStats> {
        const response = await fetch(`${API_BASE}/api/comm/stats`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch communication stats: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },


    async createScalingRule(rule: Partial<ScalingRule>): Promise<ScalingRule> {
        const response = await fetch(`${SCALING_API_BASE}/api/scaling/rules`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(rule),
        });
        if (!response.ok) {
            throw new Error(`Failed to create scaling rule: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },

    async updateScalingRule(id: string, rule: Partial<ScalingRule>): Promise<ScalingRule> {
        const response = await fetch(`${SCALING_API_BASE}/api/scaling/rules/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(rule),
        });
        if (!response.ok) {
            throw new Error(`Failed to update scaling rule: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },

    async deleteScalingRule(id: string): Promise<void> {
        const response = await fetch(`${SCALING_API_BASE}/api/scaling/rules/${id}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to delete scaling rule: ${response.status} ${response.statusText}`);
        }
    },

    async getDeployments(namespace?: string, node?: string): Promise<DeploymentInfo[]> {
        const params = new URLSearchParams();
        if (namespace) params.set('namespace', namespace);
        if (node) params.set('node', node);
        const query = params.toString() ? `?${params.toString()}` : '';
        const response = await fetch(`${SCALING_API_BASE}/api/scaling/deployments${query}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch deployments: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },

    async getLatestMetrics(node?: string): Promise<LatestMetric[]> {
        const query = node ? `?node=${encodeURIComponent(node)}` : '';
        const response = await fetch(`${API_BASE}/api/scaling/metrics/latest${query}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch latest metrics: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },

    async sendBroadcast(message: any): Promise<void> {
        const response = await fetch(`${API_BASE}/api/comm/broadcast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message),
        });
        if (!response.ok) throw new Error('Failed to send broadcast');
    },

    async sendUnicast(target: string, message: any): Promise<void> {
        const response = await fetch(`${API_BASE}/api/comm/unicast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...message, targets: [target] }),
        });
        if (!response.ok) throw new Error('Failed to send unicast');
    },

    async sendMulticast(targets: string[], message: any): Promise<void> {
        const response = await fetch(`${API_BASE}/api/comm/multicast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...message, targets }),
        });
        if (!response.ok) throw new Error('Failed to send multicast');
    },

    async getCommLogs(scope: 'local' | 'cluster' = 'local', limit = 50): Promise<CommLogEntry[]> {
        const params = new URLSearchParams({ scope, limit: `${limit}` });
        const response = await fetch(`${API_BASE}/api/comm/logs?${params.toString()}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch communication logs: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return Array.isArray(data?.logs) ? (data.logs as CommLogEntry[]) : [];
    },

    // Extensions (SPI)
    async getExtensions(): Promise<{ extensions: ExtensionInfo[] }> {
        const response = await fetch(`${API_BASE}/api/extensions`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch extensions: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },
    async getExtensionConfig(name: string): Promise<Record<string, unknown>> {
        const response = await fetch(`${API_BASE}/api/extensions/${name}/config`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-cache',
        });
        if (!response.ok) {
            if (response.status === 404) return {};
            throw new Error(`Failed to fetch extension config: ${response.status} ${response.statusText}`);
        }
        return response.json();
    },
    async setExtensionConfig(name: string, config: Record<string, unknown>): Promise<void> {
        const response = await fetch(`${API_BASE}/api/extensions/${name}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
        });
        if (!response.ok) {
            throw new Error(`Failed to set extension config: ${response.status} ${response.statusText}`);
        }
    },
    async triggerNotificationExtension(): Promise<void> {
        const response = await fetch(`${API_BASE}/api/extensions/notification/trigger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(`Failed to trigger notification check: ${response.status} ${response.statusText}`);
        }
    },

    /** Sends a test message to all configured webhooks (Discord, Teams, Slack) so you can verify they receive it. */
    async sendTestNotification(): Promise<void> {
        const response = await fetch(`${API_BASE}/api/extensions/notification/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(`Failed to send test notification: ${response.status} ${response.statusText}`);
        }
    },

    async getPodDetails(): Promise<{ pods: Record<string, { namespace: string; name: string; node_name: string }> }> {
        const response = await fetch(`${API_BASE}/api/pod/details`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-cache',
        });
        if (!response.ok) throw new Error('Failed to fetch pod details');
        return response.json();
    },
}

export type ExtensionInput = {
    key: string;
    label: string;
    type: string;
    required?: boolean;
    default?: unknown;
    options?: { value: string; label: string }[];
};

export type ExtensionInfo = {
    name: string;
    label?: string;
    description?: string;
    inputs?: ExtensionInput[];
    summary_keys?: string[];
};
