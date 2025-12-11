import './Page.css';

export function Scheduling() {
    return (
        <div className="page-container">
            <div className="page-header">
                <div className="page-title-section">
                    <h1 className="page-title">Latency-Aware Scheduling</h1>
                    <p className="page-subtitle">Network-aware pod placement and scheduling optimization</p>
                </div>
            </div>

            <div className="page-content">
                <div className="feature-card">
                    <h2>Component Overview</h2>
                    <p>This component implements latency-aware pod scheduling that considers network performance when making placement decisions.</p>
                </div>

                <div className="info-grid">
                    <div className="info-card">
                        <h3>Features</h3>
                        <ul>
                            <li>Network-aware pod placement</li>
                            <li>Latency-based scheduling decisions</li>
                            <li>Node performance analysis</li>
                            <li>Optimal resource allocation</li>
                        </ul>
                    </div>

                    <div className="info-card">
                        <h3>Integration</h3>
                        <p>This component subscribes to real-time metrics:</p>
                        <pre className="code-block">
{`import telemetry

collector = telemetry.GlobalRegistry.Get(
    telemetry.MetricTypeDNS
)
updates = collector.Subscribe()

# React to latency changes in real-time
for metric in updates:
    makeSchedulingDecision(metric)`}
                        </pre>
                    </div>

                    <div className="info-card">
                        <h3>Status</h3>
                        <div className="status-badge coming-soon">Coming Soon</div>
                        <p>This component will use eBPF telemetry for intelligent pod scheduling based on network performance.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

