import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import type { ScalingPlacementResponse } from '../types/scaling';

const CACHE_TTL_MS = 15000;

type CacheEntry = {
    value: ScalingPlacementResponse;
    timestamp: number;
};

export function useScalingPlacement() {
    const cacheRef = useRef<Record<string, CacheEntry>>({});
    const [data, setData] = useState<ScalingPlacementResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchPlacement = useCallback(async (namespace?: string, deployment?: string, force = false) => {
        if (!namespace || !deployment) {
            setData(null);
            setError(null);
            return null;
        }

        const key = `${namespace}/${deployment}`;
        const now = Date.now();
        const cached = cacheRef.current[key];
        if (!force && cached && now-cached.timestamp < CACHE_TTL_MS) {
            setData(cached.value);
            setError(null);
            return cached.value;
        }

        setLoading(true);
        try {
            const response = await api.getScalingPods(namespace, deployment);
            cacheRef.current[key] = { value: response, timestamp: now };
            setData(response);
            setError(null);
            return response;
        } catch (err: any) {
            setError(err?.message || 'Failed to load pod placement');
            return null;
        } finally {
            setLoading(false);
        }
    }, []);

    const invalidate = useCallback((namespace?: string, deployment?: string) => {
        if (!namespace || !deployment) {
            cacheRef.current = {};
            return;
        }
        delete cacheRef.current[`${namespace}/${deployment}`];
    }, []);

    const summary = useMemo(() => {
        if (!data) return '';
        return Object.entries(data.nodeCounts)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([node, count]) => `${node}:${count}`)
            .join(', ');
    }, [data]);

    return {
        data,
        loading,
        error,
        summary,
        fetchPlacement,
        invalidate,
    };
}
