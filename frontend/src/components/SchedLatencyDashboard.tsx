import { useEffect, useState } from 'react';
import { api } from '../services/api';
import './SchedLatencyDashboard.css';

interface SchedLatencyMetrics {
    total_events: number;
    avg_runqueue_latency_us: number;
    max_runqueue_latency_us: number;
    min_runqueue_latency_us: number;
    p50_runqueue_latency_us: number;
    p95_runqueue_latency_us: number;
    p99_runqueue_latency_us: number;
    avg_cpu_time_us: number;
    cpu_starvation_count: number;
    last_update: string;
}

interface PodSchedLatencyMetrics {
    pod_key: string;
    pod_name: string;
    namespace: string;
    event_count: number;
    avg_runqueue_latency_us: number;
    max_runqueue_latency_us: number;
    avg_cpu_time_us: number;
    cpu_starvation_count: number;
    last_seen: string;
}

interface SchedLatencyRecord {
    timestamp: string;
    pod_key: string;
    pod_name: string;
    namespace: string;
    pid: number;
    comm: string;
    cpu: number;
    runqueue_latency_us: number;
    cpu_time_us: number;
}

export function SchedLatencyDashboard() {
    const [nodeMetrics, setNodeMetrics] = useState<SchedLatencyMetrics | null>(null);
    const [podMetrics, setPodMetrics] = useState<Record<string, PodSchedLatencyMetrics>>({});
    const [recentRecords, setRecentRecords] = useState<SchedLatencyRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [sortField, setSortField] = useState<'avg' | 'max' | 'starvation'>('avg');

    const fetchData = async () => {
        try {
            const data = await api.getSchedLatencyMetrics(20);
            setNodeMetrics(data.node_metrics);
            setPodMetrics(data.pod_metrics || {});
            setRecentRecords(data.recent_records || []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch scheduling latency metrics');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        if (!autoRefresh) return;
        
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, [autoRefresh]);

    const formatLatency = (us: number | undefined): string => {
        if (us === undefined || us === null || isNaN(us)) return '0 μs';
        if (us >= 1000000) return `${(us / 1000000).toFixed(2)} s`;
        if (us >= 1000) return `${(us / 1000).toFixed(2)} ms`;
        return `${us.toFixed(0)} μs`;
    };

    const getSortedPods = () => {
        const pods = Object.values(podMetrics);
        return pods.sort((a, b) => {
            switch (sortField) {
                case 'avg':
                    return b.avg_runqueue_latency_us - a.avg_runqueue_latency_us;
                case 'max':
                    return b.max_runqueue_latency_us - a.max_runqueue_latency_us;
                case 'starvation':
                    return b.cpu_starvation_count - a.cpu_starvation_count;
                default:
                    return 0;
            }
        });
    };

    const getLatencyColor = (latencyUs: number): string => {
        if (latencyUs > 10000) return 'var(--color-critical)'; // > 10ms
        if (latencyUs > 5000) return 'var(--color-warning)'; // > 5ms
        return 'var(--color-good)';
    };

    if (loading) {
        return (
            <div className="sched-latency-dashboard">
                <div className="loading">Loading scheduling latency metrics...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="sched-latency-dashboard">
                <div className="error">{error}</div>
                <button onClick={fetchData}>Retry</button>
            </div>
        );
    }

    const sortedPods = getSortedPods();

    return (
        <div className="sched-latency-dashboard">
            <div className="dashboard-header">
                <div>
                    <h1>⏱️ CPU Scheduling Latency</h1>
                    <p className="subtitle">Run Queue Delay & CPU Starvation Metrics</p>
                </div>
                <div className="header-controls">
                    <label className="auto-refresh-toggle">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                        />
                        Auto-refresh (5s)
                    </label>
                    <button onClick={fetchData} className="refresh-btn">
                        🔄 Refresh
                    </button>
                </div>
            </div>

            {/* Node-level Overview */}
            {nodeMetrics && (
                <div className="node-overview">
                    <h2>📊 Node-Level Metrics</h2>
                    <div className="metrics-grid">
                        <div className="metric-card">
                            <div className="metric-label">Total Events</div>
                            <div className="metric-value">{nodeMetrics.total_events.toLocaleString()}</div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-label">Avg Run Queue Latency</div>
                            <div className="metric-value" style={{ color: getLatencyColor(nodeMetrics.avg_runqueue_latency_us) }}>
                                {formatLatency(nodeMetrics.avg_runqueue_latency_us)}
                            </div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-label">P50 / P95 / P99</div>
                            <div className="metric-value-small">
                                <span style={{ color: getLatencyColor(nodeMetrics.p50_runqueue_latency_us) }}>
                                    {formatLatency(nodeMetrics.p50_runqueue_latency_us)}
                                </span>
                                {' / '}
                                <span style={{ color: getLatencyColor(nodeMetrics.p95_runqueue_latency_us) }}>
                                    {formatLatency(nodeMetrics.p95_runqueue_latency_us)}
                                </span>
                                {' / '}
                                <span style={{ color: getLatencyColor(nodeMetrics.p99_runqueue_latency_us) }}>
                                    {formatLatency(nodeMetrics.p99_runqueue_latency_us)}
                                </span>
                            </div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-label">Max Latency</div>
                            <div className="metric-value" style={{ color: getLatencyColor(nodeMetrics.max_runqueue_latency_us) }}>
                                {formatLatency(nodeMetrics.max_runqueue_latency_us)}
                            </div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-label">Min Latency</div>
                            <div className="metric-value" style={{ color: getLatencyColor(nodeMetrics.min_runqueue_latency_us) }}>
                                {formatLatency(nodeMetrics.min_runqueue_latency_us)}
                            </div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-label">CPU Starvation Events</div>
                            <div className="metric-value" style={{ color: nodeMetrics.cpu_starvation_count > 0 ? 'var(--color-critical)' : 'var(--color-good)' }}>
                                {nodeMetrics.cpu_starvation_count}
                            </div>
                            <div className="metric-subtitle">{'>'} 10ms latency</div>
                        </div>
                        <div className="metric-card">
                            <div className="metric-label">Avg CPU Time</div>
                            <div className="metric-value">{formatLatency(nodeMetrics.avg_cpu_time_us)}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Per-Pod Metrics */}
            <div className="pod-metrics-section">
                <div className="section-header">
                    <h2>🎯 Per-Pod Scheduling Latency</h2>
                    <div className="sort-controls">
                        <label>Sort by:</label>
                        <select value={sortField} onChange={(e) => setSortField(e.target.value as any)}>
                            <option value="avg">Avg Latency</option>
                            <option value="max">Max Latency</option>
                            <option value="starvation">Starvation Count</option>
                        </select>
                    </div>
                </div>
                
                <div className="pod-metrics-table">
                    <table>
                        <thead>
                            <tr>
                                <th>Pod</th>
                                <th>Namespace</th>
                                <th>Events</th>
                                <th>Avg Latency</th>
                                <th>Max Latency</th>
                                <th>Avg CPU Time</th>
                                <th>Starvation</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedPods.length === 0 ? (
                                <tr>
                                    <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>
                                        No pod scheduling data available yet
                                    </td>
                                </tr>
                            ) : (
                                sortedPods.map((pod) => (
                                    <tr key={pod.pod_key}>
                                        <td className="pod-name">{pod.pod_name}</td>
                                        <td className="namespace">{pod.namespace}</td>
                                        <td>{pod.event_count.toLocaleString()}</td>
                                        <td style={{ color: getLatencyColor(pod.avg_runqueue_latency_us) }}>
                                            {formatLatency(pod.avg_runqueue_latency_us)}
                                        </td>
                                        <td style={{ color: getLatencyColor(pod.max_runqueue_latency_us) }}>
                                            {formatLatency(pod.max_runqueue_latency_us)}
                                        </td>
                                        <td>{formatLatency(pod.avg_cpu_time_us)}</td>
                                        <td>
                                            <span className={pod.cpu_starvation_count > 0 ? 'starvation-badge' : ''}>
                                                {pod.cpu_starvation_count}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Recent Events */}
            <div className="recent-events-section">
                <h2>📝 Recent Scheduling Events</h2>
                <div className="events-table">
                    <table>
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Pod</th>
                                <th>Process</th>
                                <th>CPU</th>
                                <th>Run Queue Latency</th>
                                <th>CPU Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentRecords.length === 0 ? (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                                        No recent scheduling events
                                    </td>
                                </tr>
                            ) : (
                                recentRecords.slice(0, 20).map((record, idx) => (
                                    <tr key={idx}>
                                        <td className="timestamp">
                                            {new Date(record.timestamp).toLocaleTimeString()}
                                        </td>
                                        <td className="pod-name">{record.pod_name || 'system'}</td>
                                        <td className="process">
                                            <code>{record.comm}</code>
                                            <span className="pid"> (PID: {record.pid})</span>
                                        </td>
                                        <td>CPU {record.cpu}</td>
                                        <td style={{ color: getLatencyColor(record.runqueue_latency_us) }}>
                                            {formatLatency(record.runqueue_latency_us)}
                                        </td>
                                        <td>{formatLatency(record.cpu_time_us)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Info Card */}
            <div className="info-card">
                <h3>ℹ️ About Scheduling Latency</h3>
                <p>
                    <strong>Run Queue Latency:</strong> Time a process waits in the CPU run queue before getting scheduled.
                    High latency indicates CPU contention, noisy neighbors, or poor pod placement.
                </p>
                <p>
                    <strong>CPU Starvation:</strong> Events where run queue latency exceeds 10ms, indicating severe scheduling delays.
                </p>
                <p>
                    <strong>Data Source:</strong> eBPF tracepoints on <code>sched:sched_wakeup</code> and <code>sched:sched_switch</code>
                </p>
            </div>
        </div>
    );
}

