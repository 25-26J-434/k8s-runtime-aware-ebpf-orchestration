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
                }
            } catch (err) {
                console.error('Failed to fetch cluster info:', err);
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

