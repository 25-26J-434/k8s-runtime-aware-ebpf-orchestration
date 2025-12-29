import { useState, useEffect, useRef } from 'react';
import { useMetrics } from '../hooks/useMetrics';
import { useClusterInfo } from '../hooks/useClusterInfo';
import { usePodDetails } from '../hooks/usePodDetails';
import { DNSLatencyChart } from '../components/DNSLatencyChart';
import { TCPMetricsChart } from '../components/TCPMetricsChart';
import { SystemResourcesChart } from '../components/SystemResourcesChart';
import { TCPIssuesChart } from '../components/TCPIssuesChart';
import { PacketDistributionChart } from '../components/PacketDistributionChart';
import { SystemHealth } from '../components/SystemHealth';
import { TopPerformers } from '../components/TopPerformers';
import { NetworkStats } from '../components/NetworkStats';
import { CPUSchedulingMetrics } from '../components/CPUSchedulingMetrics';
import { api } from '../services/api';
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
    FiRefreshCw,
    FiClock
} from 'react-icons/fi';
import '../App.css';
import '../styles/clean-pods.css';

export function Dashboard() {
    const { metrics, loading, error } = useMetrics(3000);
    const clusterInfo = useClusterInfo(5000);
    const { data: podDetails, loading: podDetailsLoading } = usePodDetails(5000);
    const [activeSection, setActiveSection] = useState<string>('overview');
    const sectionRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
    const [schedMetrics, setSchedMetrics] = useState<any>(null);
    const [containerSchedMetrics, setContainerSchedMetrics] = useState<any>({});
    const [selectedPod, setSelectedPod] = useState<string>('all');

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

    // Fetch scheduling metrics
    useEffect(() => {
        const fetchSchedMetrics = async () => {
            try {
                const data = await api.getSchedLatencyMetrics(10);
                setSchedMetrics(data);
            } catch (err) {
                // Silently fail if scheduling metrics not available
            }
        };
        
        const fetchContainerSchedMetrics = async () => {
            try {
                const data = await api.getSchedLatencyContainers();
                setContainerSchedMetrics(data || {});
            } catch (err) {
                // Silently fail if container scheduling metrics not available
            }
        };
        
        fetchSchedMetrics();
        fetchContainerSchedMetrics();
        const interval = setInterval(() => {
            fetchSchedMetrics();
            fetchContainerSchedMetrics();
        }, 3000); // Update every 3 seconds for real-time
        return () => clearInterval(interval);
    }, []);

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
        { id: 'cpu-scheduling', label: 'CPU Scheduling', icon: FiClock },
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
                            <div className="overview-label">Total Containers</div>
                            <div className="overview-value">{podDetails?.cluster_metrics.total_containers || 0}</div>
                        </div>
                        <div className="overview-card">
                            <div className="overview-label">Total Pods</div>
                            <div className="overview-value">{podDetails?.cluster_metrics.total_pods || clusterInfo.activePods}</div>
                        </div>
                        <div className="overview-card">
                            <div className="overview-label">Total Nodes</div>
                            <div className="overview-value">{podDetails?.cluster_metrics.total_nodes || 1}</div>
                        </div>
                        <div className="overview-card">
                            <div className="overview-label">Namespaces</div>
                            <div className="overview-value">{podDetails?.cluster_metrics.pods_by_namespace ? Object.keys(podDetails.cluster_metrics.pods_by_namespace).length : 0}</div>
                        </div>
                        <div className="overview-card">
                            <div className="overview-label">eBPF Active Pods</div>
                            <div className="overview-value">
                                {metrics?.pods ? Object.keys(metrics.pods).length : 0}
                            </div>
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

                {/* CPU Scheduling Latency */}
                <section 
                    id="cpu-scheduling" 
                    ref={(el) => (sectionRefs.current['cpu-scheduling'] = el)}
                    className="section"
                >
                    <div className="section-header">
                        <h2>CPU SCHEDULING LATENCY</h2>
                        <span className="section-badge">Run Queue Performance</span>
                    </div>
                    <CPUSchedulingMetrics />
                </section>

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

                        {schedMetrics?.node_metrics && schedMetrics.node_metrics.total_events > 0 && (
                            <>
                                <div className="stat-card scheduling">
                                    <div className="stat-header">
                                        <h3>CPU Scheduling</h3>
                                    </div>
                                    <div className="stat-value">{schedMetrics.node_metrics.total_events.toLocaleString()}</div>
                                    <div className="stat-details">
                                        <span className="stat-label">Total Events</span>
                                        <span className="stat-sublabel">
                                            Avg: {(schedMetrics.node_metrics.avg_runqueue_latency_us || 0).toFixed(0)} μs
                                        </span>
                                    </div>
                                </div>

                                <div className="stat-card scheduling-latency">
                                    <div className="stat-header">
                                        <h3>Run Queue Latency</h3>
                                    </div>
                                    <div className="stat-value">
                                        {(schedMetrics.node_metrics.avg_runqueue_latency_us || 0).toFixed(0)} <span className="unit">μs</span>
                                    </div>
                                    <div className="stat-details">
                                        <span className="stat-label">Average Wait Time</span>
                                        <span className="stat-range">
                                            P95: {(schedMetrics.node_metrics.p95_runqueue_latency_us || 0).toFixed(0)} μs • 
                                            Max: {(schedMetrics.node_metrics.max_runqueue_latency_us || 0).toFixed(0)} μs
                                        </span>
                                    </div>
                                </div>

                                <div className={`stat-card scheduling-starvation ${schedMetrics.node_metrics.cpu_starvation_count > 0 ? 'alert' : ''}`}>
                                    <div className="stat-header">
                                        <h3>CPU Starvation</h3>
                                    </div>
                                    <div className="stat-value" style={{
                                        color: schedMetrics.node_metrics.cpu_starvation_count > 0 ? '#ef4444' : '#10b981'
                                    }}>
                                        {schedMetrics.node_metrics.cpu_starvation_count}
                                    </div>
                                    <div className="stat-details">
                                        <span className="stat-label">Critical Delays</span>
                                        <span className="stat-sublabel">Latency {'>'} 10ms</span>
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
                {metrics?.pods && Object.keys(metrics.pods).length > 0 && (
                    <section 
                        id="pod-metrics" 
                        ref={(el) => (sectionRefs.current['pod-metrics'] = el)}
                        className="section"
                    >
                        <div className="section-header">
                            <h2>POD-LEVEL METRICS</h2>
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <span className="section-badge">{Object.keys(metrics.pods).length} Active Pods</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <label style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Filter Pod:</label>
                                    <select 
                                        value={selectedPod}
                                        onChange={(e) => setSelectedPod(e.target.value)}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            background: 'rgba(30, 41, 59, 0.8)',
                                            border: '1px solid rgba(71, 85, 105, 0.5)',
                                            borderRadius: '6px',
                                            color: '#e2e8f0',
                                            fontSize: '0.875rem',
                                            cursor: 'pointer',
                                            minWidth: '250px'
                                        }}
                                    >
                                        <option value="all">All Pods ({Object.keys(metrics.pods).length})</option>
                                        {Object.keys(metrics.pods).sort().map((podKey) => {
                                            const [ns, name] = podKey.split('/');
                                            return (
                                                <option key={podKey} value={podKey}>
                                                    {ns}/{name}
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {selectedPod === 'all' ? (
                            <div className="pods-grid">
                                {Object.entries(metrics.pods).map(([podKey, podData]) => {
                                const dnsStats = podData.dns_latency;
                                const tcpStats = podData.tcp_metrics;
                                const [namespace, podName] = podKey.split('/');
                                
                                // Calculate microsecond values from nanoseconds
                                const dnsAvgLatencyUs = dnsStats ? (dnsStats.avg_latency_ns / 1000) : 0;
                                const dnsMinLatencyUs = dnsStats ? (dnsStats.min_latency_ns / 1000) : 0;
                                const dnsMaxLatencyUs = dnsStats ? (dnsStats.max_latency_ns / 1000) : 0;
                                
                                // Get container-level metrics for this pod
                                const containerMetrics: Record<string, any> = {};
                                if (metrics.containers) {
                                    Object.entries(metrics.containers).forEach(([containerKey, containerData]) => {
                                        // containerKey format: "namespace/podname/containername"
                                        const parts = containerKey.split('/');
                                        const containerPodKey = `${parts[0]}/${parts[1]}`;
                                        if (containerPodKey === podKey) {
                                            const containerName = parts[2];
                                            containerMetrics[containerName] = containerData;
                                        }
                                    });
                                }
                                
                                const parts = podKey.split('/');
                                
                                return (
                                    <div key={podKey} className="pod-card-clean">
                                        {/* Header Section */}
                                        <div className="card-header-clean">
                                            <div className="pod-title-clean">
                                                <span className="namespace-tag">{parts[0]}</span>
                                                <span className="pod-name-clean">{parts[1]}</span>
                                            </div>
                                            <div className="status-badge-clean">Active</div>
                                        </div>

                                        {/* Pod-Level eBPF Metrics */}
                                        <div className="metrics-section-clean">
                                            {dnsStats && (
                                                <div className="metric-block-clean">
                                                    <div className="metric-block-title">DNS Metrics</div>
                                                    <div className="metric-grid-clean">
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Avg Latency</div>
                                                            <div className="metric-value-clean">{dnsAvgLatencyUs.toFixed(2)} μs</div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Events</div>
                                                            <div className="metric-value-clean">{dnsStats.total_events.toLocaleString()}</div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Min</div>
                                                            <div className="metric-value-clean">{dnsMinLatencyUs.toFixed(2)} μs</div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Max</div>
                                                            <div className="metric-value-clean">{dnsMaxLatencyUs.toFixed(2)} μs</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {tcpStats && tcpStats.total_events > 0 && (
                                                <div className="metric-block-clean">
                                                    <div className="metric-block-title">TCP Metrics</div>
                                                    <div className="metric-grid-clean">
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Connections</div>
                                                            <div className="metric-value-clean">{(tcpStats.connection_count || 0).toLocaleString()}</div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Events</div>
                                                            <div className="metric-value-clean">{(tcpStats.total_events || 0).toLocaleString()}</div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Retransmits</div>
                                                            <div className="metric-value-clean">{(tcpStats.total_retransmissions || 0).toLocaleString()}</div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Avg RTT</div>
                                                            <div className="metric-value-clean">{((tcpStats.avg_rtt_us || 0) / 1000).toFixed(2)} ms</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            <div className="metric-block-clean">
                                                <div className="metric-block-title">CPU Scheduling</div>
                                                {schedMetrics?.pod_metrics && schedMetrics.pod_metrics[podKey] ? (
                                                    <div className="metric-grid-clean">
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Avg Latency</div>
                                                            <div className="metric-value-clean" style={{
                                                                color: (schedMetrics.pod_metrics[podKey].avg_runqueue_latency_us || 0) > 10000 ? '#ef4444' : 
                                                                       (schedMetrics.pod_metrics[podKey].avg_runqueue_latency_us || 0) > 5000 ? '#f59e0b' : '#10b981'
                                                            }}>
                                                                {(schedMetrics.pod_metrics[podKey].avg_runqueue_latency_us || 0).toFixed(0)} μs
                                                            </div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Events</div>
                                                            <div className="metric-value-clean">
                                                                {(schedMetrics.pod_metrics[podKey].event_count || 0).toLocaleString()}
                                                            </div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Max Latency</div>
                                                            <div className="metric-value-clean" style={{
                                                                color: (schedMetrics.pod_metrics[podKey].max_runqueue_latency_us || 0) > 10000 ? '#ef4444' : '#10b981'
                                                            }}>
                                                                {(schedMetrics.pod_metrics[podKey].max_runqueue_latency_us || 0).toFixed(0)} μs
                                                            </div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Starvation</div>
                                                            <div className="metric-value-clean" style={{
                                                                color: (schedMetrics.pod_metrics[podKey].cpu_starvation_count || 0) > 0 ? '#ef4444' : '#10b981'
                                                            }}>
                                                                {schedMetrics.pod_metrics[podKey].cpu_starvation_count || 0}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{ 
                                                        padding: '1rem', 
                                                        textAlign: 'center', 
                                                        color: '#64748b', 
                                                        fontSize: '0.875rem',
                                                        fontStyle: 'italic'
                                                    }}>
                                                        No scheduling data available yet
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Container-Level eBPF Metrics & Details */}
                                        {podDetails?.pods[podKey] && podDetails.pods[podKey].containers?.length > 0 && (
                                            <div className="container-section-clean">
                                                <div className="section-title-clean">
                                                    <span>Container Metrics</span>
                                                    <span className="count-badge-clean">{podDetails.pods[podKey].containers.length}</span>
                                                </div>
                                                <div className="container-grid-clean">
                                                    {podDetails.pods[podKey].containers.map((container: any) => {
                                                        const containerName = container.name;
                                                        const containerData = containerMetrics[containerName] || {};
                                                        const containerDns = containerData.dns_latency;
                                                        const containerTcp = containerData.tcp_metrics;
                                                        const containerKey = `${podKey}/${containerName}`;
                                                        const containerSched = containerSchedMetrics[containerKey];

                                                        return (
                                                            <div key={containerName} className="container-card-clean">
                                                                {/* Container Info */}
                                                                <div className="container-info-clean">
                                                                    <div className="container-name-clean">{containerName}</div>
                                                                    <div className="container-image-clean">{container.image.split(':')[0]}</div>
                                                                    <div className="container-status-clean">
                                                                        <span className={container.ready ? 'status-ready' : 'status-not-ready'}>
                                                                            {container.ready ? 'Ready' : 'Not Ready'}
                                                                        </span>
                                                                        <span className="status-divider">|</span>
                                                                        <span>{container.state}</span>
                                                                        <span className="status-divider">|</span>
                                                                        <span>Restarts: {container.restart_count}</span>
                                                                    </div>
                                                                </div>
                                                                
                                                                {/* eBPF Metrics - All Metrics */}
                                                                <div className="ebpf-metrics-compact">
                                                                    {containerDns && containerDns.total_events > 0 ? (
                                                                        <div className="metric-row-compact">
                                                                            <span className="metric-type">DNS</span>
                                                                            <span className="metric-val">{containerDns.total_events} queries</span>
                                                                            <span className="metric-val">{containerDns.avg_latency_us.toFixed(1)}μs avg</span>
                                                                            <span className="metric-val">{(containerDns.max_latency_ns / 1000).toFixed(1)}μs max</span>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="metric-row-compact">
                                                                            <span className="metric-type">DNS</span>
                                                                            <span className="metric-val" style={{color: '#64748b', fontStyle: 'italic'}}>No data</span>
                                                                        </div>
                                                                    )}
                                                                    {containerTcp && containerTcp.total_events > 0 ? (
                                                                        <div className="metric-row-compact">
                                                                            <span className="metric-type">TCP</span>
                                                                            <span className="metric-val">{containerTcp.total_events} events</span>
                                                                            <span className="metric-val">{containerTcp.retransmissions || 0} retrans</span>
                                                                            <span className="metric-val">{((containerTcp.last_srtt_us || 0) / 1000).toFixed(1)}ms rtt</span>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="metric-row-compact">
                                                                            <span className="metric-type">TCP</span>
                                                                            <span className="metric-val" style={{color: '#64748b', fontStyle: 'italic'}}>No data</span>
                                                                        </div>
                                                                    )}
                                                                    {/* CPU Scheduling for container */}
                                                                    {containerSched ? (
                                                                        <div className="metric-row-compact">
                                                                            <span className="metric-type">CPU Sched</span>
                                                                            <span className="metric-val" style={{
                                                                                color: (containerSched.avg_runqueue_latency_us || 0) > 10000 ? '#ef4444' : 
                                                                                       (containerSched.avg_runqueue_latency_us || 0) > 5000 ? '#f59e0b' : '#10b981'
                                                                            }}>
                                                                                {(containerSched.avg_runqueue_latency_us || 0).toFixed(0)}μs avg
                                                                            </span>
                                                                            <span className="metric-val">{(containerSched.event_count || 0).toLocaleString()} events</span>
                                                                            {(containerSched.cpu_starvation_count || 0) > 0 && (
                                                                                <span className="metric-val" style={{color: '#ef4444'}}>
                                                                                    {(containerSched.cpu_starvation_count || 0)} starv
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="metric-row-compact">
                                                                            <span className="metric-type">CPU Sched</span>
                                                                            <span className="metric-val" style={{color: '#64748b', fontStyle: 'italic'}}>No data</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                
                                                                {/* Resources */}
                                                                <div className="resource-row-compact">
                                                                    <span>CPU: {container.resources.requests.cpu}</span>
                                                                    <span className="dot-sep">•</span>
                                                                    <span>Memory: {container.resources.requests.memory}</span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        ) : (
                            <div className="enhanced-pod-view">
                                {(() => {
                                    const podKey = selectedPod;
                                    const podData = metrics.pods[podKey];
                                    if (!podData) return null;
                                    
                                    const dnsStats = podData.dns_latency;
                                    const tcpStats = podData.tcp_metrics;
                                    const [namespace, podName] = podKey.split('/');
                                    
                                    const dnsAvgLatencyUs = dnsStats ? (dnsStats.avg_latency_ns / 1000) : 0;
                                    const dnsMinLatencyUs = dnsStats ? (dnsStats.min_latency_ns / 1000) : 0;
                                    const dnsMaxLatencyUs = dnsStats ? (dnsStats.max_latency_ns / 1000) : 0;
                                    
                                    const containerMetrics: Record<string, any> = {};
                                    if (metrics.containers) {
                                        Object.entries(metrics.containers).forEach(([containerKey, containerData]) => {
                                            const parts = containerKey.split('/');
                                            const containerPodKey = `${parts[0]}/${parts[1]}`;
                                            if (containerPodKey === podKey) {
                                                const containerName = parts[2];
                                                containerMetrics[containerName] = containerData;
                                            }
                                        });
                                    }
                                    
                                    const podSchedMetrics = schedMetrics?.pod_metrics?.[podKey];
                                    
                                    return (
                                        <div className="enhanced-pod-card">
                                            {/* Enhanced Header */}
                                            <div className="enhanced-pod-header">
                                                <div className="enhanced-pod-title">
                                                    <span className="enhanced-namespace">{namespace}</span>
                                                    <span className="enhanced-pod-name">{podName}</span>
                                                </div>
                                                <button 
                                                    onClick={() => setSelectedPod('all')}
                                                    style={{
                                                        padding: '0.5rem 1rem',
                                                        background: 'rgba(71, 85, 105, 0.5)',
                                                        border: '1px solid rgba(71, 85, 105, 0.7)',
                                                        borderRadius: '6px',
                                                        color: '#e2e8f0',
                                                        cursor: 'pointer',
                                                        fontSize: '0.875rem'
                                                    }}
                                                >
                                                    View All Pods
                                                </button>
                                            </div>

                                            {/* Metrics Overview Grid */}
                                            <div className="enhanced-metrics-overview">
                                                {dnsStats && (
                                                    <div className="enhanced-metric-card">
                                                        <div className="enhanced-metric-header">DNS Performance</div>
                                                        <div className="enhanced-metric-value">{dnsAvgLatencyUs.toFixed(2)} μs</div>
                                                        <div className="enhanced-metric-details">
                                                            <span>Min: {dnsMinLatencyUs.toFixed(2)} μs</span>
                                                            <span>Max: {dnsMaxLatencyUs.toFixed(2)} μs</span>
                                                            <span>Events: {dnsStats.total_events.toLocaleString()}</span>
                                                        </div>
                                                    </div>
                                                )}
                                                
                                                {tcpStats && tcpStats.total_events > 0 && (
                                                    <div className="enhanced-metric-card">
                                                        <div className="enhanced-metric-header">TCP Metrics</div>
                                                        <div className="enhanced-metric-value">{((tcpStats.avg_rtt_us || 0) / 1000).toFixed(2)} ms</div>
                                                        <div className="enhanced-metric-details">
                                                            <span>Connections: {(tcpStats.connection_count || 0).toLocaleString()}</span>
                                                            <span>Events: {(tcpStats.total_events || 0).toLocaleString()}</span>
                                                            <span>Retrans: {(tcpStats.total_retransmissions || 0).toLocaleString()}</span>
                                                        </div>
                                                    </div>
                                                )}
                                                
                                                {podSchedMetrics && (
                                                    <div className="enhanced-metric-card">
                                                        <div className="enhanced-metric-header">CPU Scheduling</div>
                                                        <div className="enhanced-metric-value" style={{
                                                            color: podSchedMetrics.avg_runqueue_latency_us > 10000 ? '#ef4444' : 
                                                                   podSchedMetrics.avg_runqueue_latency_us > 5000 ? '#f59e0b' : '#10b981'
                                                        }}>
                                                            {(podSchedMetrics.avg_runqueue_latency_us || 0).toFixed(0)} μs
                                                        </div>
                                                        <div className="enhanced-metric-details">
                                                            <span>Max: {(podSchedMetrics.max_runqueue_latency_us || 0).toFixed(0)} μs</span>
                                                            <span>Events: {(podSchedMetrics.event_count || 0).toLocaleString()}</span>
                                                            <span style={{
                                                                color: podSchedMetrics.cpu_starvation_count > 0 ? '#ef4444' : '#10b981'
                                                            }}>
                                                                Starvation: {podSchedMetrics.cpu_starvation_count || 0}
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Detailed Sections */}
                                            <div className="enhanced-details-grid">
                                                {/* DNS Details */}
                                                {dnsStats && (
                                                    <div className="enhanced-detail-section">
                                                        <h4>DNS Latency Details</h4>
                                                        <div className="detail-metrics">
                                                            <div className="detail-row">
                                                                <span className="detail-label">Average Latency:</span>
                                                                <span className="detail-value">{dnsAvgLatencyUs.toFixed(2)} μs</span>
                                                            </div>
                                                            <div className="detail-row">
                                                                <span className="detail-label">Minimum Latency:</span>
                                                                <span className="detail-value">{dnsMinLatencyUs.toFixed(2)} μs</span>
                                                            </div>
                                                            <div className="detail-row">
                                                                <span className="detail-label">Maximum Latency:</span>
                                                                <span className="detail-value">{dnsMaxLatencyUs.toFixed(2)} μs</span>
                                                            </div>
                                                            <div className="detail-row">
                                                                <span className="detail-label">Total Queries:</span>
                                                                <span className="detail-value">{dnsStats.total_events.toLocaleString()}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* TCP Details */}
                                                {tcpStats && tcpStats.total_events > 0 && (
                                                    <div className="enhanced-detail-section">
                                                        <h4>TCP Connection Details</h4>
                                                        <div className="detail-metrics">
                                                            <div className="detail-row">
                                                                <span className="detail-label">Active Connections:</span>
                                                                <span className="detail-value">{(tcpStats.connection_count || 0).toLocaleString()}</span>
                                                            </div>
                                                            <div className="detail-row">
                                                                <span className="detail-label">Total Events:</span>
                                                                <span className="detail-value">{(tcpStats.total_events || 0).toLocaleString()}</span>
                                                            </div>
                                                            <div className="detail-row">
                                                                <span className="detail-label">Retransmissions:</span>
                                                                <span className="detail-value">{(tcpStats.total_retransmissions || 0).toLocaleString()}</span>
                                                            </div>
                                                            <div className="detail-row">
                                                                <span className="detail-label">Average RTT:</span>
                                                                <span className="detail-value">{((tcpStats.avg_rtt_us || 0) / 1000).toFixed(2)} ms</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* CPU Scheduling Details */}
                                                {podSchedMetrics && (
                                                    <div className="enhanced-detail-section">
                                                        <h4>CPU Scheduling Details</h4>
                                                        <div className="detail-metrics">
                                                            <div className="detail-row">
                                                                <span className="detail-label">Average Run Queue Latency:</span>
                                                                <span className="detail-value" style={{
                                                                    color: podSchedMetrics.avg_runqueue_latency_us > 10000 ? '#ef4444' : 
                                                                           podSchedMetrics.avg_runqueue_latency_us > 5000 ? '#f59e0b' : '#10b981'
                                                                }}>
                                                                    {(podSchedMetrics.avg_runqueue_latency_us || 0).toFixed(0)} μs
                                                                </span>
                                                            </div>
                                                            <div className="detail-row">
                                                                <span className="detail-label">Maximum Latency:</span>
                                                                <span className="detail-value" style={{
                                                                    color: podSchedMetrics.max_runqueue_latency_us > 10000 ? '#ef4444' : '#10b981'
                                                                }}>
                                                                    {(podSchedMetrics.max_runqueue_latency_us || 0).toFixed(0)} μs
                                                                </span>
                                                            </div>
                                                            <div className="detail-row">
                                                                <span className="detail-label">Scheduling Events:</span>
                                                                <span className="detail-value">{(podSchedMetrics.event_count || 0).toLocaleString()}</span>
                                                            </div>
                                                            <div className="detail-row">
                                                                <span className="detail-label">CPU Starvation Events:</span>
                                                                <span className="detail-value" style={{
                                                                    color: podSchedMetrics.cpu_starvation_count > 0 ? '#ef4444' : '#10b981'
                                                                }}>
                                                                    {podSchedMetrics.cpu_starvation_count || 0} (delays {'>'} 10ms)
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Container Details */}
                                            {podDetails?.pods[podKey] && podDetails.pods[podKey].containers?.length > 0 && (
                                                <div className="enhanced-containers-section">
                                                    <h4>Container Details ({podDetails.pods[podKey].containers.length})</h4>
                                                    <div className="enhanced-containers-grid">
                                                        {podDetails.pods[podKey].containers.map((container: any) => {
                                                            const containerName = container.name;
                                                            const containerData = containerMetrics[containerName] || {};
                                                            const containerDns = containerData.dns_latency;
                                                            const containerTcp = containerData.tcp_metrics;
                                                            const containerKey = `${podKey}/${containerName}`;
                                                            const containerSched = containerSchedMetrics[containerKey];
                                                            const hasMetrics = (containerDns && containerDns.total_events > 0) || 
                                                                              (containerTcp && containerTcp.total_events > 0);

                                                            return (
                                                                <div key={containerName} className="enhanced-container-card">
                                                                    <div className="enhanced-container-header">
                                                                        <span className="enhanced-container-name">{containerName}</span>
                                                                        <span className={`enhanced-container-status ${container.ready ? 'ready' : 'not-ready'}`}>
                                                                            {container.ready ? 'Ready' : 'Not Ready'}
                                                                        </span>
                                                                    </div>
                                                                    <div className="enhanced-container-image">{container.image}</div>
                                                                    
                                                                    <div className="enhanced-container-metrics-section">
                                                                        {/* DNS Metrics - Always show */}
                                                                        <div className="enhanced-container-metric-block">
                                                                            <div className="enhanced-container-metric-title">DNS Metrics</div>
                                                                            {containerDns && containerDns.total_events > 0 ? (
                                                                                <>
                                                                                    <div className="enhanced-container-metric-row">
                                                                                        <span className="metric-label">Avg Latency:</span>
                                                                                        <span className="metric-value">{((containerDns.avg_latency_ns || 0) / 1000).toFixed(2)} μs</span>
                                                                                    </div>
                                                                                    <div className="enhanced-container-metric-row">
                                                                                        <span className="metric-label">Events:</span>
                                                                                        <span className="metric-value">{(containerDns.total_events || 0).toLocaleString()}</span>
                                                                                    </div>
                                                                                    <div className="enhanced-container-metric-row">
                                                                                        <span className="metric-label">Max Latency:</span>
                                                                                        <span className="metric-value">{((containerDns.max_latency_ns || 0) / 1000).toFixed(2)} μs</span>
                                                                                    </div>
                                                                                </>
                                                                            ) : (
                                                                                <div className="enhanced-container-metric-row">
                                                                                    <span className="metric-value" style={{color: '#64748b', fontStyle: 'italic', width: '100%'}}>No DNS data</span>
                                                                                </div>
                                                                            )}
                                                                        </div>

                                                                        {/* TCP Metrics - Always show */}
                                                                        <div className="enhanced-container-metric-block">
                                                                            <div className="enhanced-container-metric-title">TCP Metrics</div>
                                                                            {containerTcp && containerTcp.total_events > 0 ? (
                                                                                <>
                                                                                    <div className="enhanced-container-metric-row">
                                                                                        <span className="metric-label">Events:</span>
                                                                                        <span className="metric-value">{(containerTcp.total_events || 0).toLocaleString()}</span>
                                                                                    </div>
                                                                                    <div className="enhanced-container-metric-row">
                                                                                        <span className="metric-label">Retransmissions:</span>
                                                                                        <span className="metric-value">{(containerTcp.total_retransmissions || 0).toLocaleString()}</span>
                                                                                    </div>
                                                                                    <div className="enhanced-container-metric-row">
                                                                                        <span className="metric-label">Avg RTT:</span>
                                                                                        <span className="metric-value">{((containerTcp.avg_rtt_us || 0) / 1000).toFixed(2)} ms</span>
                                                                                    </div>
                                                                                </>
                                                                            ) : (
                                                                                <div className="enhanced-container-metric-row">
                                                                                    <span className="metric-value" style={{color: '#64748b', fontStyle: 'italic', width: '100%'}}>No TCP data</span>
                                                                                </div>
                                                                            )}
                                                                        </div>

                                                                        {/* CPU Scheduling - Per-container */}
                                                                        <div className="enhanced-container-metric-block">
                                                                            <div className="enhanced-container-metric-title">CPU Scheduling</div>
                                                                            {containerSched ? (
                                                                                <>
                                                                                    <div className="enhanced-container-metric-row">
                                                                                        <span className="metric-label">Avg Latency:</span>
                                                                                        <span className="metric-value" style={{
                                                                                            color: (containerSched.avg_runqueue_latency_us || 0) > 10000 ? '#ef4444' : 
                                                                                                   (containerSched.avg_runqueue_latency_us || 0) > 5000 ? '#f59e0b' : '#10b981'
                                                                                        }}>
                                                                                            {(containerSched.avg_runqueue_latency_us || 0).toFixed(0)} μs
                                                                                        </span>
                                                                                    </div>
                                                                                    <div className="enhanced-container-metric-row">
                                                                                        <span className="metric-label">Events:</span>
                                                                                        <span className="metric-value">{(containerSched.event_count || 0).toLocaleString()}</span>
                                                                                    </div>
                                                                                    <div className="enhanced-container-metric-row">
                                                                                        <span className="metric-label">Max Latency:</span>
                                                                                        <span className="metric-value" style={{
                                                                                            color: (containerSched.max_runqueue_latency_us || 0) > 10000 ? '#ef4444' : '#10b981'
                                                                                        }}>
                                                                                            {(containerSched.max_runqueue_latency_us || 0).toFixed(0)} μs
                                                                                        </span>
                                                                                    </div>
                                                                                    <div className="enhanced-container-metric-row">
                                                                                        <span className="metric-label">Starvation:</span>
                                                                                        <span className="metric-value" style={{
                                                                                            color: (containerSched.cpu_starvation_count || 0) > 0 ? '#ef4444' : '#10b981'
                                                                                        }}>
                                                                                            {containerSched.cpu_starvation_count || 0}
                                                                                        </span>
                                                                                    </div>
                                                                                </>
                                                                            ) : (
                                                                                <div className="enhanced-container-metric-row">
                                                                                    <span className="metric-value" style={{color: '#64748b', fontStyle: 'italic', width: '100%'}}>
                                                                                        No scheduling data yet
                                                                                    </span>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    
                                                                    <div className="enhanced-container-resources">
                                                                        <div className="resource-item">
                                                                            <span className="resource-label">CPU:</span>
                                                                            <span className="resource-value">{container.resources?.requests?.cpu || 'N/A'}</span>
                                                                        </div>
                                                                        <div className="resource-item">
                                                                            <span className="resource-label">Memory:</span>
                                                                            <span className="resource-value">{container.resources?.requests?.memory || 'N/A'}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                );
                            })}
                        </div>
                    )}
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

