import { useEffect, useMemo, useState } from 'react';
import { FiActivity, FiAlertTriangle, FiRefreshCw, FiSend, FiServer, FiZap } from 'react-icons/fi';
import { useMetrics } from '../hooks/useMetrics';
import { useClusterInfo } from '../hooks/useClusterInfo';
import { api } from '../services/api';
import type { RedirectRulePayload, RedirectionEvent, RedirectionEventPayload } from '../types/api';
import './Page.css';
import './Routing.css';

type RoutingFormState = RedirectionEventPayload & RedirectRulePayload;

const defaultPayload: RoutingFormState = {
    policy_name: '',
    namespace: 'test-service',
    frontend_service: '',
    frontend_service_port: '',
    monitor_pod_contains: '',
    metric: 'dns_us',
    violation_threshold: 1000,
    action: 'redirect',
    redirect_backend_label: '',
    redirect_backend_port: '',
    redirect_backend_protocol: 'TCP',
    ttl_seconds: '',
    choose_best_pod: false,
    backend_candidate_label: '',
    redirect_winner_label: 'redirect-winner=yes',
    planned_backend_service: 'service-b',
    planned_backend_label: 'app=service-b',
    planned_backend_port: '5001',
    final_backend_service: 'service-c',
    final_backend_label: 'app=service-c',
    final_backend_port: '5003',
    violation_triggered: false,
    accepted_service: 'service-c',
    status: 'applied',
    notes: 'Hello I am service C (redirect winner)',
};

const policyPresets = [
    {
        label: 'Redirect service-a → service-c (sample)',
        value: 'redirect-service-a-to-c',
        namespace: 'test-service',
        frontend_service: 'service-a',
        frontend_service_port: '5000',
        monitor_pod_contains: 'service-a',
        redirect_backend_label: 'app=service-c',
        redirect_backend_port: '5003',
        backend_candidate_label: 'app=service-c',
        notes: 'policy',
    },
];

const serviceOptions = ['service-a', 'service-b', 'service-c'];
const portOptions = ['5000', '5001', '5003'];
const backendLabelOptions = ['app=service-b', 'app=service-c'];

