import type {
    MetricsResponse,
    ClusterTopology,
    Service,
    UnifiedMetricsResponse,
    RedirectionEvent,
    RedirectionEventPayload,
} from '../types/api';

const API_BASE = '';  // Proxy handles routing
const ROUTING_API_BASE = import.meta.env.VITE_ROUTING_API || 'http://localhost:4000';

type ApplyResponse = {
    message: string;
    stdout?: string;
    stderr?: string;
    helper?: string;
    rule?: string;
    exitCode?: number;
    signal?: string;
};

// Transform unified metrics to expected format
function transformUnifiedMetrics(data: UnifiedMetricsResponse): MetricsResponse {
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

    async createRedirectionEvent(payload: RedirectionEventPayload): Promise<RedirectionEvent> {
        const response = await fetch(`${ROUTING_API_BASE}/api/redirections`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to create redirection event: ${response.status} ${response.statusText} - ${text}`);
        }

        return response.json();
    },

    async applyRuleByPolicy(policyName: string): Promise<ApplyResponse> {
        const response = await fetch(
            `${ROUTING_API_BASE}/api/rules/by-policy/${encodeURIComponent(policyName)}/apply`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to apply policy: ${response.status} ${response.statusText} - ${text}`);
        }

        return response.json();
    },

    async getRuleByPolicy(policyName: string): Promise<{ id: string }> {
        const response = await fetch(`${ROUTING_API_BASE}/api/rules/by-policy/${encodeURIComponent(policyName)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch rule: ${response.status} ${response.statusText}`);
        }

        return response.json();
    },

    async deleteRule(id: string): Promise<void> {
        const response = await fetch(`${ROUTING_API_BASE}/api/rules/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to delete rule: ${response.status} ${response.statusText} - ${text}`);
        }
    },

    async createRule(rule: any): Promise<any> {
        const response = await fetch(`${ROUTING_API_BASE}/api/rules`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(rule),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to create rule: ${response.status} ${response.statusText} - ${text}`);
        }

        return response.json();
    },

    async getRedirectionEvents(policyName?: string): Promise<RedirectionEvent[]> {
        const query = policyName ? `?policy_name=${encodeURIComponent(policyName)}` : '';
        const response = await fetch(`${ROUTING_API_BASE}/api/redirections${query}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch redirection events: ${response.status} ${response.statusText}`);
        }

        return response.json();
    },

    async getRoutingIdentity(): Promise<string> {
        const response = await fetch(`${ROUTING_API_BASE}/whoami`);
        if (!response.ok) {
            throw new Error(`Failed to fetch routing service identity: ${response.status} ${response.statusText}`);
        }
        return response.text();
    },
};
