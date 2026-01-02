import { useState, useEffect } from 'react';

export interface ContainerInfo {
  name: string;
  image: string;
  ready: boolean;
  restart_count: number;
  state: string;
  resources: {
    requests: {
      cpu: string;
      memory: string;
    };
    limits: {
      cpu: string;
      memory: string;
    };
  };
}

export interface PodDetail {
  namespace: string;
  name: string;
  node_name: string;
  pod_ip: string;
  status: string;
  created_at: string;
  labels: Record<string, string>;
  containers: ContainerInfo[];
  init_containers?: ContainerInfo[];
  total_cpu_requested: string;
  total_memory_requested: string;
  metrics?: Record<string, any>;
}

export interface ClusterMetrics {
  total_nodes: number;
  total_pods: number;
  total_containers: number;
  total_namespaces: number;
  pods_per_node: Record<string, number>;
  pods_by_namespace: Record<string, number>;
  node_capacity: {
    cpu: string;
    memory: string;
  };
  node_allocatable: {
    cpu: string;
    memory: string;
  };
}

export interface PodDetailsData {
  timestamp: string;
  cluster_metrics: ClusterMetrics;
  pods: Record<string, PodDetail>;
}

export function usePodDetails(refreshInterval: number = 5000) {
  const [data, setData] = useState<PodDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    let fallbackInterval: NodeJS.Timeout | null = null;

    // Import WebSocket service
    import('../services/websocket').then(({ podDetailsWebSocket }) => {
      if (!mounted) return;

      const handlePodDetailsUpdate = (podDetailsData: PodDetailsData) => {
        if (mounted) {
          setData(podDetailsData);
          setError(null);
          setLoading(false);
        }
      };

      // Try WebSocket connection first
      podDetailsWebSocket.connect();
      podDetailsWebSocket.subscribe('pod_details', handlePodDetailsUpdate);

      // Fallback to REST API if WebSocket fails
      const checkConnectionAndFallback = async () => {
        if (!podDetailsWebSocket.isConnected() && mounted) {
          try {
            const response = await fetch('http://localhost:8080/api/pod/details');
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            const json = await response.json();
            if (mounted) {
              setData(json);
              setError(null);
              setLoading(false);
            }
          } catch (e) {
            if (mounted) {
              setError(e as Error);
              setLoading(false);
            }
          }
        }
      };

      // Check connection status periodically and fallback if needed (only if WebSocket disconnected)
      // Use longer interval to avoid constant polling
      fallbackInterval = setInterval(checkConnectionAndFallback, 30000); // Check every 30 seconds
      
      // Initial fallback check after a longer delay (give WebSocket time to connect)
      setTimeout(checkConnectionAndFallback, 5000);

      // Store the cleanup function
      return () => {
        mounted = false;
        podDetailsWebSocket.unsubscribe('pod_details', handlePodDetailsUpdate);
        
        if (fallbackInterval) {
          clearInterval(fallbackInterval);
        }
      };
    });

    return () => {
      mounted = false;
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
    };
  }, [refreshInterval]);

  return { data, loading, error };
}


