import './Page.css';

export function Routing() {
    return (
        <div className="page-container">
            <div className="page-header">
                <div className="page-title-section">
                    <h1 className="page-title">Intelligent Traffic Routing</h1>
                    <p className="page-subtitle">Latency-aware pod selection and traffic distribution</p>
                </div>
            </div>

            <div className="page-content">
                <div className="feature-card">
                    <h2>Component Overview</h2>
                    <p>This component implements intelligent traffic routing based on real-time network latency metrics collected from the eBPF daemon.</p>
                </div>

                <div className="info-grid">
                    <div className="info-card">
                        <h3>Features</h3>
                        <ul>
                            <li>Real-time latency monitoring</li>
                            <li>Automatic pod selection</li>
                            <li>Load balancing based on performance</li>
                            <li>Dynamic routing decisions</li>
                        </ul>
                    </div>

                    <div className="info-card">
                        <h3>Integration</h3>
                        <p>This component uses the telemetry package directly:</p>
                        <pre className="code-block">
{`import telemetry

podDNS = telemetry.GetPodDNSMetrics()
podRTT = telemetry.GetPodRTTMetrics()

# Select best pod based on latency
bestPod = selectBestEndpoint(podDNS, podRTT)`}
                        </pre>
                    </div>

                    <div className="info-card">
                        <h3>Status</h3>
                        <div className="status-badge coming-soon">Coming Soon</div>
                        <p>This component will be implemented to use the eBPF telemetry data for intelligent routing decisions.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

