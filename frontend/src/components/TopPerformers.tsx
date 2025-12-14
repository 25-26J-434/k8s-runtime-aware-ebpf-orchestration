import { useState } from 'react';
import { useMetrics } from '../hooks/useMetrics';
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
    totalEvents: number;
}

type FilterType = 'all' | 'dns' | 'tcp';

export function TopPerformers() {
    const { metrics } = useMetrics(3000);
    const [filter, setFilter] = useState<FilterType>('all');

    if (!metrics || !metrics.dns.pods) return null;

        // Calculate performance score for each pod based on selected filter
        const pods: PodPerformance[] = Object.keys(metrics.dns.pods).map((podKey) => {
        const [namespace, name] = podKey.split('/');
        const dnsMetrics = metrics.dns.pods[podKey];
        const tcpMetrics = metrics.tcp?.pods?.[podKey];

        // Get metrics (normalize to avoid division by zero)
        const dnsLatency = dnsMetrics?.avg_latency_us || 0;
        const tcpRetrans = tcpMetrics?.retransmissions || 0;
        const tcpLoss = tcpMetrics?.packet_loss || 0;
        const tcpSRTT = tcpMetrics?.last_srtt_us || 0;
        const dnsEvents = dnsMetrics?.total_events || 0;
        const tcpEvents = tcpMetrics?.total_events || 0;
        const totalEvents = dnsEvents + tcpEvents;

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
        } else {
            // All metrics: composite score
            const dnsScore = Math.min(100, (dnsLatency / 100));
            const retransRate = tcpEvents > 0 ? (tcpRetrans / tcpEvents) * 100 : 0;
            const lossRate = tcpEvents > 0 ? (tcpLoss / tcpEvents) * 100 : 0;
            const srttScore = Math.min(100, (tcpSRTT / 10000));

            // Weighted average: DNS 40%, TCP metrics 60% (20% each)
            score = (dnsScore * 0.4) + (retransRate * 0.2) + (lossRate * 0.2) + (srttScore * 0.2);
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
            totalEvents
        };
    });

    // Filter pods based on selected filter
    let filteredPods = pods;
    if (filter === 'dns') {
        filteredPods = pods.filter(p => p.dnsLatency > 0);
    } else if (filter === 'tcp') {
        filteredPods = pods.filter(p => p.tcpSRTT > 0 || p.tcpRetransmissions > 0 || p.tcpPacketLoss > 0);
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
                    DNS Only
                </button>
                <button
                    className={`filter-btn ${filter === 'tcp' ? 'active' : ''}`}
                    onClick={() => setFilter('tcp')}
                >
                    TCP Only
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
                                                <span>DNS: {pod.dnsLatency.toFixed(0)}μs</span>
                                            ) : null}
                                            {filter === 'tcp' || filter === 'all' ? (
                                                <>
                                                    {pod.tcpSRTT > 0 && <span>SRTT: {pod.tcpSRTT.toFixed(1)}ms</span>}
                                                    {pod.tcpRetransmissions > 0 && <span>Retrans: {pod.tcpRetransmissions}</span>}
                                                    {pod.tcpPacketLoss > 0 && <span>Loss: {pod.tcpPacketLoss}</span>}
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
                                                <span>DNS: {pod.dnsLatency.toFixed(0)}μs</span>
                                            ) : null}
                                            {filter === 'tcp' || filter === 'all' ? (
                                                <>
                                                    {pod.tcpSRTT > 0 && <span>SRTT: {pod.tcpSRTT.toFixed(1)}ms</span>}
                                                    {pod.tcpRetransmissions > 0 && <span>Retrans: {pod.tcpRetransmissions}</span>}
                                                    {pod.tcpPacketLoss > 0 && <span>Loss: {pod.tcpPacketLoss}</span>}
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


