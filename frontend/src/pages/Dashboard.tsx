import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useMetrics } from '../hooks/useMetrics';
import { useClusterInfo } from '../hooks/useClusterInfo';
import { usePodDetails } from '../hooks/usePodDetails';
import { DNSLatencyChart } from '../components/DNSLatencyChart';
import { TCPMetricsChart } from '../components/TCPMetricsChart';
import { SystemResourcesChart } from '../components/SystemResourcesChart';
import { TCPIssuesChart } from '../components/TCPIssuesChart';
import { SystemHealth } from '../components/SystemHealth';
import { TopPerformers } from '../components/TopPerformers';
import { NetworkStats } from '../components/NetworkStats';
import { CPUSchedulingMetrics } from '../components/CPUSchedulingMetrics';
import DiskIOMetrics from '../components/DiskIOMetrics';
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
    const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
    const { metrics, loading, error, availableNodes, totalPodsAcrossAllNodes } = useMetrics(5000, selectedNodeKey);
    const clusterInfo = useClusterInfo(10000); // Increased from 5000ms to 10000ms
    const { data: podDetails, loading: podDetailsLoading } = usePodDetails(10000); // Increased from 5000ms to 10000ms
    const [activeSection, setActiveSection] = useState<string>('health');
    const sectionRefs = useRef<{ [key: string]: HTMLElement | null }>({});
    const [schedMetrics, setSchedMetrics] = useState<any>(null);
    const [containerSchedMetrics, setContainerSchedMetrics] = useState<any>({});
    const [selectedPod, setSelectedPod] = useState<string>('all');
    const [diskIOMetrics, setDiskIOMetrics] = useState<any>(null);
    const [diskIOPodMetrics, setDiskIOPodMetrics] = useState<any>({});
    const [diskIOContainerMetrics, setDiskIOContainerMetrics] = useState<any>({});

    // Auto-select first node when nodes become available
    useEffect(() => {
        if (availableNodes.length > 0 && !selectedNodeKey) {
            setSelectedNodeKey(availableNodes[0].key);
        }
    }, [availableNodes, selectedNodeKey]);

    // Save selected node to localStorage
    useEffect(() => {
        if (selectedNodeKey) {
            localStorage.setItem('selectedNodeKey', selectedNodeKey);
        }
    }, [selectedNodeKey]);

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
    }, []);

    // Extract supplementary metrics from WebSocket metrics updates
    useEffect(() => {
        if (!metrics) return;
        
        // Extract scheduling latency from metrics
        const schedData = (metrics as any).sched_latency;
        if (schedData) {
            setSchedMetrics(schedData);
        }
        
        // Extract disk I/O from metrics
        if (metrics.node_system?.disk_io) {
            setDiskIOMetrics(metrics.node_system.disk_io);
        }
        
        // Extract pod-level disk I/O (pod-level scheduling is already in schedMetrics.pod_metrics)
        if (metrics.pods) {
            const diskIOByPod: any = {};
            
            Object.entries(metrics.pods).forEach(([podKey, podData]: [string, any]) => {
                if (podData.disk_io) {
                    diskIOByPod[podKey] = podData.disk_io;
                }
            });
            
            if (Object.keys(diskIOByPod).length > 0) {
                setDiskIOPodMetrics(diskIOByPod);
            }
        }
        
        // Extract container-level metrics
        if (metrics.containers) {
            const diskIOByContainer: any = {};
            const schedByContainer: any = {};
            
            Object.entries(metrics.containers).forEach(([containerKey, containerData]: [string, any]) => {
                if (containerData.disk_io) {
                    diskIOByContainer[containerKey] = containerData.disk_io;
                }
                if (containerData.sched_latency) {
                    schedByContainer[containerKey] = containerData.sched_latency;
                }
            });
            
            if (Object.keys(diskIOByContainer).length > 0) {
                setDiskIOContainerMetrics(diskIOByContainer);
            } else {
                // Clear if no data
                setDiskIOContainerMetrics({});
            }
            
            if (Object.keys(schedByContainer).length > 0) {
                setContainerSchedMetrics(schedByContainer);
            } else {
                // Clear if no data
                setContainerSchedMetrics({});
            }
        }
    }, [metrics]);

    // Extract podMetrics from metrics
    const podMetrics = useMemo(() => {
        return metrics?.pods || {};
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

    // Define navigation items with professional icons - ordered to match dashboard sections
    const navItems = [
        { id: 'health', label: 'System Health', icon: FiActivity },
        { id: 'node-metrics', label: 'Node Metrics', icon: FiServer },
        { id: 'system', label: 'Node System Metrics', icon: FiCpu },
        { id: 'dns', label: 'DNS Metrics', icon: FiGlobe },
        { id: 'tcp', label: 'TCP Metrics', icon: FiRadio },
        { id: 'disk-io', label: 'Disk I/O', icon: FiDownload },
        { id: 'cpu-scheduling', label: 'CPU Scheduling', icon: FiClock },
        { id: 'performance', label: 'Performance', icon: FiZap },
        { id: 'pod-metrics', label: 'Pod Metrics', icon: FiPackage },
        { id: 'services', label: 'Service Health', icon: FiSettings },
    ];

    return (
        <div className="dashboard-content">
            {/* Node Selector - Top of Dashboard */}
            {availableNodes.length > 0 && (
                <div style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 100,
                    background: 'rgba(15, 23, 42, 0.95)',
                    backdropFilter: 'blur(10px)',
                    borderBottom: '1px solid rgba(71, 85, 105, 0.3)',
                    padding: '1.25rem 2rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '2rem',
                    flexWrap: 'wrap'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <FiServer style={{ color: '#60a5fa', fontSize: '1.25rem' }} />
                            <label style={{ color: '#e2e8f0', fontSize: '0.95rem', fontWeight: 600 }}>
                                Selected Node:
                            </label>
                            <select
                                value={selectedNodeKey || ''}
                                onChange={(e) => {
                                    const newKey = e.target.value || null;
                                    setSelectedNodeKey(newKey);
                                    if (newKey) {
                                        localStorage.setItem('selectedNodeKey', newKey);
                                    }
                                }}
                                style={{
                                    padding: '0.625rem 1.25rem',
                                    background: 'rgba(30, 41, 59, 0.8)',
                                    border: '2px solid rgba(59, 130, 246, 0.4)',
                                    borderRadius: '8px',
                                    color: '#e2e8f0',
                                    fontSize: '0.95rem',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    minWidth: '280px',
                                    outline: 'none',
                                    transition: 'all 0.2s ease'
                                }}
                                onFocus={(e) => {
                                    e.target.style.borderColor = 'rgba(59, 130, 246, 0.6)';
                                    e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
                                }}
                                onBlur={(e) => {
                                    e.target.style.borderColor = 'rgba(59, 130, 246, 0.4)';
                                    e.target.style.boxShadow = 'none';
                                }}
                            >
                                {availableNodes.map((node) => (
                                    <option key={node.key} value={node.key}>
                                        {node.name} {node.ip ? `(${node.ip})` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                        
                        {metrics?.node_name && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                padding: '0.625rem 1.25rem',
                                background: 'rgba(30, 41, 59, 0.6)',
                                border: '2px solid rgba(71, 85, 105, 0.4)',
                                borderRadius: '8px'
                            }}>
                                <FiServer style={{ color: '#94a3b8', fontSize: '1.1rem' }} />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                                    <span style={{ 
                                        color: '#94a3b8', 
                                        fontSize: '0.75rem', 
                                        fontWeight: 600,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.5px'
                                    }}>
                                        Current Node
                                    </span>
                                    <span style={{ 
                                        color: '#e2e8f0', 
                                        fontSize: '0.9rem', 
                                        fontWeight: 500 
                                    }}>
                                        {metrics.node_name} {metrics.node_ip ? `(${metrics.node_ip})` : ''}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
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
                    <SystemHealth metrics={metrics} />
                </section>

                {/* Node Metrics Section */}
                <section 
                    id="node-metrics" 
                    ref={(el) => (sectionRefs.current['node-metrics'] = el)}
                    className="section"
                >
                    <div className="section-header">
                        <h2>NODE METRICS</h2>
                        <span className="section-badge">Node Overview</span>
                    </div>
                    <div className="overview-grid">
                        <div className="overview-card">
                            <div className="overview-label">Node Name</div>
                            <div className="overview-value">{metrics?.node_name || 'N/A'}</div>
                            {metrics?.node_ip && (
                                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                                    IP: {metrics.node_ip}
                                </div>
                            )}
                        </div>
                        <div className="overview-card">
                            <div className="overview-label">eBPF Active Pods</div>
                            <div className="overview-value">
                                {metrics?.pods ? Object.keys(metrics.pods).length : 0}
                            </div>
                        </div>
                        <div className="overview-card">
                            <div className="overview-label">Active Containers</div>
                            <div className="overview-value">
                                {metrics?.containers ? Object.keys(metrics.containers).length : 0}
                            </div>
                        </div>
                    </div>
                </section>

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

                {/* DNS Metrics Section */}
                <section 
                    id="dns" 
                    ref={(el) => (sectionRefs.current['dns'] = el)}
                    className="section"
                >
                    <div className="section-header">
                        <h2>DNS METRICS</h2>
                        <span className="section-badge">Network Resolution</span>
                    </div>

                    {/* Node DNS Latency Chart */}
                    <div className="chart-container">
                        <DNSLatencyChart 
                            currentLatency={metrics?.dns.avg_latency_us || 0} 
                            title="Node DNS Latency Over Time"
                        />
                    </div>

                    <div className="metrics-grid">
                        <div className="stat-card dns">
                            <div className="stat-header">
                                <h3>Total Events</h3>
                            </div>
                            <div className="stat-value">{metrics?.dns.total_events.toLocaleString() || 0}</div>
                            <div className="stat-details">
                                <span className="stat-label">DNS Queries</span>
                            </div>
                        </div>

                        <div className="stat-card latency">
                            <div className="stat-header">
                                <h3>Average Latency</h3>
                            </div>
                            <div className="stat-value">{(metrics?.dns?.avg_latency_us || 0).toFixed(2)} <span className="unit">μs</span></div>
                            <div className="stat-details">
                                <span className="stat-label">Mean Response Time</span>
                                <span className="stat-sublabel">{((metrics?.dns?.avg_latency_us || 0) / 1000).toFixed(2)} ms</span>
                            </div>
                        </div>

                        <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%)', borderColor: 'rgba(59, 130, 246, 0.3)'}}>
                            <div className="stat-header">
                                <h3>Last Latency</h3>
                            </div>
                            <div className="stat-value" style={{color: '#3b82f6'}}>
                                {metrics?.dns.last_latency_us ? metrics.dns.last_latency_us.toFixed(2) : '0.00'} <span className="unit">μs</span>
                            </div>
                            <div className="stat-details">
                                <span className="stat-label">Most Recent Query</span>
                                <span className="stat-sublabel">
                                    {metrics?.dns.last_latency_us ? (metrics.dns.last_latency_us / 1000).toFixed(2) + ' ms' : 'N/A'}
                                </span>
                            </div>
                        </div>

                        <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%)', borderColor: 'rgba(16, 185, 129, 0.3)'}}>
                            <div className="stat-header">
                                <h3>Min Latency</h3>
                            </div>
                            <div className="stat-value" style={{color: '#10b981'}}>
                                {metrics?.dns.min_latency_us ? metrics.dns.min_latency_us.toFixed(2) : '0.00'} <span className="unit">μs</span>
                            </div>
                            <div className="stat-details">
                                <span className="stat-label">Fastest Response</span>
                                <span className="stat-sublabel">
                                    {metrics?.dns.min_latency_us ? (metrics.dns.min_latency_us / 1000).toFixed(2) + ' ms' : 'N/A'}
                                </span>
                            </div>
                        </div>

                        <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(239, 68, 68, 0.05) 100%)', borderColor: 'rgba(239, 68, 68, 0.3)'}}>
                            <div className="stat-header">
                                <h3>Max Latency</h3>
                            </div>
                            <div className="stat-value" style={{color: '#ef4444'}}>
                                {metrics?.dns.max_latency_us ? metrics.dns.max_latency_us.toFixed(2) : '0.00'} <span className="unit">μs</span>
                            </div>
                            <div className="stat-details">
                                <span className="stat-label">Slowest Response</span>
                                <span className="stat-sublabel">
                                    {metrics?.dns.max_latency_us ? (metrics.dns.max_latency_us / 1000).toFixed(2) + ' ms' : 'N/A'}
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* TCP Metrics Section */}
                {metrics?.tcp && (
                    <section 
                        id="tcp" 
                        ref={(el) => (sectionRefs.current['tcp'] = el)}
                        className="section"
                    >
                        <div className="section-header">
                            <h2>TCP METRICS</h2>
                            <span className="section-badge">Connection Performance</span>
                        </div>

                        {/* TCP Metrics Chart */}
                        {metrics.tcp.total_events > 0 && (
                            <div className="chart-container">
                                <TCPMetricsChart 
                                    currentSRTT={metrics.tcp.last_srtt_us || 0}
                                    currentMinRTT={metrics.tcp.last_min_rtt_us || 0}
                                    title="TCP RTT Metrics Over Time"
                                />
                            </div>
                        )}

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

                        {metrics.tcp.total_events > 0 && (
                            <div className="metrics-grid" style={{marginBottom: '2rem'}}>
                                <div className="stat-card tcp">
                                    <div className="stat-header">
                                        <h3>Total Events</h3>
                                    </div>
                                    <div className="stat-value">{metrics.tcp.total_events.toLocaleString()}</div>
                                    <div className="stat-details">
                                        <span className="stat-label">TCP Connections</span>
                                    </div>
                                </div>

                                <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%)', borderColor: 'rgba(59, 130, 246, 0.3)'}}>
                                    <div className="stat-header">
                                        <h3>Average SRTT</h3>
                                    </div>
                                    <div className="stat-value" style={{
                                        color: '#3b82f6',
                                        fontSize: metrics.tcp.avg_srtt_us > 1000000 ? '1.4rem' : '2rem',
                                        wordBreak: 'break-word',
                                        lineHeight: '1.2'
                                    }}>
                                        {(() => {
                                            const val = metrics.tcp.avg_srtt_us || 0;
                                            if (val >= 1000000) {
                                                return (val / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ms';
                                            }
                                            return val.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' μs';
                                        })()}
                                    </div>
                                    <div className="stat-details">
                                        <span className="stat-label">Mean Smoothed RTT</span>
                                        <span className="stat-sublabel">
                                            {metrics.tcp.avg_srtt_us ? (
                                                metrics.tcp.avg_srtt_us >= 1000000 
                                                    ? (metrics.tcp.avg_srtt_us / 1000000).toFixed(2) + ' s'
                                                    : (metrics.tcp.avg_srtt_us / 1000).toFixed(2) + ' ms'
                                            ) : 'N/A'}
                                        </span>
                                    </div>
                                </div>

                                <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(139, 92, 246, 0.05) 100%)', borderColor: 'rgba(139, 92, 246, 0.3)'}}>
                                    <div className="stat-header">
                                        <h3>Last SRTT</h3>
                                    </div>
                                    <div className="stat-value" style={{
                                        color: '#a78bfa',
                                        fontSize: metrics.tcp.last_srtt_us > 1000000 ? '1.4rem' : '2rem',
                                        wordBreak: 'break-word',
                                        lineHeight: '1.2'
                                    }}>
                                        {(() => {
                                            const val = metrics.tcp.last_srtt_us || 0;
                                            if (val >= 1000000) {
                                                return (val / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ms';
                                            }
                                            return val.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' μs';
                                        })()}
                                    </div>
                                    <div className="stat-details">
                                        <span className="stat-label">Most Recent SRTT</span>
                                        <span className="stat-sublabel">
                                            {metrics.tcp.last_srtt_us ? (
                                                metrics.tcp.last_srtt_us >= 1000000 
                                                    ? (metrics.tcp.last_srtt_us / 1000000).toFixed(2) + ' s'
                                                    : (metrics.tcp.last_srtt_us / 1000).toFixed(2) + ' ms'
                                            ) : 'N/A'}
                                        </span>
                                    </div>
                                </div>

                                <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%)', borderColor: 'rgba(16, 185, 129, 0.3)'}}>
                                    <div className="stat-header">
                                        <h3>Min RTT</h3>
                                    </div>
                                    <div className="stat-value" style={{
                                        color: '#10b981',
                                        fontSize: metrics.tcp.last_min_rtt_us > 1000000 ? '1.4rem' : '2rem',
                                        wordBreak: 'break-word',
                                        lineHeight: '1.2'
                                    }}>
                                        {(() => {
                                            const val = metrics.tcp.last_min_rtt_us || 0;
                                            if (val >= 1000000) {
                                                return (val / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ms';
                                            }
                                            return val.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' μs';
                                        })()}
                                    </div>
                                    <div className="stat-details">
                                        <span className="stat-label">Minimum Round Trip Time</span>
                                        <span className="stat-sublabel">
                                            {metrics.tcp.last_min_rtt_us ? (
                                                metrics.tcp.last_min_rtt_us >= 1000000 
                                                    ? (metrics.tcp.last_min_rtt_us / 1000000).toFixed(2) + ' s'
                                                    : (metrics.tcp.last_min_rtt_us / 1000).toFixed(2) + ' ms'
                                            ) : 'N/A'}
                                        </span>
                                    </div>
                                </div>

                                <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(239, 68, 68, 0.05) 100%)', borderColor: 'rgba(239, 68, 68, 0.3)'}}>
                                    <div className="stat-header">
                                        <h3>Retransmissions</h3>
                                    </div>
                                    <div className="stat-value" style={{color: '#ef4444'}}>
                                        {metrics.tcp.retransmissions.toLocaleString()}
                                    </div>
                                    <div className="stat-details">
                                        <span className="stat-label">Total Retransmissions</span>
                                        <span className="stat-sublabel">
                                            {metrics.tcp.total_events > 0 ? ((metrics.tcp.retransmissions / metrics.tcp.total_events) * 100).toFixed(2) + '% rate' : '0%'}
                                        </span>
                                    </div>
                                </div>

                                <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(245, 158, 11, 0.05) 100%)', borderColor: 'rgba(245, 158, 11, 0.3)'}}>
                                    <div className="stat-header">
                                        <h3>Packet Loss</h3>
                                    </div>
                                    <div className="stat-value" style={{color: '#f59e0b'}}>
                                        {metrics.tcp.packet_loss.toLocaleString()}
                                    </div>
                                    <div className="stat-details">
                                        <span className="stat-label">Total Packet Loss</span>
                                        <span className="stat-sublabel">
                                            {metrics.tcp.total_events > 0 ? ((metrics.tcp.packet_loss / metrics.tcp.total_events) * 100).toFixed(2) + '% rate' : '0%'}
                                        </span>
                                    </div>
                                </div>

                                <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.1) 0%, rgba(236, 72, 153, 0.05) 100%)', borderColor: 'rgba(236, 72, 153, 0.3)'}}>
                                    <div className="stat-header">
                                        <h3>Bad Handshakes</h3>
                                    </div>
                                    <div className="stat-value" style={{color: '#ec4899'}}>
                                        {metrics.tcp.bad_handshakes.toLocaleString()}
                                    </div>
                                    <div className="stat-details">
                                        <span className="stat-label">Failed Connections</span>
                                        <span className="stat-sublabel">
                                            {metrics.tcp.total_events > 0 ? ((metrics.tcp.bad_handshakes / metrics.tcp.total_events) * 100).toFixed(2) + '% rate' : '0%'}
                                        </span>
                                    </div>
                                </div>

                                <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(99, 102, 241, 0.05) 100%)', borderColor: 'rgba(99, 102, 241, 0.3)'}}>
                                    <div className="stat-header">
                                        <h3>Congestion Window</h3>
                                    </div>
                                    <div className="stat-value" style={{
                                        color: '#6366f1',
                                        fontSize: metrics.tcp.last_cwnd > 1000000 ? '1.4rem' : '2rem',
                                        wordBreak: 'break-word',
                                        lineHeight: '1.2'
                                    }}>
                                        {(() => {
                                            const val = metrics.tcp.last_cwnd || 0;
                                            if (val >= 1073741824) {
                                                return (val / 1073741824).toFixed(2) + ' GB';
                                            } else if (val >= 1048576) {
                                                return (val / 1048576).toFixed(2) + ' MB';
                                            } else if (val >= 1024) {
                                                return (val / 1024).toFixed(2) + ' KB';
                                            }
                                            return val.toLocaleString() + ' B';
                                        })()}
                                    </div>
                                    <div className="stat-details">
                                        <span className="stat-label">Last CWND</span>
                                        <span className="stat-sublabel">
                                            {metrics.tcp.last_cwnd ? metrics.tcp.last_cwnd.toLocaleString() + ' bytes' : 'N/A'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* TCP Events Timeline */}
                        <div className="section-header" style={{marginTop: '2rem', marginBottom: '1rem'}}>
                            <h3 style={{fontSize: '1.1rem', color: '#e2e8f0', fontWeight: 600}}>TCP Events Timeline</h3>
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

                {/* Disk I/O Metrics */}
                {diskIOMetrics && (
                    <section 
                        id="disk-io" 
                        ref={(el) => (sectionRefs.current['disk-io'] = el)}
                        className="section"
                    >
                        <div className="section-header">
                            <h2>DISK I/O METRICS</h2>
                            <span className="section-badge">Storage Performance</span>
                        </div>
                        <DiskIOMetrics 
                            data={diskIOMetrics}
                            title="Node Disk I/O Metrics"
                        />
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
                    <CPUSchedulingMetrics metrics={metrics} />
                </section>

                {/* Performance Rankings */}
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
                        <TopPerformers metrics={metrics} />
                    </section>
                )}

                {/* Pod-Level Metrics Section */}
                {podMetrics && Object.keys(podMetrics).length > 0 && (
                    <section 
                        id="pod-metrics" 
                        ref={(el) => (sectionRefs.current['pod-metrics'] = el)}
                        className="section"
                    >
                        <div className="section-header">
                            <h2>POD-LEVEL METRICS</h2>
                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <span className="section-badge">{Object.keys(podMetrics).length} Active Pods</span>
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
                                        <option value="all">All Pods ({Object.keys(podMetrics).length})</option>
                                        {Object.keys(podMetrics).sort().map((podKey) => {
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

                        {/* Available Metrics Summary - Professional Design */}
                        <div style={{
                            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.9) 100%)',
                            border: '1px solid rgba(71, 85, 105, 0.4)',
                            borderRadius: '12px',
                            padding: '2rem',
                            marginBottom: '2rem',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)'
                        }}>
                            {/* Header Section */}
                            <div style={{ 
                                marginBottom: '2rem',
                                paddingBottom: '1.5rem',
                                borderBottom: '1px solid rgba(71, 85, 105, 0.3)'
                            }}>
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '0.75rem',
                                    marginBottom: '0.5rem'
                                }}>
                                    <FiBarChart2 style={{ 
                                        fontSize: '1.25rem', 
                                        color: '#60a5fa',
                                        filter: 'drop-shadow(0 0 4px rgba(96, 165, 250, 0.3))'
                                    }} />
                                    <h3 style={{ 
                                        fontSize: '1.125rem', 
                                        color: '#e2e8f0', 
                                        fontWeight: 600,
                                        margin: 0,
                                        letterSpacing: '0.025em'
                                    }}>
                                        Available Pod Metrics
                                    </h3>
                                </div>
                                <p style={{ 
                                    fontSize: '0.875rem', 
                                    color: '#94a3b8',
                                    margin: 0,
                                    lineHeight: '1.6',
                                    marginLeft: '2rem'
                                }}>
                                    Real-time eBPF metrics collected from all pods in the cluster
                                </p>
                            </div>

                            {/* Metrics Grid */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                                gap: '1.25rem'
                            }}>
                                {/* DNS Performance Card */}
                                <div style={{
                                    background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
                                    border: '1px solid rgba(59, 130, 246, 0.2)',
                                    borderRadius: '10px',
                                    padding: '1.5rem',
                                    transition: 'all 0.3s ease',
                                    position: 'relative',
                                    overflow: 'hidden'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.4)';
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 8px 16px -4px rgba(59, 130, 246, 0.2)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.2)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                                >
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '0.75rem',
                                        marginBottom: '1rem'
                                    }}>
                                        <div style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '8px',
                                            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(37, 99, 235, 0.15) 100%)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            border: '1px solid rgba(59, 130, 246, 0.3)'
                                        }}>
                                            <FiGlobe style={{ fontSize: '1.25rem', color: '#60a5fa' }} />
                                        </div>
                                        <div>
                                            <div style={{ 
                                                fontSize: '0.9375rem', 
                                                color: '#e2e8f0', 
                                                fontWeight: 600,
                                                letterSpacing: '0.025em'
                                            }}>
                                                DNS Performance
                                            </div>
                                            <div style={{ 
                                                fontSize: '0.75rem', 
                                                color: '#64748b',
                                                marginTop: '0.125rem'
                                            }}>
                                                Network Resolution
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ 
                                        fontSize: '0.8125rem', 
                                        color: '#cbd5e1', 
                                        lineHeight: '1.75',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.5rem'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ color: '#60a5fa', fontSize: '0.625rem' }}>▸</span>
                                            <span>Query latency (avg, min, max)</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ color: '#60a5fa', fontSize: '0.625rem' }}>▸</span>
                                            <span>Total DNS queries</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ color: '#60a5fa', fontSize: '0.625rem' }}>▸</span>
                                            <span>Response time distribution</span>
                                        </div>
                                    </div>
                                </div>

                                {/* TCP Network Card */}
                                <div style={{
                                    background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
                                    border: '1px solid rgba(34, 197, 94, 0.2)',
                                    borderRadius: '10px',
                                    padding: '1.5rem',
                                    transition: 'all 0.3s ease',
                                    position: 'relative',
                                    overflow: 'hidden'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.4)';
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 8px 16px -4px rgba(34, 197, 94, 0.2)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.2)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                                >
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '0.75rem',
                                        marginBottom: '1rem'
                                    }}>
                                        <div style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '8px',
                                            background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(22, 163, 74, 0.15) 100%)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            border: '1px solid rgba(34, 197, 94, 0.3)'
                                        }}>
                                            <FiRadio style={{ fontSize: '1.25rem', color: '#4ade80' }} />
                                        </div>
                                        <div>
                                            <div style={{ 
                                                fontSize: '0.9375rem', 
                                                color: '#e2e8f0', 
                                                fontWeight: 600,
                                                letterSpacing: '0.025em'
                                            }}>
                                                TCP Network
                                            </div>
                                            <div style={{ 
                                                fontSize: '0.75rem', 
                                                color: '#64748b',
                                                marginTop: '0.125rem'
                                            }}>
                                                Connection Metrics
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ 
                                        fontSize: '0.8125rem', 
                                        color: '#cbd5e1', 
                                        lineHeight: '1.75',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.5rem'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ color: '#4ade80', fontSize: '0.625rem' }}>▸</span>
                                            <span>Round-trip time (RTT)</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ color: '#4ade80', fontSize: '0.625rem' }}>▸</span>
                                            <span>Retransmissions & packet loss</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ color: '#4ade80', fontSize: '0.625rem' }}>▸</span>
                                            <span>Connection events</span>
                                        </div>
                                    </div>
                                </div>

                                {/* CPU Scheduling Card */}
                                <div style={{
                                    background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
                                    border: '1px solid rgba(251, 191, 36, 0.2)',
                                    borderRadius: '10px',
                                    padding: '1.5rem',
                                    transition: 'all 0.3s ease',
                                    position: 'relative',
                                    overflow: 'hidden'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(251, 191, 36, 0.4)';
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 8px 16px -4px rgba(251, 191, 36, 0.2)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(251, 191, 36, 0.2)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                                >
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '0.75rem',
                                        marginBottom: '1rem'
                                    }}>
                                        <div style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '8px',
                                            background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.2) 0%, rgba(245, 158, 11, 0.15) 100%)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            border: '1px solid rgba(251, 191, 36, 0.3)'
                                        }}>
                                            <FiCpu style={{ fontSize: '1.25rem', color: '#fbbf24' }} />
                                        </div>
                                        <div>
                                            <div style={{ 
                                                fontSize: '0.9375rem', 
                                                color: '#e2e8f0', 
                                                fontWeight: 600,
                                                letterSpacing: '0.025em'
                                            }}>
                                                CPU Scheduling
                                            </div>
                                            <div style={{ 
                                                fontSize: '0.75rem', 
                                                color: '#64748b',
                                                marginTop: '0.125rem'
                                            }}>
                                                Scheduler Metrics
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ 
                                        fontSize: '0.8125rem', 
                                        color: '#cbd5e1', 
                                        lineHeight: '1.75',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.5rem'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ color: '#fbbf24', fontSize: '0.625rem' }}>▸</span>
                                            <span>Run queue latency</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ color: '#fbbf24', fontSize: '0.625rem' }}>▸</span>
                                            <span>CPU starvation events</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ color: '#fbbf24', fontSize: '0.625rem' }}>▸</span>
                                            <span>Scheduling delays & context switches</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Disk I/O Card */}
                                <div style={{
                                    background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%)',
                                    border: '1px solid rgba(168, 85, 247, 0.2)',
                                    borderRadius: '10px',
                                    padding: '1.5rem',
                                    transition: 'all 0.3s ease',
                                    position: 'relative',
                                    overflow: 'hidden'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.4)';
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 8px 16px -4px rgba(168, 85, 247, 0.2)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(168, 85, 247, 0.2)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                                >
                                    <div style={{ 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '0.75rem',
                                        marginBottom: '1rem'
                                    }}>
                                        <div style={{
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '8px',
                                            background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2) 0%, rgba(147, 51, 234, 0.15) 100%)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            border: '1px solid rgba(168, 85, 247, 0.3)'
                                        }}>
                                            <FiDownload style={{ fontSize: '1.25rem', color: '#a78bfa' }} />
                                        </div>
                                        <div>
                                            <div style={{ 
                                                fontSize: '0.9375rem', 
                                                color: '#e2e8f0', 
                                                fontWeight: 600,
                                                letterSpacing: '0.025em'
                                            }}>
                                                Disk I/O
                                            </div>
                                            <div style={{ 
                                                fontSize: '0.75rem', 
                                                color: '#64748b',
                                                marginTop: '0.125rem'
                                            }}>
                                                Storage Performance
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ 
                                        fontSize: '0.8125rem', 
                                        color: '#cbd5e1', 
                                        lineHeight: '1.75',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.5rem'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ color: '#a78bfa', fontSize: '0.625rem' }}>▸</span>
                                            <span>Read/write latency</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ color: '#a78bfa', fontSize: '0.625rem' }}>▸</span>
                                            <span>I/O operations count</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ color: '#a78bfa', fontSize: '0.625rem' }}>▸</span>
                                            <span>Data transfer rates & queue depth</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {selectedPod === 'all' ? (
                            <div className="pods-grid">
                                {Object.entries(podMetrics).map(([podKey, podData]) => {
                                const dnsStats = podData.dns_latency;
                                const tcpStats = podData.tcp_metrics;
                                const podDiskIO = diskIOPodMetrics[podKey];
                                const [namespace, podName] = podKey.split('/');
                                
                                const dnsAvgLatencyUs = dnsStats?.avg_latency_us || 0;
                                const dnsMinLatencyUs = dnsStats?.min_latency_us || 0;
                                const dnsMaxLatencyUs = dnsStats?.max_latency_us || 0;
                                
                                // Get container-level metrics for this pod
                                const containerMetrics: Record<string, any> = {};
                                if (metrics?.containers) {
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
                                                        <div className="metric-value-clean">{(tcpStats.total_events || 0).toLocaleString()}</div>
                                                    </div>
                                                    <div className="metric-cell-clean">
                                                        <div className="metric-label-clean">Events</div>
                                                        <div className="metric-value-clean">{(tcpStats.total_events || 0).toLocaleString()}</div>
                                                    </div>
                                                    <div className="metric-cell-clean">
                                                        <div className="metric-label-clean">Retransmits</div>
                                                        <div className="metric-value-clean">{(tcpStats.retransmissions || 0).toLocaleString()}</div>
                                                    </div>
                                                    <div className="metric-cell-clean">
                                                        <div className="metric-label-clean">Avg SRTT</div>
                                                        <div className="metric-value-clean">{((tcpStats.avg_srtt_us || 0) / 1000).toFixed(2)} ms</div>
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

                                            {/* Disk I/O Metrics for Pod */}
                                            {podDiskIO && (
                                                <div className="metric-block-clean">
                                                    <div className="metric-block-title">Disk I/O Performance</div>
                                                    <div className="metric-grid-clean">
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Total Operations</div>
                                                            <div className="metric-value-clean">{(podDiskIO.total_io_operations || 0).toLocaleString()}</div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Avg Latency</div>
                                                            <div className="metric-value-clean">
                                                                {podDiskIO.avg_io_latency_ns 
                                                                    ? (podDiskIO.avg_io_latency_ns < 1000000 
                                                                        ? `${(podDiskIO.avg_io_latency_ns / 1000).toFixed(1)} μs` 
                                                                        : `${(podDiskIO.avg_io_latency_ns / 1000000).toFixed(2)} ms`)
                                                                    : '0 μs'}
                                                            </div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Reads</div>
                                                            <div className="metric-value-clean">{(podDiskIO.total_reads || 0).toLocaleString()}</div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Writes</div>
                                                            <div className="metric-value-clean">{(podDiskIO.total_writes || 0).toLocaleString()}</div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Data Transferred</div>
                                                            <div className="metric-value-clean" style={{fontSize: '0.95rem'}}>
                                                                {podDiskIO.total_io_bytes 
                                                                    ? (podDiskIO.total_io_bytes < 1024 
                                                                        ? `${podDiskIO.total_io_bytes} B`
                                                                        : podDiskIO.total_io_bytes < 1048576
                                                                        ? `${(podDiskIO.total_io_bytes / 1024).toFixed(1)} KB`
                                                                        : `${(podDiskIO.total_io_bytes / 1048576).toFixed(1)} MB`)
                                                                    : '0 B'}
                                                            </div>
                                                        </div>
                                                        <div className="metric-cell-clean">
                                                            <div className="metric-label-clean">Queue Depth</div>
                                                            <div className="metric-value-clean">{(podDiskIO.current_queue_depth || 0)}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
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
                                                        const containerKey = `${podKey}/${containerName}`;
                                                        
                                                        // Get container data from both sources
                                                        const containerData = containerMetrics[containerName] || {};
                                                        // Also try direct lookup from metrics.containers using full key
                                                        const containerDataDirect = metrics?.containers?.[containerKey] || {};
                                                        
                                                        // Merge both sources (direct lookup takes precedence)
                                                        const mergedContainerData = { ...containerData, ...containerDataDirect };
                                                        
                                                        const containerDns = mergedContainerData.dns_latency;
                                                        const containerTcp = mergedContainerData.tcp_metrics;
                                                        const containerDiskIO = mergedContainerData.disk_io || diskIOContainerMetrics[containerKey];
                                                        const containerSched = containerSchedMetrics[containerKey];
                                                        
                                                        // Only show containers that have at least one metric type
                                                        // This reduces noise from containers that haven't generated eBPF events yet

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
                                                                
                                                                {/* eBPF Metrics - Organized by Type - Only show sections with data */}
                                                                <div className="container-metrics-organized">
                                                                    {/* DNS Metrics Section - Only show if has data */}
                                                                    {containerDns && (containerDns.total_events > 0 || containerDns.avg_latency_ns !== undefined) && (
                                                                        <div className="container-metric-section">
                                                                            <div className="container-metric-section-title">DNS Performance</div>
                                                                            <div className="container-metric-details">
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Queries:</span>
                                                                                    <span className="metric-item-value">{containerDns.total_events.toLocaleString()}</span>
                                                                                </div>
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Avg Latency:</span>
                                                                                    <span className="metric-item-value">{containerDns.avg_latency_us.toFixed(1)} μs</span>
                                                                                </div>
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Max Latency:</span>
                                                                                    <span className="metric-item-value">{(containerDns.max_latency_ns / 1000).toFixed(1)} μs</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {/* TCP Metrics Section - Only show if has data */}
                                                                    {containerTcp && (containerTcp.total_events > 0 || containerTcp.avg_rtt_us !== undefined || containerTcp.last_srtt_us !== undefined) && (
                                                                        <div className="container-metric-section">
                                                                            <div className="container-metric-section-title">TCP Network</div>
                                                                            <div className="container-metric-details">
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Events:</span>
                                                                                    <span className="metric-item-value">{containerTcp.total_events.toLocaleString()}</span>
                                                                                </div>
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Retransmissions:</span>
                                                                                    <span className="metric-item-value" style={{color: (containerTcp.retransmissions || 0) > 0 ? '#ef4444' : '#10b981'}}>
                                                                                        {(containerTcp.retransmissions || 0).toLocaleString()}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Avg RTT:</span>
                                                                                    <span className="metric-item-value">{((containerTcp.last_srtt_us || 0) / 1000).toFixed(1)} ms</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {/* CPU Scheduling Section - Only show if has data */}
                                                                    {containerSched && (
                                                                        <div className="container-metric-section">
                                                                            <div className="container-metric-section-title">CPU Scheduling</div>
                                                                            <div className="container-metric-details">
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Avg Latency:</span>
                                                                                    <span className="metric-item-value" style={{
                                                                                        color: (containerSched.avg_runqueue_latency_us || 0) > 10000 ? '#ef4444' : 
                                                                                               (containerSched.avg_runqueue_latency_us || 0) > 5000 ? '#f59e0b' : '#10b981'
                                                                                    }}>
                                                                                        {(containerSched.avg_runqueue_latency_us || 0).toFixed(0)} μs
                                                                                    </span>
                                                                                </div>
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Events:</span>
                                                                                    <span className="metric-item-value">{(containerSched.event_count || 0).toLocaleString()}</span>
                                                                                </div>
                                                                                {(containerSched.cpu_starvation_count || 0) > 0 && (
                                                                                    <div className="container-metric-item">
                                                                                        <span className="metric-item-label">Starvation:</span>
                                                                                        <span className="metric-item-value" style={{color: '#ef4444', fontWeight: 700}}>
                                                                                            {(containerSched.cpu_starvation_count || 0)}
                                                                                        </span>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {/* Disk I/O Section - Only show if has data */}
                                                                    {containerDiskIO && (containerDiskIO.total_io_operations > 0 || containerDiskIO.total_reads !== undefined || containerDiskIO.total_writes !== undefined) && (
                                                                        <div className="container-metric-section">
                                                                            <div className="container-metric-section-title">Disk I/O</div>
                                                                            <div className="container-metric-details">
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Operations:</span>
                                                                                    <span className="metric-item-value">{(containerDiskIO.total_io_operations || 0).toLocaleString()}</span>
                                                                                </div>
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Avg Latency:</span>
                                                                                    <span className="metric-item-value">
                                                                                        {containerDiskIO.avg_io_latency_ns 
                                                                                            ? (containerDiskIO.avg_io_latency_ns < 1000000 
                                                                                                ? `${(containerDiskIO.avg_io_latency_ns / 1000).toFixed(1)} μs` 
                                                                                                : `${(containerDiskIO.avg_io_latency_ns / 1000000).toFixed(2)} ms`)
                                                                                            : '0 μs'}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Reads:</span>
                                                                                    <span className="metric-item-value">{(containerDiskIO.total_reads || 0).toLocaleString()}</span>
                                                                                </div>
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Writes:</span>
                                                                                    <span className="metric-item-value">{(containerDiskIO.total_writes || 0).toLocaleString()}</span>
                                                                                </div>
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Data:</span>
                                                                                    <span className="metric-item-value">
                                                                                        {containerDiskIO.total_io_bytes 
                                                                                            ? (containerDiskIO.total_io_bytes < 1024 
                                                                                                ? `${containerDiskIO.total_io_bytes} B`
                                                                                                : containerDiskIO.total_io_bytes < 1048576
                                                                                                ? `${(containerDiskIO.total_io_bytes / 1024).toFixed(1)} KB`
                                                                                                : `${(containerDiskIO.total_io_bytes / 1048576).toFixed(1)} MB`)
                                                                                            : '0 B'}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="container-metric-item">
                                                                                    <span className="metric-item-label">Queue Depth:</span>
                                                                                    <span className="metric-item-value">{(containerDiskIO.current_queue_depth || 0)}</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {/* Show message only if container has NO metrics at all */}
                                                                    {!containerDns && !containerTcp && !containerSched && !containerDiskIO && (
                                                                        <div className="container-metric-empty" style={{padding: '1rem', textAlign: 'center'}}>
                                                                            No eBPF metrics available yet. Metrics will appear as the container generates activity.
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
                                    const podData = podMetrics?.[podKey];
                                    if (!podData) return null;
                                    
                                    const dnsStats = podData.dns_latency;
                                    const tcpStats = podData.tcp_metrics;
                                    const [namespace, podName] = podKey.split('/');
                                    
                                    const dnsAvgLatencyUs = dnsStats?.avg_latency_us || 0;
                                    const dnsMinLatencyUs = dnsStats?.min_latency_us || 0;
                                    const dnsMaxLatencyUs = dnsStats?.max_latency_us || 0;
                                    
                                    const containerMetrics: Record<string, any> = {};
                                    if (metrics?.containers) {
                                        Object.entries(metrics.containers).forEach(([containerKey, containerData]) => {
                                            const parts = containerKey.split('/');
                                            if (parts.length >= 3) {
                                                const containerPodKey = `${parts[0]}/${parts[1]}`;
                                                if (containerPodKey === podKey) {
                                                    const containerName = parts[2];
                                                    containerMetrics[containerName] = containerData;
                                                }
                                            }
                                        });
                                    }
                                    
                                    const podSchedMetrics = schedMetrics?.pod_metrics?.[podKey];
                                    const podDiskIO = diskIOPodMetrics[podKey];
                                    
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
                                                        <div className="enhanced-metric-value">{((tcpStats.avg_srtt_us || 0) / 1000).toFixed(2)} ms</div>
                                                        <div className="enhanced-metric-details">
                                                            <span>Connections: {(tcpStats.total_events || 0).toLocaleString()}</span>
                                                            <span>Events: {(tcpStats.total_events || 0).toLocaleString()}</span>
                                                            <span>Retrans: {(tcpStats.retransmissions || 0).toLocaleString()}</span>
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
                                                
                                                {podDiskIO && (
                                                    <div className="enhanced-metric-card">
                                                        <div className="enhanced-metric-header">Disk I/O</div>
                                                        <div className="enhanced-metric-value" style={{fontSize: '1.1rem'}}>
                                                            {podDiskIO.total_io_operations 
                                                                ? (podDiskIO.total_io_operations < 1000 
                                                                    ? podDiskIO.total_io_operations.toLocaleString()
                                                                    : `${(podDiskIO.total_io_operations / 1000).toFixed(1)}K`)
                                                                : '0'} ops
                                                        </div>
                                                        <div className="enhanced-metric-details">
                                                            <span>
                                                                Latency: {podDiskIO.avg_io_latency_ns 
                                                                    ? (podDiskIO.avg_io_latency_ns < 1000000 
                                                                        ? `${(podDiskIO.avg_io_latency_ns / 1000).toFixed(1)} μs` 
                                                                        : `${(podDiskIO.avg_io_latency_ns / 1000000).toFixed(2)} ms`)
                                                                    : '0 μs'}
                                                            </span>
                                                            <span>
                                                                Data: {podDiskIO.total_io_bytes 
                                                                    ? (podDiskIO.total_io_bytes < 1024 
                                                                        ? `${podDiskIO.total_io_bytes} B`
                                                                        : podDiskIO.total_io_bytes < 1048576
                                                                        ? `${(podDiskIO.total_io_bytes / 1024).toFixed(1)} KB`
                                                                        : `${(podDiskIO.total_io_bytes / 1048576).toFixed(1)} MB`)
                                                                    : '0 B'}
                                                            </span>
                                                            <span>Queue: {podDiskIO.current_queue_depth || 0}</span>
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
                                                                <span className="detail-value">{(tcpStats.total_events || 0).toLocaleString()}</span>
                                                            </div>
                                                            <div className="detail-row">
                                                                <span className="detail-label">Total Events:</span>
                                                                <span className="detail-value">{(tcpStats.total_events || 0).toLocaleString()}</span>
                                                            </div>
                                                            <div className="detail-row">
                                                                <span className="detail-label">Retransmissions:</span>
                                                                <span className="detail-value">{(tcpStats.retransmissions || 0).toLocaleString()}</span>
                                                            </div>
                                                            <div className="detail-row">
                                                                <span className="detail-label">Average RTT:</span>
                                                                <span className="detail-value">{((tcpStats.avg_srtt_us || 0) / 1000).toFixed(2)} ms</span>
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
                                                            const containerKey = `${podKey}/${containerName}`;
                                                            
                                                            // Get container data from both sources
                                                            const containerData = containerMetrics[containerName] || {};
                                                            // Also try direct lookup from metrics.containers using full key
                                                            const containerDataDirect = metrics?.containers?.[containerKey] || {};
                                                            
                                                            // Merge both sources (direct lookup takes precedence)
                                                            const mergedContainerData = { ...containerData, ...containerDataDirect };
                                                            
                                                            const containerDns = mergedContainerData.dns_latency;
                                                            const containerTcp = mergedContainerData.tcp_metrics;
                                                            const containerDiskIO = mergedContainerData.disk_io || diskIOContainerMetrics[containerKey];
                                                            const containerSched = containerSchedMetrics[containerKey];
                                                            const hasMetrics = (containerDns && containerDns.total_events > 0) || 
                                                                              (containerTcp && containerTcp.total_events > 0) ||
                                                                              (containerDiskIO && containerDiskIO.total_io_operations > 0);

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
                                                                        {/* DNS Metrics - Only show if has data */}
                                                                        {containerDns && containerDns.total_events > 0 && (
                                                                            <div className="enhanced-container-metric-block">
                                                                                <div className="enhanced-container-metric-title">DNS Metrics</div>
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
                                                                            </div>
                                                                        )}

                                                                        {/* TCP Metrics - Only show if has data */}
                                                                        {containerTcp && containerTcp.total_events > 0 && (
                                                                            <div className="enhanced-container-metric-block">
                                                                                <div className="enhanced-container-metric-title">TCP Metrics</div>
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
                                                                            </div>
                                                                        )}

                                                                        {/* CPU Scheduling - Only show if has data */}
                                                                        {containerSched && (
                                                                            <div className="enhanced-container-metric-block">
                                                                                <div className="enhanced-container-metric-title">CPU Scheduling</div>
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
                                                                                {(containerSched.cpu_starvation_count || 0) > 0 && (
                                                                                    <div className="enhanced-container-metric-row">
                                                                                        <span className="metric-label">Starvation:</span>
                                                                                        <span className="metric-value" style={{
                                                                                            color: '#ef4444'
                                                                                        }}>
                                                                                            {containerSched.cpu_starvation_count || 0}
                                                                                        </span>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        )}

                                                                        {/* Disk I/O - Only show if has data */}
                                                                        {containerDiskIO && (containerDiskIO.total_io_operations > 0 || containerDiskIO.total_reads !== undefined || containerDiskIO.total_writes !== undefined) && (
                                                                            <div className="enhanced-container-metric-block">
                                                                                <div className="enhanced-container-metric-title">Disk I/O</div>
                                                                                <div className="enhanced-container-metric-row">
                                                                                    <span className="metric-label">Total Operations:</span>
                                                                                    <span className="metric-value">{(containerDiskIO.total_io_operations || 0).toLocaleString()}</span>
                                                                                </div>
                                                                                <div className="enhanced-container-metric-row">
                                                                                    <span className="metric-label">Avg Latency:</span>
                                                                                    <span className="metric-value">
                                                                                        {containerDiskIO.avg_io_latency_ns 
                                                                                            ? (containerDiskIO.avg_io_latency_ns < 1000000 
                                                                                                ? `${(containerDiskIO.avg_io_latency_ns / 1000).toFixed(2)} μs` 
                                                                                                : `${(containerDiskIO.avg_io_latency_ns / 1000000).toFixed(2)} ms`)
                                                                                            : '0 μs'}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="enhanced-container-metric-row">
                                                                                    <span className="metric-label">Reads:</span>
                                                                                    <span className="metric-value">{(containerDiskIO.total_reads || 0).toLocaleString()}</span>
                                                                                </div>
                                                                                <div className="enhanced-container-metric-row">
                                                                                    <span className="metric-label">Writes:</span>
                                                                                    <span className="metric-value">{(containerDiskIO.total_writes || 0).toLocaleString()}</span>
                                                                                </div>
                                                                                <div className="enhanced-container-metric-row">
                                                                                    <span className="metric-label">Data Transferred:</span>
                                                                                    <span className="metric-value">
                                                                                        {containerDiskIO.total_io_bytes 
                                                                                            ? (containerDiskIO.total_io_bytes < 1024 
                                                                                                ? `${containerDiskIO.total_io_bytes} B`
                                                                                                : containerDiskIO.total_io_bytes < 1048576
                                                                                                ? `${(containerDiskIO.total_io_bytes / 1024).toFixed(1)} KB`
                                                                                                : `${(containerDiskIO.total_io_bytes / 1048576).toFixed(1)} MB`)
                                                                                            : '0 B'}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="enhanced-container-metric-row">
                                                                                    <span className="metric-label">Queue Depth:</span>
                                                                                    <span className="metric-value">{(containerDiskIO.current_queue_depth || 0)}</span>
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        {/* Show message only if container has NO metrics at all */}
                                                                        {!containerDns && !containerTcp && !containerSched && !containerDiskIO && (
                                                                            <div className="enhanced-container-metric-block">
                                                                                <div className="enhanced-container-metric-title">eBPF Metrics</div>
                                                                                <div className="enhanced-container-metric-row">
                                                                                    <span className="metric-value" style={{color: '#64748b', fontStyle: 'italic', width: '100%', textAlign: 'center', padding: '1rem 0'}}>
                                                                                        No eBPF metrics available yet. Metrics will appear as the container generates activity.
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        )}
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
                            })()}
                        </div>
                    )}
                </section>
                )}

                {/* Service Health */}
                {metrics?.service_health && (() => {
                    // Get pods on the selected node from podDetails (using node_name) and from metrics.pods
                    const selectedNodeName = metrics?.node_name;
                    const nodePodKeys = new Set<string>();
                    
                    // Add pods from metrics.pods (these are already filtered by selected node)
                    if (metrics?.pods) {
                        Object.keys(metrics.pods).forEach(podKey => nodePodKeys.add(podKey));
                    }
                    
                    // Also add pods from podDetails that are on the selected node
                    if (podDetails?.pods && selectedNodeName) {
                        Object.entries(podDetails.pods).forEach(([podKey, podData]: [string, any]) => {
                            if (podData.node_name === selectedNodeName) {
                                nodePodKeys.add(podKey);
                            }
                        });
                    }
                    
                    // Create a map of pod names (just name, not namespace/name) to pod keys for matching
                    const podNameToKeyMap = new Map<string, Set<string>>();
                    nodePodKeys.forEach(podKey => {
                        const [, podName] = podKey.split('/');
                        if (podName) {
                            if (!podNameToKeyMap.has(podName)) {
                                podNameToKeyMap.set(podName, new Set());
                            }
                            podNameToKeyMap.get(podName)!.add(podKey);
                        }
                    });
                    
                    // Filter service details to only include services with endpoints on this node
                    const filteredServiceDetails: Record<string, any> = {};
                    if (metrics.service_health.service_details) {
                        Object.entries(metrics.service_health.service_details).forEach(([serviceKey, service]: [string, any]) => {
                            // Check if this service has any endpoints on the selected node
                            if (service.endpoint_health) {
                                let hasEndpointOnNode = false;
                                const filteredEndpoints: Record<string, any> = {};
                                let nodeReadyEndpoints = 0;
                                let nodeTotalEndpoints = 0;
                                
                                Object.entries(service.endpoint_health).forEach(([endpointKey, endpoint]: [string, any]) => {
                                    const podName = endpoint.pod_name;
                                    if (podName && podNameToKeyMap.has(podName)) {
                                        // Check if this pod name matches any pod on the selected node
                                        // For more accurate matching, we can check if the namespace matches too
                                        const matchingKeys = podNameToKeyMap.get(podName)!;
                                        // If there's a match, include this endpoint
                                        if (matchingKeys.size > 0) {
                                            // Try to match by namespace if available
                                            const [serviceNamespace] = serviceKey.split('/');
                                            let matched = false;
                                            for (const key of matchingKeys) {
                                                const [podNamespace] = key.split('/');
                                                if (podNamespace === serviceNamespace) {
                                                    matched = true;
                                                    break;
                                                }
                                            }
                                            // If namespace matches or we only have one pod with this name, include it
                                            if (matched || matchingKeys.size === 1) {
                                                hasEndpointOnNode = true;
                                                filteredEndpoints[endpointKey] = endpoint;
                                                nodeTotalEndpoints++;
                                                if (endpoint.status === 'ready') {
                                                    nodeReadyEndpoints++;
                                                }
                                            }
                                        }
                                    }
                                });
                                
                                if (hasEndpointOnNode) {
                                    // Create filtered service with node-specific endpoint counts
                                    filteredServiceDetails[serviceKey] = {
                                        ...service,
                                        endpoint_health: filteredEndpoints,
                                        total_endpoints: nodeTotalEndpoints,
                                        ready_endpoints: nodeReadyEndpoints,
                                        // Recalculate status based on node endpoints
                                        status: nodeReadyEndpoints === 0 ? 'unhealthy' : 
                                                nodeReadyEndpoints === nodeTotalEndpoints ? 'healthy' : 'degraded'
                                    };
                                }
                            }
                        });
                    }
                    
                    // Calculate filtered summary counts
                    const filteredTotalServices = Object.keys(filteredServiceDetails).length;
                    const filteredHealthyServices = Object.values(filteredServiceDetails).filter((s: any) => s.status === 'healthy').length;
                    const filteredUnhealthyServices = Object.values(filteredServiceDetails).filter((s: any) => s.status !== 'healthy').length;
                    
                    return (
                        <section 
                            id="services" 
                            ref={(el) => (sectionRefs.current['services'] = el)}
                            className="section"
                        >
                            <div className="section-header">
                                <div>
                                    <h2>SERVICE HEALTH</h2>
                                    <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                                        Services with endpoints on selected node: {metrics?.node_name || 'N/A'}
                                    </p>
                                </div>
                                <span className="section-badge">
                                    {filteredHealthyServices} Healthy / {filteredTotalServices} Total
                                </span>
                            </div>

                            {/* Summary Cards */}
                            <div className="metrics-grid" style={{ marginBottom: '2rem' }}>
                                <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%)', borderColor: 'rgba(16, 185, 129, 0.3)'}}>
                                    <div className="stat-header">
                                        <h3>Healthy Services</h3>
                                    </div>
                                    <div className="stat-value" style={{color: '#10b981'}}>{filteredHealthyServices}</div>
                                    <div className="stat-details">
                                        <span className="stat-label">All endpoints ready</span>
                                    </div>
                                </div>

                                <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(239, 68, 68, 0.05) 100%)', borderColor: 'rgba(239, 68, 68, 0.3)'}}>
                                    <div className="stat-header">
                                        <h3>Unhealthy Services</h3>
                                    </div>
                                    <div className="stat-value" style={{color: '#ef4444'}}>{filteredUnhealthyServices}</div>
                                    <div className="stat-details">
                                        <span className="stat-label">Needs attention</span>
                                    </div>
                                </div>

                                <div className="stat-card" style={{background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(245, 158, 11, 0.05) 100%)', borderColor: 'rgba(245, 158, 11, 0.3)'}}>
                                    <div className="stat-header">
                                        <h3>Total Services</h3>
                                    </div>
                                    <div className="stat-value" style={{color: '#f59e0b'}}>{filteredTotalServices}</div>
                                    <div className="stat-details">
                                        <span className="stat-label">On this node</span>
                                    </div>
                                </div>
                            </div>

                            {/* Service Details Table */}
                            {Object.keys(filteredServiceDetails).length > 0 && (
                            <div style={{ marginTop: '2rem' }}>
                                <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: '#e2e8f0' }}>Service Details</h3>
                                <div style={{ 
                                    background: 'rgba(15, 23, 42, 0.6)', 
                                    borderRadius: '8px', 
                                    border: '1px solid rgba(59, 130, 246, 0.2)',
                                    overflow: 'hidden'
                                }}>
                                    <div style={{ 
                                        display: 'grid', 
                                        gridTemplateColumns: '2fr 1fr 1fr 1fr 1.5fr 1fr',
                                        gap: '1rem',
                                        padding: '1rem',
                                        borderBottom: '1px solid rgba(59, 130, 246, 0.1)',
                                        fontWeight: 600,
                                        fontSize: '0.85rem',
                                        color: '#94a3b8',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.5px'
                                    }}>
                                        <div>Service Name</div>
                                        <div>Namespace</div>
                                        <div>Type</div>
                                        <div>Status</div>
                                        <div>Endpoints</div>
                                        <div>Last Check</div>
                                    </div>
                                    {Object.entries(filteredServiceDetails).map(([serviceKey, service]: [string, any]) => {
                                        const statusColor = service.status === 'healthy' ? '#10b981' : 
                                                          service.status === 'degraded' ? '#f59e0b' : '#ef4444';
                                        const statusLabel = service.status === 'healthy' ? 'Healthy' : 
                                                           service.status === 'degraded' ? 'Degraded' : 'Unhealthy';
                                        const endpointRatio = `${service.ready_endpoints || 0} / ${service.total_endpoints || 0}`;
                                        
                                        return (
                                            <div 
                                                key={serviceKey}
                                                style={{ 
                                                    display: 'grid', 
                                                    gridTemplateColumns: '2fr 1fr 1fr 1fr 1.5fr 1fr',
                                                    gap: '1rem',
                                                    padding: '1rem',
                                                    borderBottom: '1px solid rgba(59, 130, 246, 0.05)',
                                                    alignItems: 'center',
                                                    transition: 'background 0.2s'
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'}
                                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <div>
                                                    <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{service.name}</div>
                                                    {service.cluster_ip && (
                                                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                                                            IP: {service.cluster_ip}
                                                        </div>
                                                    )}
                                                </div>
                                                <div style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>{service.namespace}</div>
                                                <div style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>{service.type || 'ClusterIP'}</div>
                                                <div>
                                                    <span style={{ 
                                                        padding: '0.25rem 0.75rem',
                                                        borderRadius: '4px',
                                                        fontSize: '0.75rem',
                                                        fontWeight: 600,
                                                        backgroundColor: statusColor + '20',
                                                        color: statusColor,
                                                        border: `1px solid ${statusColor}40`
                                                    }}>
                                                        {statusLabel}
                                                    </span>
                                                </div>
                                                <div>
                                                    <div style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
                                                        {endpointRatio} ready
                                                    </div>
                                                    {service.total_endpoints > 0 && (
                                                        <div style={{ 
                                                            width: '100%', 
                                                            height: '4px', 
                                                            background: 'rgba(59, 130, 246, 0.2)', 
                                                            borderRadius: '2px',
                                                            marginTop: '0.5rem',
                                                            overflow: 'hidden'
                                                        }}>
                                                            <div style={{ 
                                                                width: `${(service.ready_endpoints / service.total_endpoints) * 100}%`,
                                                                height: '100%',
                                                                background: statusColor,
                                                                transition: 'width 0.3s'
                                                            }} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                                    {service.last_check ? new Date(service.last_check).toLocaleTimeString() : 'N/A'}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Endpoint Details */}
                        {Object.keys(filteredServiceDetails).length > 0 && Object.entries(filteredServiceDetails).some(([_, service]: [string, any]) => 
                            service.endpoint_health && Object.keys(service.endpoint_health).length > 0
                        ) && (
                            <div style={{ marginTop: '2rem' }}>
                                <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: '#e2e8f0' }}>Endpoint Health</h3>
                                <div style={{ 
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
                                    gap: '1rem'
                                }}>
                                    {Object.entries(filteredServiceDetails).map(([serviceKey, service]: [string, any]) => {
                                        if (!service.endpoint_health || Object.keys(service.endpoint_health).length === 0) return null;
                                        
                                        return (
                                            <div 
                                                key={serviceKey}
                                                style={{ 
                                                    background: 'rgba(15, 23, 42, 0.6)', 
                                                    borderRadius: '8px', 
                                                    border: '1px solid rgba(59, 130, 246, 0.2)',
                                                    padding: '1rem'
                                                }}
                                            >
                                                <div style={{ 
                                                    fontSize: '0.9rem', 
                                                    fontWeight: 600, 
                                                    color: '#e2e8f0',
                                                    marginBottom: '0.75rem',
                                                    paddingBottom: '0.75rem',
                                                    borderBottom: '1px solid rgba(59, 130, 246, 0.1)'
                                                }}>
                                                    {service.name} ({service.namespace})
                                                </div>
                                                {Object.entries(service.endpoint_health).map(([endpointKey, endpoint]: [string, any]) => {
                                                    const endpointStatusColor = endpoint.status === 'ready' ? '#10b981' : '#ef4444';
                                                    const httpCheckColor = endpoint.http_check ? '#10b981' : '#ef4444';
                                                    
                                                    return (
                                                        <div 
                                                            key={endpointKey}
                                                            style={{ 
                                                                padding: '0.75rem',
                                                                marginBottom: '0.5rem',
                                                                background: 'rgba(59, 130, 246, 0.05)',
                                                                borderRadius: '6px',
                                                                border: `1px solid ${endpointStatusColor}30`
                                                            }}
                                                        >
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                                                <div>
                                                                    <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.9rem' }}>
                                                                        {endpoint.pod_name || 'Unknown Pod'}
                                                                    </div>
                                                                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                                                                        {endpoint.pod_ip}
                                                                    </div>
                                                                </div>
                                                                <span style={{ 
                                                                    padding: '0.25rem 0.5rem',
                                                                    borderRadius: '4px',
                                                                    fontSize: '0.7rem',
                                                                    fontWeight: 600,
                                                                    backgroundColor: endpointStatusColor + '20',
                                                                    color: endpointStatusColor,
                                                                    border: `1px solid ${endpointStatusColor}40`
                                                                }}>
                                                                    {endpoint.status === 'ready' ? 'Ready' : 'Not Ready'}
                                                                </span>
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                                                                <div>
                                                                    <span style={{ color: '#64748b' }}>HTTP Check: </span>
                                                                    <span style={{ color: httpCheckColor, fontWeight: 600 }}>
                                                                        {endpoint.http_check ? '✓ Pass' : '✗ Fail'}
                                                                    </span>
                                                                </div>
                                                                {endpoint.latency_ms > 0 && (
                                                                    <div>
                                                                        <span style={{ color: '#64748b' }}>Latency: </span>
                                                                        <span style={{ color: '#cbd5e1', fontWeight: 600 }}>
                                                                            {endpoint.latency_ms.toFixed(2)} ms
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                    </section>
                    );
                })()}

            </main>
            </div>

            <footer className="dashboard-footer">
                <span>Powered by eBPF - Kubernetes Runtime-Aware Orchestration</span>
                <span>Auto-refresh: 3s</span>
            </footer>
        </div>
    );
}
