import { useState } from 'react';
import type { MetricsResponse } from '../types/api';
import './TopPerformers.css';

interface PodPerformance {
    key: string;
    name: string;
    namespace: string;
    score: number;
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

    // Calculate performance score for each pod based on selected filter
    const pods: PodPerformance[] = Array.from(allPodKeys).map((podKey) => {
        const [namespace, name] = podKey.split('/');
        const dnsMetrics = metrics.dns.pods?.[podKey];
        const tcpMetrics = metrics.tcp?.pods?.[podKey];
        const cpuSchedMetrics = metrics.sched_latency?.pod_metrics?.[podKey];
        const podData = metrics.pods?.[podKey];
        const diskIOMetrics = podData?.disk_io;

        // Get metrics (normalize to avoid division by zero)
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

        let score = 0;

        // Calculate score based on filter
        if (filter === 'dns') {
            // DNS-only ranking: lower latency = better
            score = Math.min(100, (dnsLatency / 100)); // 100μs = 1 point, 10000μs = 100 points
        } else if (filter === 'tcp') {
            // TCP-only ranking: combine retransmissions, packet loss, and SRTT
            const retransRate = tcpEvents > 0 ? (tcpRetrans / tcpEvents) * 100 : 100; // Higher is worse
            const lossRate = tcpEvents > 0 ? (tcpLoss / tcpEvents) * 100 : 100; // Higher is worse
            const srttScore = Math.min(100, (tcpSRTT / 10000)); // 100ms = 1 point, 1000ms = 100 points

            // If no TCP events, give worst score
            if (tcpEvents === 0) {
                score = 100;
            } else {
                // Average of TCP metrics (lower is better)
                score = (retransRate * 0.4) + (lossRate * 0.3) + (srttScore * 0.3);
            }
        } else if (filter === 'cpu') {
            // CPU Scheduling-only ranking: latency and starvation
            const latencyScore = Math.min(100, (cpuSchedLatency / 100)); // 100μs = 1 point, 10000μs = 100 points
            const starvationScore = Math.min(100, cpuStarvation * 10); // 10 starvation events = 100 points
            
            if (cpuEvents === 0) {
                score = 100;
            } else {
                score = (latencyScore * 0.7) + (starvationScore * 0.3);
            }
        } else if (filter === 'disk') {
            // Disk I/O-only ranking: latency
            const latencyScore = Math.min(100, (diskIOLatency / 100)); // 100μs = 1 point, 10000μs = 100 points
            
            if (diskIOOperations === 0) {
                score = 100;
            } else {
                score = latencyScore;
            }
        } else {
            // All metrics: composite score
            const dnsScore = Math.min(100, (dnsLatency / 100));
            const retransRate = tcpEvents > 0 ? (tcpRetrans / tcpEvents) * 100 : 0;
            const lossRate = tcpEvents > 0 ? (tcpLoss / tcpEvents) * 100 : 0;
            const srttScore = Math.min(100, (tcpSRTT / 10000));
            const cpuLatencyScore = Math.min(100, (cpuSchedLatency / 100));
            const cpuStarvationScore = Math.min(100, cpuStarvation * 10);
            const diskLatencyScore = Math.min(100, (diskIOLatency / 100));

            // Weighted average: DNS 25%, TCP 25% (8.33% each), CPU 25% (17.5% latency, 7.5% starvation), Disk 25%
            score = (dnsScore * 0.25) + 
                    (retransRate * 0.0833) + (lossRate * 0.0833) + (srttScore * 0.0833) +
                    (cpuLatencyScore * 0.175) + (cpuStarvationScore * 0.075) +
                    (diskLatencyScore * 0.25);
        }

        return {
            key: podKey,
            name,
            namespace,
            score: score,
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

    // Sort filtered pods by score (lower is better)
    filteredPods.sort((a, b) => a.score - b.score);

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
                    <h3>Top Performers {filter !== 'all' && `(${filter.toUpperCase()})`}</h3>
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
                                        <div className="performer-metric">
                                            <span className="performer-label">Score</span>
                                            <span className="performer-value">{pod.score.toFixed(1)}</span>
                                        </div>
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
                    <h3>Needs Attention {filter !== 'all' && `(${filter.toUpperCase()})`}</h3>
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
                                        <div className="performer-metric">
                                            <span className="performer-label">Score</span>
                                            <span className="performer-value">{pod.score.toFixed(1)}</span>
                                        </div>
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

