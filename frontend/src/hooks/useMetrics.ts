import { useEffect, useRef, useState } from 'react';
import { API_BASE, api, transformUnifiedMetrics } from '../services/api';
import type { MetricsResponse, UnifiedMetricsResponse } from '../types/api';

export function useMetrics(refreshInterval = 3000) {
    const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const latestMetricsRef = useRef<MetricsResponse | null>(null);
    const clusterMetricsRef = useRef<Record<string, UnifiedMetricsResponse>>({});
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<number | null>(null);

    useEffect(() => {
        let mounted = true;
        let lastErrorLog = 0;
        const ERROR_LOG_INTERVAL = 30000; // Only log errors every 30 seconds

        const fetchMetrics = async () => {
            try {
                const data = await api.getMetrics();
                if (mounted) {
                    setMetrics(data);
                    latestMetricsRef.current = data;
                    setError(null);
                    lastErrorLog = 0; // Reset error logging on successful fetch
                }
            } catch (err: any) {
                // Only set error if component is still mounted
                if (mounted) {
                    setError(err as Error);

                    // Throttle error logging
                    const now = Date.now();
                    if (now - lastErrorLog > ERROR_LOG_INTERVAL) {
                        console.error('Failed to fetch metrics:', err.message || err);
                        lastErrorLog = now;
                    }
                }
            } finally {
                if (mounted) {
                    setLoading(false);
                }
            }
        };

        fetchMetrics();
        const interval = setInterval(fetchMetrics, refreshInterval);

        const connectWebSocket = () => {
            if (!mounted || typeof window === 'undefined') {
                return;
            }

            try {
                const wsUrl = resolveWebSocketUrl('/api/metrics/ws');
                if (!wsUrl) {
                    return;
                }

                const ws = new WebSocket(wsUrl);
                wsRef.current = ws;

                ws.onopen = () => {
                    if (!mounted) {
                        return;
                    }
                    setError(null);
                };

                ws.onerror = (event) => {
                    if (!mounted) {
                        return;
                    }
                    const wsError = new Error('WebSocket connection error');
                    setError(wsError);
                    safeCloseWebSocket();
                };

                ws.onclose = () => {
                    if (!mounted) {
                        return;
                    }
                    scheduleReconnect();
                };

                ws.onmessage = (event) => {
                    if (!mounted) {
                        return;
                    }
                    try {
                        const payload = JSON.parse(event.data);
                        handleMetricsMessage(payload);
                    } catch (parseErr) {
                        console.error('Failed to parse metrics WebSocket message:', parseErr);
                    }
                };
            } catch (err) {
                console.error('Failed to establish metrics WebSocket connection:', err);
                scheduleReconnect();
            }
        };

        const scheduleReconnect = () => {
            if (!mounted || reconnectTimerRef.current !== null) {
                return;
            }
            reconnectTimerRef.current = window.setTimeout(() => {
                reconnectTimerRef.current = null;
                connectWebSocket();
            }, 5000);
        };

        const safeCloseWebSocket = () => {
            if (wsRef.current) {
                try {
                    wsRef.current.close();
                } catch (closeErr) {
                    console.warn('Error closing metrics WebSocket:', closeErr);
                }
                wsRef.current = null;
            }
        };

        const handleMetricsMessage = (message: any) => {
            if (!message || typeof message !== 'object') {
                return;
            }

            if (message.type === 'snapshot' && message.nodes && typeof message.nodes === 'object') {
                clusterMetricsRef.current = message.nodes as Record<string, UnifiedMetricsResponse>;
                updateSelectedNodeMetrics();
                return;
            }

            if (message.type === 'node_update' && message.node && message.metrics) {
                clusterMetricsRef.current = {
                    ...clusterMetricsRef.current,
                    [message.node]: message.metrics as UnifiedMetricsResponse,
                };
                updateSelectedNodeMetrics();
            }
        };

        const updateSelectedNodeMetrics = () => {
            const nodes = clusterMetricsRef.current;
            const nodeEntries = Object.values(nodes || {});
            if (nodeEntries.length === 0) {
                return;
            }

            const currentNodeName = latestMetricsRef.current?.node_name;
            const currentNodeIP = latestMetricsRef.current?.node_ip;

            const preferred = nodeEntries.find((entry) =>
                (currentNodeName && entry.node_name === currentNodeName) ||
                (currentNodeIP && entry.node_ip === currentNodeIP)
            );

            const fallback = nodeEntries.find((entry) => entry.node_name && entry.node_name !== 'unknown') || nodeEntries[0];
            const selected = preferred || fallback;

            if (!selected) {
                return;
            }

            const transformed = transformUnifiedMetrics(selected);
            latestMetricsRef.current = transformed;
            setMetrics(transformed);
            setLoading(false);
            setError(null);
        };

        connectWebSocket();

        return () => {
            mounted = false;
            clearInterval(interval);
            if (reconnectTimerRef.current !== null) {
                window.clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (wsRef.current) {
                try {
                    wsRef.current.close();
                } catch (closeErr) {
                    console.warn('Error closing metrics WebSocket:', closeErr);
                }
                wsRef.current = null;
            }
        };
    }, [refreshInterval]);

    return { metrics, loading, error };
}

function resolveWebSocketUrl(path: string): string {
    if (typeof window === 'undefined') {
        return '';
    }

    const trimmedPath = path.startsWith('/') ? path : `/${path}`;

    if (API_BASE && /^https?:\/\//.test(API_BASE)) {
        const baseUrl = new URL(API_BASE);
        baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, '')}${trimmedPath}`;
        baseUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        return baseUrl.toString();
    }

    const origin = window.location.origin;
    const url = new URL(`${API_BASE}${trimmedPath}`, origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
}
