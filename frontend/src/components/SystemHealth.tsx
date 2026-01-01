import { useMetrics } from '../hooks/useMetrics';
import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { FiSettings, FiInfo } from 'react-icons/fi';
import './SystemHealth.css';

interface HealthThresholds {
    dns: { excellent: number; good: number; warning: number; critical: number };
    tcp_srtt: { excellent: number; good: number; warning: number; critical: number };
    runqueue: { excellent: number; good: number; warning: number; critical: number };
    tcp_retrans_rate: number; // percentage
    tcp_loss_rate: number; // percentage
    tcp_badhs_rate: number; // percentage
    cpu_starvation: { excellent: number; good: number; warning: number; critical: number };
}

const DEFAULT_THRESHOLDS: HealthThresholds = {
    dns: { excellent: 5, good: 10, warning: 50, critical: 50 },
    tcp_srtt: { excellent: 50, good: 100, warning: 500, critical: 500 },
    runqueue: { excellent: 5, good: 10, warning: 50, critical: 50 },
    tcp_retrans_rate: 5.0,
    tcp_loss_rate: 2.0,
    tcp_badhs_rate: 1.0,
    cpu_starvation: { excellent: 0, good: 5, warning: 20, critical: 20 }
};

export function SystemHealth() {
    const { metrics } = useMetrics(3000);
    const [schedMetrics, setSchedMetrics] = useState<any>(null);
    const [showThresholds, setShowThresholds] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [thresholds, setThresholds] = useState<HealthThresholds>(() => {
        const saved = localStorage.getItem('healthThresholds');
        return saved ? JSON.parse(saved) : DEFAULT_THRESHOLDS;
    });
    const [editThresholds, setEditThresholds] = useState<HealthThresholds>(thresholds);

    // Extract CPU scheduling metrics from WebSocket
    useEffect(() => {
        if (metrics && (metrics as any).sched_latency) {
            setSchedMetrics((metrics as any).sched_latency);
        } else if (metrics && metrics.node_system && (metrics.node_system as any).sched_latency) {
            setSchedMetrics((metrics.node_system as any).sched_latency);
        }
    }, [metrics]);

    const handleSaveThresholds = () => {
        setThresholds(editThresholds);
        localStorage.setItem('healthThresholds', JSON.stringify(editThresholds));
        setIsEditing(false);
    };

    const handleCancelEdit = () => {
        setEditThresholds(thresholds);
        setIsEditing(false);
    };

    const handleResetDefaults = () => {
        setEditThresholds(DEFAULT_THRESHOLDS);
    };

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
        // - CPU Scheduling: Run Queue < 10ms, Warning < 50ms, Critical >= 50ms
        // - CPU Starvation: None, Warning > 5, Critical > 20
        
        const hasDNSData = metrics.dns.total_events > 0;
        const hasTCPData = tcpMetrics && tcpMetrics.total_events > 0;
        const hasSchedData = schedMetrics && schedMetrics.node_metrics && schedMetrics.node_metrics.total_events > 0;
        
        // If no data, show as unknown/warning
        if (!hasDNSData && !hasTCPData && !hasSchedData) {
            return { status: 'warning', label: 'No Data', color: '#94a3b8' };
        }
        
        // Evaluate DNS health using custom thresholds
        let dnsHealth = 'excellent';
        if (hasDNSData) {
            if (dnsMs >= thresholds.dns.critical) dnsHealth = 'critical';
            else if (dnsMs >= thresholds.dns.warning) dnsHealth = 'warning';
            else if (dnsMs >= thresholds.dns.good) dnsHealth = 'good';
        }
        
        // Evaluate TCP health based on SRTT and issues using custom thresholds
        let tcpHealth = 'excellent';
        if (hasTCPData) {
            // Check SRTT
            if (srttMs >= thresholds.tcp_srtt.critical) tcpHealth = 'critical';
            else if (srttMs >= thresholds.tcp_srtt.warning) tcpHealth = 'warning';
            else if (srttMs >= thresholds.tcp_srtt.good) tcpHealth = 'good';
            
            // Check for TCP issues (retransmissions, packet loss, bad handshakes)
            const retransRate = (tcpMetrics.retransmissions / Math.max(tcpMetrics.total_events, 1)) * 100;
            const lossRate = (tcpMetrics.packet_loss / Math.max(tcpMetrics.total_events, 1)) * 100;
            const badHSRate = (tcpMetrics.bad_handshakes / Math.max(tcpMetrics.total_events, 1)) * 100;
            
            // Apply custom thresholds
            if (retransRate > thresholds.tcp_retrans_rate) tcpHealth = 'critical';
            else if (retransRate > thresholds.tcp_retrans_rate / 5 && tcpHealth !== 'critical') tcpHealth = 'warning';
            
            if (lossRate > thresholds.tcp_loss_rate) tcpHealth = 'critical';
            else if (lossRate > thresholds.tcp_loss_rate / 4 && tcpHealth !== 'critical') tcpHealth = 'warning';
            
            if (badHSRate > thresholds.tcp_badhs_rate) tcpHealth = 'critical';
            else if (badHSRate > thresholds.tcp_badhs_rate / 5 && tcpHealth !== 'critical') tcpHealth = 'warning';
        }
        
        // Evaluate CPU Scheduling health using custom thresholds
        let schedHealth = 'excellent';
        if (hasSchedData) {
            const runQueueMs = (schedMetrics.node_metrics.avg_runqueue_latency_us || 0) / 1000; // Convert us to ms
            const starvationCount = schedMetrics.node_metrics.cpu_starvation_count || 0;
            
            // Check run queue latency
            if (runQueueMs >= thresholds.runqueue.critical) schedHealth = 'critical';
            else if (runQueueMs >= thresholds.runqueue.warning) schedHealth = 'warning';
            else if (runQueueMs >= thresholds.runqueue.good) schedHealth = 'good';
            
            // Check CPU starvation count
            if (starvationCount > thresholds.cpu_starvation.critical) schedHealth = 'critical';
            else if (starvationCount > thresholds.cpu_starvation.warning && schedHealth !== 'critical') schedHealth = 'warning';
        }
        
        // Overall health is worst of DNS, TCP, and CPU Scheduling
        // Priority: critical > warning > good > excellent
        if (dnsHealth === 'critical' || tcpHealth === 'critical' || schedHealth === 'critical') {
            return { status: 'critical', label: 'Critical', color: '#ef4444' };
        }
        if (dnsHealth === 'warning' || tcpHealth === 'warning' || schedHealth === 'warning') {
            return { status: 'warning', label: 'Warning', color: '#f59e0b' };
        }
        if (dnsHealth === 'good' || tcpHealth === 'good' || schedHealth === 'good') {
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <button 
                            onClick={() => setShowThresholds(!showThresholds)}
                            className="threshold-toggle-btn"
                            title="View/Edit health thresholds"
                        >
                            <FiInfo size={16} />
                        </button>
                        <button 
                            onClick={() => setIsEditing(!isEditing)}
                            className="threshold-toggle-btn"
                            title="Edit thresholds"
                            style={{ 
                                backgroundColor: isEditing ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.15)',
                                borderColor: isEditing ? 'rgba(59, 130, 246, 0.6)' : 'rgba(59, 130, 246, 0.3)'
                            }}
                        >
                            <FiSettings size={16} />
                        </button>
                        <div className={`health-badge ${health.status}`} style={{ backgroundColor: health.color + '20', borderColor: health.color, color: health.color }}>
                            {health.label}
                        </div>
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
                    {schedMetrics && schedMetrics.node_metrics && schedMetrics.node_metrics.total_events > 0 && (
                        <>
                            <div className="health-metric">
                                <span className="health-label">Run Queue Latency</span>
                                <span className="health-value">
                                    {(() => {
                                        const runQueueMs = (schedMetrics.node_metrics.avg_runqueue_latency_us || 0) / 1000;
                                        const schedStatus = runQueueMs >= 50 ? 'critical' : runQueueMs >= 10 ? 'warning' : runQueueMs >= 5 ? 'good' : 'excellent';
                                        const statusColors = {
                                            excellent: '#10b981',
                                            good: '#3b82f6',
                                            warning: '#f59e0b',
                                            critical: '#ef4444'
                                        };
                                        return (
                                            <span style={{ color: statusColors[schedStatus] }}>
                                                {runQueueMs.toFixed(2)} ms
                                            </span>
                                        );
                                    })()}
                                </span>
                            </div>
                            <div className="health-metric">
                                <span className="health-label">CPU Starvation</span>
                                <span className="health-value">
                                    {(() => {
                                        const starvation = schedMetrics.node_metrics.cpu_starvation_count || 0;
                                        const starvationColor = starvation === 0 ? '#10b981' : starvation > 20 ? '#ef4444' : starvation > 5 ? '#f59e0b' : '#3b82f6';
                                        return (
                                            <span style={{ color: starvationColor }}>
                                                {starvation} events
                                            </span>
                                        );
                                    })()}
                                </span>
                            </div>
                        </>
                    )}
                </div>

                {/* Collapsible Threshold Info */}
                {(showThresholds || isEditing) && (
                    <div className="threshold-info-panel">
                        <div className="threshold-info-header">
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                {isEditing ? 'Edit Health Criteria' : 'Health Criteria'}
                            </span>
                            {isEditing && (
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button onClick={handleResetDefaults} className="threshold-action-btn threshold-reset-btn">
                                        Reset
                                    </button>
                                    <button onClick={handleCancelEdit} className="threshold-action-btn threshold-cancel-btn">
                                        Cancel
                                    </button>
                                    <button onClick={handleSaveThresholds} className="threshold-action-btn threshold-save-btn">
                                        Save
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="threshold-info-grid">
                            {/* DNS Latency Thresholds */}
                            <div className="threshold-info-section">
                                <div className="threshold-info-title">DNS Latency (ms)</div>
                                <div className="threshold-info-items">
                                    {isEditing ? (
                                        <>
                                            <div className="threshold-edit-item">
                                                <span className="threshold-dot" style={{ backgroundColor: '#10b981' }}></span>
                                                <span className="threshold-info-label">Excellent &lt;</span>
                                                <input 
                                                    type="number" 
                                                    className="threshold-input"
                                                    value={editThresholds.dns.excellent}
                                                    onChange={(e) => setEditThresholds({...editThresholds, dns: {...editThresholds.dns, excellent: parseFloat(e.target.value)}})}
                                                />
                                            </div>
                                            <div className="threshold-edit-item">
                                                <span className="threshold-dot" style={{ backgroundColor: '#3b82f6' }}></span>
                                                <span className="threshold-info-label">Good &lt;</span>
                                                <input 
                                                    type="number" 
                                                    className="threshold-input"
                                                    value={editThresholds.dns.good}
                                                    onChange={(e) => setEditThresholds({...editThresholds, dns: {...editThresholds.dns, good: parseFloat(e.target.value)}})}
                                                />
                                            </div>
                                            <div className="threshold-edit-item">
                                                <span className="threshold-dot" style={{ backgroundColor: '#f59e0b' }}></span>
                                                <span className="threshold-info-label">Warning &lt;</span>
                                                <input 
                                                    type="number" 
                                                    className="threshold-input"
                                                    value={editThresholds.dns.warning}
                                                    onChange={(e) => setEditThresholds({...editThresholds, dns: {...editThresholds.dns, warning: parseFloat(e.target.value)}})}
                                                />
                                            </div>
                                            <div className="threshold-edit-item">
                                                <span className="threshold-dot" style={{ backgroundColor: '#ef4444' }}></span>
                                                <span className="threshold-info-label">Critical ≥</span>
                                                <input 
                                                    type="number" 
                                                    className="threshold-input"
                                                    value={editThresholds.dns.critical}
                                                    onChange={(e) => setEditThresholds({...editThresholds, dns: {...editThresholds.dns, critical: parseFloat(e.target.value)}})}
                                                />
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="threshold-info-item">
                                                <span className="threshold-dot" style={{ backgroundColor: '#10b981' }}></span>
                                                <span className="threshold-info-label">Excellent:</span>
                                                <span className="threshold-info-value">&lt; {thresholds.dns.excellent}ms</span>
                                            </div>
                                            <div className="threshold-info-item">
                                                <span className="threshold-dot" style={{ backgroundColor: '#3b82f6' }}></span>
                                                <span className="threshold-info-label">Good:</span>
                                                <span className="threshold-info-value">{thresholds.dns.excellent}-{thresholds.dns.good}ms</span>
                                            </div>
                                            <div className="threshold-info-item">
                                                <span className="threshold-dot" style={{ backgroundColor: '#f59e0b' }}></span>
                                                <span className="threshold-info-label">Warning:</span>
                                                <span className="threshold-info-value">{thresholds.dns.good}-{thresholds.dns.warning}ms</span>
                                            </div>
                                            <div className="threshold-info-item">
                                                <span className="threshold-dot" style={{ backgroundColor: '#ef4444' }}></span>
                                                <span className="threshold-info-label">Critical:</span>
                                                <span className="threshold-info-value">≥ {thresholds.dns.critical}ms</span>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* TCP SRTT Thresholds */}
                            {metrics.tcp && metrics.tcp.total_events > 0 && (
                                <div className="threshold-info-section">
                                    <div className="threshold-info-title">TCP SRTT</div>
                                    <div className="threshold-info-items">
                                        <div className="threshold-info-item">
                                            <span className="threshold-dot" style={{ backgroundColor: '#10b981' }}></span>
                                            <span className="threshold-info-label">Excellent:</span>
                                            <span className="threshold-info-value">&lt; 50ms</span>
                                        </div>
                                        <div className="threshold-info-item">
                                            <span className="threshold-dot" style={{ backgroundColor: '#3b82f6' }}></span>
                                            <span className="threshold-info-label">Good:</span>
                                            <span className="threshold-info-value">50-100ms</span>
                                        </div>
                                        <div className="threshold-info-item">
                                            <span className="threshold-dot" style={{ backgroundColor: '#f59e0b' }}></span>
                                            <span className="threshold-info-label">Warning:</span>
                                            <span className="threshold-info-value">100-500ms</span>
                                        </div>
                                        <div className="threshold-info-item">
                                            <span className="threshold-dot" style={{ backgroundColor: '#ef4444' }}></span>
                                            <span className="threshold-info-label">Critical:</span>
                                            <span className="threshold-info-value">≥ 500ms</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* CPU Scheduling Thresholds */}
                            {schedMetrics && schedMetrics.node_metrics && schedMetrics.node_metrics.total_events > 0 && (
                                <div className="threshold-info-section">
                                    <div className="threshold-info-title">Run Queue Latency</div>
                                    <div className="threshold-info-items">
                                        <div className="threshold-info-item">
                                            <span className="threshold-dot" style={{ backgroundColor: '#10b981' }}></span>
                                            <span className="threshold-info-label">Excellent:</span>
                                            <span className="threshold-info-value">&lt; 5ms</span>
                                        </div>
                                        <div className="threshold-info-item">
                                            <span className="threshold-dot" style={{ backgroundColor: '#3b82f6' }}></span>
                                            <span className="threshold-info-label">Good:</span>
                                            <span className="threshold-info-value">5-10ms</span>
                                        </div>
                                        <div className="threshold-info-item">
                                            <span className="threshold-dot" style={{ backgroundColor: '#f59e0b' }}></span>
                                            <span className="threshold-info-label">Warning:</span>
                                            <span className="threshold-info-value">10-50ms</span>
                                        </div>
                                        <div className="threshold-info-item">
                                            <span className="threshold-dot" style={{ backgroundColor: '#ef4444' }}></span>
                                            <span className="threshold-info-label">Critical:</span>
                                            <span className="threshold-info-value">≥ 50ms</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* TCP Issues Thresholds */}
                            {metrics.tcp && metrics.tcp.total_events > 0 && (
                                <div className="threshold-info-section">
                                    <div className="threshold-info-title">TCP Issues</div>
                                    <div className="threshold-info-items">
                                        <div className="threshold-info-item">
                                            <span className="threshold-info-label">Retrans Rate:</span>
                                            <span className="threshold-info-value">&gt; 5% = Critical</span>
                                        </div>
                                        <div className="threshold-info-item">
                                            <span className="threshold-info-label">Packet Loss:</span>
                                            <span className="threshold-info-value">&gt; 2% = Critical</span>
                                        </div>
                                        <div className="threshold-info-item">
                                            <span className="threshold-info-label">Bad Handshakes:</span>
                                            <span className="threshold-info-value">&gt; 1% = Critical</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* CPU Starvation Thresholds */}
                            {schedMetrics && schedMetrics.node_metrics && schedMetrics.node_metrics.total_events > 0 && (
                                <div className="threshold-info-section">
                                    <div className="threshold-info-title">CPU Starvation</div>
                                    <div className="threshold-info-items">
                                        <div className="threshold-info-item">
                                            <span className="threshold-dot" style={{ backgroundColor: '#10b981' }}></span>
                                            <span className="threshold-info-label">Excellent:</span>
                                            <span className="threshold-info-value">0 events</span>
                                        </div>
                                        <div className="threshold-info-item">
                                            <span className="threshold-dot" style={{ backgroundColor: '#3b82f6' }}></span>
                                            <span className="threshold-info-label">Good:</span>
                                            <span className="threshold-info-value">1-5 events</span>
                                        </div>
                                        <div className="threshold-info-item">
                                            <span className="threshold-dot" style={{ backgroundColor: '#f59e0b' }}></span>
                                            <span className="threshold-info-label">Warning:</span>
                                            <span className="threshold-info-value">6-20 events</span>
                                        </div>
                                        <div className="threshold-info-item">
                                            <span className="threshold-dot" style={{ backgroundColor: '#ef4444' }}></span>
                                            <span className="threshold-info-label">Critical:</span>
                                            <span className="threshold-info-value">&gt; 20 events</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="threshold-info-note">
                            <FiInfo size={12} style={{ marginRight: '0.25rem' }} />
                            Overall health is determined by the worst metric status
                        </div>
                    </div>
                )}
            </div>

            <div className="health-card">
                <div className="health-header">
                    <h3>Event Rate</h3>
                    <span style={{ fontSize: '0.7rem', color: '#71717a' }}>Real-time</span>
                </div>
                <div className="health-metrics">
                    <div className="health-metric">
                        <span className="health-label">Events/Min</span>
                        <span className="health-value" style={{ color: '#3b82f6' }}>{eventRate}</span>
                    </div>
                    <div className="health-metric">
                        <span className="health-label">Total Events</span>
                        <span className="health-value">{totalEvents.toLocaleString()}</span>
                    </div>
                    <div className="health-metric">
                        <span className="health-label">DNS Events</span>
                        <span className="health-value" style={{ fontSize: '0.95rem' }}>{metrics.dns.total_events.toLocaleString()}</span>
                    </div>
                    {metrics.tcp && (
                        <div className="health-metric">
                            <span className="health-label">TCP Events</span>
                            <span className="health-value" style={{ fontSize: '0.95rem' }}>{metrics.tcp.total_events.toLocaleString()}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Node System Resources */}
            {metrics.node_system && (
                <div className="health-card">
                    <div className="health-header">
                        <h3>System Resources</h3>
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
                                       metrics.node_system.memory_usage_percent > 60 ? '#f59e0b' : '#10b981',
                                fontSize: '0.95rem'
                            }}>
                                {metrics.node_system.memory_usage_percent.toFixed(1)}%
                            </span>
                        </div>
                        <div className="health-metric">
                            <span className="health-label">Memory</span>
                            <span className="health-value" style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                                {metrics.node_system.memory_used_mb.toLocaleString()} / {metrics.node_system.memory_total_mb.toLocaleString()} MB
                            </span>
                        </div>
                        <div className="health-metric">
                            <span className="health-label">Load Avg (1m/5m/15m)</span>
                            <span className="health-value" style={{ fontSize: '0.85rem' }}>
                                {metrics.node_system.load_avg_1min.toFixed(2)} / {metrics.node_system.load_avg_5min.toFixed(2)} / {metrics.node_system.load_avg_15min.toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            <div className="health-card">
                <div className="health-header">
                    <h3>Network Issues</h3>
                </div>
                <div className="health-metrics">
                    {metrics.tcp && (
                        <>
                            <div className="health-metric">
                                <span className="health-label">Retransmissions</span>
                                <span className="health-value" style={{ 
                                    color: (metrics.tcp.retransmissions || 0) > 10 ? '#ef4444' : 
                                           (metrics.tcp.retransmissions || 0) > 0 ? '#f59e0b' : '#10b981',
                                    fontSize: '1.3rem'
                                }}>
                                    {metrics.tcp.retransmissions.toLocaleString()}
                                </span>
                            </div>
                            <div className="health-metric">
                                <span className="health-label">Packet Loss</span>
                                <span className="health-value" style={{ 
                                    color: (metrics.tcp.packet_loss || 0) > 5 ? '#ef4444' : 
                                           (metrics.tcp.packet_loss || 0) > 0 ? '#f59e0b' : '#10b981',
                                    fontSize: '1.3rem'
                                }}>
                                    {metrics.tcp.packet_loss.toLocaleString()}
                                </span>
                            </div>
                            <div className="health-metric">
                                <span className="health-label">Bad Handshakes</span>
                                <span className="health-value" style={{ 
                                    color: (metrics.tcp.bad_handshakes || 0) > 5 ? '#ef4444' : 
                                           (metrics.tcp.bad_handshakes || 0) > 0 ? '#f59e0b' : '#10b981',
                                    fontSize: '1.3rem'
                                }}>
                                    {metrics.tcp.bad_handshakes.toLocaleString()}
                                </span>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* CPU Scheduling Health Card */}
            {schedMetrics && schedMetrics.node_metrics && schedMetrics.node_metrics.total_events > 0 && (
                <div className="health-card">
                    <div className="health-header">
                        <h3>CPU Scheduling</h3>
                        <p style={{ fontSize: '0.75rem', color: '#71717a', marginTop: '0.25rem' }}>
                            Run queue latency and CPU starvation metrics
                        </p>
                    </div>
                    <div className="health-metrics">
                        <div className="health-metric">
                            <span className="health-label">Avg Run Queue Latency</span>
                            <span className="health-value" style={{ 
                                color: ((schedMetrics.node_metrics.avg_runqueue_latency_us || 0) / 1000) >= 50 ? '#ef4444' : 
                                       ((schedMetrics.node_metrics.avg_runqueue_latency_us || 0) / 1000) >= 10 ? '#f59e0b' : '#10b981' 
                            }}>
                                {((schedMetrics.node_metrics.avg_runqueue_latency_us || 0) / 1000).toFixed(2)} ms
                            </span>
                        </div>
                        <div className="health-metric">
                            <span className="health-label">Max Run Queue Latency</span>
                            <span className="health-value" style={{ 
                                color: ((schedMetrics.node_metrics.max_runqueue_latency_us || 0) / 1000) >= 100 ? '#ef4444' : 
                                       ((schedMetrics.node_metrics.max_runqueue_latency_us || 0) / 1000) >= 50 ? '#f59e0b' : '#cbd5e1' 
                            }}>
                                {((schedMetrics.node_metrics.max_runqueue_latency_us || 0) / 1000).toFixed(2)} ms
                            </span>
                        </div>
                        <div className="health-metric">
                            <span className="health-label">P95 Run Queue Latency</span>
                            <span className="health-value">
                                {((schedMetrics.node_metrics.p95_runqueue_latency_us || 0) / 1000).toFixed(2)} ms
                            </span>
                        </div>
                        <div className="health-metric">
                            <span className="health-label">P99 Run Queue Latency</span>
                            <span className="health-value">
                                {((schedMetrics.node_metrics.p99_runqueue_latency_us || 0) / 1000).toFixed(2)} ms
                            </span>
                        </div>
                        <div className="health-metric">
                            <span className="health-label">CPU Starvation Events</span>
                            <span className="health-value" style={{ 
                                color: (schedMetrics.node_metrics.cpu_starvation_count || 0) === 0 ? '#10b981' : 
                                       (schedMetrics.node_metrics.cpu_starvation_count || 0) > 20 ? '#ef4444' : 
                                       (schedMetrics.node_metrics.cpu_starvation_count || 0) > 5 ? '#f59e0b' : '#3b82f6' 
                            }}>
                                {(schedMetrics.node_metrics.cpu_starvation_count || 0).toLocaleString()}
                            </span>
                        </div>
                        <div className="health-metric">
                            <span className="health-label">Total Scheduling Events</span>
                            <span className="health-value">
                                {(schedMetrics.node_metrics.total_events || 0).toLocaleString()}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

