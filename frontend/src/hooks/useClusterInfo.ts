import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { topologyWebSocket } from '../services/websocket';

interface ClusterInfo {
    cluster: string;
    node: string;
    totalPods: number;
    activePods: number;
}

export function useClusterInfo(refreshInterval = 5000) {
    const [clusterInfo, setClusterInfo] = useState<ClusterInfo>({
        cluster: 'ebpf-cluster',
        node: 'Loading...',
        totalPods: 0,
        activePods: 0,
    });

    const handleTopologyUpdate = useCallback((topology: any) => {
        if (topology.nodes && topology.nodes.length > 0) {
            const node = topology.nodes[0];
            const podCount = node.pods ? node.pods.length : 0;
            const runningPods = node.pods ? node.pods.filter((p: any) => p.status === 'Running').length : 0;

            setClusterInfo({
                cluster: 'ebpf-cluster',
                node: node.name,
                totalPods: podCount,
                activePods: runningPods,
            });
        }
    }, []);

    useEffect(() => {
        let mounted = true;
        let fallbackInterval: number | null = null;
        let lastErrorLog = 0;
        const ERROR_LOG_INTERVAL = 30000;

        // Try WebSocket connection first
        topologyWebSocket.connect();
        topologyWebSocket.subscribe('topology', handleTopologyUpdate);

        // Fallback to REST API if WebSocket fails
        const checkConnectionAndFallback = async () => {
            if (!topologyWebSocket.isConnected() && mounted) {
                try {
                    const topology = await api.getClusterTopology();
                    if (mounted) {
                        handleTopologyUpdate(topology);
                        lastErrorLog = 0;
                    }
                } catch (err: any) {
                    if (mounted) {
                        const now = Date.now();
                        if (now - lastErrorLog > ERROR_LOG_INTERVAL) {
                            console.error('Failed to fetch cluster info:', err.message || err);
                            lastErrorLog = now;
                        }
                    }
                }
            }
        };

        // Check connection status periodically and fallback if needed (only if WebSocket disconnected)
        // Use longer interval to avoid constant polling
        fallbackInterval = setInterval(checkConnectionAndFallback, 30000); // Check every 30 seconds
        
        // Initial fallback check after a longer delay (give WebSocket time to connect)
        setTimeout(checkConnectionAndFallback, 5000);

        return () => {
            mounted = false;
            topologyWebSocket.unsubscribe('topology', handleTopologyUpdate);
            
            if (fallbackInterval) {
                clearInterval(fallbackInterval);
            }
        };
    }, [refreshInterval, handleTopologyUpdate]);

    return clusterInfo;
}

