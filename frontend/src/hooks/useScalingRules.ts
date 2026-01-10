import { useState, useEffect, useCallback } from 'react';
import type { ScalingRule, LatestMetric, DeploymentInfo } from '../types/scaling';
import { api } from '../services/api';

export function useScalingRules(refreshInterval = 5000) {
    const [rules, setRules] = useState<ScalingRule[] | null>(null);
    const [deployments, setDeployments] = useState<Record<string, DeploymentInfo>>({});
    const [latestMetrics, setLatestMetrics] = useState<Record<string, LatestMetric>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [rulesRes, depsRes, metricsRes] = await Promise.allSettled([
                api.getScalingRules(),
                api.getDeployments(),
                api.getLatestMetrics(),
            ]);

            if (rulesRes.status === 'fulfilled') {
                setRules(rulesRes.value || []);
                setError(null);
            } else {
                setError(rulesRes.reason?.message || 'Failed to load scaling rules');
            }

            if (depsRes.status === 'fulfilled') {
                const depMap: Record<string, DeploymentInfo> = {};
                (depsRes.value || []).forEach((d) => {
                    depMap[`${d.namespace}/${d.name}`] = d;
                });
                setDeployments(depMap);
            }

            if (metricsRes.status === 'fulfilled') {
                const metMap: Record<string, LatestMetric> = {};
                (metricsRes.value || []).forEach((m) => {
                    metMap[`${m.namespace}/${m.deployment}/${m.metric}`] = m;
                });
                setLatestMetrics(metMap);
            }
        } catch (err: any) {
            console.error('[useScalingRules] fetch error', err);
            setError(err.message || 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
        const id = setInterval(fetchAll, refreshInterval);
        return () => clearInterval(id);
    }, [fetchAll, refreshInterval]);

    const createRule = useCallback(async (rule: Partial<ScalingRule>) => {
        const created = await api.createScalingRule(rule);
        await fetchAll();
        return created;
    }, [fetchAll]);

    const updateRule = useCallback(async (id: string, rule: Partial<ScalingRule>) => {
        const updated = await api.updateScalingRule(id, rule);
        await fetchAll();
        return updated;
    }, [fetchAll]);

    const toggleRule = useCallback(async (id: string, enabled: boolean) => {
        setRules((prev) => prev?.map((r) => (r._id === id ? { ...r, enabled } : r)) ?? prev);
        const res = await api.updateScalingRule(id, { enabled });
        await fetchAll();
        return res;
    }, [fetchAll]);

    const deleteRule = useCallback(async (id: string) => {
        const res = await api.deleteScalingRule(id);
        await fetchAll();
        return res;
    }, [fetchAll]);

    return {
        rules,
        deployments,
        latestMetrics,
        loading,
        error,
        createRule,
        updateRule,
        toggleRule,
        deleteRule,
        reload: fetchAll,
    };
}
