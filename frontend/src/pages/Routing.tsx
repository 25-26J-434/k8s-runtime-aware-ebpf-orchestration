import { useEffect, useMemo, useState } from 'react';
import { FiAlertTriangle, FiDatabase, FiRefreshCw, FiEdit2, FiEye, FiTrash2, FiX } from 'react-icons/fi';
import { api } from '../services/api';
import './Page.css';
import './Routing.css';

type PolicyRecord = {
    id?: string;
    policy_name?: string;
    namespace?: string;
    scope?: string;
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

type ProbeResult = {
    raw: string;
    service?: string;
    pod?: string;
    node?: string;
    winnerLabel?: string;
    winnerLabelPresent?: boolean;
    podLabels?: Record<string, string>;
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

    // Supported telemetry metrics (must stay in sync with backend validation)
    const metricOptions = ['dns_latency', 'disk_io'];
    const strategyOptions = ['best_pod', 'all'];
    const [deleteTarget, setDeleteTarget] = useState<PolicyRecord | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [applyingPolicy, setApplyingPolicy] = useState<string | null>(null);
    const [applyError, setApplyError] = useState<string | null>(null);
    const [applyStatus, setApplyStatus] = useState<string | null>(null);
    const [applyToastTs, setApplyToastTs] = useState<string | null>(null);
    const [applyToastMessage, setApplyToastMessage] = useState<string | null>(null);
    const [clusterSummary, setClusterSummary] = useState<any>(null);
    const [clusterLoading, setClusterLoading] = useState(false);
    const [clusterError, setClusterError] = useState<string | null>(null);
    const [selectedNode, setSelectedNode] = useState<string>('');
    const [probeLoading, setProbeLoading] = useState(false);
    const [probeError, setProbeError] = useState<string | null>(null);
    const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
    const [probeTs, setProbeTs] = useState<string | null>(null);
    const [lastApplyResult, setLastApplyResult] = useState<any>(null);

    const fetchClusterSummary = async () => {
        setClusterLoading(true);
        setClusterError(null);
        try {
            const data = await api.getClusterSummary();
            setClusterSummary(data || {});
            const firstNode = data?.nodes?.[0]?.name || '';
            setSelectedNode(firstNode);
            return data || {};
        } catch (err: any) {
            setClusterError(err?.message || 'Failed to fetch cluster summary');
            return null;
        } finally {
            setClusterLoading(false);
        }
    };
    const defaultCreateForm = {
        policy_name: '',
        namespace: 'test-services',
        scope: 'local',
        frontend_service: '',
        frontend_port: '',
        action_target_namespace: '',
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
        action_winner_label: 'redirect-winner=yes',
    };
    const targetNamespace = editForm.action_target_namespace || editForm.namespace || '';

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

    const resolveWinnerLabel = (policy: PolicyRecord) => {
        const actionObj = typeof policy.action === 'object' ? (policy.action as any) : {};
        return actionObj.winner_label || policy.winner_label || 'redirect-winner=yes';
    };

    const parseWinnerLabel = (label: string) => {
        const parts = String(label || '').split('=');
        if (parts.length < 2) return { key: label, value: '' };
        return { key: parts[0], value: parts.slice(1).join('=') };
    };

    const parseWhoami = (text: string) => {
        const match = text.match(/Hi,\s*I am\s*([^\n(]+)\s*\(([^)]+)\)/i);
        if (!match) return { service: 'unknown', pod: '' };
        let service = match[1].trim();
        let pod = match[2].trim();
        if (pod.startsWith('pod=')) pod = pod.slice('pod='.length);
        return { service, pod };
    };

    const getFrontendInfo = (policy: PolicyRecord) => {
        const service = policy.frontend?.service || policy.frontend_service || '';
        const port =
            policy.frontend?.port ||
            policy.frontend_service_port ||
            (policy as any).frontend_port ||
            5000;
        const namespace = policy.namespace || 'default';
        return { service, port, namespace };
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

    const policyStatusLabel = (policy: PolicyRecord) => {
        const status = (policy as any).status || {};
        const lastDecision = status.last_decision || status.lastDecision || (policy as any).last_decision || (policy as any).lastDecision;
        const lastExpired =
            status.last_expired_at || status.lastExpiredAt || (policy as any).last_expired_at || (policy as any).lastExpiredAt;
        const lastApplied =
            status.last_applied_at || status.lastAppliedAt || (policy as any).last_applied_at || (policy as any).lastAppliedAt;
        const appliedAt = lastApplied ? new Date(lastApplied).getTime() : 0;
        const expiredAt = lastExpired ? new Date(lastExpired).getTime() : 0;
        if (appliedAt > 0 && appliedAt >= expiredAt) {
            return 'active';
        }
        if (String(lastDecision || '').toUpperCase() === 'EXPIRED' || !!lastExpired) {
            return 'expired';
        }
        if (String(lastDecision || '').toUpperCase() === 'APPLIED' || !!lastApplied) return 'active';
        return 'unknown';
    };

    const hydrateEditForm = (policy: PolicyRecord) => {
        const actionObj = typeof policy.action === 'object' ? (policy.action as any) : {};
        return {
            policy_name: policy.policy_name || '',
            namespace: policy.namespace || '',
            scope: policy.scope || 'local',
            action_target_namespace: (policy as any).action_target_namespace || policy.namespace || '',
            frontend_service: policy.frontend?.service || policy.frontend_service || '',
            frontend_port: policy.frontend?.port || policy.frontend_service_port || '',
            telemetry_metric: policy.telemetry?.metric || policy.metric || '',
            telemetry_violation_threshold: policy.telemetry?.violation_threshold || policy.violation_threshold || '',
            telemetry_monitor: policy.frontend?.service || policy.frontend_service || policy.telemetry?.monitor_pod_contains || policy.monitor_pod_contains || '',
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
        if (!clusterSummary && !clusterLoading) {
            fetchClusterSummary();
        }
    };

    const openEdit = (policy: PolicyRecord) => {
        setSelectedPolicy(policy);
        setDrawerMode('edit');
        setEditForm(hydrateEditForm(policy));
        setDrawerOpen(true);
        setDrawerError(null);
        setDrawerSuccess(null);
        if (!clusterSummary && !clusterLoading) {
            fetchClusterSummary();
        } else if (!selectedNode && clusterSummary?.nodes?.length) {
            setSelectedNode(clusterSummary.nodes[0].name);
        }
    };

    const openCreate = () => {
        setSelectedPolicy(null);
        setDrawerMode('create');
        setEditForm(defaultCreateForm);
        setDrawerOpen(true);
        setDrawerError(null);
        setDrawerSuccess(null);
        if (!clusterSummary && !clusterLoading) {
            fetchClusterSummary();
        }
    };

    const handleApplyPolicy = async (policy: PolicyRecord) => {
        if (!policy.policy_name) return;
        setApplyingPolicy(policy.policy_name);
        setApplyError(null);
        setApplyStatus(null);
        setApplyToastMessage(null);
        try {
            const res = await api.applyPolicy(policy.policy_name);
            const statusText = res.applied ? 'Redirect applied' : 'Policy evaluated';
            setApplyStatus(statusText);
            const targetText = res.target_backend ? `Target: ${res.target_backend}` : '';
            setApplyToastMessage(res.message || targetText || statusText);
            setApplyToastTs(new Date().toLocaleTimeString());
            setLastApplyResult({ policy: policy.policy_name, ...res });
            if (res.applied) {
                await runProbe(policy);
            }
        } catch (err: any) {
            setApplyError(err?.message || `Failed to apply ${policy.policy_name}`);
        } finally {
            setApplyingPolicy(null);
        }
    };

    const runProbe = async (policy: PolicyRecord) => {
        const { service, port, namespace } = getFrontendInfo(policy);
        if (!service) {
            setProbeError('Frontend service missing in policy.');
            return;
        }
        setProbeLoading(true);
        setProbeError(null);
        try {
            let summary = clusterSummary;
            if (!summary && !clusterLoading) {
                summary = await fetchClusterSummary();
            }
            const text = await api.probeService(service, namespace, port, '/whoami');
            const parsed = parseWhoami(text);
            const pods = summary?.pods || [];
            const podEntry =
                pods.find((p: any) => p.name === parsed.pod && p.namespace === namespace) ||
                pods.find((p: any) => p.name === parsed.pod);
            const labels = (podEntry?.labels || {}) as Record<string, string>;
            const winnerLabel = resolveWinnerLabel(policy);
            const { key, value } = parseWinnerLabel(winnerLabel);
            const winnerLabelPresent =
                key && value ? labels?.[key] === value : key ? Object.prototype.hasOwnProperty.call(labels || {}, key) : false;
            setProbeResult({
                raw: text,
                service: parsed.service,
                pod: parsed.pod,
                node: podEntry?.node || '',
                podLabels: labels,
                winnerLabel,
                winnerLabelPresent,
            });
            setProbeTs(new Date().toLocaleTimeString());
        } catch (err: any) {
            setProbeError(err?.message || 'Failed to probe service');
        } finally {
            setProbeLoading(false);
        }
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
                scope: editForm.scope || 'local',
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
                    winner_label: 'redirect-winner=yes',
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
        addIfValue(body, 'scope', editForm.scope);

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
            editForm.action_target_namespace !== undefined ||
            editForm.action_backend_candidates_selector !== undefined
        ) {
            body.action = {};
            addIfValue(body.action, 'type', editForm.action_type);
            addIfValue(body.action, 'backend_selector', editForm.action_backend_selector);
            addIfValue(body.action, 'target_namespace', editForm.action_target_namespace);
            const backendPort = numOrString(editForm.action_backend_port);
            if (backendPort !== undefined) addIfValue(body.action, 'backend_port', backendPort);
            addIfValue(body.action, 'protocol', editForm.action_protocol);
            const ttl = numOrString(editForm.action_ttl_seconds);
            if (ttl !== undefined) addIfValue(body.action, 'ttl_seconds', ttl);
            addIfValue(body.action, 'strategy', editForm.action_strategy);
            addIfValue(body.action, 'backend_candidates_selector', editForm.action_backend_candidates_selector);
            if (!Object.keys(body.action).length) delete body.action;
            else {
                body.action.winner_label = selectedPolicy?.action?.winner_label || 'redirect-winner=yes';
            }
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

    useEffect(() => {
        if (!clusterSummary && (drawerMode === 'create' || drawerMode === 'edit')) {
            fetchClusterSummary();
        }
    }, [clusterSummary, drawerMode]);

    useEffect(() => {
        if (editForm.frontend_service) {
            setEditForm((prev: any) => ({
                ...prev,
                telemetry_monitor: prev.frontend_service,
            }));
        }
    }, [editForm.frontend_service]);

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

    const renderPolicyTable = (list: PolicyRecord[], showLoadingRow: boolean, emptyLabel: string) => {
        return (
            <div className="policy-table-wrapper">
                <table className="policy-table">
                    <thead>
                        <tr>
                            <th>Policy</th>
                            <th>Scope</th>
                            <th>Status</th>
                            <th>Metric</th>
                            <th>Threshold</th>
                            <th>TTL (s)</th>
                            <th>Actions</th>
                            <th>Policy Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {showLoadingRow && (
                            <tr>
                                <td colSpan={8} className="table-loading">
                                    Loading…
                                </td>
                            </tr>
                        )}
                        {!showLoadingRow && list.length === 0 && (
                            <tr>
                                <td colSpan={8} className="table-loading">
                                    {emptyLabel}
                                </td>
                            </tr>
                        )}
                        {!showLoadingRow &&
                            list.map((policy) => {
                                const status = policyStatusLabel(policy);

                                return (
                                    <tr key={policy.id || policy.policy_name}>
                                        <td data-label="Policy">
                                            <div className="cell-main">{policy.policy_name || '—'}</div>
                                        </td>
                                        <td data-label="Scope">{policy.scope || 'local'}</td>
                                        <td data-label="Status">
                                            <span className={`status-pill ${status}`}>{status}</span>
                                        </td>
                                        <td data-label="Metric">{resolveMetric(policy)}</td>
                                        <td data-label="Threshold">{resolveThreshold(policy)}</td>
                                        <td data-label="TTL (s)">{resolveTtl(policy)}</td>
                                        <td className="table-actions" data-label="Actions">
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
                                        <td className="policy-action-cell" data-label="Policy Action">
                                            <button
                                                type="button"
                                                className="apply-button"
                                                onClick={() => handleApplyPolicy(policy)}
                                                disabled={applyingPolicy === policy.policy_name}
                                            >
                                                {applyingPolicy === policy.policy_name ? 'Applying…' : 'Apply'}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                    </tbody>
                </table>
            </div>
        );
    };

    const namespacesForNode = useMemo(() => {
        if (!selectedNode || !clusterSummary?.pods) return clusterSummary?.namespaces || [];
        const nsSet = new Set<string>();
        for (const pod of clusterSummary.pods || []) {
            if (pod.node === selectedNode && pod.namespace) nsSet.add(pod.namespace);
        }
        return Array.from(nsSet);
    }, [selectedNode, clusterSummary]);

    const servicesForNamespace = (ns: string) => {
        if (!ns || !clusterSummary?.services) return [];
        return (clusterSummary.services as any[]).filter((svc) => svc.namespace === ns);
    };

    const podsForNamespace = (ns: string) => {
        if (!ns || !clusterSummary?.pods) return [];
        return (clusterSummary.pods as any[]).filter((p) => p.namespace === ns);
    };

    const selectorFromService = (svc: any) => {
        if (!svc?.selector) return '';
        const entries = Object.entries(svc.selector);
        if (!entries.length) return '';
        const [k, v] = entries[0];
        return `${k}=${v}`;
    };

    const backendPortForSelector = (ns: string, selector: string) => {
        if (!selector) return '';
        const svc = servicesForNamespace(ns).find((s: any) => selectorFromService(s) === selector);
        if (svc?.ports?.length) {
            const port = svc.ports[0]?.port;
            if (port) return port;
        }
        const pod = podsForNamespace(ns).find((p: any) => p.labels?.app && `app=${p.labels.app}` === selector);
        const podPort = pod?.containers?.[0]?.ports?.[0]?.containerPort;
        return podPort || '';
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
                {applyError && (
                    <div className="alert error">
                        <FiAlertTriangle /> {applyError}
                    </div>
                )}

                {!loading && !error && !policies.length && (
                    <div className="empty-state">
                        No policies found. Create one via the routing backend and reload.
                    </div>
                )}

                {renderPolicyTable(policies, loading, 'No policies found.')}
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
                            {clusterError && (
                                <div className="alert error">
                                    <FiAlertTriangle /> {clusterError}
                                </div>
                            )}
                            <label className="form-field">
                                <span className="form-label">Node</span>
                                <select
                                    value={selectedNode}
                                    onChange={(e) => {
                                        setSelectedNode(e.target.value);
                                        const nsList = namespacesForNode;
                                        if (nsList.length) {
                                            setEditForm((prev: any) => ({ ...prev, namespace: nsList[0] }));
                                        }
                                    }}
                                    disabled={clusterLoading}
                                >
                                    <option value="">Select node</option>
                                    {(clusterSummary?.nodes || []).map((n: any) => (
                                        <option key={n.name} value={n.name}>
                                            {n.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Policy Name</span>
                                <input type="text" value={selectedPolicy?.policy_name || ''} readOnly />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Namespace</span>
                                <select
                                    value={editForm.namespace || ''}
                                    onChange={(e) => setEditForm((prev: any) => ({ ...prev, namespace: e.target.value }))}
                                    disabled={clusterLoading}
                                >
                                    <option value="">Select namespace</option>
                                    {(namespacesForNode.length ? namespacesForNode : clusterSummary?.namespaces || []).map(
                                        (ns: string) => (
                                            <option key={ns} value={ns}>
                                                {ns}
                                            </option>
                                        )
                                    )}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Scope</span>
                                <select
                                    value={editForm.scope || 'local'}
                                    onChange={(e) => setEditForm((prev: any) => ({ ...prev, scope: e.target.value }))}
                                >
                                    <option value="local">Local</option>
                                    <option value="cluster">Cluster</option>
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Traffic Entry Service</span>
                                <select
                                    value={editForm.frontend_service || ''}
                                    onChange={(e) => {
                                        const svcName = e.target.value;
                                        setEditForm((prev: any) => ({
                                            ...prev,
                                            frontend_service: svcName,
                                            telemetry_monitor: svcName,
                                        }));
                                        const svc = servicesForNamespace(editForm.namespace || '').find(
                                            (s: any) => s.name === svcName
                                        );
                                        const port = svc?.ports?.[0]?.port;
                                        if (port) {
                                            setEditForm((prev: any) => ({ ...prev, frontend_port: port }));
                                        }
                                    }}
                                    disabled={clusterLoading}
                                >
                                    <option value="">Select service</option>
                                    {servicesForNamespace(editForm.namespace || '').map((svc: any) => (
                                        <option key={`${svc.namespace}-${svc.name}`} value={svc.name}>
                                            {svc.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Traffic Entry Port</span>
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
                                    value={editForm.frontend_service || selectedPolicy?.frontend?.service || ''}
                                    readOnly
                                    disabled
                                    title="Monitor selector mirrors frontend service"
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Target Selector Namespace</span>
                                <select
                                    value={editForm.action_target_namespace || editForm.namespace || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({
                                            ...prev,
                                            action_target_namespace: e.target.value,
                                        }))
                                    }
                                    disabled={clusterLoading}
                                >
                                    <option value="">Same as policy namespace ({editForm.namespace || 'set namespace'})</option>
                                    {(clusterSummary?.namespaces || []).map((ns: string) => (
                                        <option key={`target-ns-${ns}`} value={ns}>
                                            {ns}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Target Selector</span>
                                <select
                                    value={editForm.action_backend_selector || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => {
                                            const selector = e.target.value;
                                            const ns = prev.action_target_namespace || prev.namespace || '';
                                            const port = backendPortForSelector(ns, selector);
                                            return {
                                                ...prev,
                                                action_backend_selector: selector,
                                                action_backend_port: port || prev.action_backend_port,
                                            };
                                        })
                                    }
                                    disabled={clusterLoading}
                                >
                                    <option value="">Select Target Selector</option>
                                    {servicesForNamespace(editForm.action_target_namespace || editForm.namespace || '').map((svc: any) => {
                                        const sel = selectorFromService(svc);
                                        if (!sel) return null;
                                        return (
                                            <option key={`${svc.namespace}-${svc.name}-sel-edit`} value={sel}>
                                                {svc.name} ({sel})
                                            </option>
                                        );
                                    })}
                                    {podsForNamespace(editForm.action_target_namespace || editForm.namespace || '').map((pod: any) => {
                                        const app = pod.labels?.app;
                                        const sel = app ? `app=${app}` : '';
                                        if (!sel) return null;
                                        return (
                                            <option key={`${pod.namespace}-${pod.name}-pod-edit`} value={sel}>
                                                Pod {pod.name} ({sel})
                                            </option>
                                        );
                                    })}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Target Sector's Port</span>
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
                                <span className="form-label">Target Candidates Selector</span>
                                <select
                                    value={editForm.action_backend_candidates_selector || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({
                                            ...prev,
                                            action_backend_candidates_selector: e.target.value,
                                        }))
                                    }
                                    disabled={clusterLoading}
                                >
                                    <option value="">Select backend candidates</option>
                                    {servicesForNamespace(editForm.namespace || '').map((svc: any) => {
                                        const sel = selectorFromService(svc);
                                        if (!sel) return null;
                                        return (
                                            <option key={`${svc.namespace}-${svc.name}-sel`} value={sel}>
                                                {svc.name} ({sel})
                                            </option>
                                        );
                                    })}
                                    {podsForNamespace(editForm.namespace || '').map((pod: any) => {
                                        const app = pod.labels?.app;
                                        const sel = app ? `app=${app}` : '';
                                        if (!sel) return null;
                                        return (
                                            <option key={`${pod.namespace}-${pod.name}-pod`} value={sel}>
                                                Pod {pod.name} ({sel})
                                            </option>
                                        );
                                    })}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Winner Pod Label</span>
                                <input
                                    type="text"
                                    value="redirect-winner=yes"
                                    readOnly
                                    disabled
                                    title="Set automatically"
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
                            {clusterError && (
                                <div className="alert error">
                                    <FiAlertTriangle /> {clusterError}
                                </div>
                            )}
                            <label className="form-field">
                                <span className="form-label">Node</span>
                                <select
                                    value={selectedNode}
                                    onChange={(e) => {
                                        setSelectedNode(e.target.value);
                                        const nsList = namespacesForNode;
                                        if (nsList.length) {
                                            setEditForm((prev: any) => ({ ...prev, namespace: nsList[0] }));
                                        }
                                    }}
                                    disabled={clusterLoading}
                                >
                                    <option value="">Select node</option>
                                    {(clusterSummary?.nodes || []).map((n: any) => (
                                        <option key={n.name} value={n.name}>
                                            {n.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
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
                                <select
                                    value={editForm.namespace || ''}
                                    onChange={(e) => setEditForm((prev: any) => ({ ...prev, namespace: e.target.value }))}
                                    required
                                    disabled={clusterLoading}
                                >
                                    <option value="">Select namespace</option>
                                    {(namespacesForNode.length ? namespacesForNode : clusterSummary?.namespaces || []).map(
                                        (ns: string) => (
                                            <option key={ns} value={ns}>
                                                {ns}
                                            </option>
                                        )
                                    )}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Scope</span>
                                <select
                                    value={editForm.scope || 'local'}
                                    onChange={(e) => setEditForm((prev: any) => ({ ...prev, scope: e.target.value }))}
                                >
                                    <option value="local">Local</option>
                                    <option value="cluster">Cluster</option>
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Traffic Entrypoint Service *</span>
                                <select
                                    value={editForm.frontend_service || ''}
                                    onChange={(e) => {
                                        const svcName = e.target.value;
                                        setEditForm((prev: any) => ({
                                            ...prev,
                                            frontend_service: svcName,
                                            telemetry_monitor: svcName,
                                        }));
                                        const svc = servicesForNamespace(editForm.namespace || '').find(
                                            (s: any) => s.name === svcName
                                        );
                                        const port = svc?.ports?.[0]?.port;
                                        if (port) {
                                            setEditForm((prev: any) => ({ ...prev, frontend_port: port }));
                                        }
                                    }}
                                    required
                                    disabled={clusterLoading}
                                >
                                    <option value="">Select service</option>
                                    {servicesForNamespace(editForm.namespace || '').map((svc: any) => (
                                        <option key={`${svc.namespace}-${svc.name}`} value={svc.name}>
                                            {svc.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Traffic Entry Port *</span>
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
                                    value={editForm.frontend_service || ''}
                                    readOnly
                                    disabled
                                    required
                                    title="Monitor selector mirrors frontend service"
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Target Selector Namespace</span>
                                <select
                                    value={editForm.action_target_namespace || editForm.namespace || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({
                                            ...prev,
                                            action_target_namespace: e.target.value,
                                        }))
                                    }
                                    disabled={clusterLoading}
                                >
                                    <option value="">Same as policy namespace ({editForm.namespace || 'set namespace'})</option>
                                    {(clusterSummary?.namespaces || []).map((ns: string) => (
                                        <option key={`target-ns-${ns}`} value={ns}>
                                            {ns}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Target Selector *</span>
                                <select
                                    value={editForm.action_backend_selector || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => {
                                            const selector = e.target.value;
                                            const port = backendPortForSelector(targetNamespace, selector);
                                            return {
                                                ...prev,
                                                action_backend_selector: selector,
                                                action_backend_port: port || prev.action_backend_port,
                                            };
                                        })
                                    }
                                    required
                                    disabled={clusterLoading}
                                >
                                    <option value="">Select Target Selector</option>
                                    {servicesForNamespace(targetNamespace).map((svc: any) => {
                                        const sel = selectorFromService(svc);
                                        if (!sel) return null;
                                        return (
                                            <option key={`${svc.namespace}-${svc.name}-sel`} value={sel}>
                                                {svc.name} ({sel})
                                            </option>
                                        );
                                    })}
                                    {podsForNamespace(targetNamespace).map((pod: any) => {
                                        const app = pod.labels?.app;
                                        const sel = app ? `app=${app}` : '';
                                        if (!sel) return null;
                                        return (
                                            <option key={`${pod.namespace}-${pod.name}-pod`} value={sel}>
                                                Pod {pod.name} ({sel})
                                            </option>
                                        );
                                    })}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Target Sector's Port *</span>
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
                                <span className="form-label">Target Candidates Selector</span>
                                <select
                                    value={editForm.action_backend_candidates_selector || ''}
                                    onChange={(e) =>
                                        setEditForm((prev: any) => ({
                                            ...prev,
                                            action_backend_candidates_selector: e.target.value,
                                        }))
                                    }
                                    disabled={clusterLoading}
                                >
                                    <option value="">Select backend candidates</option>
                                    {servicesForNamespace(editForm.namespace || '').map((svc: any) => {
                                        const sel = selectorFromService(svc);
                                        if (!sel) return null;
                                        return (
                                            <option key={`${svc.namespace}-${svc.name}-sel-create`} value={sel}>
                                                {svc.name} ({sel})
                                            </option>
                                        );
                                    })}
                                    {podsForNamespace(editForm.namespace || '').map((pod: any) => {
                                        const app = pod.labels?.app;
                                        const sel = app ? `app=${app}` : '';
                                        if (!sel) return null;
                                        return (
                                            <option key={`${pod.namespace}-${pod.name}-pod-create`} value={sel}>
                                                Pod {pod.name} ({sel})
                                            </option>
                                        );
                                    })}
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Winner Pod Label</span>
                                <input
                                    type="text"
                                    value="redirect-winner=yes"
                                    readOnly
                                    disabled
                                    title="Set automatically"
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
                    <div className="detail-stack">
                        <div className="detail-grid">
                            {selectedPolicy ? (
                                <>
                                    {[
                                        { label: 'Frontend', value: selectedPolicy.frontend || selectedPolicy.frontend_service },
                                        { label: 'Monitor', value: selectedPolicy.telemetry?.monitor_pod_contains || selectedPolicy.monitor_pod_contains },
                                        { label: 'Target selector', value: resolveTarget(selectedPolicy) },
                                        { label: 'Scope', value: selectedPolicy.scope || 'local' },
                                        { label: 'Backend candidates', value: (selectedPolicy as any).backend_candidates_selector || (typeof selectedPolicy.action === 'object' ? (selectedPolicy.action as any).backend_candidates_selector : '') },
                                        { label: 'Action', value: selectedPolicy.action },
                                        { label: 'Strategy', value: (typeof selectedPolicy.action === 'object' ? (selectedPolicy.action as any).strategy : (selectedPolicy as any).strategy) },
                                        { label: 'Winner Pod Label', value: (typeof selectedPolicy.action === 'object' ? (selectedPolicy.action as any).winner_label : (selectedPolicy as any).winner_label) },
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

                    </div>
                )}
            </div>
            {applyStatus && (
                <div className="toast success">
                    <div className="toast-title">{applyStatus}</div>
                    {applyToastMessage && <div className="toast-body">{applyToastMessage}</div>}
                    {applyToastTs && <div className="toast-meta">{applyToastTs}</div>}
                    <button
                        className="toast-close"
                        aria-label="Close"
                        onClick={() => {
                            setApplyStatus(null);
                            setApplyToastMessage(null);
                            setApplyToastTs(null);
                        }}
                    >
                        <FiX />
                    </button>
                </div>
            )}
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
