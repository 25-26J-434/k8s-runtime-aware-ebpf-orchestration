import { useEffect, useMemo, useState } from 'react';
import { FiAlertTriangle, FiDatabase, FiRefreshCw, FiEdit2, FiEye, FiTrash2, FiX } from 'react-icons/fi';
import { api } from '../services/api';
import './Page.css';
import './Routing.css';

type PolicyRecord = {
    id?: string;
    policy_name?: string;
    namespace?: string;
    frontend_service?: string;
    frontend_service_port?: string | number;
    redirect_backend_label?: string;
    redirect_backend_port?: string | number;
    redirect_backend_protocol?: string;
    ttl_seconds?: string | number;
    metric?: string;
    violation_threshold?: string | number;
    action?: string;
    notes?: string;
    createdAt?: string;
    updatedAt?: string;
    frontend?: {
        service?: string;
        port?: number | string;
    };
    telemetry?: {
        metric?: string;
        violation_threshold?: number | string;
        monitor_pod_contains?: string;
    };
    monitor_pod_contains?: string;
    strategy?: string;
    backend_selector?: string;
    backend_candidates_selector?: string;
    winner_label?: string;
};

export function Routing() {
    const [policies, setPolicies] = useState<PolicyRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [selectedPolicy, setSelectedPolicy] = useState<PolicyRecord | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);

    const formatValue = (value: any) => {
        if (value === null || value === undefined) return '—';
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        if (Array.isArray(value)) {
            return value.join(', ') || '—';
        }
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (_err) {
                return '—';
            }
        }
        return '—';
    };

    const formatAction = (action: any) => {
        if (!action) return 'redirect';
        if (typeof action === 'string') return action;
        if (typeof action === 'object') {
            return action.type || formatValue(action);
        }
        return String(action);
    };

    const resolveTarget = (policy: PolicyRecord) => {
        const actionObj = typeof policy.action === 'object' ? (policy.action as any) : {};
        const targetLabel =
            policy.redirect_backend_label ||
            actionObj.backend_selector ||
            policy.backend_selector ||
            actionObj.backend_candidates_selector ||
            policy.backend_candidates_selector;
        return targetLabel || '—';
    };

    const resolveFrontend = (policy: PolicyRecord) => {
        return policy.frontend?.service || policy.frontend_service || (policy as any).source_service || '—';
    };

    const resolveMetric = (policy: PolicyRecord) => {
        return policy.telemetry?.metric || policy.metric || '—';
    };

    const resolveThreshold = (policy: PolicyRecord) => {
        return policy.telemetry?.violation_threshold || policy.violation_threshold || '—';
    };

    const resolveProtocol = (policy: PolicyRecord) => {
        const actionObj = typeof policy.action === 'object' ? (policy.action as any) : {};
        return actionObj.protocol || policy.redirect_backend_protocol || '—';
    };

    const resolveTtl = (policy: PolicyRecord) => {
        const actionObj = typeof policy.action === 'object' ? (policy.action as any) : {};
        return actionObj.ttl_seconds || policy.ttl_seconds || '—';
    };

    const fetchPolicies = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await api.getPolicies();
            const data = Array.isArray(response) ? response : (response as any)?.policies || [];
            setPolicies(data);
            setLastUpdated(new Date().toISOString());
        } catch (err: any) {
            setError(err?.message || 'Failed to load policies');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPolicies();
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setDrawerOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const formattedUpdated = useMemo(() => {
        if (!lastUpdated) return '';
        try {
            const date = new Date(lastUpdated);
            return `${date.toLocaleTimeString()} • ${date.toLocaleDateString()}`;
        } catch (_err) {
            return lastUpdated;
        }
    }, [lastUpdated]);

    const formatDate = (value?: string) => {
        if (!value) return '—';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return '—';
        return parsed.toLocaleString();
    };

    const renderValue = (value: any) => {
        if (value === null || value === undefined) return '—';
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        if (Array.isArray(value)) {
            return value.length ? value.join(', ') : '—';
        }
        return (
            <details className="detail-details">
                <summary>Expand</summary>
                <pre className="detail-pre">{JSON.stringify(value, null, 2)}</pre>
            </details>
        );
    };

    return (
        <div className="page-container routing-page">
            <div className="page-header">

            </div>

            <div className="routing-card">
                <div className="card-title">
                    <FiDatabase />
                    <span>Policies</span>
                </div>
                <div className="table-toolbar">
                    <div className="table-meta">
                        {loading ? 'Loading policies…' : `${policies.length} policies`}
                        {formattedUpdated && !loading ? ` • Updated ${formattedUpdated}` : ''}
                    </div>
                    <button className="ghost-button" onClick={fetchPolicies} disabled={loading}>
                        <FiRefreshCw /> Reload
                    </button>
                </div>

                {error && (
                    <div className="alert error">
                        <FiAlertTriangle /> {error}
                    </div>
                )}

                {!loading && !error && !policies.length && (
                    <div className="empty-state">
                        No policies found. Create one via the routing backend and reload.
                    </div>
                )}

                <div className="policy-table-wrapper">
                    <table className="policy-table">
                        <thead>
                            <tr>
                                <th>Policy</th>
                                <th>Frontend</th>
                                <th>Target Selector</th>
                                <th>Action</th>
                                <th>Metric</th>
                                <th>Threshold</th>
                                <th>Protocol</th>
                                <th>TTL (s)</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr>
                                    <td colSpan={9} className="table-loading">
                                        Loading…
                                    </td>
                                </tr>
                            )}
                            {!loading &&
                                policies.map((policy) => {
                                    const source = resolveFrontend(policy);
                                    const target = resolveTarget(policy);

                                    return (
                                        <tr key={policy.id || policy.policy_name}>
                                            <td>
                                                <div className="cell-main">{policy.policy_name || '—'}</div>
                                            </td>
                                            <td>{source || '—'}</td>
                                            <td>{target || '—'}</td>
                                            <td>{formatAction(policy.action)}</td>
                                            <td>{resolveMetric(policy)}</td>
                                            <td>{resolveThreshold(policy)}</td>
                                            <td>{resolveProtocol(policy)}</td>
                                            <td>{resolveTtl(policy)}</td>
                                            <td className="table-actions">
                                                <button
                                                    type="button"
                                                    className="icon-button"
                                                    aria-label="View policy"
                                                    onClick={() => {
                                                        setSelectedPolicy(policy);
                                                        setDrawerOpen(true);
                                                    }}
                                                >
                                                    <FiEye />
                                                </button>
                                                <button type="button" className="icon-button" aria-label="Edit policy">
                                                    <FiEdit2 />
                                                </button>
                                                <button type="button" className="icon-button danger" aria-label="Delete policy">
                                                    <FiTrash2 />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                        </tbody>
                    </table>
                </div>
            </div>

            {drawerOpen && <div className="drawer-overlay" onClick={() => setDrawerOpen(false)} />}
            <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
                <div className="drawer-header">
                    <div>
                        <div className="drawer-title">{selectedPolicy?.policy_name || 'Policy details'}</div>
                        <div className="drawer-subtitle">{selectedPolicy?.namespace || '—'}</div>
                    </div>
                    <button className="icon-button" aria-label="Close" onClick={() => setDrawerOpen(false)}>
                        <FiX />
                    </button>
                </div>
                <div className="detail-grid">
                                {selectedPolicy ? (
                                    <>
                                        {[
                                            { label: 'Frontend', value: selectedPolicy.frontend || selectedPolicy.frontend_service },
                                            { label: 'Monitor', value: selectedPolicy.telemetry?.monitor_pod_contains || selectedPolicy.monitor_pod_contains },
                                { label: 'Target selector', value: resolveTarget(selectedPolicy) },
                                { label: 'Backend candidates', value: (selectedPolicy as any).backend_candidates_selector || (typeof selectedPolicy.action === 'object' ? (selectedPolicy.action as any).backend_candidates_selector : '') },
                                { label: 'Action', value: selectedPolicy.action },
                                { label: 'Strategy', value: (typeof selectedPolicy.action === 'object' ? (selectedPolicy.action as any).strategy : (selectedPolicy as any).strategy) },
                                { label: 'Winner label', value: (typeof selectedPolicy.action === 'object' ? (selectedPolicy.action as any).winner_label : (selectedPolicy as any).winner_label) },
                                { label: 'Protocol', value: resolveProtocol(selectedPolicy) },
                                { label: 'TTL seconds', value: resolveTtl(selectedPolicy) },
                                { label: 'Metric', value: resolveMetric(selectedPolicy) },
                                { label: 'Threshold', value: resolveThreshold(selectedPolicy) },
                                { label: 'Notes', value: selectedPolicy.notes },
                                { label: 'Created', value: formatDate(selectedPolicy.createdAt) },
                                { label: 'Updated', value: formatDate(selectedPolicy.updatedAt) },
                                { label: 'Action payload', value: typeof selectedPolicy.action === 'object' ? selectedPolicy.action : undefined },
                                { label: 'Frontend payload', value: selectedPolicy.frontend },
                                { label: 'Telemetry payload', value: selectedPolicy.telemetry },
                                { label: 'Raw policy', value: selectedPolicy },
                            ].map((item) => (
                                <div key={item.label} className="detail-item">
                                    <div className="detail-label">{item.label}</div>
                                    <div className="detail-value">{renderValue(item.value)}</div>
                                </div>
                            ))}
                        </>
                    ) : (
                        <div className="empty-state">Select a policy to view details.</div>
                    )}
                </div>
                <div className="drawer-footer">
                    <button className="ghost-button" onClick={() => setDrawerOpen(false)}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
