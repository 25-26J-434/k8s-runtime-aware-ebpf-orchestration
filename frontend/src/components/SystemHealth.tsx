import { useMetrics } from '../hooks/useMetrics';
import './SystemHealth.css';

export function SystemHealth() {
    const { metrics } = useMetrics(3000);

    if (!metrics) return null;

    const getHealthStatus = () => {
        const avgDNS = metrics.dns.avg_latency_us;
        const tcpMetrics = metrics.tcp;
        
        // Convert to milliseconds for easier threshold checking
        const dnsMs = avgDNS / 1000;
        const srttMs = tcpMetrics ? (tcpMetrics.last_srtt_us / 1000) : 0;
        
        // Health thresholds (in milliseconds):
        // - DNS: Normal < 10ms, Warning < 50ms, Critical >= 50ms
        // - TCP SRTT: Normal < 100ms, Warning < 500ms, Critical >= 500ms
        // - TCP Issues: Retransmissions, Packet Loss, Bad Handshakes
        
        const hasDNSData = metrics.dns.total_events > 0;
        const hasTCPData = tcpMetrics && tcpMetrics.total_events > 0;
        
        // If no data, show as unknown/warning
        if (!hasDNSData && !hasTCPData) {
            return { status: 'warning', label: 'No Data', color: '#94a3b8' };
        }
        
        // Evaluate DNS health
        let dnsHealth = 'excellent';
        if (hasDNSData) {
            if (dnsMs >= 50) dnsHealth = 'critical';
            else if (dnsMs >= 10) dnsHealth = 'warning';
            else if (dnsMs >= 5) dnsHealth = 'good';
        }
        
        // Evaluate TCP health based on SRTT and issues
        let tcpHealth = 'excellent';
        if (hasTCPData) {
            // Check SRTT
            if (srttMs >= 500) tcpHealth = 'critical';
            else if (srttMs >= 100) tcpHealth = 'warning';
            else if (srttMs >= 50) tcpHealth = 'good';
            
            // Check for TCP issues (retransmissions, packet loss, bad handshakes)
            const retransRate = tcpMetrics.retransmissions / Math.max(tcpMetrics.total_events, 1);
            const lossRate = tcpMetrics.packet_loss / Math.max(tcpMetrics.total_events, 1);
            const badHSRate = tcpMetrics.bad_handshakes / Math.max(tcpMetrics.total_events, 1);
            
            // If retransmission rate > 5%, it's critical
            if (retransRate > 0.05) tcpHealth = 'critical';
            // If retransmission rate > 1%, it's warning
            else if (retransRate > 0.01 && tcpHealth !== 'critical') tcpHealth = 'warning';
            
            // If packet loss rate > 2%, it's critical
            if (lossRate > 0.02) tcpHealth = 'critical';
            // If packet loss rate > 0.5%, it's warning
            else if (lossRate > 0.005 && tcpHealth !== 'critical') tcpHealth = 'warning';
            
            // If bad handshake rate > 1%, it's critical
            if (badHSRate > 0.01) tcpHealth = 'critical';
            // If bad handshake rate > 0.2%, it's warning
            else if (badHSRate > 0.002 && tcpHealth !== 'critical') tcpHealth = 'warning';
        }
        
        // Overall health is worst of DNS and TCP
        // Priority: critical > warning > good > excellent
        if (dnsHealth === 'critical' || tcpHealth === 'critical') {
            return { status: 'critical', label: 'Critical', color: '#ef4444' };
        }
        if (dnsHealth === 'warning' || tcpHealth === 'warning') {
            return { status: 'warning', label: 'Warning', color: '#f59e0b' };
        }
        if (dnsHealth === 'good' || tcpHealth === 'good') {
            return { status: 'good', label: 'Good', color: '#3b82f6' };
        }
        
        return { status: 'excellent', label: 'Excellent', color: '#10b981' };
    };

    const health = getHealthStatus();
    const tcpEvents = metrics.tcp ? metrics.tcp.total_events : 0;
    const totalEvents = metrics.dns.total_events + tcpEvents;
    const eventRate = totalEvents > 0 ? (totalEvents / 60).toFixed(1) : '0';

    const nodeName = metrics.node_name || 'Current Node';
    const nodePodsCount = metrics.dns.pods ? Object.keys(metrics.dns.pods).length : 0;

    return (
        <div className="system-health">
            <div className="health-card">
                <div className="health-header">
                    <div>
                        <h3>Node Health</h3>
                        <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                            {nodeName} • {nodePodsCount} Pod{nodePodsCount !== 1 ? 's' : ''} on this node
                        </p>
                    </div>
                    <div className={`health-badge ${health.status}`} style={{ backgroundColor: health.color + '20', borderColor: health.color, color: health.color }}>
                        {health.label}
                    </div>
                </div>
                <div className="health-metrics">
                    <div className="health-metric">
                        <span className="health-label">DNS Latency</span>
                        <span className="health-value" style={{ color: health.color }}>
                            {(() => {
                                const dnsMs = metrics.dns.avg_latency_us / 1000;
                                const dnsStatus = dnsMs >= 50 ? 'critical' : dnsMs >= 10 ? 'warning' : dnsMs >= 5 ? 'good' : 'excellent';
                                const statusColors = {
                                    excellent: '#10b981',
                                    good: '#3b82f6',
                                    warning: '#f59e0b',
                                    critical: '#ef4444'
                                };
                                return (
                                    <span style={{ color: statusColors[dnsStatus] }}>
                                        {metrics.dns.avg_latency_us.toFixed(2)} μs ({dnsMs.toFixed(2)} ms)
                                    </span>
                                );
                            })()}
                        </span>
                    </div>
                    {metrics.tcp && metrics.tcp.total_events > 0 && (
                        <>
                            <div className="health-metric">
                                <span className="health-label">TCP SRTT</span>
                                <span className="health-value" style={{ color: health.color }}>
                                    {(() => {
                                        const srttMs = metrics.tcp.last_srtt_us / 1000;
                                        const srttStatus = srttMs >= 500 ? 'critical' : srttMs >= 100 ? 'warning' : srttMs >= 50 ? 'good' : 'excellent';
                                        const statusColors = {
                                            excellent: '#10b981',
                                            good: '#3b82f6',
                                            warning: '#f59e0b',
                                            critical: '#ef4444'
                                        };
                                        return (
                                            <span style={{ color: statusColors[srttStatus] }}>
                                                {metrics.tcp.last_srtt_us.toFixed(2)} μs ({srttMs.toFixed(2)} ms)
                                            </span>
                                        );
                                    })()}
                                </span>
                            </div>
                            <div className="health-metric">
                                <span className="health-label">TCP Issues</span>
                                <span className="health-value" style={{ color: health.color }}>
                                    {(() => {
                                        const retrans = metrics.tcp.retransmissions || 0;
                                        const loss = metrics.tcp.packet_loss || 0;
                                        const badHS = metrics.tcp.bad_handshakes || 0;
                                        const totalIssues = retrans + loss + badHS;
                                        const issueColor = totalIssues === 0 ? '#10b981' : totalIssues > 10 ? '#ef4444' : '#f59e0b';
                                        return (
                                            <span style={{ color: issueColor }}>
                                                Retrans: {retrans} | Loss: {loss} | Bad HS: {badHS}
                                            </span>
                                        );
                                    })()}
                                </span>
                            </div>
                        </>
                    )}
                </div>
                
                {/* Health Thresholds Info */}
                <div className="health-thresholds">
                    <div className="thresholds-header">
                        <span className="thresholds-title">Health Thresholds</span>
                    </div>
                    <div className="thresholds-grid">
                        <div className="threshold-section">
                            <div className="threshold-label">DNS Latency</div>
                            <div className="threshold-item excellent">
                                <span className="threshold-status">Excellent</span>
                                <span className="threshold-range">&lt; 5ms</span>
                            </div>
                            <div className="threshold-item good">
                                <span className="threshold-status">Good</span>
                                <span className="threshold-range">5-10ms</span>
                            </div>
                            <div className="threshold-item warning">
                                <span className="threshold-status">Warning</span>
                                <span className="threshold-range">10-50ms</span>
                            </div>
                            <div className="threshold-item critical">
                                <span className="threshold-status">Critical</span>
                                <span className="threshold-range">≥ 50ms</span>
                            </div>
                        </div>
                        {metrics.tcp && metrics.tcp.total_events > 0 && (
                            <div className="threshold-section">
                                <div className="threshold-label">TCP SRTT</div>
                                <div className="threshold-item excellent">
                                    <span className="threshold-status">Excellent</span>
                                    <span className="threshold-range">&lt; 50ms</span>
                                </div>
                                <div className="threshold-item good">
                                    <span className="threshold-status">Good</span>
                                    <span className="threshold-range">50-100ms</span>
                                </div>
                                <div className="threshold-item warning">
                                    <span className="threshold-status">Warning</span>
                                    <span className="threshold-range">100-500ms</span>
                                </div>
                                <div className="threshold-item critical">
                                    <span className="threshold-status">Critical</span>
                                    <span className="threshold-range">≥ 500ms</span>
                                </div>
                            </div>
                        )}
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

            {/* Node System Resources */}
            {metrics.node_system && (
                <div className="health-card">
                    <div className="health-header">
                        <h3>Node System Resources</h3>
                    </div>
                    <div className="health-metrics">
                        <div className="health-metric">
                            <span className="health-label">CPU Usage</span>
                            <span className="health-value" style={{ 
                                color: metrics.node_system.cpu_usage_percent > 80 ? '#ef4444' : 
                                       metrics.node_system.cpu_usage_percent > 60 ? '#f59e0b' : '#10b981' 
                            }}>
                                {metrics.node_system.cpu_usage_percent.toFixed(1)}%
                            </span>
                        </div>
                        <div className="health-metric">
                            <span className="health-label">Memory Usage</span>
                            <span className="health-value" style={{ 
                                color: metrics.node_system.memory_usage_percent > 80 ? '#ef4444' : 
                                       metrics.node_system.memory_usage_percent > 60 ? '#f59e0b' : '#10b981' 
                            }}>
                                {metrics.node_system.memory_usage_percent.toFixed(1)}% 
                                <span style={{ fontSize: '0.85rem', color: '#94a3b8', marginLeft: '0.5rem' }}>
                                    ({metrics.node_system.memory_used_mb.toLocaleString()} MB / {metrics.node_system.memory_total_mb.toLocaleString()} MB)
                                </span>
                            </span>
                        </div>
                        <div className="health-metric">
                            <span className="health-label">Load Average</span>
                            <span className="health-value">
                                1m: {metrics.node_system.load_avg_1min.toFixed(2)} | 
                                5m: {metrics.node_system.load_avg_5min.toFixed(2)} | 
                                15m: {metrics.node_system.load_avg_15min.toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            <div className="health-card">
                <div className="health-header">
                    <h3>Node Monitoring</h3>
                    <p style={{ fontSize: '0.75rem', color: '#71717a', marginTop: '0.25rem' }}>
                        Metrics for {nodeName} and its {nodePodsCount} pod{nodePodsCount !== 1 ? 's' : ''}
                    </p>
                </div>
                <div className="health-metrics">
                    <div className="health-metric">
                        <span className="health-label">Pods on Node</span>
                        <span className="health-value">
                            {nodePodsCount}
                        </span>
                    </div>
                    <div className="health-metric">
                        <span className="health-label">DNS Queries (Node + Pods)</span>
                        <span className="health-value">{metrics.dns.total_events.toLocaleString()}</span>
                    </div>
                    {metrics.tcp && (
                        <>
                            <div className="health-metric">
                                <span className="health-label">TCP Events</span>
                                <span className="health-value">{metrics.tcp.total_events.toLocaleString()}</span>
                            </div>
                            <div className="health-metric">
                                <span className="health-label">Retransmissions</span>
                                <span className="health-value" style={{ color: (metrics.tcp.retransmissions || 0) > 10 ? '#ef4444' : (metrics.tcp.retransmissions || 0) > 0 ? '#f59e0b' : '#10b981' }}>
                                    {metrics.tcp.retransmissions.toLocaleString()}
                                </span>
                            </div>
                            <div className="health-metric">
                                <span className="health-label">Packet Loss</span>
                                <span className="health-value" style={{ color: (metrics.tcp.packet_loss || 0) > 5 ? '#ef4444' : (metrics.tcp.packet_loss || 0) > 0 ? '#f59e0b' : '#10b981' }}>
                                    {metrics.tcp.packet_loss.toLocaleString()}
                                </span>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

