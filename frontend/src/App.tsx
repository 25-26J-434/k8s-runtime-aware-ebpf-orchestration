import { useMetrics } from './hooks/useMetrics'
import { useClusterInfo } from './hooks/useClusterInfo'
import { DNSLatencyChart } from './components/DNSLatencyChart'
import './App.css'

function App() {
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
                <h2>⚠️ Connection Error</h2>
                <p>{error.message}</p>
                <p>Make sure the eBPF daemon is running on port 8080</p>
            </div>
        );
    }

    return (
        <div className="dashboard">
            <header className="dashboard-header">
                <div className="header-content">
                    <div className="header-title">
                        <h1>eBPF Telemetry Dashboard</h1>
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
                    <div className="connection-status">
                        <span className="status-dot"></span>
                        <span>Live</span>
                    </div>
                </div>
            </header>

            <main className="dashboard-main">
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
                                        <div className="pod-header">
                                            <div className="pod-info">
                                                <div className="pod-name">{podName}</div>
                                                <div className="pod-namespace">{namespace}</div>
                                            </div>
                                            <div className="pod-status">Running</div>
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
                                                        <span className="metric-value cyan">{stats.avg_latency_us.toFixed(2)} μs</span>
                                                    </div>
                                                    <div className="metric-item">
                                                        <span className="metric-label">Events</span>
                                                        <span className="metric-value purple">{stats.total_events}</span>
                                                    </div>
                                                </div>
                                                <div className="metrics-row">
                                                    <div className="metric-item">
                                                        <span className="metric-label">Min</span>
                                                        <span className="metric-value green">{stats.min_latency_us.toFixed(2)} μs</span>
                                                    </div>
                                                    <div className="metric-item">
                                                        <span className="metric-label">Max</span>
                                                        <span className="metric-value orange">{stats.max_latency_us.toFixed(2)} μs</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="metric-group">
                                                <div className="metric-group-title">
                                                    RTT Metrics
                                                </div>
                                                <div className="metrics-row">
                                                    <div className="metric-item">
                                                        <span className="metric-label">Avg RTT</span>
                                                        <span className="metric-value cyan">{metrics?.rtt.avg_rtt_us > 0 ? metrics.rtt.avg_rtt_us.toFixed(2) : 'N/A'} {metrics?.rtt.avg_rtt_us > 0 ? 'μs' : ''}</span>
                                                    </div>
                                                    <div className="metric-item">
                                                        <span className="metric-label">Connections</span>
                                                        <span className="metric-value purple">{metrics?.rtt.total_events || 0}</span>
                                                    </div>
                                                </div>
                                                <div className="metrics-row">
                                                    <div className="metric-item">
                                                        <span className="metric-label">Min RTT</span>
                                                        <span className="metric-value green">{metrics?.rtt.min_rtt_us > 0 ? metrics.rtt.min_rtt_us.toFixed(2) : 'N/A'} {metrics?.rtt.min_rtt_us > 0 ? 'μs' : ''}</span>
                                                    </div>
                                                    <div className="metric-item">
                                                        <span className="metric-label">Max RTT</span>
                                                        <span className="metric-value orange">{metrics?.rtt.max_rtt_us > 0 ? metrics.rtt.max_rtt_us.toFixed(2) : 'N/A'} {metrics?.rtt.max_rtt_us > 0 ? 'μs' : ''}</span>
                                                    </div>
                                                </div>
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
    )
}

export default App
