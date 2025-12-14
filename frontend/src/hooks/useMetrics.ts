import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { MetricsResponse } from '../types/api';

export function useMetrics(refreshInterval = 3000) {
    const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let mounted = true;
        let lastErrorLog = 0;
        const ERROR_LOG_INTERVAL = 30000; // Only log errors every 30 seconds

        const fetchMetrics = async () => {
            try {
                const data = await api.getMetrics();
                if (mounted) {
                    setMetrics(data);
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

        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, [refreshInterval]);

    return { metrics, loading, error };
}
