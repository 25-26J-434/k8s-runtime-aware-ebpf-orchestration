import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { metricsWebSocket } from '../services/websocket';
import type { MetricsResponse, UnifiedMetricsResponse } from '../types/api';

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
    
    // Extract scheduling latency metrics
    const schedNode = node.sched_latency || {};
    const schedPods: Record<string, any> = {};
    Object.entries(pods).forEach(([podKey, podMetrics]) => {
        if (podMetrics.sched_latency) {
            schedPods[podKey] = podMetrics.sched_latency;
        }
    });

    // Extract disk I/O metrics
    const diskIONode = node.disk_io || {};
    const diskIOPods: Record<string, any> = {};
    Object.entries(pods).forEach(([podKey, podMetrics]) => {
        if (podMetrics.disk_io) {
            diskIOPods[podKey] = podMetrics.disk_io;
        }
    });

    // Extract container-level disk I/O
    const diskIOContainers: Record<string, any> = {};
    const containers = data.containers || {};
    Object.entries(containers).forEach(([containerKey, containerMetrics]: [string, any]) => {
        if (containerMetrics.disk_io) {
            diskIOContainers[containerKey] = containerMetrics.disk_io;
        }
    });

    // Debug logging
    if (schedNode && Object.keys(schedNode).length > 0) {
        console.log('[useMetrics] Found sched_latency in node:', schedNode);
    }
    if (Object.keys(schedPods).length > 0) {
        console.log('[useMetrics] Found sched_latency in pods:', Object.keys(schedPods).length, 'pods');
    }
    if (diskIONode && Object.keys(diskIONode).length > 0) {
        console.log('[useMetrics] Found disk_io in node:', diskIONode);
    }
    if (Object.keys(diskIOPods).length > 0) {
        console.log('[useMetrics] Found disk_io in pods:', Object.keys(diskIOPods).length, 'pods');
    }
    if (Object.keys(diskIOContainers).length > 0) {
        console.log('[useMetrics] Found disk_io in containers:', Object.keys(diskIOContainers).length, 'containers');
    }

    // Build node_system object with disk_io
    const nodeSystem: any = node.node_system || {};
    if (diskIONode && Object.keys(diskIONode).length > 0) {
        nodeSystem.disk_io = diskIONode;
    }

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
            recent_events: (node.tcp_metrics as any)?.recent_events || [],
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
                            recent_events: tcp.recent_events || [],
                        };
                    }
                });
                return tcpPods;
            })(),
        },
        node_system: Object.keys(nodeSystem).length > 0 ? nodeSystem : undefined,
        packet_distribution: node.packet_distribution || undefined,
        service_health: node.service_health || undefined,
        nat_metadata: node.nat_metadata || undefined,
        sched_latency: schedNode && Object.keys(schedNode).length > 0 ? {
            node_metrics: schedNode,
            pod_metrics: schedPods,
        } : undefined,
        pods: data.pods,
        containers: data.containers || {},
    };
}

export function useMetrics(refreshInterval = 3000) {
    const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const handleMetricsUpdate = useCallback((data: UnifiedMetricsResponse) => {
        try {
            const transformed = transformUnifiedMetrics(data);
            setMetrics(transformed);
            setError(null);
            setLoading(false);
        } catch (err) {
            console.error('[useMetrics] Error transforming metrics:', err);
            setError(err as Error);
        }
    }, []);

    useEffect(() => {
        let mounted = true;
        let fallbackInterval: number | null = null;

        // Try WebSocket connection first
        metricsWebSocket.connect();
        metricsWebSocket.subscribe('metrics', handleMetricsUpdate);

        // Fallback to REST API if WebSocket fails
        const checkConnectionAndFallback = async () => {
            if (!metricsWebSocket.isConnected() && mounted) {
                try {
                    const data = await api.getMetrics();
                    if (mounted) {
                        setMetrics(data);
                        setError(null);
                        setLoading(false);
                    }
                } catch (err) {
                    if (mounted) {
                        setError(err as Error);
                        setLoading(false);
                    }
                }
            }
        };

        // Only use fallback if WebSocket disconnects (check every 10 seconds)
        fallbackInterval = setInterval(checkConnectionAndFallback, 10000);
        
        // Initial fallback check after 2 seconds (give WebSocket time to connect)
        setTimeout(checkConnectionAndFallback, 2000);

        return () => {
            mounted = false;
            metricsWebSocket.unsubscribe('metrics', handleMetricsUpdate);
            
            if (fallbackInterval) {
                clearInterval(fallbackInterval);
            }
        };
    }, [refreshInterval, handleMetricsUpdate]);

    return { metrics, loading, error };
}
