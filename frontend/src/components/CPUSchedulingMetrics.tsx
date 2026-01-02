import { useState, useEffect } from 'react';
import type { MetricsResponse } from '../types/api';
import './CPUSchedulingMetrics.css';

interface SchedMetrics {
    total_events: number;
    avg_runqueue_latency_us: number;
    max_runqueue_latency_us: number;
    min_runqueue_latency_us: number;
    p50_runqueue_latency_us: number;
    p95_runqueue_latency_us: number;
    p99_runqueue_latency_us: number;
    avg_cpu_time_us: number;
    cpu_starvation_count: number;
}

interface PodSchedMetrics {
    pod_name: string;
    namespace: string;
    avg_runqueue_latency_us: number;
    max_runqueue_latency_us: number;
    cpu_starvation_count: number;
}

interface CPUSchedulingMetricsProps {
    metrics?: MetricsResponse | null;
}

export function CPUSchedulingMetrics({ metrics }: CPUSchedulingMetricsProps = {}) {
    const [nodeMetrics, setNodeMetrics] = useState<SchedMetrics | null>(null);
    const [topPods, setTopPods] = useState<PodSchedMetrics[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!metrics) {
            setLoading(true);
            return;
        }

        // Extract scheduling latency from WebSocket metrics
        const schedData = (metrics as any).sched_latency;
        
        if (schedData && schedData.node_metrics) {
            const nodeData = schedData.node_metrics;
            
            setNodeMetrics({
                total_events: nodeData.total_events || 0,
                avg_runqueue_latency_us: nodeData.avg_runqueue_latency_us || 0,
                max_runqueue_latency_us: nodeData.max_runqueue_latency_us || 0,
                min_runqueue_latency_us: nodeData.min_runqueue_latency_us || 0,
                p50_runqueue_latency_us: nodeData.p50_runqueue_latency_us || 0,
                p95_runqueue_latency_us: nodeData.p95_runqueue_latency_us || 0,
                p99_runqueue_latency_us: nodeData.p99_runqueue_latency_us || 0,
                avg_cpu_time_us: nodeData.avg_cpu_time_us || 0,
                cpu_starvation_count: nodeData.cpu_starvation_count || 0,
            });

            // Extract pod metrics
            if (schedData.pod_metrics && Object.keys(schedData.pod_metrics).length > 0) {
                const pods = Object.values(schedData.pod_metrics) as PodSchedMetrics[];
                const sorted = pods
                    .filter((p: PodSchedMetrics) => p.avg_runqueue_latency_us > 0)
                    .sort((a: PodSchedMetrics, b: PodSchedMetrics) => 
                        b.avg_runqueue_latency_us - a.avg_runqueue_latency_us
                    )
                    .slice(0, 5);
                setTopPods(sorted);
            } else {
                setTopPods([]);
            }
            
            setLoading(false);
        } else {
            setLoading(false);
        }
    }, [metrics]);

    const formatLatency = (us: number | undefined): string => {
        if (!us || isNaN(us)) return '0 μs';
        if (us >= 1000) return `${(us / 1000).toFixed(1)} ms`;
        return `${us.toFixed(0)} μs`;
    };

    const getLatencyColor = (us: number | undefined): string => {
        if (!us) return '#10b981';
        if (us > 10000) return '#ef4444';
        if (us > 5000) return '#f59e0b';
        return '#10b981';
    };

    if (loading) {
        return (
            <div className="cpu-sched-loading">
                <div className="spinner-small"></div>
                <span>Loading CPU scheduling data...</span>
            </div>
        );
    }

    if (!nodeMetrics || nodeMetrics.total_events === 0) {
        return (
            <div className="cpu-sched-empty">
                <div className="empty-icon">SCHED</div>
                <p>No CPU scheduling data available yet</p>
                <span className="empty-hint">Waiting for scheduler events...</span>
            </div>
        );
    }

    return (
        <div className="cpu-scheduling-container">
            {/* Node-Level Summary Cards */}
            <div className="sched-summary-grid">
                <div className="sched-card highlight">
                    <div className="sched-card-content">
                        <div className="sched-card-label">Avg Run Queue Latency</div>
                        <div className="sched-card-value" style={{ 
                            color: getLatencyColor(nodeMetrics.avg_runqueue_latency_us) 
                        }}>
                            {formatLatency(nodeMetrics.avg_runqueue_latency_us)}
                        </div>
                        <div className="sched-card-subtitle">
                            P95: {formatLatency(nodeMetrics.p95_runqueue_latency_us)}
                        </div>
                    </div>
                </div>

                <div className="sched-card">
                    <div className="sched-card-content">
                        <div className="sched-card-label">Max Latency</div>
                        <div className="sched-card-value" style={{ 
                            color: getLatencyColor(nodeMetrics.max_runqueue_latency_us) 
                        }}>
                            {formatLatency(nodeMetrics.max_runqueue_latency_us)}
                        </div>
                        <div className="sched-card-subtitle">Peak delay</div>
                    </div>
                </div>

                <div className="sched-card">
                    <div className="sched-card-content">
                        <div className="sched-card-label">Min Latency</div>
                        <div className="sched-card-value" style={{ 
                            color: '#10b981'
                        }}>
                            {formatLatency(nodeMetrics.min_runqueue_latency_us)}
                        </div>
                        <div className="sched-card-subtitle">Minimum delay</div>
                    </div>
                </div>

                <div className="sched-card">
                    <div className="sched-card-content">
                        <div className="sched-card-label">P50 (Median)</div>
                        <div className="sched-card-value" style={{ 
                            color: getLatencyColor(nodeMetrics.p50_runqueue_latency_us) 
                        }}>
                            {formatLatency(nodeMetrics.p50_runqueue_latency_us)}
                        </div>
                        <div className="sched-card-subtitle">50th percentile</div>
                    </div>
                </div>

                <div className="sched-card">
                    <div className="sched-card-content">
                        <div className="sched-card-label">P99</div>
                        <div className="sched-card-value" style={{ 
                            color: getLatencyColor(nodeMetrics.p99_runqueue_latency_us) 
                        }}>
                            {formatLatency(nodeMetrics.p99_runqueue_latency_us)}
                        </div>
                        <div className="sched-card-subtitle">99th percentile</div>
                    </div>
                </div>

                <div className="sched-card">
                    <div className="sched-card-content">
                        <div className="sched-card-label">Avg CPU Time</div>
                        <div className="sched-card-value" style={{ 
                            color: '#60a5fa'
                        }}>
                            {formatLatency(nodeMetrics.avg_cpu_time_us)}
                        </div>
                        <div className="sched-card-subtitle">Average execution time</div>
                    </div>
                </div>

                <div className="sched-card">
                    <div className="sched-card-content">
                        <div className="sched-card-label">Total Events</div>
                        <div className="sched-card-value">
                            {nodeMetrics.total_events.toLocaleString()}
                        </div>
                        <div className="sched-card-subtitle">Scheduling samples</div>
                    </div>
                </div>

                <div className={`sched-card ${nodeMetrics.cpu_starvation_count > 0 ? 'alert' : ''}`}>
                    <div className="sched-card-content">
                        <div className="sched-card-label">CPU Starvation</div>
                        <div className="sched-card-value" style={{ 
                            color: nodeMetrics.cpu_starvation_count > 0 ? '#ef4444' : '#10b981' 
                        }}>
                            {nodeMetrics.cpu_starvation_count}
                        </div>
                        <div className="sched-card-subtitle">Delays {'>'} 10ms</div>
                    </div>
                </div>
            </div>

            {/* Top Pods by Latency */}
            {topPods.length > 0 && (
                <div className="sched-top-pods">
                    <div className="sched-section-header">
                        <h4>Top Pods by Scheduling Latency</h4>
                        <span className="sched-badge">Highest Run Queue Delays</span>
                    </div>
                    <div className="sched-pods-list">
                        {topPods.map((pod, idx) => (
                            <div key={idx} className="sched-pod-item">
                                <div className="sched-pod-rank">#{idx + 1}</div>
                                <div className="sched-pod-info">
                                    <div className="sched-pod-name">{pod.pod_name}</div>
                                    <div className="sched-pod-ns">{pod.namespace}</div>
                                </div>
                                <div className="sched-pod-metrics">
                                    <div className="sched-pod-metric">
                                        <span className="metric-label">Avg:</span>
                                        <span className="metric-value" style={{ 
                                            color: getLatencyColor(pod.avg_runqueue_latency_us) 
                                        }}>
                                            {formatLatency(pod.avg_runqueue_latency_us)}
                                        </span>
                                    </div>
                                    <div className="sched-pod-metric">
                                        <span className="metric-label">Max:</span>
                                        <span className="metric-value" style={{ 
                                            color: getLatencyColor(pod.max_runqueue_latency_us) 
                                        }}>
                                            {formatLatency(pod.max_runqueue_latency_us)}
                                        </span>
                                    </div>
                                    {pod.cpu_starvation_count > 0 && (
                                        <div className="sched-starvation-badge">
                                            CRIT: {pod.cpu_starvation_count}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

        </div>
    );
}

