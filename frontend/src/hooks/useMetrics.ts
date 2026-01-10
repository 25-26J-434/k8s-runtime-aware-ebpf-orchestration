import { useState, useEffect, useCallback, useRef } from 'react';
import type { MetricsResponse, UnifiedMetricsResponse } from '../types/api';

// Module-level singleton to track cluster metrics WebSocket connection
// This prevents multiple connections even when React StrictMode remounts components
const clusterMetricsWebSocketSingleton = {
    ws: null as WebSocket | null,
    messageHandlers: new Set<(message: any) => void>(),
    isConnecting: false,
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

export function useMetrics(_refreshInterval = 3000, selectedNodeKey?: string | null) {
    const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [availableNodes, setAvailableNodes] = useState<Array<{key: string, name: string, ip: string}>>([]);
    const [totalPodsAcrossAllNodes, setTotalPodsAcrossAllNodes] = useState<number>(0);

    const clusterMetricsRef = useRef<Record<string, UnifiedMetricsResponse>>({});
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const selectedNodeKeyRef = useRef<string | null | undefined>(selectedNodeKey);

    // Update available nodes list and calculate total pods across all nodes
    const updateAvailableNodes = useCallback(() => {
        const nodes = clusterMetricsRef.current;
        const nodeList = Object.entries(nodes).map(([key, data]) => ({
            key,
            name: data.node_name || key,
            ip: data.node_ip || ''
        }));
        setAvailableNodes(nodeList);
        
        // Calculate total pods across all nodes (deduplicate by pod key)
        const allPodsSet = new Set<string>();
        Object.values(nodes).forEach((nodeMetrics) => {
            if (nodeMetrics.pods) {
                Object.keys(nodeMetrics.pods).forEach((podKey) => {
                    allPodsSet.add(podKey);
                });
            }
        });
        setTotalPodsAcrossAllNodes(allPodsSet.size);
    }, []);

    // Update metrics for selected node
    const updateSelectedNodeMetrics = useCallback((nodeKey?: string | null) => {
        const nodes = clusterMetricsRef.current;
        if (Object.keys(nodes).length === 0) {
            return;
        }

        // Determine which node to select
        let selected: UnifiedMetricsResponse | null = null;
        
        if (nodeKey && nodes[nodeKey]) {
            // Use explicitly selected node
            selected = nodes[nodeKey];
        } else if (Object.keys(nodes).length > 0) {
            // Fallback to first available node
            const firstKey = Object.keys(nodes)[0];
            selected = nodes[firstKey];
        }

        if (!selected) {
            return;
        }

        try {
            const transformed = transformUnifiedMetrics(selected);
            setMetrics(transformed);
            setLoading(false);
            setError(null);
        } catch (err) {
            console.error('[useMetrics] Error transforming cluster metrics:', err);
        }
    }, []);

    // Update ref when selectedNodeKey changes
    useEffect(() => {
        selectedNodeKeyRef.current = selectedNodeKey;
    }, [selectedNodeKey]);

    // Handle cluster-wide metrics from /api/metrics/ws
    const handleClusterMetricsMessage = useCallback((message: any) => {
        if (!message || typeof message !== 'object') {
            return;
        }

        // Handle snapshot - initial cluster state
        if (message.type === 'snapshot' && message.nodes && typeof message.nodes === 'object') {
            clusterMetricsRef.current = message.nodes as Record<string, UnifiedMetricsResponse>;
            updateAvailableNodes();
            updateSelectedNodeMetrics(selectedNodeKeyRef.current);
            return;
        }

        // Handle node_update - individual node metrics update
        if (message.type === 'node_update' && message.node && message.metrics) {
            clusterMetricsRef.current = {
                ...clusterMetricsRef.current,
                [message.node]: message.metrics as UnifiedMetricsResponse,
            };
            updateAvailableNodes();
            updateSelectedNodeMetrics(selectedNodeKeyRef.current);
        }
    }, [updateAvailableNodes, updateSelectedNodeMetrics]);

    useEffect(() => {
        // Add this handler to the singleton's message handlers
        clusterMetricsWebSocketSingleton.messageHandlers.add(handleClusterMetricsMessage);

        // Connect to cluster-wide metrics WebSocket (/api/metrics/ws) using singleton
        const connectClusterWebSocket = () => {
            if (typeof window === 'undefined') {
                return;
            }

            // Don't create a new connection if one already exists and is connecting/connected
            if (clusterMetricsWebSocketSingleton.ws && (
                clusterMetricsWebSocketSingleton.ws.readyState === WebSocket.CONNECTING ||
                clusterMetricsWebSocketSingleton.ws.readyState === WebSocket.OPEN
            )) {
                return;
            }

            // Prevent multiple simultaneous connection attempts
            if (clusterMetricsWebSocketSingleton.isConnecting) {
                return;
            }

            clusterMetricsWebSocketSingleton.isConnecting = true;

            try {
                // Use relative URL so Vite proxy handles it
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const host = window.location.host;
                const wsUrl = `${protocol}//${host}/api/metrics/ws`;

                const ws = new WebSocket(wsUrl);
                clusterMetricsWebSocketSingleton.ws = ws;

                ws.onopen = () => {
                    clusterMetricsWebSocketSingleton.isConnecting = false;
                };

                ws.onerror = (event) => {
                    clusterMetricsWebSocketSingleton.isConnecting = false;
                    console.error('[useMetrics] Cluster WebSocket error:', event);
                    safeCloseWebSocket();
                };

                ws.onclose = () => {
                    console.log('[useMetrics] Cluster WebSocket closed, will reconnect...');
                    clusterMetricsWebSocketSingleton.ws = null;
                    scheduleReconnect();
                };

                ws.onmessage = (event) => {
                    try {
                        // Skip empty messages
                        if (!event.data || event.data.trim() === '') {
                            return;
                        }
                        const payload = JSON.parse(event.data);
                        // Notify all registered handlers
                        clusterMetricsWebSocketSingleton.messageHandlers.forEach(handler => {
                            try {
                                handler(payload);
                            } catch (err) {
                                console.error('[useMetrics] Error in message handler:', err);
                            }
                        });
                    } catch (parseErr) {
                        // Only log if it's not an empty message error
                        if (event.data && event.data.trim() !== '') {
                            console.error('[useMetrics] Failed to parse cluster metrics message:', parseErr, 'Data:', event.data.substring(0, 100));
                        }
                    }
                };
            } catch (err) {
                clusterMetricsWebSocketSingleton.isConnecting = false;
                console.error('[useMetrics] Failed to connect to cluster WebSocket:', err);
                scheduleReconnect();
            }
        };

        const scheduleReconnect = () => {
            if (reconnectTimerRef.current !== null) {
                return;
            }
            // Clear any existing connection before reconnecting
            safeCloseWebSocket();
            reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null;
                connectClusterWebSocket();
            }, 5000);
        };

        const safeCloseWebSocket = () => {
            if (clusterMetricsWebSocketSingleton.ws) {
                try {
                    clusterMetricsWebSocketSingleton.ws.close();
                } catch (closeErr) {
                    console.warn('[useMetrics] Error closing cluster WebSocket:', closeErr);
                }
                clusterMetricsWebSocketSingleton.ws = null;
            }
        };

        // Connect to cluster WebSocket (singleton will prevent duplicates)
        connectClusterWebSocket();

        // NO REST API FALLBACK - WebSocket only for real-time metrics

        return () => {
            // Remove this handler from the singleton
            clusterMetricsWebSocketSingleton.messageHandlers.delete(handleClusterMetricsMessage);
            
            // Don't close the WebSocket here - let other instances use it
            // Only close if no handlers remain
            if (clusterMetricsWebSocketSingleton.messageHandlers.size === 0) {
                safeCloseWebSocket();
            }
            
            if (reconnectTimerRef.current !== null) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
        };
    }, [handleClusterMetricsMessage]);

    // Update metrics when selectedNodeKey changes
    useEffect(() => {
        updateSelectedNodeMetrics(selectedNodeKey);
    }, [selectedNodeKey, updateSelectedNodeMetrics]);

    return { metrics, loading, error, availableNodes, totalPodsAcrossAllNodes };
}

