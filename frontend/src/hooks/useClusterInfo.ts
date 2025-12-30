import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { topologyWebSocket } from '../services/websocket';

interface ClusterNode {
    name: string;
    ip?: string;
    role?: string;
    status?: string;
}

interface ClusterInfo {
    cluster: string;
    node: string;
    totalPods: number;
    activePods: number;
    totalNodes: number;
    nodes: ClusterNode[];
}

const DEFAULT_CLUSTER_NAME = import.meta.env.VITE_CLUSTER_NAME || 'ebpf-cluster';

export function useClusterInfo(refreshInterval = 5000) {
    const [clusterInfo, setClusterInfo] = useState<ClusterInfo>({
        cluster: DEFAULT_CLUSTER_NAME,
        node: 'Loading...',
        totalPods: 0,
        activePods: 0,
        totalNodes: 0,
        nodes: [],
    });

    const handleTopologyUpdate = useCallback((topology: any) => {
        if (topology?.nodes && topology.nodes.length > 0) {
            const nodes: ClusterNode[] = topology.nodes.map((node: any) => ({
                name: node.name || node.node || 'unknown',
                ip: node.ip || node.address,
                role: node.role,
                status: node.status,
            }));

            const allPods = topology.nodes.reduce((acc: any[], node: any) => {
                const pods = Array.isArray(node.pods) ? node.pods : [];
                return acc.concat(pods);
            }, [] as any[]);

            const podCount = allPods.length;
            const runningPods = allPods.filter((p: any) => (p.status || '').toLowerCase() === 'running').length;

            setClusterInfo({
                cluster: topology.cluster || DEFAULT_CLUSTER_NAME,
                node: nodes[0]?.name || 'unknown',
                totalPods: podCount,
                activePods: runningPods,
                totalNodes: nodes.length,
                nodes,
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

        // Check connection status periodically and fallback if needed
        fallbackInterval = setInterval(checkConnectionAndFallback, refreshInterval);
        
        // Initial fallback check after a short delay
        setTimeout(checkConnectionAndFallback, 1000);

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
