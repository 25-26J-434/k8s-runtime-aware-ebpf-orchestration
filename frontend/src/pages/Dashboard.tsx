import { useState, useEffect, useRef } from 'react';
import { useMetrics } from '../hooks/useMetrics';
import { useClusterInfo } from '../hooks/useClusterInfo';
import { DNSLatencyChart } from '../components/DNSLatencyChart';
import { TCPMetricsChart } from '../components/TCPMetricsChart';
import { SystemResourcesChart } from '../components/SystemResourcesChart';
import { TCPIssuesChart } from '../components/TCPIssuesChart';
import { PacketDistributionChart } from '../components/PacketDistributionChart';
import { SystemHealth } from '../components/SystemHealth';
import { TopPerformers } from '../components/TopPerformers';
import { NetworkStats } from '../components/NetworkStats';
import { 
    FiBarChart2, 
    FiActivity, 
    FiZap, 
    FiGlobe, 
    FiServer, 
    FiRadio, 
    FiPackage, 
    FiCpu, 
    FiDownload, 
    FiSettings, 
    FiRefreshCw 
} from 'react-icons/fi';
import '../App.css';

export function Dashboard() {
    const { metrics, loading, error } = useMetrics(3000);
    const clusterInfo = useClusterInfo(5000);
    const [activeSection, setActiveSection] = useState<string>('overview');
    const sectionRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

    // Scroll to section
    const scrollToSection = (sectionId: string) => {
        const element = sectionRefs.current[sectionId];
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setActiveSection(sectionId);
        }
    };

    // Track active section on scroll
    useEffect(() => {
        const handleScroll = () => {
            const sections = Object.keys(sectionRefs.current);
            const scrollPosition = window.scrollY + 150;

            for (let i = sections.length - 1; i >= 0; i--) {
                const section = sectionRefs.current[sections[i]];
                if (section && section.offsetTop <= scrollPosition) {
                    setActiveSection(sections[i]);
                    break;
                }
            }
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, [metrics]);

    if (loading && !metrics) {
        return (
            <div className="loading-container">
                <div className="loading-spinner"></div>
                <p>Loading eBPF Telemetry Dashboard...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="error-container">
                <h2>Connection Error</h2>
                <p>{error.message}</p>
                <p>Make sure the eBPF daemon is running on port 8080</p>
            </div>
        );
    }

    // Define navigation items with professional icons - ordered logically
    const navItems = [
        { id: 'overview', label: 'Overview', icon: FiBarChart2 },
        { id: 'health', label: 'System Health', icon: FiActivity },
        { id: 'performance', label: 'Performance', icon: FiZap },
        { id: 'node-metrics', label: 'Node Metrics', icon: FiServer },
        { id: 'system', label: 'System Resources', icon: FiCpu },
        { id: 'network', label: 'Network Stats', icon: FiGlobe },
        { id: 'tcp-events', label: 'TCP Events', icon: FiRadio },
        { id: 'pod-metrics', label: 'Pod Metrics', icon: FiPackage },
        { id: 'packets', label: 'Packet Distribution', icon: FiDownload },
        { id: 'services', label: 'Service Health', icon: FiSettings },
        { id: 'nat', label: 'NAT Metadata', icon: FiRefreshCw },
    ];

    return (
        <div className="dashboard-content">
            <div className="dashboard-main-wrapper">
                {/* Sticky Navigation Sidebar */}
                <nav className="dashboard-nav">
                    <div className="nav-header">
                        <h3>Navigation</h3>
                    </div>
                    <ul className="nav-list">
                        {navItems.map((item) => {
                            const IconComponent = item.icon;
                            return (
                                <li key={item.id}>
                                    <button
                                        className={`nav-item ${activeSection === item.id ? 'active' : ''}`}
                                        onClick={() => scrollToSection(item.id)}
                                    >
                                        <span className="nav-icon">
                                            <IconComponent />
                                        </span>
                                        <span className="nav-label">{item.label}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </nav>

            <main className="dashboard-main">
                {/* Overview Section */}
                <section 
                    id="overview" 
                    ref={(el) => (sectionRefs.current['overview'] = el)}
                    className="section"
                >
                    <div className="section-header">
                        <h2>DASHBOARD OVERVIEW</h2>
                        <span className="section-badge">Real-time Monitoring</span>
                    </div>
                    <div className="overview-grid">
                        <div className="overview-card">
                            <div className="overview-label">Cluster</div>
                            <div className="overview-value">{clusterInfo.cluster}</div>
                        </div>
                        <div className="overview-card">
                            <div className="overview-label">Node</div>
                            <div className="overview-value">{metrics?.node_name || clusterInfo.node}</div>
                            {metrics?.node_ip && (
                                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                                    IP: {metrics.node_ip}
                                </div>
                            )}
                        </div>
                        <div className="overview-card">
                            <div className="overview-label">Active Pods</div>
                            <div className="overview-value">{metrics?.dns.pods ? Object.keys(metrics.dns.pods).length : 0}</div>
                        </div>
                        <div className="overview-card">
                            <div className="overview-label">Total Pods</div>
                            <div className="overview-value">{clusterInfo.activePods}</div>
                        </div>
                    </div>
                </section>

                {/* System Health Overview */}
                <section 
                    id="health" 
                    ref={(el) => (sectionRefs.current['health'] = el)}
                    className="section"
                >
                    <div className="section-header">
                        <h2>SYSTEM HEALTH</h2>
                        <span className="section-badge">Real-time Status</span>
                    </div>
                    <SystemHealth />
                </section>

                {/* Top Performers */}
                {metrics?.dns.pods && Object.keys(metrics.dns.pods).length > 0 && (
                    <section 
                        id="performance" 
                        ref={(el) => (sectionRefs.current['performance'] = el)}
                        className="section"
                    >
                        <div className="section-header">
                            <h2>PERFORMANCE RANKINGS</h2>
                            <span className="section-badge">Top & Bottom Pods</span>
                        </div>
                        <TopPerformers />
                    </section>
                )}

                {/* Network Statistics */}
                <section 
                    id="network" 
                    ref={(el) => (sectionRefs.current['network'] = el)}
                    className="section"
                >
                    <div className="section-header">
                        <h2>NETWORK STATISTICS</h2>
                        <span className="section-badge">Distribution Analysis</span>
                    </div>
                    <NetworkStats />
                </section>

                {/* Node-Level Metrics Section */}
                <section 
                    id="node-metrics" 
                    ref={(el) => (sectionRefs.current['node-metrics'] = el)}
                    className="section"
                >
                    <div className="section-header">
                        <h2>NODE-LEVEL METRICS</h2>
                        <span className="section-badge">Cluster-wide Statistics</span>
                    </div>

                    {/* Node DNS Latency Chart */}
                    <div className="chart-container">
                        <DNSLatencyChart 
                            currentLatency={metrics?.dns.avg_latency_us || 0} 
                            title="Node DNS Latency Over Time"
                        />
                    </div>

                    {/* TCP Metrics Chart */}
                    {metrics?.tcp && metrics.tcp.total_events > 0 && (
                        <div className="chart-container">
                            <TCPMetricsChart 
                                currentSRTT={metrics.tcp.last_srtt_us || 0}
                                currentMinRTT={metrics.tcp.last_min_rtt_us || 0}
                                title="TCP RTT Metrics Over Time"
                            />
                        </div>
                    )}

                    <div className="metrics-grid">
                        <div className="stat-card dns">
                            <div className="stat-header">
                                <h3>DNS Events</h3>
                            </div>
                            <div className="stat-value">{metrics?.dns.total_events.toLocaleString() || 0}</div>
                            <div className="stat-details">
                                <span className="stat-label">Total Queries</span>
                                <span className="stat-sublabel">Avg: {metrics?.dns.avg_latency_us.toFixed(2)} μs</span>
                            </div>
                        </div>

                        <div className="stat-card latency">
                            <div className="stat-header">
                                <h3>DNS Latency</h3>
                            </div>
                            <div className="stat-value">{metrics?.dns.avg_latency_us.toFixed(2)} <span className="unit">μs</span></div>
                            <div className="stat-details">
                                <span className="stat-label">Average Response Time</span>
                                <span className="stat-range">Min: {metrics?.dns.min_latency_us.toFixed(2)} μs • Max: {metrics?.dns.max_latency_us.toFixed(2)} μs</span>
                            </div>
                        </div>


                        {metrics?.tcp && metrics.tcp.total_events > 0 && (
                            <>
                                <div className="stat-card tcp">
                                    <div className="stat-header">
                                        <h3>TCP Metrics</h3>
                                    </div>
                                    <div className="stat-value">{metrics.tcp.total_events.toLocaleString()}</div>
                                    <div className="stat-details">
                                        <span className="stat-label">Total Events</span>
                                        <span className="stat-sublabel">SRTT: {metrics.tcp.last_srtt_us.toFixed(2)} μs</span>
                                    </div>
                                </div>

                                <div className="stat-card tcp-details">
                                    <div className="stat-header">
                                        <h3>TCP Health</h3>
                                    </div>
                                    <div className="stat-value" style={{fontSize: '1.2rem'}}>
                                        <div style={{marginBottom: '0.5rem'}}>Retrans: {metrics.tcp.retransmissions}</div>
                                        <div style={{marginBottom: '0.5rem'}}>Loss: {metrics.tcp.packet_loss}</div>
                                        <div>Bad HS: {metrics.tcp.bad_handshakes}</div>
                                    </div>
                                    <div className="stat-details">
                                        <span className="stat-label">Network Quality</span>
                                        <span className="stat-range">CWND: {metrics.tcp.last_cwnd.toLocaleString()}</span>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </section>

                {/* TCP Events Timeline - Enhanced */}
                {metrics?.tcp && (
                    <section 
                        id="tcp-events" 
                        ref={(el) => (sectionRefs.current['tcp-events'] = el)}
                        className="section"
                    >
                        <div className="section-header">
                            <h2>TCP EVENTS TIMELINE</h2>
                            <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
                                <span className="section-badge">
                                    {metrics.tcp.recent_events && metrics.tcp.recent_events.length > 0 
                                        ? `${metrics.tcp.recent_events.length} Events` 
                                        : 'Retransmissions & Packet Loss'}
                                </span>
                                {metrics.tcp.recent_events && metrics.tcp.recent_events.length > 0 && (
                                    <span style={{
                                        fontSize: '0.75rem',
                                        color: '#94a3b8',
                                        padding: '0.25rem 0.75rem',
                                        background: 'rgba(59, 130, 246, 0.1)',
                                        borderRadius: '6px',
                                        border: '1px solid rgba(59, 130, 246, 0.2)'
                                    }}>
                                        Showing last 20 events
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* TCP Issues Chart */}
                        {metrics.tcp.total_events > 0 && (
                            <div className="chart-container" style={{marginBottom: '2rem'}}>
                                <TCPIssuesChart 
                                    retransmissions={metrics.tcp.retransmissions || 0}
                                    packetLoss={metrics.tcp.packet_loss || 0}
                                    title="TCP Retransmissions & Packet Loss Over Time"
                                />
                            </div>
                        )}

                        <div className="events-timeline">
                            {metrics.tcp.recent_events && Array.isArray(metrics.tcp.recent_events) && metrics.tcp.recent_events.length > 0 ? (
                                metrics.tcp.recent_events.slice().reverse().slice(0, 20).map((event, idx) => (
                                <div key={idx} className={`event-item ${event.event_type}`}>
                                    <div className="event-time">{new Date(event.timestamp).toLocaleTimeString()}</div>
                                    <div className="event-details">
                                        <div className="event-type-badge" style={{
                                            backgroundColor: event.event_type === 'retransmission' ? '#f59e0b20' : '#ef444420',
                                            borderColor: event.event_type === 'retransmission' ? '#f59e0b' : '#ef4444',
                                            color: event.event_type === 'retransmission' ? '#f59e0b' : '#ef4444'
                                        }}>
                                            {event.event_type === 'retransmission' ? 'RETRANS' : 'LOSS'}
                                        </div>
                                        <div className="event-info">
                                            <div className="event-pod">
                                                {event.pod_name !== 'unknown' ? (
                                                    <span><strong>{event.pod_name}</strong> ({event.namespace})</span>
                                                ) : (
                                                    <span>IP: {event.source_ip}</span>
                                                )}
                                            </div>
                                            <div className="event-connection">
                                                {event.source_ip}:{event.source_port} → {event.dest_ip}:{event.dest_port}
                                            </div>
                                            <div className="event-metrics">
                                                <span className="event-metric-badge">
                                                    <span className="metric-label">SRTT</span>
                                                    <span className="metric-value">{(event.srtt_us / 1000).toFixed(2)}ms</span>
                                                </span>
                                                <span className="event-metric-badge">
                                                    <span className="metric-label">Min RTT</span>
                                                    <span className="metric-value">{(event.min_rtt_us / 1000).toFixed(2)}ms</span>
                                                </span>
                                                <span className="event-metric-badge">
                                                    <span className="metric-label">CWND</span>
                                                    <span className="metric-value">{event.cwnd.toLocaleString()}</span>
                                                </span>
                                                {event.retrans_count > 0 && (
                                                    <span className="event-metric-badge" style={{color: '#f59e0b', borderColor: 'rgba(245, 158, 11, 0.3)'}}>
                                                        <span className="metric-label">Retrans</span>
                                                        <span className="metric-value" style={{color: '#f59e0b'}}>{event.retrans_count}</span>
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))
                            ) : (
                                <div className="event-item" style={{
                                    padding: '3rem 2rem', 
                                    textAlign: 'center', 
                                    borderLeftColor: '#71717a',
                                    background: 'linear-gradient(135deg, rgba(30, 35, 55, 0.4) 0%, rgba(20, 25, 45, 0.3) 100%)'
                                }}>
                                    <div className="event-info" style={{width: '100%', alignItems: 'center'}}>
                                        <div style={{
                                            color: '#94a3b8', 
                                            fontSize: '1rem',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '1rem',
                                            alignItems: 'center'
                                        }}>
                                            <div style={{fontWeight: 600, color: '#cbd5e1', fontSize: '1.1rem'}}>
                                                No recent retransmissions or packet loss events
                                            </div>
                                            <div style={{
                                                display: 'flex',
                                                gap: '1.5rem',
                                                marginTop: '0.5rem',
                                                flexWrap: 'wrap',
                                                justifyContent: 'center'
                                            }}>
                                                <span style={{
                                                    fontSize: '0.85rem',
                                                    padding: '0.5rem 1rem',
                                                    background: 'rgba(245, 158, 11, 0.1)',
                                                    borderRadius: '8px',
                                                    border: '1px solid rgba(245, 158, 11, 0.2)',
                                                    color: '#fbbf24'
                                                }}>
                                                    Total Retransmissions: <strong>{metrics.tcp.retransmissions}</strong>
                                                </span>
                                                <span style={{
                                                    fontSize: '0.85rem',
                                                    padding: '0.5rem 1rem',
                                                    background: 'rgba(239, 68, 68, 0.1)',
                                                    borderRadius: '8px',
                                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                                    color: '#f87171'
                                                }}>
                                                    Total Packet Loss: <strong>{metrics.tcp.packet_loss}</strong>
                                                </span>
                                            </div>
                                            <span style={{
                                                fontSize: '0.8rem', 
                                                marginTop: '0.5rem', 
                                                display: 'block', 
                                                color: '#71717a',
                                                fontStyle: 'italic'
                                            }}>
                                                Events will appear here in real-time as they occur
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                )}

                {/* Pod-Level Metrics Section */}
                {metrics?.dns.pods && Object.keys(metrics.dns.pods).length > 0 && (
                    <section 
                        id="pod-metrics" 
                        ref={(el) => (sectionRefs.current['pod-metrics'] = el)}
                        className="section"
                    >
                        <div className="section-header">
                            <h2>POD-LEVEL METRICS</h2>
                            <span className="section-badge">{Object.keys(metrics.dns.pods).length} Active Pods</span>
                        </div>
                        <div className="pods-grid">
                            {Object.entries(metrics.dns.pods).map(([podKey, stats]) => {
                                const [namespace, podName] = podKey.split('/');
                                return (
                                    <div key={podKey} className="pod-card">
                                        <div className="pod-card-glow"></div>
                                        <div className="pod-header">
                                            <div className="pod-info">
                                                <div className="pod-name">{podName}</div>
                                                <div className="pod-namespace">{namespace}</div>
                                            </div>
                                            <div className="pod-status-wrapper">
                                                <div className="pod-status-indicator"></div>
                                                <div className="pod-status">Running</div>
                                            </div>
                                        </div>

                                        {/* Pod DNS Latency Chart */}
                                        <div className="pod-chart">
                                            <DNSLatencyChart 
                                                currentLatency={stats.avg_latency_us} 
                                                title={`${podName} DNS Latency`}
                                            />
                                        </div>
                                        
                                        <div className="pod-metrics-section">
                                            <div className="metric-group">
                                                <div className="metric-group-title">
                                                    DNS Metrics
                                                </div>
                                                <div className="metrics-row">
                                                    <div className="metric-item">
                                                        <span className="metric-label">Avg Latency</span>
                                                        <span className="metric-value cyan">{stats.avg_latency_us.toFixed(2)} <span className="metric-unit">μs</span></span>
                                                        <div className="metric-trend">{(stats.avg_latency_us < 1000 ? 'Excellent' : stats.avg_latency_us < 5000 ? 'Good' : 'Needs Attention')}</div>
                                                    </div>
                                                    <div className="metric-item">
                                                        <span className="metric-label">Events</span>
                                                        <span className="metric-value purple">{stats.total_events.toLocaleString()}</span>
                                                        <div className="metric-trend">Total Queries</div>
                                                    </div>
                                                </div>
                                                <div className="metrics-row">
                                                    <div className="metric-item">
                                                        <span className="metric-label">Min</span>
                                                        <span className="metric-value green">{stats.min_latency_us.toFixed(2)} <span className="metric-unit">μs</span></span>
                                                        <div className="metric-trend">Best Performance</div>
                                                    </div>
                                                    <div className="metric-item">
                                                        <span className="metric-label">Max</span>
                                                        <span className="metric-value orange">{stats.max_latency_us.toFixed(2)} <span className="metric-unit">μs</span></span>
                                                        <div className="metric-trend">Peak Latency</div>
                                                    </div>
                                                </div>
                                            </div>

                                            {metrics?.tcp?.pods?.[podKey] && (
                                                <div className="metric-group">
                                                    <div className="metric-group-title">
                                                        TCP-Level Metrics
                                                    </div>
                                                    {(() => {
                                                        const podTCP = metrics.tcp.pods[podKey];
                                                        if (podTCP && podTCP.total_events > 0) {
                                                            return (
                                                                <>
                                                                    <div className="metrics-row">
                                                                        <div className="metric-item">
                                                                            <span className="metric-label">SRTT</span>
                                                                            <span className="metric-value cyan">{(podTCP.last_srtt_us / 1000).toFixed(2)} <span className="metric-unit">ms</span></span>
                                                                            <div className="metric-trend">Smoothed RTT</div>
                                                                        </div>
                                                                        <div className="metric-item">
                                                                            <span className="metric-label">Min RTT</span>
                                                                            <span className="metric-value green">{(podTCP.last_min_rtt_us / 1000).toFixed(2)} <span className="metric-unit">ms</span></span>
                                                                            <div className="metric-trend">Best RTT</div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="metrics-row">
                                                                        <div className="metric-item">
                                                                            <span className="metric-label">Retrans</span>
                                                                            <span className="metric-value orange">{podTCP.retransmissions}</span>
                                                                            <div className="metric-trend">Retransmissions</div>
                                                                        </div>
                                                                        <div className="metric-item">
                                                                            <span className="metric-label">Loss</span>
                                                                            <span className="metric-value red">{podTCP.packet_loss}</span>
                                                                            <div className="metric-trend">Packet Loss</div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="metrics-row">
                                                                        <div className="metric-item">
                                                                            <span className="metric-label">CWND</span>
                                                                            <span className="metric-value purple">{podTCP.last_cwnd.toLocaleString()}</span>
                                                                            <div className="metric-trend">Congestion Window</div>
                                                                        </div>
                                                                        <div className="metric-item">
                                                                            <span className="metric-label">Bad HS</span>
                                                                            <span className="metric-value red">{podTCP.bad_handshakes}</span>
                                                                            <div className="metric-trend">Failed Handshakes</div>
                                                                        </div>
                                                                    </div>
                                                                </>
                                                            );
                                                        }
                                                        return null;
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Node System Metrics */}
                {metrics?.node_system && (
                    <section 
                        id="system" 
                        ref={(el) => (sectionRefs.current['system'] = el)}
                        className="section"
                    >
                        <div className="section-header">
                            <h2>NODE SYSTEM METRICS</h2>
                            <span className="section-badge">CPU & Memory</span>
                        </div>

                        {/* System Resources Chart */}
                        <div className="chart-container">
                            <SystemResourcesChart 
                                cpuUsage={metrics.node_system.cpu_usage_percent}
                                memoryUsage={metrics.node_system.memory_usage_percent}
                                title="CPU & Memory Usage Over Time"
                            />
                        </div>

                        <div className="metrics-grid">
                            <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%)', borderColor: 'rgba(59, 130, 246, 0.3)'}}>
                                <div className="stat-header">
                                    <h3>CPU Usage</h3>
                                </div>
                                <div className="stat-value" style={{color: metrics.node_system.cpu_usage_percent > 80 ? '#ef4444' : metrics.node_system.cpu_usage_percent > 60 ? '#f59e0b' : '#10b981'}}>
                                    {metrics.node_system.cpu_usage_percent.toFixed(1)}%
                                </div>
                                <div className="stat-details">
                                    <span className="stat-label">Current CPU Load</span>
                                </div>
                            </div>

                            <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(139, 92, 246, 0.05) 100%)', borderColor: 'rgba(139, 92, 246, 0.3)'}}>
                                <div className="stat-header">
                                    <h3>Memory Usage</h3>
                                </div>
                                <div className="stat-value" style={{color: metrics.node_system.memory_usage_percent > 80 ? '#ef4444' : metrics.node_system.memory_usage_percent > 60 ? '#f59e0b' : '#10b981'}}>
                                    {metrics.node_system.memory_usage_percent.toFixed(1)}%
                                </div>
                                <div className="stat-details">
                                    <span className="stat-label">
                                        {metrics.node_system.memory_used_mb.toLocaleString()} MB / {metrics.node_system.memory_total_mb.toLocaleString()} MB
                                    </span>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-header">
                                    <h3>Load Average</h3>
                                </div>
                                <div className="stat-value" style={{fontSize: '1.1rem'}}>
                                    <div>1min: {metrics.node_system.load_avg_1min.toFixed(2)}</div>
                                    <div>5min: {metrics.node_system.load_avg_5min.toFixed(2)}</div>
                                    <div>15min: {metrics.node_system.load_avg_15min.toFixed(2)}</div>
                                </div>
                                <div className="stat-details">
                                    <span className="stat-label">System Load</span>
                                </div>
                            </div>
                        </div>
                    </section>
                )}

                {/* Packet Distribution */}
                {metrics?.packet_distribution && (
                    <section 
                        id="packets" 
                        ref={(el) => (sectionRefs.current['packets'] = el)}
                        className="section"
                    >
                        <div className="section-header">
                            <h2>PACKET DISTRIBUTION</h2>
                            <span className="section-badge">Traffic Analysis</span>
                        </div>

                        {/* Packet Distribution Chart */}
                        {Object.keys(metrics.packet_distribution.packets_by_protocol).length > 0 && (
                            <div className="chart-container">
                                <PacketDistributionChart 
                                    packetsByProtocol={metrics.packet_distribution.packets_by_protocol}
                                    title="Packet Distribution by Protocol"
                                />
                            </div>
                        )}

                        <div className="metrics-grid">
                            <div className="stat-card">
                                <div className="stat-header">
                                    <h3>Total Packets</h3>
                                </div>
                                <div className="stat-value">{metrics.packet_distribution.total_packets.toLocaleString()}</div>
                                <div className="stat-details">
                                    <span className="stat-label">All Packets</span>
                                </div>
                            </div>

                            {Object.keys(metrics.packet_distribution.packets_by_protocol).length > 0 && (
                                <div className="stat-card">
                                    <div className="stat-header">
                                        <h3>By Protocol</h3>
                                    </div>
                                    <div className="stat-value" style={{fontSize: '1rem'}}>
                                        {Object.entries(metrics.packet_distribution.packets_by_protocol).map(([proto, count]) => (
                                            <div key={proto}>{proto.toUpperCase()}: {count.toLocaleString()}</div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                )}

                {/* Service Health */}
                {metrics?.service_health && (
                    <section 
                        id="services" 
                        ref={(el) => (sectionRefs.current['services'] = el)}
                        className="section"
                    >
                        <div className="section-header">
                            <h2>SERVICE HEALTH</h2>
                            <span className="section-badge">
                                {metrics.service_health.healthy_services} Healthy / {metrics.service_health.total_services} Total
                            </span>
                        </div>
                        <div className="metrics-grid">
                            <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%)', borderColor: 'rgba(16, 185, 129, 0.3)'}}>
                                <div className="stat-header">
                                    <h3>Healthy Services</h3>
                                </div>
                                <div className="stat-value" style={{color: '#10b981'}}>{metrics.service_health.healthy_services}</div>
                                <div className="stat-details">
                                    <span className="stat-label">Fully Operational</span>
                                </div>
                            </div>

                            <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(239, 68, 68, 0.05) 100%)', borderColor: 'rgba(239, 68, 68, 0.3)'}}>
                                <div className="stat-header">
                                    <h3>Unhealthy Services</h3>
                                </div>
                                <div className="stat-value" style={{color: '#ef4444'}}>{metrics.service_health.unhealthy_services}</div>
                                <div className="stat-details">
                                    <span className="stat-label">Needs Attention</span>
                                </div>
                            </div>
                        </div>
                    </section>
                )}

                {/* NAT Metadata */}
                {metrics?.nat_metadata && (
                    <section 
                        id="nat" 
                        ref={(el) => (sectionRefs.current['nat'] = el)}
                        className="section"
                    >
                        <div className="section-header">
                            <h2>NAT TRANSLATION METADATA</h2>
                            <span className="section-badge">Connection Tracking</span>
                        </div>
                        <div className="metrics-grid">
                            <div className="stat-card">
                                <div className="stat-header">
                                    <h3>Active Connections</h3>
                                </div>
                                <div className="stat-value">{metrics.nat_metadata.active_connections.toLocaleString()}</div>
                                <div className="stat-details">
                                    <span className="stat-label">Currently Tracked</span>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-header">
                                    <h3>SNAT Translations</h3>
                                </div>
                                <div className="stat-value">{metrics.nat_metadata.snat_translations.toLocaleString()}</div>
                                <div className="stat-details">
                                    <span className="stat-label">Source NAT</span>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-header">
                                    <h3>DNAT Translations</h3>
                                </div>
                                <div className="stat-value">{metrics.nat_metadata.dnat_translations.toLocaleString()}</div>
                                <div className="stat-details">
                                    <span className="stat-label">Destination NAT</span>
                                </div>
                            </div>
                        </div>
                    </section>
                )}
            </main>
            </div>

            <footer className="dashboard-footer">
                <span>Powered by eBPF - Kubernetes Runtime-Aware Orchestration</span>
                <span>Auto-refresh: 3s</span>
            </footer>
        </div>
    );
}

