import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import type { ClusterTopology, MetricsResponse, PodStats } from '../types/api';
import './RoutingPlayground.css';

type PodOption = {
    key: string;
    name: string;
    namespace: string;
    ip?: string;
    node?: string;
    metrics?: PodStats;
};

export function RoutingPlayground() {
    const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
    const [topology, setTopology] = useState<ClusterTopology | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Single Kind cluster in this setup; surface its name in the dropdown for clarity.
    const [cluster] = useState<string>('ebpf-cluster');
    const clusterOptions = ['ebpf-cluster']; // matches k8s/kind-config.yaml name

    const [sourcePod, setSourcePod] = useState<string>('');
    const [targetPod, setTargetPod] = useState<string>('');
    const [namespace, setNamespace] = useState<string>('test-services');
    const [nodeFilter, setNodeFilter] = useState<string>('all');

    useEffect(() => {
        let ignore = false;
        async function load() {
            try {
                setLoading(true);
                const [m, t] = await Promise.all([
                    api.getMetrics(),
                    api.getClusterTopology(),
                ]);
                if (!ignore) {
                    setMetrics(m);
                    setTopology(t);
                    setError(null);
                }
            } catch (err) {
                setError((err as Error).message);
            } finally {
                if (!ignore) setLoading(false);
            }
        }
        load();
        return () => { ignore = true; };
    }, []);

    const podMap = useMemo(() => {
        const map = new Map<string, PodOption>();
        if (!topology) return map;
        topology.nodes.forEach(node => {
            node.pods.forEach(pod => {
                const key = `${pod.namespace}/${pod.name}`;
                map.set(key, {
                    key,
                    name: pod.name,
                    namespace: pod.namespace,
                    ip: pod.ip,
                    node: node.name,
                });
            });
        });
        return map;
    }, [topology]);

    const metricOptions = useMemo(() => {
        const opts: PodOption[] = [];
        if (!metrics?.dns?.pods) return opts;

        Object.entries(metrics.dns.pods).forEach(([key, value]) => {
            const base = podMap.get(key);
            if (base) {
                if (nodeFilter !== 'all' && base.node !== nodeFilter) return;
                opts.push({
                    ...base,
                    metrics: value,
                });
            }
        });
        return opts;
    }, [metrics, podMap, nodeFilter]);

    const namespaceOptions = useMemo(() => {
        const set = new Set<string>();
        podMap.forEach(p => set.add(p.namespace));
        return Array.from(set);
    }, [podMap]);

    const nodeOptions = useMemo(() => {
        const set = new Set<string>();
        topology?.nodes.forEach(n => set.add(n.name));
        return ['all', ...Array.from(set)];
    }, [topology]);

    useEffect(() => {
        // Initialize selections when data arrives
        if (!sourcePod && podMap.size > 0) {
            const first = Array.from(podMap.values()).find(p =>
                p.namespace === namespace && (nodeFilter === 'all' || p.node === nodeFilter)
            ) || Array.from(podMap.values())[0];
            if (first) {
                setSourcePod(first.key);
            }
        }
        if (!targetPod && metricOptions.length > 0) {
            setTargetPod(metricOptions[0].key);
        }
    }, [podMap, metricOptions, sourcePod, targetPod, namespace, nodeFilter]);

    const bestTarget = useMemo(() => {
        const candidates = metricOptions.filter(p =>
            p.namespace === namespace &&
            (nodeFilter === 'all' || p.node === nodeFilter)
        );
        if (candidates.length === 0) return null;
        return candidates.reduce((best, current) => {
            const bestLatency = best?.metrics?.avg_latency_us ?? Number.POSITIVE_INFINITY;
            const currentLatency = current.metrics?.avg_latency_us ?? Number.POSITIVE_INFINITY;
            return currentLatency < bestLatency ? current : best;
        }, candidates[0]);
    }, [metricOptions, namespace, nodeFilter]);

    const selectedSource = sourcePod ? podMap.get(sourcePod) : null;
    const selectedTarget = targetPod ? podMap.get(targetPod) : null;
    const targetMetrics = targetPod ? metrics?.dns?.pods?.[targetPod] : undefined;

    const command = selectedSource && selectedTarget
        ? `kubectl -n ${selectedSource.namespace} exec ${selectedSource.name} -- curl -s http://${selectedTarget.ip ?? '<target-ip>'}:5001/health`
        : 'Select a source and target pod to generate a routing command.';

    const handleRun = () => {
        if (!selectedSource || !selectedTarget) return;
        const msg = `Run this in your terminal:\n\n${command}`;
        console.log('Run command:', command);
        alert(msg);
    };

    return (
        <div className="routing-playground">
            <div className="routing-row">
                <div className="routing-field">
                    <label>Cluster</label>
                    <select
                        className="routing-select"
                        value={cluster}
                        onChange={(e) => {
                            // Placeholder for future multi-cluster; single cluster in Kind setup.
                        }}
                    >
                        {clusterOptions.map(c => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                </div>

                <div className="routing-field">
                    <label>Node</label>
                    <select
                        className="routing-select"
                        value={nodeFilter}
                        onChange={(e) => {
                            setNodeFilter(e.target.value);
                            // Reset selections when node changes
                            const first = Array.from(podMap.values()).find(p =>
                                (e.target.value === 'all' || p.node === e.target.value) &&
                                p.namespace === namespace
                            );
                            if (first) setSourcePod(first.key);
                            if (bestTarget && (e.target.value === 'all' || bestTarget.node === e.target.value)) {
                                setTargetPod(bestTarget.key);
                            }
                        }}
                    >
                        {nodeOptions.map(n => (
                            <option key={n} value={n}>{n === 'all' ? 'All nodes' : n}</option>
                        ))}
                    </select>
                </div>

                <div className="routing-field">
                    <label>Namespace</label>
                    <select
                        className="routing-select"
                        value={namespace}
                        onChange={(e) => {
                            setNamespace(e.target.value);
                            // Reset selections to namespace-scoped pods if available
                            const first = Array.from(podMap.values()).find(p => p.namespace === e.target.value);
                            if (first) setSourcePod(first.key);
                            if (bestTarget && bestTarget.namespace === e.target.value) {
                                setTargetPod(bestTarget.key);
                            }
                        }}
                    >
                        {namespaceOptions.map(ns => (
                            <option key={ns} value={ns}>{ns}</option>
                        ))}
                    </select>
                </div>

                <div className="routing-field">
                    <label>Source Pod</label>
                    <select
                        className="routing-select"
                        value={sourcePod}
                        onChange={(e) => setSourcePod(e.target.value)}
                    >
                        {Array.from(podMap.values())
                            .filter(p =>
                                p.namespace === namespace &&
                                (nodeFilter === 'all' || p.node === nodeFilter)
                            )
                            .map(p => (
                                <option key={p.key} value={p.key}>
                                    {p.name} ({p.node})
                                </option>
                            ))}
                    </select>
                </div>

                <div className="routing-field">
                    <label>Target Pod</label>
                    <select
                        className="routing-select"
                        value={targetPod}
                        onChange={(e) => setTargetPod(e.target.value)}
                    >
                        {metricOptions
                            .filter(p =>
                                p.namespace === namespace &&
                                (nodeFilter === 'all' || p.node === nodeFilter)
                            )
                            .map(p => (
                                <option key={p.key} value={p.key}>
                                    {p.name} ({p.node}) • avg {Math.round(p.metrics?.avg_latency_us ?? 0)}µs
                                </option>
                            ))}
                    </select>
                </div>
            </div>

            <div className="routing-actions">
                <button
                    className="routing-button"
                    onClick={() => {
                        if (bestTarget) {
                            setTargetPod(bestTarget.key);
                        }
                    }}
                    disabled={!bestTarget}
                >
                    Use lowest-latency target
                </button>
                <button
                    className="routing-button secondary"
                    onClick={handleRun}
                    disabled={!selectedSource || !selectedTarget}
                >
                    Run command (copy)
                </button>
                <div className="routing-status">
                    {loading ? 'Loading telemetry…' : error ? `Error: ${error}` : 'Live telemetry'}
                </div>
            </div>

            <div className="routing-summary">
                <div><strong>Source:</strong> {selectedSource ? `${selectedSource.name} (${selectedSource.node})` : 'Choose a source pod'}</div>
                <div><strong>Target:</strong> {selectedTarget ? `${selectedTarget.name} (${selectedTarget.node})` : 'Choose a target pod'}</div>
                {targetMetrics && (
                    <div className="routing-hint">
                        Target avg latency: {Math.round(targetMetrics.avg_latency_us)} µs, last: {Math.round(targetMetrics.last_latency_us)} µs
                    </div>
                )}
            </div>

            <div className="routing-command">
                {command}
            </div>
        </div>
    );
}
