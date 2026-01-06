import { useState } from 'react';
import type { MetricsResponse } from '../types/api';
import './TopPerformers.css';

interface PodPerformance {
    key: string;
    name: string;
    namespace: string;
    dnsLatency: number;
    tcpRetransmissions: number;
    tcpPacketLoss: number;
    tcpSRTT: number;
    cpuSchedLatency: number;
    cpuStarvation: number;
    diskIOLatency: number;
    diskIOOperations: number;
    totalEvents: number;
}

type FilterType = 'all' | 'dns' | 'tcp' | 'cpu' | 'disk';

interface TopPerformersProps {
    metrics?: MetricsResponse | null;
}

export function TopPerformers({ metrics }: TopPerformersProps = {}) {
    const [filter, setFilter] = useState<FilterType>('all');

    const dnsPods = metrics?.dns?.pods;
    if (!metrics || !dnsPods) return null;

    // Get all pod keys from all metric types
    const allPodKeys = new Set<string>();
    Object.keys(metrics.dns.pods || {}).forEach(k => allPodKeys.add(k));
    Object.keys(metrics.tcp?.pods || {}).forEach(k => allPodKeys.add(k));
    Object.keys(metrics.sched_latency?.pod_metrics || {}).forEach(k => allPodKeys.add(k));
    Object.keys(metrics.pods || {}).forEach(k => allPodKeys.add(k));

    // Get performance metrics for each pod
    const pods: PodPerformance[] = Array.from(allPodKeys).map((podKey) => {
        const [namespace, name] = podKey.split('/');
        const dnsMetrics = metrics.dns.pods?.[podKey];
        const tcpMetrics = metrics.tcp?.pods?.[podKey];
        const cpuSchedMetrics = metrics.sched_latency?.pod_metrics?.[podKey];
        const podData = metrics.pods?.[podKey];
        const diskIOMetrics = podData?.disk_io;

        // Get metrics
        const dnsLatency = dnsMetrics?.avg_latency_us || 0;
        const tcpRetrans = tcpMetrics?.retransmissions || 0;
        const tcpLoss = tcpMetrics?.packet_loss || 0;
        const tcpSRTT = tcpMetrics?.last_srtt_us || 0;
        const cpuSchedLatency = cpuSchedMetrics?.avg_runqueue_latency_us || 0;
        const cpuStarvation = cpuSchedMetrics?.cpu_starvation_count || 0;
        const diskIOLatency = diskIOMetrics?.avg_io_latency_ns ? diskIOMetrics.avg_io_latency_ns / 1000 : 0; // Convert ns to μs
        const diskIOOperations = diskIOMetrics?.total_io_operations || 0;

        const dnsEvents = dnsMetrics?.total_events || 0;
        const tcpEvents = tcpMetrics?.total_events || 0;
        const cpuEvents = cpuSchedMetrics?.event_count || 0;
        const totalEvents = dnsEvents + tcpEvents + cpuEvents + diskIOOperations;

        return {
            key: podKey,
            name,
            namespace,
            dnsLatency,
            tcpRetransmissions: tcpRetrans,
            tcpPacketLoss: tcpLoss,
            tcpSRTT: tcpSRTT / 1000, // Convert to ms for display
            cpuSchedLatency: cpuSchedLatency / 1000, // Convert to ms for display
            cpuStarvation,
            diskIOLatency: diskIOLatency / 1000, // Convert to ms for display
            diskIOOperations,
            totalEvents
        };
    });

    // Filter pods based on selected filter
    let filteredPods = pods;
    if (filter === 'dns') {
        filteredPods = pods.filter(p => p.dnsLatency > 0);
    } else if (filter === 'tcp') {
        filteredPods = pods.filter(p => p.tcpSRTT > 0 || p.tcpRetransmissions > 0 || p.tcpPacketLoss > 0);
    } else if (filter === 'cpu') {
        filteredPods = pods.filter(p => p.cpuSchedLatency > 0 || p.cpuStarvation > 0);
    } else if (filter === 'disk') {
        filteredPods = pods.filter(p => p.diskIOOperations > 0);
    }

    // Sort filtered pods by primary metric (lower is better for top performers)
    filteredPods.sort((a, b) => {
        if (filter === 'dns') {
            return a.dnsLatency - b.dnsLatency;
        } else if (filter === 'tcp') {
            // Sort by SRTT (primary), then retransmissions
            if (a.tcpSRTT !== b.tcpSRTT) {
                return a.tcpSRTT - b.tcpSRTT;
            }
            return a.tcpRetransmissions - b.tcpRetransmissions;
        } else if (filter === 'cpu') {
            // Sort by scheduling latency (primary), then starvation
            if (a.cpuSchedLatency !== b.cpuSchedLatency) {
                return a.cpuSchedLatency - b.cpuSchedLatency;
            }
            return a.cpuStarvation - b.cpuStarvation;
        } else if (filter === 'disk') {
            return a.diskIOLatency - b.diskIOLatency;
        } else {
            // All: sort by DNS latency as primary metric
            return a.dnsLatency - b.dnsLatency;
        }
    });

    // Calculate min/max values for display
    const getMinMaxValues = () => {
        if (filteredPods.length === 0) return { min: 0, max: 0 };
        
        if (filter === 'dns') {
            const values = filteredPods.map(p => p.dnsLatency).filter(v => v > 0);
            return { min: Math.min(...values), max: Math.max(...values) };
        } else if (filter === 'tcp') {
            const values = filteredPods.map(p => p.tcpSRTT).filter(v => v > 0);
            return { min: Math.min(...values), max: Math.max(...values) };
        } else if (filter === 'cpu') {
            const values = filteredPods.map(p => p.cpuSchedLatency).filter(v => v > 0);
            return { min: Math.min(...values), max: Math.max(...values) };
        } else if (filter === 'disk') {
            const values = filteredPods.map(p => p.diskIOLatency).filter(v => v > 0);
            return { min: Math.min(...values), max: Math.max(...values) };
        } else {
            const values = filteredPods.map(p => p.dnsLatency).filter(v => v > 0);
            return { min: Math.min(...values), max: Math.max(...values) };
        }
    };

    const minMax = getMinMaxValues();
    const topPerformers = filteredPods.slice(0, 5);
    const worstPerformers = [...filteredPods].reverse().slice(0, 5);

    return (
        <div className="top-performers">
            <div className="performers-filters">
                <button
                    className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
                    onClick={() => setFilter('all')}
                >
                    All Metrics
                </button>
                <button
                    className={`filter-btn ${filter === 'dns' ? 'active' : ''}`}
                    onClick={() => setFilter('dns')}
                >
                    DNS
                </button>
                <button
                    className={`filter-btn ${filter === 'tcp' ? 'active' : ''}`}
                    onClick={() => setFilter('tcp')}
                >
                    TCP
                </button>
                <button
                    className={`filter-btn ${filter === 'cpu' ? 'active' : ''}`}
                    onClick={() => setFilter('cpu')}
                >
                    CPU Scheduling
                </button>
                <button
                    className={`filter-btn ${filter === 'disk' ? 'active' : ''}`}
                    onClick={() => setFilter('disk')}
                >
                    Disk I/O
                </button>
            </div>

            <div className="performers-grid">
                <div className="performers-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <h3>Top Performers {filter !== 'all' && `(${filter.toUpperCase()})`}</h3>
                        {minMax.min > 0 && minMax.min !== minMax.max && (
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>
                                Range: {minMax.min.toFixed(1)} - {minMax.max.toFixed(1)}
                                {filter === 'dns' ? 'μs' : filter === 'tcp' || filter === 'cpu' || filter === 'disk' ? 'ms' : 'μs'}
                            </span>
                        )}
                    </div>
                    <div className="performers-list">
                        {topPerformers.length > 0 ? (
                            topPerformers.map((pod, index) => (
                                <div key={pod.key} className="performer-item best">
                                    <div className="performer-rank">{index + 1}</div>
                                    <div className="performer-info">
                                        <div className="performer-name">{pod.name}</div>
                                        <div className="performer-namespace">{pod.namespace}</div>
                                    </div>
                                    <div className="performer-metrics">
                                        <div className="performer-metric-details">
                                            {filter === 'dns' || filter === 'all' ? (
                                                pod.dnsLatency > 0 && <span>DNS: {pod.dnsLatency.toFixed(0)}μs</span>
                                            ) : null}
                                            {filter === 'tcp' || filter === 'all' ? (
                                                <>
                                                    {pod.tcpSRTT > 0 && <span>SRTT: {pod.tcpSRTT.toFixed(1)}ms</span>}
                                                    {pod.tcpRetransmissions > 0 && <span>Retrans: {pod.tcpRetransmissions}</span>}
                                                    {pod.tcpPacketLoss > 0 && <span>Loss: {pod.tcpPacketLoss}</span>}
                                                </>
                                            ) : null}
                                            {filter === 'cpu' || filter === 'all' ? (
                                                <>
                                                    {pod.cpuSchedLatency > 0 && <span>Sched: {pod.cpuSchedLatency.toFixed(1)}ms</span>}
                                                    {pod.cpuStarvation > 0 && <span>Starvation: {pod.cpuStarvation}</span>}
                                                </>
                                            ) : null}
                                            {filter === 'disk' || filter === 'all' ? (
                                                <>
                                                    {pod.diskIOLatency > 0 && <span>Disk I/O: {pod.diskIOLatency.toFixed(1)}ms</span>}
                                                    {pod.diskIOOperations > 0 && <span>Ops: {pod.diskIOOperations.toLocaleString()}</span>}
                                                </>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: '2rem', textAlign: 'center', color: '#71717a' }}>
                                No pods match the selected filter
                            </div>
                        )}
                    </div>
                </div>

                <div className="performers-section">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <h3>Needs Attention {filter !== 'all' && `(${filter.toUpperCase()})`}</h3>
                        {minMax.min > 0 && minMax.min !== minMax.max && (
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>
                                Range: {minMax.min.toFixed(1)} - {minMax.max.toFixed(1)}
                                {filter === 'dns' ? 'μs' : filter === 'tcp' || filter === 'cpu' || filter === 'disk' ? 'ms' : 'μs'}
                            </span>
                        )}
                    </div>
                    <div className="performers-list">
                        {worstPerformers.length > 0 ? (
                            worstPerformers.map((pod, index) => (
                                <div key={pod.key} className="performer-item worst">
                                    <div className="performer-rank">{index + 1}</div>
                                    <div className="performer-info">
                                        <div className="performer-name">{pod.name}</div>
                                        <div className="performer-namespace">{pod.namespace}</div>
                                    </div>
                                    <div className="performer-metrics">
                                        <div className="performer-metric-details">
                                            {filter === 'dns' || filter === 'all' ? (
                                                pod.dnsLatency > 0 && <span>DNS: {pod.dnsLatency.toFixed(0)}μs</span>
                                            ) : null}
                                            {filter === 'tcp' || filter === 'all' ? (
                                                <>
                                                    {pod.tcpSRTT > 0 && <span>SRTT: {pod.tcpSRTT.toFixed(1)}ms</span>}
                                                    {pod.tcpRetransmissions > 0 && <span>Retrans: {pod.tcpRetransmissions}</span>}
                                                    {pod.tcpPacketLoss > 0 && <span>Loss: {pod.tcpPacketLoss}</span>}
                                                </>
                                            ) : null}
                                            {filter === 'cpu' || filter === 'all' ? (
                                                <>
                                                    {pod.cpuSchedLatency > 0 && <span>Sched: {pod.cpuSchedLatency.toFixed(1)}ms</span>}
                                                    {pod.cpuStarvation > 0 && <span>Starvation: {pod.cpuStarvation}</span>}
                                                </>
                                            ) : null}
                                            {filter === 'disk' || filter === 'all' ? (
                                                <>
                                                    {pod.diskIOLatency > 0 && <span>Disk I/O: {pod.diskIOLatency.toFixed(1)}ms</span>}
                                                    {pod.diskIOOperations > 0 && <span>Ops: {pod.diskIOOperations.toLocaleString()}</span>}
                                                </>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: '2rem', textAlign: 'center', color: '#71717a' }}>
                                No pods match the selected filter
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

