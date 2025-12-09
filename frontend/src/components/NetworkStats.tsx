import { useMetrics } from '../hooks/useMetrics';
import './NetworkStats.css';

export function NetworkStats() {
    const { metrics } = useMetrics(3000);

    if (!metrics) return null;

    const calculatePercentile = (values: number[], percentile: number) => {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    };

    const dnsValues = metrics.dns.pods 
        ? Object.values(metrics.dns.pods).map(p => p.avg_latency_us)
        : [];
    
    const rttValues = metrics.rtt.pods
        ? Object.values(metrics.rtt.pods).map(p => p.avg_latency_us)
        : [];

    const dnsP50 = calculatePercentile(dnsValues, 50);
    const dnsP95 = calculatePercentile(dnsValues, 95);
    const dnsP99 = calculatePercentile(dnsValues, 99);
    
    const rttP50 = calculatePercentile(rttValues, 50);
    const rttP95 = calculatePercentile(rttValues, 95);
    const rttP99 = calculatePercentile(rttValues, 99);

    return (
        <div className="network-stats">
            <div className="stats-card">
                <h3>DNS Latency Distribution</h3>
                <div className="stats-grid">
                    <div className="stat-item">
                        <span className="stat-label">P50 (Median)</span>
                        <span className="stat-value">{dnsP50.toFixed(2)} μs</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">P95</span>
                        <span className="stat-value">{dnsP95.toFixed(2)} μs</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">P99</span>
                        <span className="stat-value">{dnsP99.toFixed(2)} μs</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Max</span>
                        <span className="stat-value">{metrics.dns.max_latency_us.toFixed(2)} μs</span>
                    </div>
                </div>
            </div>

            <div className="stats-card">
                <h3>RTT Latency Distribution</h3>
                <div className="stats-grid">
                    <div className="stat-item">
                        <span className="stat-label">P50 (Median)</span>
                        <span className="stat-value">{rttP50.toFixed(2)} μs</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">P95</span>
                        <span className="stat-value">{rttP95.toFixed(2)} μs</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">P99</span>
                        <span className="stat-value">{rttP99.toFixed(2)} μs</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Max</span>
                        <span className="stat-value">{metrics.rtt.max_rtt_us.toFixed(2)} μs</span>
                    </div>
                </div>
            </div>

            <div className="stats-card">
                <h3>Performance Summary</h3>
                <div className="stats-grid">
                    <div className="stat-item">
                        <span className="stat-label">Total DNS Queries</span>
                        <span className="stat-value">{metrics.dns.total_events.toLocaleString()}</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Total TCP Connections</span>
                        <span className="stat-value">{metrics.rtt.total_events.toLocaleString()}</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Avg DNS Latency</span>
                        <span className="stat-value">{metrics.dns.avg_latency_us.toFixed(2)} μs</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Avg RTT Latency</span>
                        <span className="stat-value">{metrics.rtt.avg_rtt_us.toFixed(2)} μs</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

