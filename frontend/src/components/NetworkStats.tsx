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

    // Calculate DNS latency percentiles
    // P50 (Median): 50% of values are below this, 50% are above
    // P95: 95% of values are below this, 5% are above (worst-case performance)
    // P99: 99% of values are below this, 1% are above (extreme worst-case)
    const dnsP50 = calculatePercentile(dnsValues, 50);
    const dnsP95 = calculatePercentile(dnsValues, 95);
    const dnsP99 = calculatePercentile(dnsValues, 99);

    return (
        <div className="network-stats">
            <div className="stats-card">
                <h3>DNS Latency Distribution</h3>
                <div className="stats-grid">
                    <div className="stat-item">
                        <span className="stat-label">Typical Response Time</span>
                        <span className="stat-value">{dnsP50.toFixed(2)} μs</span>
                        <span className="stat-sublabel">50% of requests are faster</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Worst Case (95%)</span>
                        <span className="stat-value">{dnsP95.toFixed(2)} μs</span>
                        <span className="stat-sublabel">95% of requests are faster</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Extreme Cases (99%)</span>
                        <span className="stat-value">{dnsP99.toFixed(2)} μs</span>
                        <span className="stat-sublabel">99% of requests are faster</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Slowest Request</span>
                        <span className="stat-value">{metrics.dns.max_latency_us.toFixed(2)} μs</span>
                        <span className="stat-sublabel">Maximum observed latency</span>
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
                        <span className="stat-label">Avg DNS Latency</span>
                        <span className="stat-value">{metrics.dns.avg_latency_us.toFixed(2)} μs</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Min DNS Latency</span>
                        <span className="stat-value">{metrics.dns.min_latency_us.toFixed(2)} μs</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-label">Max DNS Latency</span>
                        <span className="stat-value">{metrics.dns.max_latency_us.toFixed(2)} μs</span>
                    </div>
                </div>
            </div>
        </div>
    );
}


