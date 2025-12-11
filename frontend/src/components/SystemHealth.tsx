import { useMetrics } from '../hooks/useMetrics';
import './SystemHealth.css';

export function SystemHealth() {
    const { metrics } = useMetrics(3000);

    if (!metrics) return null;

    const getHealthStatus = () => {
        const avgDNS = metrics.dns.avg_latency_us;
        const avgRTT = metrics.rtt.avg_rtt_us;
        
        if (avgDNS < 1000 && avgRTT < 5000) return { status: 'excellent', label: 'Excellent', color: '#10b981' };
        if (avgDNS < 5000 && avgRTT < 20000) return { status: 'good', label: 'Good', color: '#3b82f6' };
        if (avgDNS < 10000 && avgRTT < 50000) return { status: 'warning', label: 'Warning', color: '#f59e0b' };
        return { status: 'critical', label: 'Critical', color: '#ef4444' };
    };

    const health = getHealthStatus();
    const totalEvents = metrics.dns.total_events + metrics.rtt.total_events;
    const eventRate = totalEvents > 0 ? (totalEvents / 60).toFixed(1) : '0';

    return (
        <div className="system-health">
            <div className="health-card">
                <div className="health-header">
                    <h3>System Health</h3>
                    <div className={`health-badge ${health.status}`} style={{ backgroundColor: health.color + '20', borderColor: health.color, color: health.color }}>
                        {health.label}
                    </div>
                </div>
                <div className="health-metrics">
                    <div className="health-metric">
                        <span className="health-label">DNS Latency</span>
                        <span className="health-value" style={{ color: health.color }}>
                            {metrics.dns.avg_latency_us.toFixed(2)} μs
                        </span>
                    </div>
                    <div className="health-metric">
                        <span className="health-label">RTT Latency</span>
                        <span className="health-value" style={{ color: health.color }}>
                            {metrics.rtt.avg_rtt_us.toFixed(2)} μs
                        </span>
                    </div>
                </div>
            </div>

            <div className="health-card">
                <div className="health-header">
                    <h3>Event Rate</h3>
                </div>
                <div className="health-metrics">
                    <div className="health-metric">
                        <span className="health-label">Events/Min</span>
                        <span className="health-value">{eventRate}</span>
                    </div>
                    <div className="health-metric">
                        <span className="health-label">Total Events</span>
                        <span className="health-value">{totalEvents.toLocaleString()}</span>
                    </div>
                </div>
            </div>

            <div className="health-card">
                <div className="health-header">
                    <h3>Active Monitoring</h3>
                </div>
                <div className="health-metrics">
                    <div className="health-metric">
                        <span className="health-label">Pods Monitored</span>
                        <span className="health-value">
                            {metrics.dns.pods ? Object.keys(metrics.dns.pods).length : 0}
                        </span>
                    </div>
                    <div className="health-metric">
                        <span className="health-label">DNS Queries</span>
                        <span className="health-value">{metrics.dns.total_events.toLocaleString()}</span>
                    </div>
                    <div className="health-metric">
                        <span className="health-label">TCP Connections</span>
                        <span className="health-value">{metrics.rtt.total_events.toLocaleString()}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

