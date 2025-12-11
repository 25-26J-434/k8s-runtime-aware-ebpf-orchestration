import { useMetrics } from '../hooks/useMetrics';
import { useClusterInfo } from '../hooks/useClusterInfo';
import { DNSLatencyChart } from '../components/DNSLatencyChart';
import { SystemHealth } from '../components/SystemHealth';
import { TopPerformers } from '../components/TopPerformers';
import { NetworkStats } from '../components/NetworkStats';
import '../App.css';

export function Dashboard() {
    const { metrics, loading, error } = useMetrics(3000);
    const clusterInfo = useClusterInfo(5000);

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

    return (
        <div className="dashboard-content">
            <header className="dashboard-header">
                <div className="header-content">
                    <div className="header-title">
                        <h1>Telemetry Dashboard</h1>
                        <p className="header-subtitle">Real-time Kubernetes Network Monitoring</p>
                    </div>
                    <div className="cluster-info">
                        <div className="info-item">
                            <span className="info-label">Cluster</span>
                            <span className="info-value">{clusterInfo.cluster}</span>
                        </div>
                        <div className="info-separator"></div>
                        <div className="info-item">
                            <span className="info-label">Node</span>
                            <span className="info-value">{clusterInfo.node}</span>
                        </div>
                        <div className="info-separator"></div>
                        <div className="info-item">
                            <span className="info-label">Total Pods</span>
                            <span className="info-value">{clusterInfo.activePods}</span>
                        </div>
                        <div className="info-separator"></div>
                        <div className="info-item">
                            <span className="info-label">Monitored Pods</span>
                            <span className="info-value">{metrics?.dns.pods ? Object.keys(metrics.dns.pods).length : 0}</span>
                        </div>
                    </div>
                </div>
            </header>

            <main className="dashboard-main">
                {/* System Health Overview */}
                <section className="section">
                    <div className="section-header">
                        <h2>SYSTEM HEALTH</h2>
                        <span className="section-badge">Real-time Status</span>
                    </div>
                    <SystemHealth />
                </section>

                {/* Top Performers */}
                {metrics?.dns.pods && Object.keys(metrics.dns.pods).length > 0 && (
                    <section className="section">
                        <div className="section-header">
                            <h2>PERFORMANCE RANKINGS</h2>
                            <span className="section-badge">Top & Bottom Pods</span>
                        </div>
                        <TopPerformers />
                    </section>
                )}

                {/* Network Statistics */}
                <section className="section">
                    <div className="section-header">
                        <h2>NETWORK STATISTICS</h2>
                        <span className="section-badge">Distribution Analysis</span>
                    </div>
                    <NetworkStats />
                </section>

                {/* Node-Level Metrics Section */}
                <section className="section">
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

                        <div className="stat-card rtt">
                            <div className="stat-header">
                                <h3>RTT Events</h3>
                            </div>
                            <div className="stat-value">{metrics?.rtt.total_events.toLocaleString() || 0}</div>
                            <div className="stat-details">
                                <span className="stat-label">TCP Connections</span>
                                <span className="stat-sublabel">Avg: {metrics?.rtt.avg_rtt_us.toFixed(2)} μs</span>
                            </div>
                        </div>

                        <div className="stat-card rtt-latency">
                            <div className="stat-header">
                                <h3>TCP RTT</h3>
                            </div>
                            <div className="stat-value">{metrics?.rtt.avg_rtt_us.toFixed(2)} <span className="unit">μs</span></div>
                            <div className="stat-details">
                                <span className="stat-label">Round Trip Time</span>
                                <span className="stat-range">Min: {metrics?.rtt.min_rtt_us.toFixed(2)} μs • Max: {metrics?.rtt.max_rtt_us.toFixed(2)} μs</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Pod-Level Metrics Section */}
                {metrics?.dns.pods && Object.keys(metrics.dns.pods).length > 0 && (
                    <section className="section">
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

                                            <div className="metric-group">
                                                <div className="metric-group-title">
                                                    RTT Metrics
                                                </div>
                                                {(() => {
                                                    const podRTT = metrics?.rtt.pods?.[podKey];
                                                    if (podRTT && podRTT.total_events > 0) {
                                                        return (
                                                            <>
                                                                <div className="metrics-row">
                                                                    <div className="metric-item">
                                                                        <span className="metric-label">Avg RTT</span>
                                                                        <span className="metric-value cyan">{podRTT.avg_latency_us.toFixed(2)} <span className="metric-unit">μs</span></span>
                                                                        <div className="metric-trend">Round Trip Time</div>
                                                                    </div>
                                                                    <div className="metric-item">
                                                                        <span className="metric-label">Connections</span>
                                                                        <span className="metric-value purple">{podRTT.total_events.toLocaleString()}</span>
                                                                        <div className="metric-trend">TCP Sessions</div>
                                                                    </div>
                                                                </div>
                                                                <div className="metrics-row">
                                                                    <div className="metric-item">
                                                                        <span className="metric-label">Min RTT</span>
                                                                        <span className="metric-value green">{podRTT.min_latency_us.toFixed(2)} <span className="metric-unit">μs</span></span>
                                                                        <div className="metric-trend">Fastest</div>
                                                                    </div>
                                                                    <div className="metric-item">
                                                                        <span className="metric-label">Max RTT</span>
                                                                        <span className="metric-value orange">{podRTT.max_latency_us.toFixed(2)} <span className="metric-unit">μs</span></span>
                                                                        <div className="metric-trend">Slowest</div>
                                                                    </div>
                                                                </div>
                                                            </>
                                                        );
                                                    } else {
                                                        return (
                                                            <div className="metrics-row">
                                                                <div className="metric-item">
                                                                    <span className="metric-label">Status</span>
                                                                    <span className="metric-value" style={{fontSize: '0.9rem', color: '#71717a'}}>No TCP connections yet</span>
                                                                </div>
                                                            </div>
                                                        );
                                                    }
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}
            </main>

            <footer className="dashboard-footer">
                <span>Powered by eBPF - Kubernetes Runtime-Aware Orchestration</span>
                <span>Auto-refresh: 3s</span>
            </footer>
        </div>
    );
}

