import { useState, useEffect } from 'react';
import { api } from '../services/api';

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

    useEffect(() => {
        let mounted = true;
        let lastErrorLog = 0;
        const ERROR_LOG_INTERVAL = 30000; // Only log errors every 30 seconds

        const fetchClusterInfo = async () => {
            try {
                const topology = await api.getClusterTopology();
                if (mounted && topology.nodes && topology.nodes.length > 0) {
                    const node = topology.nodes[0];
                    const podCount = node.pods ? node.pods.length : 0;
                    const runningPods = node.pods ? node.pods.filter((p: any) => p.status === 'Running').length : 0;

                    setClusterInfo({
                        cluster: 'ebpf-cluster',
                        node: node.name,
                        totalPods: podCount,
                        activePods: runningPods,
                    });

                    // Reset error logging on successful fetch
                    lastErrorLog = 0;
                }
            } catch (err: any) {
                // Only log errors if component is still mounted and enough time has passed
                if (mounted) {
                    const now = Date.now();
                    if (now - lastErrorLog > ERROR_LOG_INTERVAL) {
                        console.error('Failed to fetch cluster info:', err.message || err);
                        lastErrorLog = now;
                    }
                }
                // Keep existing values on error
            }
        };

        fetchClusterInfo();
        const interval = setInterval(fetchClusterInfo, refreshInterval);

        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, [refreshInterval]);

    return clusterInfo;
}

