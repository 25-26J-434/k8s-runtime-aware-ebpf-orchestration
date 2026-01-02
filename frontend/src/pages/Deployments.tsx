import './Page.css';
import { useEffect, useState } from 'react';
import type { DeploymentInfo, LatestMetric, MetricType } from '../types/scaling';
import { api } from '../services/api';

export function Deployments() {
    const [deployments, setDeployments] = useState<DeploymentInfo[] | null>(null);
    const [metrics, setMetrics] = useState<LatestMetric[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const [d, m] = await Promise.all([api.getDeployments(), api.getLatestMetrics()]);
            setDeployments(d);
            setMetrics(m);
            setError(null);
        } catch (err: any) {
            console.error(err);
            setError(err?.message || 'Failed to load deployments');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); const id = setInterval(load, 6000); return () => clearInterval(id); }, []);

    const findMetric = (d: DeploymentInfo, metric: MetricType) => {
        return metrics?.find(m => m.namespace === d.namespace && m.deployment === d.name && m.metric === metric);
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <div className="page-title-section">
                    <h1 className="page-title">Deployment Status</h1>
                    <p className="page-subtitle">Replica counts and latest eBPF metrics</p>
                </div>
            </div>

            <div className="page-content">
                <div className="feature-card">
                    {loading && <div>Loading deployments...</div>}
                    {error && <div className="error">{error}</div>}

                    {deployments && deployments.length === 0 && <div className="list-subtext">No deployments found.</div>}

                    {deployments && deployments.length > 0 && (
                        <div className="info-grid">
                            {deployments.map(d => (
                                <div className="info-card" key={`${d.namespace}/${d.name}`}>
                                    <h3>{d.name}</h3>
                                    <p className="list-subtext">Namespace: {d.namespace}</p>
                                    <p className="list-subtext">Replicas: <strong>{d.replicas}</strong></p>

                                    <div style={{ marginTop: '1rem' }}>
                                        <h4>Latest Metrics</h4>
                                        <ul className="endpoint-list">
                                            <li className="endpoint-item">DNS: <div className="endpoint-desc">{findMetric(d, 'dns_latency') ? findMetric(d, 'dns_latency')?.value : '—'}</div></li>
                                            <li className="endpoint-item">RTT: <div className="endpoint-desc">{findMetric(d, 'rtt') ? findMetric(d, 'rtt')?.value : '—'}</div></li>
                                            <li className="endpoint-item">TCP Retrans: <div className="endpoint-desc">{findMetric(d, 'tcp_retrans') ? findMetric(d, 'tcp_retrans')?.value : '—'}</div></li>
                                        </ul>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