export function Routing() {
    const { metrics } = useMetrics(6000);
    const clusterInfo = useClusterInfo(5000);
    const [payload, setPayload] = useState<RoutingFormState>(defaultPayload);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastEvent, setLastEvent] = useState<RedirectionEvent | null>(null);
    const [applyOutput, setApplyOutput] = useState<string | null>(null);
    const [identity, setIdentity] = useState<string>('');
    const [identityError, setIdentityError] = useState<string | null>(null);
    const [redirectApplied, setRedirectApplied] = useState(false);
    const [showRedirect, setShowRedirect] = useState(false);
    const [redirectUnlocked, setRedirectUnlocked] = useState(false);
    const [topologyNode, setTopologyNode] = useState<{ name?: string; ip?: string }>({});
    const [showTargetOnly, setShowTargetOnly] = useState(false);
    const [connectivityError, setConnectivityError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [connectivityWarning, setConnectivityWarning] = useState<string | null>(null);
    const [probing, setProbing] = useState(false);
    const [probeOutput, setProbeOutput] = useState<string | null>(null);
    const [probeError, setProbeError] = useState<string | null>(null);
    const [policyStatus, setPolicyStatus] = useState<string | null>(null);
    const [policyError, setPolicyError] = useState<string | null>(null);
    const [ruleStatus, setRuleStatus] = useState<string | null>(null);
    const [ruleError, setRuleError] = useState<string | null>(null);
    const [applyStatus, setApplyStatus] = useState<string | null>(null);

    const flowFrontend = payload.frontend_service || 'service-a';
    const flowPlanned = payload.planned_backend_service || 'service-b';
    const flowFinal = payload.final_backend_service || lastEvent?.accepted_service || 'service-c';
    const plannedPort = payload.planned_backend_port || '5001';
    const finalPort = payload.final_backend_port || payload.redirect_backend_port || '5003';
    const violationTriggered = redirectApplied || payload.violation_triggered;
    const redirectActive = showTargetOnly || redirectApplied || showRedirect;
    // Resolve backend identity to show which node/service will receive the event
    useEffect(() => {
        const fetchIdentity = async () => {
            try {
                const text = await api.getRoutingIdentity();
                setIdentity(text.trim());
            } catch (err: any) {
                setIdentityError(err?.message || 'Unable to reach routing backend');
            }
        };

        fetchIdentity();
    }, []);

    // Topology fallback for node name/IP
    useEffect(() => {
        const fetchTopologyNode = async () => {
            try {
                const topo = await api.getClusterTopology();
                if (topo?.nodes && topo.nodes.length > 0) {
                    const node = topo.nodes[0];
                    setTopologyNode({
                        name: node.name,
                        ip: (node as any).ip || (node as any).address,
                    });
                }
            } catch (_err) {
                // ignore
            }
        };
        fetchTopologyNode();
    }, []);

    const updateField = (field: keyof RoutingFormState, value: string | boolean | number) => {
        setPayload((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const applyPreset = (value: string) => {
        if (!value) {
            setPayload((prev) => ({ ...prev, policy_name: '' }));
            return;
        }
        const preset = policyPresets.find((p) => p.value === value);
        if (!preset) {
            setPayload((prev) => ({ ...prev, policy_name: value }));
            return;
        }
        setPayload((prev) => ({
            ...prev,
            policy_name: preset.value,
            namespace: preset.namespace,
            frontend_service: preset.frontend_service,
            frontend_service_port: preset.frontend_service_port,
            monitor_pod_contains: preset.monitor_pod_contains,
            action: 'redirect',
            redirect_backend_label: preset.redirect_backend_label,
            redirect_backend_port: preset.redirect_backend_port,
            redirect_backend_protocol: 'TCP',
            ttl_seconds: 300,
            metric: 'dns_us',
            violation_threshold: 1000,
            choose_best_pod: false,
            backend_candidate_label: preset.backend_candidate_label,
            redirect_winner_label: 'redirect-winner=yes',
            planned_backend_service: 'service-b',
            planned_backend_label: 'app=service-b',
            planned_backend_port: '5001',
            final_backend_service: 'service-c',
            final_backend_label: preset.redirect_backend_label,
            final_backend_port: preset.redirect_backend_port,
            notes: preset.notes,
        }));
    };

    const resetPayload = () => {
        setPayload(defaultPayload);
        setError(null);
        setShowTargetOnly(false);
        setApplyOutput(null);
        setRedirectApplied(false);
        setShowRedirect(false);
        setRedirectUnlocked(false);
        setProbeOutput(null);
        setProbeError(null);
        setPolicyStatus(null);
        setPolicyError(null);
        setRuleStatus(null);
        setRuleError(null);
        setApplyStatus(null);
    };

    const parsedIdentity = useMemo(() => {
        if (!identity) return '';
        const match = identity.match(/\(([^)]+)\)/);
        if (match && match[1]) return match[1];
        return identity.replace('Hi, I am ', '').trim();
    }, [identity]);

    const clusterName = clusterInfo?.cluster || 'ebpf-cluster';

    const primaryNode = useMemo(() => {
        if (metrics?.node_name) {
            const match = clusterInfo?.nodes?.find((n) => n.name === metrics.node_name);
            if (match) return match;
            return { name: metrics.node_name, ip: metrics.node_ip };
        }
        if (clusterInfo?.nodes?.length) {
            return clusterInfo.nodes[0];
        }
        if (topologyNode?.name || topologyNode?.ip) {
            return { name: topologyNode.name, ip: topologyNode.ip };
        }
        return null;
    }, [metrics?.node_name, metrics?.node_ip, clusterInfo?.nodes, topologyNode?.name, topologyNode?.ip]);

    const nodeName =
        primaryNode?.name ||
        (clusterInfo?.node && clusterInfo.node !== 'Loading...' ? clusterInfo.node : parsedIdentity || 'Unknown node');
    const nodeIp = metrics?.node_ip || primaryNode?.ip || topologyNode.ip || 'N/A';

    const nodeList = useMemo(() => {
        const names = (clusterInfo?.nodes || []).map((n) => n.name).filter(Boolean);
        if (!names.length) return 'Unknown';
        const preview = names.slice(0, 3).join(', ');
        const extra = names.length > 3 ? ` +${names.length - 3} more` : '';
        return `${preview}${extra}`;
    }, [clusterInfo?.nodes]);

    const safeNumber = (value: number | string | undefined) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : value || '';
    };

    const policyPreview = useMemo(
        () =>
            JSON.stringify(
                {
                    policy_name: payload.policy_name || '<pick a policy>',
                    namespace: payload.namespace || '<pick a namespace>',
                    frontend_service: payload.frontend_service || '<frontend>',
                    frontend_service_port: safeNumber(payload.frontend_service_port) || '<port>',
                    monitor_pod_contains: payload.monitor_pod_contains || payload.frontend_service,
                    action: payload.action || 'redirect',
                    redirect_backend_label: payload.redirect_backend_label || '<label>',
                    redirect_backend_port: safeNumber(payload.redirect_backend_port) || '<port>',
                    redirect_backend_protocol: payload.redirect_backend_protocol || 'TCP',
                    ttl_seconds: safeNumber(payload.ttl_seconds) || '<ttl>',
                    choose_best_pod: payload.choose_best_pod,
                    backend_candidate_label: payload.backend_candidate_label || payload.redirect_backend_label,
                    redirect_winner_label: payload.redirect_winner_label,
                    notes: payload.notes || 'policy',
                },
                null,
                2
            ),
        [
            payload.policy_name,
            payload.namespace,
            payload.frontend_service,
            payload.frontend_service_port,
            payload.monitor_pod_contains,
            payload.action,
            payload.redirect_backend_label,
            payload.redirect_backend_port,
            payload.redirect_backend_protocol,
            payload.ttl_seconds,
            payload.choose_best_pod,
            payload.backend_candidate_label,
            payload.redirect_winner_label,
            payload.notes,
        ]
    );

    const rulePreview = useMemo(
        () =>
            JSON.stringify(
                {
                    metric: payload.metric || 'dns_us',
                    violation_threshold: safeNumber(payload.violation_threshold) || '<threshold>',
                    notes: payload.notes || 'example rule',
                },
                null,
                2
            ),
        [payload.metric, payload.violation_threshold, payload.notes]
    );

    const parseRequired = (value: string | number | undefined, label: string) => {
        const str = typeof value === 'number' ? String(value) : (value || '').trim();
        if (!str) {
            throw new Error(`${label} is required`);
        }
        return str;
    };

    const parsePositiveNumber = (value: string | number | undefined, label: string) => {
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0) {
            throw new Error(`${label} must be a positive number`);
        }
        return num;
    };

    const buildPolicyBody = () => {
        return {
            policy_name: parseRequired(payload.policy_name, 'policy_name'),
            namespace: parseRequired(payload.namespace, 'namespace'),
            frontend_service: parseRequired(payload.frontend_service, 'frontend_service'),
            frontend_service_port: parsePositiveNumber(payload.frontend_service_port, 'frontend_service_port'),
            monitor_pod_contains: parseRequired(
                payload.monitor_pod_contains || payload.frontend_service,
                'monitor_pod_contains'
            ),
            action: payload.action || 'redirect',
            redirect_backend_label: parseRequired(payload.redirect_backend_label, 'redirect_backend_label'),
            redirect_backend_port: parsePositiveNumber(payload.redirect_backend_port, 'redirect_backend_port'),
            redirect_backend_protocol: payload.redirect_backend_protocol || 'TCP',
            ttl_seconds: parsePositiveNumber(payload.ttl_seconds, 'ttl_seconds'),
            choose_best_pod: Boolean(payload.choose_best_pod),
            backend_candidate_label: payload.backend_candidate_label || payload.redirect_backend_label,
            redirect_winner_label: payload.redirect_winner_label || 'redirect-winner=yes',
            notes: payload.notes,
        };
    };

    const buildRuleBody = () => {
        return {
            metric: payload.metric || 'dns_us',
            violation_threshold: parsePositiveNumber(payload.violation_threshold, 'violation_threshold'),
            notes: payload.notes,
        };
    };

    const handleApplyPolicy = async (event?: React.FormEvent) => {
        if (event) event.preventDefault();
        setSubmitting(true);
        setError(null);
        setApplyStatus(null);
        setShowTargetOnly(false);
        setConnectivityError(null);
        setConnectivityWarning(null);
        setApplyOutput(null);
        const policyName = payload.policy_name?.trim();
        if (!policyName) {
            setError('Pick a policy name before applying.');
            setSubmitting(false);
            return;
        }

        // Reachability checks:
        // 1) Block if routing backend (4000) is down
        const checkRoutingBackend = async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            try {
                const text = await api.getRoutingIdentity();
                if (!text) throw new Error('Empty response from routing backend');
            } finally {
                clearTimeout(timeout);
            }
        };
        // 2) Soft warning if daemon port-forward (8080) is down
        const checkDaemon = async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000);
            try {
                const res = await fetch('/api/health', { method: 'GET', cache: 'no-store', signal: controller.signal });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
            } catch (_err) {
                setConnectivityWarning(
                    'Daemon on :8080 not reachable. Ensure port-forward is running: kubectl -n ebpf-telemetry port-forward ds/ebpf-daemon 8080:8080'
                );
            } finally {
                clearTimeout(timeout);
            }
        };

        try {
            await checkRoutingBackend();
        } catch (reachErr: any) {
            setConnectivityError(reachErr?.message || 'Routing backend not reachable on port 4000.');
            setSubmitting(false);
            return;
        }
        // fire-and-forget daemon check (warning only)
        checkDaemon();

        try {
            const result = await api.applyPolicy(policyName);
            setApplyStatus(result.message || 'Policy applied.');
            setApplyOutput(result.stdout || '');
            setRedirectUnlocked(true);
            setRedirectApplied(true);
            setShowRedirect(true);
            setLastEvent({
                policy_name: policyName,
                accepted_service: payload.final_backend_service,
                violation_triggered: true,
                status: 'applied',
                redirect_backend_label: payload.redirect_backend_label,
                redirect_backend_port: payload.redirect_backend_port,
                frontend_service: payload.frontend_service,
                notes: payload.notes,
            });
            await probeServiceResponse();
        } catch (err: any) {
            setError(err?.message || 'Failed to apply local redirect policy');
        } finally {
            setSubmitting(false);
        }
    };

    const probeServiceResponse = async () => {
        setProbing(true);
        setProbeError(null);
        try {
            const text = await api.getServiceAWhoami();
            setProbeOutput(text.trim());
        } catch (err: any) {
            setProbeError(err?.message || 'Failed to fetch service response');
        } finally {
            setProbing(false);
        }
    };

    const handleUpsertRule = async () => {
        const policyName = payload.policy_name?.trim();
        if (!policyName) {
            setRuleError('Pick a policy first.');
            return;
        }
        setRuleError(null);
        setRuleStatus(null);
        try {
            const ruleBody = buildRuleBody();
            await api.upsertPolicyRule(policyName, ruleBody);
            setRuleStatus(`Rule saved for ${policyName}.`);
        } catch (err: any) {
            setRuleError(err?.message || 'Failed to save rule');
        }
    };

    const handleCreatePolicy = async () => {
        setCreating(true);
        setPolicyStatus(null);
        setPolicyError(null);

        try {
            const policyBody = buildPolicyBody();
            await api.createPolicy(policyBody);
            setPolicyStatus(`Policy ${policyBody.policy_name} saved.`);
            setShowTargetOnly(false);
        } catch (err: any) {
            setPolicyError(err?.message || 'Failed to create policy');
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="page-container routing-page">
            <div className="page-header">
                <div className="page-title-section">
                    <h1 className="page-title">Intelligent Traffic Routing</h1>
                    <p className="page-subtitle">
                        Apply the Component 2 redirect helper straight from the UI. Monitor the active node and trigger the same apply call you run in Postman.
                    </p>
                </div>
            </div>

            <div className="routing-grid">
                <div className="routing-card routing-status">
                    <div className="card-title">
                        <FiServer />
                        <span>Current Node</span>
                    </div>
                    <div className="status-grid">
                        <div className="status-item">
                            <div className="status-label">Cluster</div>
                            <div className="status-value">{clusterName}</div>
                        </div>
                        <div className="status-item">
                            <div className="status-label">Nodes</div>
                            <div className="status-value">
                                {(clusterInfo?.totalNodes || clusterInfo?.nodes?.length || 0)} • {nodeList}
                            </div>
                        </div>
                        <div className="status-item">
                            <div className="status-label">Node</div>
                            <div className="status-value">{nodeName}</div>
                        </div>
                        <div className="status-item">
                            <div className="status-label">Node IP</div>
                            <div className="status-value">{nodeIp}</div>
                        </div>
                        <div className="status-item">
                            <div className="status-label">Backend</div>
                            <div className="status-value">
                                {identity ? identity : identityError || 'Resolving...'}
                            </div>
                        </div>
                    </div>
                    <div className="status-hint">
                        <FiActivity /> The UI talks to http://localhost:4000 to apply policies. Keep the backend running and MongoDB available.
                    </div>
                </div>

                <div className="routing-card info">
                    <div className="card-title">
                        <FiAlertTriangle />
                        <span>How to run it</span>
                    </div>
                    <p className="info-copy">
                        Walk through the exact Postman calls in order: create the policy, visualize, upsert the rule, then apply.
                        All calls hit <code className="inline-code">http://localhost:4000</code>.
                    </p>
                    <div className="curl-block">
                        Step 1: POST http://localhost:4000/api/policies<br />
                        Step 3: POST http://localhost:4000/api/policies/&lt;policy&gt;/rule<br />
                        Step 4: POST http://localhost:4000/api/policies/&lt;policy&gt;/apply
                    </div>
                </div>
            </div>

            <div className="routing-card form-card">
                    <div className="form-header">
                        <div>
                            <div className="card-title">
                                <FiSend />
                                <span>Step 1 · Create policy (POST /api/policies)</span>
                            </div>
                            <p className="info-copy">
                                Pick values from the dropdowns (nothing is pre-filled) and hit Create policy. This mirrors your Postman body.
                            </p>
                        </div>
                        <div className="header-actions">
                            <button
                                type="button"
                                className="ghost-button"
                                onClick={() => applyPreset(policyPresets[0]?.value || '')}
                                disabled={creating}
                            >
                                <FiRefreshCw /> Use sample preset
                            </button>
                            <button type="button" className="ghost-button" onClick={resetPayload} disabled={creating}>
                            Reset fields
                        </button>
                        <button type="submit" form="policy-form" className="primary-button" disabled={creating}>
                            {creating ? 'Creating…' : 'Create policy'}
                        </button>
                    </div>
                </div>
                <form
                    id="policy-form"
                    className="routing-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleCreatePolicy();
                    }}
                >
                    <div className="form-grid">
                        <label className="form-field">
                            <span className="form-label">Policy Name *</span>
                            <input
                                type="text"
                                value={payload.policy_name || ''}
                                onChange={(e) => updateField('policy_name', e.target.value)}
                                placeholder="redirect-service-a-to-c"
                                required
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Namespace *</span>
                            <input
                                type="text"
                                value={payload.namespace || ''}
                                readOnly
                                placeholder="test-service"
                                required
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Frontend Service *</span>
                            <select
                                value={payload.frontend_service || ''}
                                onChange={(e) => updateField('frontend_service', e.target.value)}
                                required
                            >
                                <option value="">Pick a service</option>
                                {serviceOptions.map((svc) => (
                                    <option key={svc} value={svc}>
                                        {svc}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="form-field">
                            <span className="form-label">Frontend Service Port *</span>
                            <select
                                value={payload.frontend_service_port || ''}
                                onChange={(e) => updateField('frontend_service_port', e.target.value)}
                                required
                            >
                                <option value="">Pick a port</option>
                                {portOptions.map((port) => (
                                    <option key={port} value={port}>
                                        {port}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="form-field">
                            <span className="form-label">Monitor pods containing *</span>
                            <select
                                value={payload.monitor_pod_contains || ''}
                                onChange={(e) => updateField('monitor_pod_contains', e.target.value)}
                                required
                            >
                                <option value="">Pick a pod hint</option>
                                {serviceOptions.map((svc) => (
                                    <option key={svc} value={svc}>
                                        {svc}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="form-field">
                            <span className="form-label">Action</span>
                            <select value={payload.action} onChange={(e) => updateField('action', e.target.value)}>
                                <option value="redirect">redirect</option>
                                <option value="observe">observe</option>
                            </select>
                        </label>
                        <label className="form-field">
                            <span className="form-label">Redirect Backend Label *</span>
                            <select
                                value={payload.redirect_backend_label || ''}
                                onChange={(e) => {
                                    updateField('redirect_backend_label', e.target.value);
                                    updateField('backend_candidate_label', e.target.value);
                                    updateField('final_backend_label', e.target.value);
                                }}
                                required
                            >
                                <option value="">Pick a backend</option>
                                {backendLabelOptions.map((label) => (
                                    <option key={label} value={label}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="form-field">
                            <span className="form-label">Redirect Backend Port *</span>
                            <select
                                value={payload.redirect_backend_port || ''}
                                onChange={(e) => {
                                    updateField('redirect_backend_port', e.target.value);
                                    updateField('final_backend_port', e.target.value);
                                }}
                                required
                            >
                                <option value="">Pick a port</option>
                                {portOptions.map((port) => (
                                    <option key={port} value={port}>
                                        {port}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="form-field">
                            <span className="form-label">Redirect Backend Protocol</span>
                            <select
                                value={payload.redirect_backend_protocol || ''}
                                onChange={(e) => updateField('redirect_backend_protocol', e.target.value)}
                            >
                                <option value="">Pick protocol</option>
                                <option value="TCP">TCP</option>
                                <option value="UDP">UDP</option>
                            </select>
                        </label>
                        <label className="form-field">
                            <span className="form-label">TTL Seconds *</span>
                            <select
                                value={payload.ttl_seconds || ''}
                                onChange={(e) => updateField('ttl_seconds', e.target.value)}
                                required
                            >
                                <option value="">Pick TTL</option>
                                <option value="60">60</option>
                                <option value="120">120</option>
                                <option value="300">300</option>
                                <option value="600">600</option>
                            </select>
                        </label>
                        <label className="form-field">
                            <span className="form-label">Backend Candidate Label</span>
                            <select
                                value={payload.backend_candidate_label || ''}
                                onChange={(e) => updateField('backend_candidate_label', e.target.value)}
                            >
                                <option value="">Match redirect backend</option>
                                {backendLabelOptions.map((label) => (
                                    <option key={label} value={label}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="form-field">
                            <span className="form-label">Redirect Winner Label</span>
                            <input
                                type="text"
                                value={payload.redirect_winner_label || ''}
                                onChange={(e) => updateField('redirect_winner_label', e.target.value)}
                                placeholder="redirect-winner=yes"
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-label">Choose Best Pod</span>
                            <select
                                value={payload.choose_best_pod ? 'yes' : 'no'}
                                onChange={(e) => updateField('choose_best_pod', e.target.value === 'yes')}
                            >
                                <option value="no">no</option>
                                <option value="yes">yes</option>
                            </select>
                        </label>
                        <label className="form-field">
                            <span className="form-label">Notes</span>
                            <input
                                type="text"
                                value={payload.notes || ''}
                                onChange={(e) => updateField('notes', e.target.value)}
                                placeholder="policy"
                            />
                        </label>
                    </div>

                    {policyError && (
                        <div className="alert error">
                            <FiAlertTriangle /> {policyError}
                        </div>
                    )}
                    {policyStatus && (
                        <div className="alert success">
                            <FiActivity /> {policyStatus}
                        </div>
                    )}
                    <div className="curl-block">
                        POST 'http://localhost:4000/api/policies'<br />
                        <pre className="payload-preview small">{policyPreview}</pre>
                    </div>
                </form>
            </div>

            <div className="routing-card pod-flow-card">
                <div className="card-title packet-card-title">
                    <div className="packet-card-label">
                        <FiZap />
                        <span>Packet Path</span>
                    </div>
                </div>
                <p className="info-copy">
                    Step 2: visualize. Planned path (A → B) vs redirect path (A → C). The planned arrow turns red when a violation is detected; the green arrow lights up to show the new route.
                </p>
                <div className="packet-node-meta">
                    <span className="meta-label">Current node</span>
                    <span className="meta-value">{nodeName}</span>
                    <span className="meta-divider">•</span>
                    <span className="meta-label">IP</span>
                    <span className="meta-value">{nodeIp}</span>
                </div>
                <div className="packet-tracer">
                    <svg className="packet-canvas" viewBox="0 0 720 240" preserveAspectRatio="xMidYMid meet">
                        <defs>
                            <marker id="arrowHeadPlanned" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
                                <polygon points="0 0, 12 6, 0 12" fill="url(#plannedGrad)" />
                            </marker>
                            <marker id="arrowHeadRedirect" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
                                <polygon points="0 0, 12 6, 0 12" fill="url(#redirectGrad)" />
                            </marker>
                            <linearGradient id="plannedGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.9" />
                            </linearGradient>
                            <linearGradient id="redirectGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#10b981" stopOpacity="0.95" />
                            </linearGradient>
                        </defs>

                        {/* Planned path A -> B */}
                        <line
                            x1="154"
                            y1="120"
                            x2="316"
                            y2="120"
                            className={`planned-path ${violationTriggered ? 'alert' : ''} ${showTargetOnly ? 'hidden' : ''}`}
                            markerEnd="url(#arrowHeadPlanned)"
                        />

                        {/* Redirect path A -> C */}
                        <line
                            x1="154"
                            y1="120"
                            x2="566"
                            y2="120"
                            className={`redirect-path ${redirectActive ? 'active' : 'hidden'}`}
                            markerEnd="url(#arrowHeadRedirect)"
                        />

                        {/* Nodes */}
                        <g className="node frontend" transform="translate(120,120)">
                            <circle r="34" />
                            <text className="node-initial" x="0" y="6">A</text>
                        </g>
                        <text className="node-label-svg" x="120" y="170">{flowFrontend}</text>

                        <g className={`node planned ${(violationTriggered || showTargetOnly) ? 'muted' : ''} ${showTargetOnly ? 'hidden-node' : ''}`} transform="translate(350,120)">
                            <circle r="34" />
                            <text className="node-initial" x="0" y="6">B</text>
                        </g>
                        <text className={`node-label-svg ${showTargetOnly ? 'hidden-node' : ''}`} x="350" y="170">{flowPlanned}</text>

                        <g className="node final" transform="translate(580,120)">
                            <circle r="34" />
                            <text className="node-initial" x="0" y="6">C</text>
                        </g>
                        <text className="node-label-svg" x="580" y="170">{flowFinal}</text>

                        {/* Packets */}
                        <g className={`packet planned ${showTargetOnly ? 'hidden' : ''}`}>
                            <circle cx="154" cy="120" r="7" />
                        </g>
                        <g className={`packet redirect ${redirectActive ? 'active' : 'hidden'}`}>
                            <circle cx="154" cy="120" r="7" />
                        </g>
                    </svg>

                    {/* Absolute positioned packet dots to make the motion obvious */}
                    <div className={`packet-dot planned ${showTargetOnly ? 'hidden' : ''}`}></div>
                    <div className={`packet-dot redirect ${redirectActive ? 'active' : 'hidden'}`}></div>

                    <div className="packet-tracer-legend">
                        <div className="legend-item">
                            <span className="legend-chip planned" /> Planned :{plannedPort}
                        </div>
                        <div className="legend-item">
                            <span className="legend-chip redirect" /> Redirect :{finalPort} {violationTriggered ? '(active)' : '(armed)'}
                        </div>
                    </div>
                </div>
            </div>

            <div className="routing-grid">
                <div className="routing-card form-card">
                    <div className="form-header">
                        <div>
                            <div className="card-title">
                                <FiSend />
                                <span>Step 3 · Upsert rule (POST /api/policies/&lt;policy&gt;/rule)</span>
                            </div>
                            <p className="info-copy">
                                Save the rule JSON to the selected policy before applying. This is the Postman request that sets metric + threshold.
                            </p>
                        </div>
                        <div className="header-actions">
                            <button type="button" className="primary-button" onClick={handleUpsertRule}>
                                Save rule
                            </button>
                        </div>
                    </div>
                    <form
                        className="routing-form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleUpsertRule();
                        }}
                    >
                        <div className="form-grid">
                            <label className="form-field">
                                <span className="form-label">Metric</span>
                                <select value={payload.metric} onChange={(e) => updateField('metric', e.target.value)}>
                                    <option value="dns_us">dns_us (DNS latency)</option>
                                    <option value="rtt_us">rtt_us (round-trip)</option>
                                </select>
                            </label>
                            <label className="form-field">
                                <span className="form-label">Violation Threshold (µs)</span>
                                <input
                                    type="number"
                                    value={payload.violation_threshold}
                                    onChange={(e) => updateField('violation_threshold', e.target.value)}
                                    placeholder="1000"
                                />
                            </label>
                            <label className="form-field">
                                <span className="form-label">Notes</span>
                                <input
                                    type="text"
                                    value={payload.notes || ''}
                                    onChange={(e) => updateField('notes', e.target.value)}
                                    placeholder="example rule"
                                />
                            </label>
                        </div>
                        {ruleError && (
                            <div className="alert error">
                                <FiAlertTriangle /> {ruleError}
                            </div>
                        )}
                        {ruleStatus && (
                            <div className="alert success">
                                <FiActivity /> {ruleStatus}
                            </div>
                        )}
                        <div className="curl-block">
                            {`POST http://localhost:4000/api/policies/${payload.policy_name || '<policy>'}/rule`}<br />
                            <pre className="payload-preview small">{rulePreview}</pre>
                        </div>
                    </form>
                </div>

                <div className="routing-card form-card">
                    <div className="form-header">
                        <div>
                            <div className="card-title">
                                <FiSend />
                                <span>Step 4 · Apply policy (POST /api/policies/&lt;policy&gt;/apply)</span>
                            </div>
                            <p className="info-copy">Execute the helper against the selected policy and show the backend responses.</p>
                        </div>
                        <div className="header-actions">
                            <button type="button" className="primary-button" onClick={handleApplyPolicy} disabled={submitting}>
                                {submitting ? 'Applying…' : 'Apply policy'}
                            </button>
                        </div>
                    </div>
                    <div className="routing-form">
                        {error && (
                            <div className="alert error">
                                <FiAlertTriangle /> {error}
                            </div>
                        )}
                        {connectivityError && (
                            <div className="alert error">
                                <FiAlertTriangle /> {connectivityError}
                            </div>
                        )}
                        {applyStatus && (
                            <div className="alert success">
                                <FiActivity /> {applyStatus}
                            </div>
                        )}
                        {connectivityWarning && (
                            <div className="alert warning">
                                <FiAlertTriangle /> {connectivityWarning}
                            </div>
                        )}
                        {applyOutput && (
                            <div className="alert success">
                                <div className="output-title">Helper output</div>
                                <pre className="payload-preview small">{applyOutput}</pre>
                            </div>
                        )}
                        <div className="probe-row">
                            <button type="button" className="ghost-button" onClick={probeServiceResponse} disabled={probing}>
                                {probing ? 'Probing…' : 'Check frontend response'}
                            </button>
                            {probeError && (
                                <span className="probe-error">
                                    <FiAlertTriangle /> {probeError}
                                </span>
                            )}
                        </div>
                        {probeOutput && (
                            <div className="alert success">
                                <div className="output-title">Service response</div>
                                <pre className="payload-preview small">{probeOutput}</pre>
                            </div>
                        )}
                        <div className="curl-block">
                            {`POST http://localhost:4000/api/policies/${payload.policy_name || '<policy>'}/apply`}
                        </div>
                    </div>
                </div>
            </div>

            <div className="routing-grid">
                <div className="routing-card">
                    <div className="card-title">
                        <FiSend />
                        <span>Policy JSON</span>
                    </div>
                    <p className="info-copy">Body for POST http://localhost:4000/api/policies.</p>
                    <pre className="payload-preview">{policyPreview}</pre>
                </div>
                <div className="routing-card">
                    <div className="card-title">
                        <FiSend />
                        <span>Rule JSON</span>
                    </div>
                    <p className="info-copy">Body for POST http://localhost:4000/api/policies/&lt;policy&gt;/rule.</p>
                    <pre className="payload-preview">{rulePreview}</pre>
                </div>

                {lastEvent && (
                    <div className="routing-card">
                        <div className="card-title">
                            <FiActivity />
                            <span>Last Apply</span>
                        </div>
                        <div className="event-details">
                            <div className="event-row">
                                <span className="label">Policy</span>
                                <span className="value">{lastEvent.policy_name}</span>
                            </div>
                            <div className="event-row">
                                <span className="label">Status</span>
                                <span className="value badge">{lastEvent.status || 'applied'}</span>
                            </div>
                            <div className="event-row">
                                <span className="label">Backend Label</span>
                                <span className="value">{lastEvent.redirect_backend_label || '—'}</span>
                            </div>
                            <div className="event-row">
                                <span className="label">Port</span>
                                <span className="value">{lastEvent.redirect_backend_port || '—'}</span>
                            </div>
                            {lastEvent.notes && (
                                <div className="event-row">
                                    <span className="label">Notes</span>
                                    <span className="value">{lastEvent.notes}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
