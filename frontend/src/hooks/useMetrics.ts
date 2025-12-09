import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { MetricsResponse } from '../types/api';

export function useMetrics(refreshInterval = 3000) {
    const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        let mounted = true;

        const fetchMetrics = async () => {
            try {
                const data = await api.getMetrics();
                if (mounted) {
                    setMetrics(data);
                    setError(null);
                }
            } catch (err) {
                if (mounted) {
                    setError(err as Error);
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
