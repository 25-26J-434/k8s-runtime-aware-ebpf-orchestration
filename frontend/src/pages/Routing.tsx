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
    const [drawerMode, setDrawerMode] = useState<'view' | 'edit' | 'create'>('view');
    const [editForm, setEditForm] = useState<any>({});
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [drawerError, setDrawerError] = useState<string | null>(null);
    const [drawerSuccess, setDrawerSuccess] = useState<string | null>(null);

    const metricOptions = ['rtt_us', 'dns_us', 'sched_latency_us'];
    const strategyOptions = ['best_pod', 'all'];
    const [deleteTarget, setDeleteTarget] = useState<PolicyRecord | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const defaultCreateForm = {
        policy_name: '',
        namespace: 'test-services',
        frontend_service: '',
        frontend_port: '',
        telemetry_metric: metricOptions[0],
        telemetry_violation_threshold: '',
        telemetry_monitor: '',
        action_type: 'redirect',
        action_backend_selector: '',
        action_backend_port: '',
        action_protocol: 'TCP',
        action_ttl_seconds: '300',
        action_strategy: 'best_pod',
        action_backend_candidates_selector: '',
        action_winner_label: '',
    };

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

    const hydrateEditForm = (policy: PolicyRecord) => {
        const actionObj = typeof policy.action === 'object' ? (policy.action as any) : {};
        return {
            policy_name: policy.policy_name || '',
            namespace: policy.namespace || '',
            frontend_service: policy.frontend?.service || policy.frontend_service || '',
            frontend_port: policy.frontend?.port || policy.frontend_service_port || '',
            telemetry_metric: policy.telemetry?.metric || policy.metric || '',
            telemetry_violation_threshold: policy.telemetry?.violation_threshold || policy.violation_threshold || '',
            telemetry_monitor: policy.telemetry?.monitor_pod_contains || policy.monitor_pod_contains || '',
            action_type: actionObj.type || policy.action || 'redirect',
            action_backend_selector: actionObj.backend_selector || policy.redirect_backend_label || '',
            action_backend_port: actionObj.backend_port || policy.redirect_backend_port || '',
            action_protocol: actionObj.protocol || policy.redirect_backend_protocol || 'TCP',
            action_ttl_seconds: actionObj.ttl_seconds || policy.ttl_seconds || '',
            action_strategy: actionObj.strategy || (policy as any).strategy || '',
            action_backend_candidates_selector:
                actionObj.backend_candidates_selector || (policy as any).backend_candidates_selector || '',
            action_winner_label: actionObj.winner_label || (policy as any).winner_label || '',
        };
    };

    const numOrString = (value: any) => {
        if (value === null || value === undefined || value === '') return undefined;
        const num = Number(value);
        return Number.isFinite(num) ? num : value;
    };

    const addIfValue = (obj: any, key: string, value: any) => {
        if (value === null || value === undefined || value === '') return;
        obj[key] = value;
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

    const openView = (policy: PolicyRecord) => {
        setSelectedPolicy(policy);
        setDrawerMode('view');
        setDrawerOpen(true);
        setDrawerError(null);
        setDrawerSuccess(null);
    };

    const openEdit = (policy: PolicyRecord) => {
        setSelectedPolicy(policy);
        setDrawerMode('edit');
        setEditForm(hydrateEditForm(policy));
        setDrawerOpen(true);
        setDrawerError(null);
        setDrawerSuccess(null);
    };

    const openCreate = () => {
        setSelectedPolicy(null);
        setDrawerMode('create');
        setEditForm(defaultCreateForm);
        setDrawerOpen(true);
        setDrawerError(null);
        setDrawerSuccess(null);
    };

    const handleSave = async (event?: React.FormEvent) => {
        if (event) event.preventDefault();
        setSaving(true);
        setDrawerError(null);
        setDrawerSuccess(null);

        if (drawerMode === 'create') {
            const required = [
                'policy_name',
                'namespace',
                'frontend_service',
                'frontend_port',
                'telemetry_metric',
                'telemetry_violation_threshold',
                'telemetry_monitor',
                'action_backend_selector',
                'action_backend_port',
                'action_protocol',
                'action_ttl_seconds',
            ];
            for (const key of required) {
                if (!editForm[key]) {
                    setDrawerError('Please fill all required fields.');
                    setSaving(false);
                    return;
                }
            }

            const body = {
                policy_name: editForm.policy_name,
                namespace: editForm.namespace,
                frontend: {
                    service: editForm.frontend_service,
                    port: numOrString(editForm.frontend_port),
                },
                telemetry: {
                    metric: editForm.telemetry_metric,
                    violation_threshold: numOrString(editForm.telemetry_violation_threshold),
                    monitor_pod_contains: editForm.telemetry_monitor,
                },
                action: {
                    type: editForm.action_type || 'redirect',
                    backend_selector: editForm.action_backend_selector,
                    backend_port: numOrString(editForm.action_backend_port),
                    protocol: editForm.action_protocol || 'TCP',
                    ttl_seconds: numOrString(editForm.action_ttl_seconds),
                    strategy: editForm.action_strategy || '',
                    backend_candidates_selector: editForm.action_backend_candidates_selector || '',
                    winner_label: editForm.action_winner_label || '',
                },
            };

            try {
                const created = await api.createPolicy(body);
                setDrawerSuccess('Policy created.');
                setSelectedPolicy(created);
                setDrawerMode('view');
                fetchPolicies();
            } catch (err: any) {
                setDrawerError(err?.message || 'Failed to create policy');
            } finally {
                setSaving(false);
            }
            return;
        }

        if (!selectedPolicy) {
            setDrawerError('No policy selected.');
            setSaving(false);
            return;
        }

        const targetName = selectedPolicy.policy_name || editForm.policy_name;
        if (!targetName) {
            setDrawerError('Policy name is required.');
            setSaving(false);
            return;
        }

        const body: any = {};

        addIfValue(body, 'namespace', editForm.namespace);

        // frontend
        if (
            editForm.frontend_service !== '' ||
            editForm.frontend_port !== '' ||
            editForm.frontend_service !== undefined ||
            editForm.frontend_port !== undefined
        ) {
            body.frontend = {};
            addIfValue(body.frontend, 'service', editForm.frontend_service);
            const port = numOrString(editForm.frontend_port);
            if (port !== undefined) addIfValue(body.frontend, 'port', port);
            if (!Object.keys(body.frontend).length) delete body.frontend;
        }

        // telemetry
        if (
            editForm.telemetry_metric !== '' ||
            editForm.telemetry_violation_threshold !== '' ||
            editForm.telemetry_monitor !== '' ||
            editForm.telemetry_metric !== undefined ||
            editForm.telemetry_violation_threshold !== undefined ||
            editForm.telemetry_monitor !== undefined
        ) {
            body.telemetry = {};
            addIfValue(body.telemetry, 'metric', editForm.telemetry_metric);
            const threshold = numOrString(editForm.telemetry_violation_threshold);
            if (threshold !== undefined) addIfValue(body.telemetry, 'violation_threshold', threshold);
            addIfValue(body.telemetry, 'monitor_pod_contains', editForm.telemetry_monitor);
            if (!Object.keys(body.telemetry).length) delete body.telemetry;
        }

        // action
        if (
            editForm.action_type !== undefined ||
            editForm.action_backend_selector !== undefined ||
            editForm.action_backend_port !== undefined ||
            editForm.action_protocol !== undefined ||
            editForm.action_ttl_seconds !== undefined ||
            editForm.action_strategy !== undefined ||
            editForm.action_backend_candidates_selector !== undefined ||
            editForm.action_winner_label !== undefined
        ) {
            body.action = {};
            addIfValue(body.action, 'type', editForm.action_type);
            addIfValue(body.action, 'backend_selector', editForm.action_backend_selector);
            const backendPort = numOrString(editForm.action_backend_port);
            if (backendPort !== undefined) addIfValue(body.action, 'backend_port', backendPort);
            addIfValue(body.action, 'protocol', editForm.action_protocol);
            const ttl = numOrString(editForm.action_ttl_seconds);
            if (ttl !== undefined) addIfValue(body.action, 'ttl_seconds', ttl);
            addIfValue(body.action, 'strategy', editForm.action_strategy);
            addIfValue(body.action, 'backend_candidates_selector', editForm.action_backend_candidates_selector);
            addIfValue(body.action, 'winner_label', editForm.action_winner_label);
            if (!Object.keys(body.action).length) delete body.action;
        }

        if (!Object.keys(body).length) {
            setDrawerError('Provide at least one field to update.');
            setSaving(false);
            return;
        }

        try {
            const updated = await api.updatePolicy(targetName, body);
            setDrawerSuccess('Policy updated.');
            setSelectedPolicy(updated || { ...selectedPolicy, ...body });
            setDrawerMode('view');
            fetchPolicies();
        } catch (err: any) {
            setDrawerError(err?.message || 'Failed to update policy');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        const policyName = deleteTarget?.policy_name || selectedPolicy?.policy_name;
        if (!policyName) {
            setDrawerError('Policy name not found.');
            return;
        }
        setDeleting(true);
        setDrawerError(null);
        setDrawerSuccess(null);
        try {
            await api.deletePolicy(policyName);
            setDrawerSuccess('Policy deleted.');
            setShowDeleteConfirm(false);
            setDeleteTarget(null);
            if (selectedPolicy?.policy_name === policyName) {
                setDrawerOpen(false);
                setSelectedPolicy(null);
            }
            fetchPolicies();
        } catch (err: any) {
            setDrawerError(err?.message || 'Failed to delete policy');
        } finally {
            setDeleting(false);
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
                    <button className="ghost-button" type="button" onClick={openCreate}>
                        Create policy
                    </button>
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
                                                    onClick={() => openView(policy)}
                                                >
                                                    <FiEye />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="icon-button"
                                                    aria-label="Edit policy"
                                                    onClick={() => openEdit(policy)}
                                                >
                                                    <FiEdit2 />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="icon-button danger"
                                                    aria-label="Delete policy"
                                                    onClick={() => {
                                                        setDeleteTarget(policy);
                                                        setShowDeleteConfirm(true);
                                                    }}
                                                >
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
                        <div className="drawer-title">
                            {drawerMode === 'create'
                                ? 'Create policy'
                                : selectedPolicy?.policy_name || 'Policy details'}
                        </div>
                        <div className="drawer-subtitle">{selectedPolicy?.namespace || editForm.namespace || '—'}</div>
                    </div>
                    <div className="drawer-header-actions">
                        {selectedPolicy && drawerMode === 'view' && (
                            <button
                                className="ghost-button"
                                onClick={() => {
                                    setDrawerMode('edit');
                                    setEditForm(hydrateEditForm(selectedPolicy));
                                    setDrawerError(null);
                                    setDrawerSuccess(null);
                                }}
                            >
                                Edit
                            </button>
                        )}
                        {selectedPolicy && drawerMode === 'edit' && (
                            <button
                                className="ghost-button"
                                onClick={() => {
                                    setDrawerMode('view');
                                    setDrawerError(null);
                                    setDrawerSuccess(null);
                                }}
                            >
                                View
                            </button>
                        )}
                        <button className="icon-button" aria-label="Close" onClick={() => setDrawerOpen(false)}>
                            <FiX />
                        </button>
                    </div>
                </div>
                {drawerError && (
                    <div className="alert error">
                        <FiAlertTriangle /> {drawerError}
                    </div>
                )}
                {drawerSuccess && (
                    <div className="alert success">
                        {drawerSuccess}
                    </div>
                )}
                {drawerMode === 'edit' && selectedPolicy ? (
                    <form className="drawer-form" onSubmit={handleSave}>
                        <div className="form-grid single-column">
                            <label className="form-field">
                                <span className="form-label">Policy Name</span>
                                <input type="text" value={selectedPolicy?.policy_name || ''} readOnly />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Namespace</span>
                                <input
                                    type="text"
                                    value={editForm.namespace || ''}
                                    onChange={(e) => setEditForm((prev: any) => ({ ...prev, namespace: e.target.value }))}
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Frontend Service</span>
                                <input
                                    type="text"
                                    value={editForm.frontend_service || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, frontend_service: e.target.value }))
                                    }
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Frontend Port</span>
                                <input
                                    type="text"
                                    value={editForm.frontend_port || ''}
                                    onChange={(e) => setEditForm((prev: any) => ({ ...prev, frontend_port: e.target.value }))}
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Telemetry Metric</span>
                                <select
                                    value={editForm.telemetry_metric || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, telemetry_metric: e.target.value }))
                                    }
                                >
                                    <option value="">Select metric</option>
                                    {metricOptions.map((m) => (
                                        <option key={m} value={m}>
                                            {m}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Violation Threshold</span>
                                <input
                                    type="number"
                                    value={editForm.telemetry_violation_threshold || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({
                                            ...prev,
                                            telemetry_violation_threshold: e.target.value,
                                        }))
                                    }
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Monitor Selector</span>
                                <input
                                    type="text"
                                    value={editForm.telemetry_monitor || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, telemetry_monitor: e.target.value }))
                                    }
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Backend Selector</span>
                                <input
                                    type="text"
                                    value={editForm.action_backend_selector || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, action_backend_selector: e.target.value }))
                                    }
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Backend Port</span>
                                <input
                                    type="text"
                                    value={editForm.action_backend_port || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, action_backend_port: e.target.value }))
                                    }
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Protocol</span>
                                <input
                                    type="text"
                                    value={editForm.action_protocol || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, action_protocol: e.target.value }))
                                    }
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">TTL Seconds</span>
                                <input
                                    type="number"
                                    value={editForm.action_ttl_seconds || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, action_ttl_seconds: e.target.value }))
                                    }
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Strategy</span>
                                <select
                                    value={editForm.action_strategy || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, action_strategy: e.target.value }))
                                    }
                                >
                                    <option value="">Select strategy</option>
                                    {strategyOptions.map((s) => (
                                        <option key={s} value={s}>
                                            {s}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Backend Candidates Selector</span>
                                <input
                                    type="text"
                                    value={editForm.action_backend_candidates_selector || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({
                                            ...prev,
                                            action_backend_candidates_selector: e.target.value,
                                        }))
                                    }
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Winner Label</span>
                                <input
                                    type="text"
                                    value={editForm.action_winner_label || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, action_winner_label: e.target.value }))
                                    }
                                />
                            </label>
                        </div>
                        <div className="drawer-footer">
                            <button
                                type="button"
                                className="ghost-button"
                                onClick={() => setDrawerOpen(false)}
                                disabled={saving}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="ghost-button danger"
                                onClick={() => {
                                    setDeleteTarget(selectedPolicy);
                                    setShowDeleteConfirm(true);
                                }}
                                disabled={deleting || saving}
                            >
                                {deleting ? 'Deleting…' : 'Delete'}
                            </button>
                            <button type="submit" className="primary-button" disabled={saving}>
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </form>
                ) : drawerMode === 'create' ? (
                    <form className="drawer-form" onSubmit={handleSave}>
                        <div className="form-grid single-column">
                            <label className="form-field">
                                <span className="form-label">Policy Name *</span>
                                <input
                                    type="text"
                                    value={editForm.policy_name || ''}
                                    onChange={(e) => setEditForm((prev: any) => ({ ...prev, policy_name: e.target.value }))}
                                    required
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Namespace *</span>
                                <input
                                    type="text"
                                    value={editForm.namespace || ''}
                                    onChange={(e) => setEditForm((prev: any) => ({ ...prev, namespace: e.target.value }))}
                                    required
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Frontend Service *</span>
                                <input
                                    type="text"
                                    value={editForm.frontend_service || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, frontend_service: e.target.value }))
                                    }
                                    required
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Frontend Port *</span>
                                <input
                                    type="number"
                                    value={editForm.frontend_port || ''}
                                    onChange={(e) => setEditForm((prev: any) => ({ ...prev, frontend_port: e.target.value }))}
                                    required
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Telemetry Metric *</span>
                                <select
                                    value={editForm.telemetry_metric || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, telemetry_metric: e.target.value }))
                                    }
                                    required
                                >
                                    <option value="">Select metric</option>
                                    {metricOptions.map((m) => (
                                        <option key={m} value={m}>
                                            {m}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Violation Threshold *</span>
                                <input
                                    type="number"
                                    value={editForm.telemetry_violation_threshold || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({
                                            ...prev,
                                            telemetry_violation_threshold: e.target.value,
                                        }))
                                    }
                                    required
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Monitor Selector *</span>
                                <input
                                    type="text"
                                    value={editForm.telemetry_monitor || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, telemetry_monitor: e.target.value }))
                                    }
                                    required
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Backend Selector *</span>
                                <input
                                    type="text"
                                    value={editForm.action_backend_selector || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, action_backend_selector: e.target.value }))
                                    }
                                    required
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Backend Port *</span>
                                <input
                                    type="number"
                                    value={editForm.action_backend_port || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, action_backend_port: e.target.value }))
                                    }
                                    required
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Protocol *</span>
                                <input
                                    type="text"
                                    value={editForm.action_protocol || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, action_protocol: e.target.value }))
                                    }
                                    required
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">TTL Seconds *</span>
                                <input
                                    type="number"
                                    value={editForm.action_ttl_seconds || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, action_ttl_seconds: e.target.value }))
                                    }
                                    required
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Strategy</span>
                                <select
                                    value={editForm.action_strategy || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, action_strategy: e.target.value }))
                                    }
                                >
                                    <option value="">Select strategy</option>
                                    {strategyOptions.map((s) => (
                                        <option key={s} value={s}>
                                            {s}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Backend Candidates Selector</span>
                                <input
                                    type="text"
                                    value={editForm.action_backend_candidates_selector || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({
                                            ...prev,
                                            action_backend_candidates_selector: e.target.value,
                                        }))
                                    }
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Winner Label</span>
                                <input
                                    type="text"
                                    value={editForm.action_winner_label || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({ ...prev, action_winner_label: e.target.value }))
                                    }
                                />
                            </label>
                        </div>
                        <div className="drawer-footer">
                            <button
                                type="button"
                                className="ghost-button"
                                onClick={() => setDrawerOpen(false)}
                                disabled={saving}
                            >
                                Cancel
                            </button>
                            <button type="submit" className="primary-button" disabled={saving}>
                                {saving ? 'Creating…' : 'Create'}
                            </button>
                        </div>
                    </form>
                ) : (
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
                )}
            </div>
            {showDeleteConfirm && (
                <div
                    className="modal-overlay"
                    onClick={() => !deleting && setShowDeleteConfirm(false)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <div
                        className="modal"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: '520px',
                            maxWidth: '92vw',
                            padding: '22px 24px',
                            boxSizing: 'border-box',
                        }}
                    >

                        <div
                            className="modal-body"
                            style={{
                                textAlign: 'center',
                                lineHeight: 1.5,
                                marginBottom: '18px',
                                wordBreak: 'normal',
                                overflowWrap: 'anywhere',
                            }}
                        >
                            Are you sure you want to delete{' '}
                            <strong>{deleteTarget?.policy_name || selectedPolicy?.policy_name || 'this policy'}</strong>?
                        </div>

                        <div
                            className="modal-actions"
                            style={{
                                display: 'flex',
                                justifyContent: 'center',
                                gap: '12px',
                            }}
                        >
                            <button
                                type="button"
                                className="ghost-button"
                                onClick={() => setShowDeleteConfirm(false)}
                                disabled={deleting}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="ghost-button danger"
                                onClick={handleDelete}
                                disabled={deleting}
                            >
                                {deleting ? 'Deleting…' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
