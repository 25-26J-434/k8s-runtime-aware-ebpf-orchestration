import { useCallback, useEffect, useRef, useState } from 'react';
import { healthApi } from '../services/healthApi';
import type {
    ClusterHealthResponse,
    HealthAlert,
    HealthHistoryResponse,
    ThresholdsResponse,
} from '../types/health';

export interface ClusterHealthState {
    cluster: ClusterHealthResponse | null;
    history: HealthHistoryResponse['history'];
    alerts: HealthAlert[];
    thresholds: ThresholdsResponse | null;
    loading: boolean;
    error: string | null;
    lastUpdated: Date | null;
    refresh: () => Promise<void>;
    setThresholds: (t: ThresholdsResponse) => void;
}

/**
 * Polls the health API. All four endpoints are fetched together so the page
 * never shows a score that disagrees with its alerts. Fetch failures keep the
 * last good data on screen and surface an error banner instead.
 */
export function useClusterHealth(intervalMs = 5000): ClusterHealthState {
    const [cluster, setCluster] = useState<ClusterHealthResponse | null>(null);
    const [history, setHistory] = useState<HealthHistoryResponse['history']>({});
    const [alerts, setAlerts] = useState<HealthAlert[]>([]);
    const [thresholds, setThresholds] = useState<ThresholdsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const mounted = useRef(true);

    const refresh = useCallback(async () => {
        try {
            const [c, h, a, t] = await Promise.all([
                healthApi.getCluster(),
                healthApi.getHistory(120),
                healthApi.getAlerts(),
                healthApi.getThresholds(),
            ]);
            if (!mounted.current) return;
            setCluster(c);
            setHistory(h.history);
            setAlerts(a);
            setThresholds(t);
            setError(null);
            setLastUpdated(new Date());
        } catch (e) {
            if (!mounted.current) return;
            setError(e instanceof Error ? e.message : 'Failed to load cluster health');
        } finally {
            if (mounted.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        mounted.current = true;
        refresh();
        const timer = setInterval(refresh, intervalMs);
        return () => {
            mounted.current = false;
            clearInterval(timer);
        };
    }, [refresh, intervalMs]);

    return { cluster, history, alerts, thresholds, loading, error, lastUpdated, refresh, setThresholds };
}
