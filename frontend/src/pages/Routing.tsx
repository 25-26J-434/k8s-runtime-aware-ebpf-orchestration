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
    policy_name: 'redirect-service-a-to-c',
    namespace: 'test-services',
    frontend_service: 'service-a',
    frontend_service_port: '5000',
    monitor_pod_contains: 'service-a',
    metric: 'dns_us',
    violation_threshold: 1000,
    action: 'redirect',
    redirect_backend_label: 'app=service-c',
    redirect_backend_port: '5003',
    redirect_backend_protocol: 'TCP',
    ttl_seconds: 300,
    choose_best_pod: true,
    backend_candidate_label: 'app=service-c',
    redirect_winner_label: 'redirect-winner=yes',
    planned_backend_service: 'service-b',
    planned_backend_label: 'app=service-b',
    planned_backend_port: '5001',
    final_backend_service: 'service-c',
    final_backend_label: 'app=service-c',
    final_backend_port: '5003',
    redirect_backend_label: 'app=service-c',
    redirect_backend_port: '5003',
    violation_triggered: false,
    accepted_service: 'service-c',
    status: 'applied',
    notes: 'Hello I am service C (redirect winner)',
};

export function Routing() {
    const { metrics } = useMetrics(6000);
    const clusterInfo = useClusterInfo(5000);
    const [payload, setPayload] = useState<RoutingFormState>(defaultPayload);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [lastEvent, setLastEvent] = useState<RedirectionEvent | null>(null);
    const [applyOutput, setApplyOutput] = useState<string | null>(null);
    const [identity, setIdentity] = useState<string>('');
    const [identityError, setIdentityError] = useState<string | null>(null);
    const [redirectApplied, setRedirectApplied] = useState(false);
    const [showRedirect, setShowRedirect] = useState(false);
    const [redirectUnlocked, setRedirectUnlocked] = useState(false);
    const [topologyNode, setTopologyNode] = useState<{ name?: string; ip?: string }>({});
    const [deleting, setDeleting] = useState(false);
    const [deleteStatus, setDeleteStatus] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [showTargetOnly, setShowTargetOnly] = useState(false);
    const [connectivityError, setConnectivityError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [createStatus, setCreateStatus] = useState<string | null>(null);
    const [createError, setCreateError] = useState<string | null>(null);
    const [connectivityWarning, setConnectivityWarning] = useState<string | null>(null);
    const [probing, setProbing] = useState(false);
    const [probeOutput, setProbeOutput] = useState<string | null>(null);
    const [probeError, setProbeError] = useState<string | null>(null);

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

    const resetPayload = () => {
        setPayload(defaultPayload);
        setError(null);
        setSuccess(null);
        setDeleteStatus(null);
        setDeleteError(null);
        setShowTargetOnly(false);
        setCreateStatus(null);
        setCreateError(null);
        setApplyOutput(null);
        setRedirectApplied(false);
        setShowRedirect(false);
        setRedirectUnlocked(false);
        setProbeOutput(null);
        setProbeError(null);
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

    const rulePreview = useMemo(
        () =>
            JSON.stringify(
                {
                    policy_name: payload.policy_name,
                    namespace: payload.namespace,
                    frontend_service: payload.frontend_service,
                    frontend_service_port: safeNumber(payload.frontend_service_port),
                    monitor_pod_contains: payload.monitor_pod_contains,
                    metric: payload.metric,
                    violation_threshold: safeNumber(payload.violation_threshold),
                    action: payload.action,
                    redirect_backend_label: payload.redirect_backend_label,
                    redirect_backend_port: safeNumber(payload.redirect_backend_port),
                    redirect_backend_protocol: payload.redirect_backend_protocol,
                    ttl_seconds: safeNumber(payload.ttl_seconds),
                    choose_best_pod: payload.choose_best_pod,
                    backend_candidate_label: payload.backend_candidate_label || payload.redirect_backend_label,
                    redirect_winner_label: payload.redirect_winner_label,
                    notes: payload.notes,
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
            payload.metric,
            payload.violation_threshold,
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

    const buildRuleBody = () => {
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

        return {
            policy_name: parseRequired(payload.policy_name, 'policy_name'),
            namespace: parseRequired(payload.namespace, 'namespace'),
            frontend_service: parseRequired(payload.frontend_service, 'frontend_service'),
            frontend_service_port: parsePositiveNumber(payload.frontend_service_port, 'frontend_service_port'),
            monitor_pod_contains: parseRequired(
                payload.monitor_pod_contains || payload.frontend_service,
                'monitor_pod_contains'
            ),
            metric: payload.metric || 'dns_us',
            violation_threshold: parsePositiveNumber(payload.violation_threshold, 'violation_threshold'),
            action: payload.action || 'redirect',
            redirect_backend_label: parseRequired(payload.redirect_backend_label, 'redirect_backend_label'),
            redirect_backend_port: parsePositiveNumber(payload.redirect_backend_port, 'redirect_backend_port'),
            redirect_backend_protocol: payload.redirect_backend_protocol || 'TCP',
            ttl_seconds: parsePositiveNumber(payload.ttl_seconds, 'ttl_seconds'),
            choose_best_pod: Boolean(payload.choose_best_pod),
            backend_candidate_label: payload.backend_candidate_label || payload.redirect_backend_label,
            redirect_winner_label: payload.redirect_winner_label || 'redirect-winner=yes',
            notes: payload.notes,
        } as RedirectRulePayload;
    };

    const getPodsForService = (serviceName: string): string[] => {
        if (!metrics?.pods) return [];
        return Object.keys(metrics.pods).filter((podKey) => {
            const [, podName] = podKey.split('/');
            return podName && podName.includes(serviceName);
        });
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        setSuccess(null);
        setDeleteStatus(null);
        setDeleteError(null);
        setShowTargetOnly(false);
        setConnectivityError(null);
        setConnectivityWarning(null);
        setApplyOutput(null);

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
            const result = await api.applyRuleByPolicy(payload.policy_name.trim());
            setSuccess(result.message || 'Policy applied.');
            setApplyOutput(result.stdout || '');
            setRedirectUnlocked(true);
            setRedirectApplied(true);
            setShowRedirect(true);
            setLastEvent({
                policy_name: payload.policy_name,
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

    const handleDeletePolicy = async () => {
        const policyName = payload.policy_name?.trim();
        if (!policyName) {
            setDeleteError('Policy name is required to delete a rule.');
            return;
        }

        setDeleting(true);
        setDeleteStatus(null);
        setDeleteError(null);
        setCreateStatus(null);
        setCreateError(null);

        try {
            const rule = await api.getRuleByPolicy(policyName);
            if (!rule?.id) {
                throw new Error('Policy found but missing ID');
            }

            await api.deleteRule(rule.id);

            setLastEvent(null);
            setShowRedirect(true);
            setRedirectUnlocked(true);
            setShowTargetOnly(true);
            setDeleteStatus(`Policy ${policyName} deleted. Visualization locked to target route.`);
        } catch (err: any) {
            setDeleteError(err?.message || 'Failed to delete policy');
        } finally {
            setDeleting(false);
        }
    };

    const handleCreatePolicy = async () => {
        setCreating(true);
        setCreateStatus(null);
        setCreateError(null);
        setDeleteStatus(null);
        setDeleteError(null);

        try {
            const ruleBody = buildRuleBody();
            await api.createRule(ruleBody);
            setCreateStatus(`Policy ${ruleBody.policy_name} saved to DB.`);
            setShowTargetOnly(false);
        } catch (err: any) {
            setCreateError(err?.message || 'Failed to create policy');
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
                        <span>What this form does</span>
                    </div>
                    <p className="info-copy">
                        This is a UI wrapper for the Postman/terminal call:
                        <code className="inline-code">POST http://localhost:4000/api/rules/by-policy/redirect-service-a-to-c/apply</code>.
                        It kicks off the helper script that writes the CiliumLocalRedirectPolicy.
                    </p>
                    <div className="curl-block">
                        curl -X POST http://localhost:4000/api/rules/by-policy/redirect-service-a-to-c/apply \
                        <br />
                        &nbsp;&nbsp;--header &apos;Content-Type: application/json&apos;
                    </div>
                </div>
            </div>

                <div className="routing-card form-card">
                    <div className="form-header">
                        <div>
                            <div className="card-title">
                                <FiSend />
                                <span>Save Policy & Rule</span>
                            </div>
                            <p className="info-copy">
                                Define the rule (helper JSON) and save it to the backend before applying. Then hit Apply below to trigger the redirect helper.
                            </p>
                        </div>
                        <div className="header-actions">
                            <button type="button" className="ghost-button" onClick={resetPayload} disabled={submitting}>
                                <FiRefreshCw /> Reset to sample
                            </button>
                            <button type="button" className="ghost-button" onClick={handleCreatePolicy} disabled={creating}>
                                {creating ? 'Saving…' : 'Save rule'}
                            </button>
                            <button type="button" className="ghost-button danger" onClick={handleDeletePolicy} disabled={deleting}>
                                {deleting ? 'Deleting…' : 'Delete policy'}
                            </button>
                            <button type="submit" form="routing-form" className="primary-button" disabled={submitting}>
                                {submitting ? 'Applying...' : 'Apply policy'}
                            </button>
                        </div>
                    </div>

                    <form id="routing-form" className="routing-form" onSubmit={handleSubmit}>
                        <div className="form-section">
                            <div className="form-section-header">
                                <div className="form-section-title">Policy identity</div>
                                <div className="form-section-note">Saved to DB; used to look up the rule on apply.</div>
                            </div>
                            <div className="form-grid">
                                <label className="form-field">
                                    <span className="form-label">Policy Name *</span>
                                    <input
                                        type="text"
                                        value={payload.policy_name}
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
                                        onChange={(e) => updateField('namespace', e.target.value)}
                                        placeholder="test-services"
                                        required
                                    />
                                </label>
                                <label className="form-field">
                                    <span className="form-label">Frontend Service *</span>
                                    <input
                                        type="text"
                                        value={payload.frontend_service || ''}
                                        onChange={(e) => updateField('frontend_service', e.target.value)}
                                        placeholder="service-a"
                                        required
                                    />
                                </label>
                                <label className="form-field">
                                    <span className="form-label">Frontend Service Port *</span>
                                    <input
                                        type="number"
                                        value={payload.frontend_service_port}
                                        onChange={(e) => updateField('frontend_service_port', e.target.value)}
                                        placeholder="5000"
                                        required
                                    />
                                </label>
                                <label className="form-field">
                                    <span className="form-label">Monitor pods containing *</span>
                                    <input
                                        type="text"
                                        value={payload.monitor_pod_contains || ''}
                                        onChange={(e) => updateField('monitor_pod_contains', e.target.value)}
                                        placeholder="service-a"
                                        required
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="form-section">
                            <div className="form-section-header">
                                <div className="form-section-title">Rule trigger</div>
                                <div className="form-section-note">When this metric crosses the threshold, redirect fires.</div>
                            </div>
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
                                    <span className="form-label">Action</span>
                                    <select value={payload.action} onChange={(e) => updateField('action', e.target.value)}>
                                        <option value="redirect">redirect</option>
                                        <option value="observe">observe</option>
                                    </select>
                                </label>
                            </div>
                        </div>

                        <div className="form-section">
                            <div className="form-section-header">
                                <div className="form-section-title">Redirect target</div>
                                <div className="form-section-note">Where traffic goes when the rule is violated.</div>
                            </div>
                            <div className="form-grid">
                                <label className="form-field">
                                    <span className="form-label">Redirect Backend Label *</span>
                                    <input
                                        type="text"
                                        value={payload.redirect_backend_label || ''}
                                        onChange={(e) => updateField('redirect_backend_label', e.target.value)}
                                        placeholder="app=service-c"
                                        required
                                    />
                                </label>
                                <label className="form-field">
                                    <span className="form-label">Redirect Backend Port *</span>
                                    <input
                                        type="number"
                                        value={payload.redirect_backend_port}
                                        onChange={(e) => updateField('redirect_backend_port', e.target.value)}
                                        placeholder="5003"
                                        required
                                    />
                                </label>
                                <label className="form-field">
                                    <span className="form-label">Redirect Backend Protocol</span>
                                    <select
                                        value={payload.redirect_backend_protocol || 'TCP'}
                                        onChange={(e) => updateField('redirect_backend_protocol', e.target.value)}
                                    >
                                        <option value="TCP">TCP</option>
                                        <option value="UDP">UDP</option>
                                    </select>
                                </label>
                                <label className="form-field">
                                    <span className="form-label">TTL Seconds *</span>
                                    <input
                                        type="number"
                                        value={payload.ttl_seconds}
                                        onChange={(e) => updateField('ttl_seconds', e.target.value)}
                                        placeholder="300"
                                        required
                                    />
                                </label>
                                <label className="form-field">
                                    <span className="form-label">Backend Candidate Label</span>
                                    <input
                                        type="text"
                                        value={payload.backend_candidate_label || ''}
                                        onChange={(e) => updateField('backend_candidate_label', e.target.value)}
                                        placeholder="app=service-c"
                                    />
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
                                <label className="form-field toggle-field">
                                    <span className="form-label">Choose Best Pod</span>
                                    <div className="toggle-wrapper">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(payload.choose_best_pod)}
                                            onChange={(e) => updateField('choose_best_pod', e.target.checked)}
                                        />
                                        <span>{payload.choose_best_pod ? 'Enabled' : 'Disabled'}</span>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <div className="form-section">
                            <div className="form-section-header">
                                <div className="form-section-title">Notes</div>
                                <div className="form-section-note">Saved with the rule for operators.</div>
                            </div>
                            <label className="form-field">
                                <textarea
                                    rows={3}
                                    value={payload.notes || ''}
                                    onChange={(e) => updateField('notes', e.target.value)}
                                    placeholder="Add operator notes or context for this redirect."
                                />
                            </label>
                        </div>

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
                        {success && (
                            <div className="alert success">
                                <FiActivity /> {success}
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
                    Visual cue of the planned path (A → B) and the redirect path (A → C). The planned arrow turns red when a violation is detected; the green arrow lights up to show the new route. Use &quot;Create policy&quot; below to write/update the rule, then &quot;Apply policy&quot; above to execute it.
                </p>
                {deleteError && (
                    <div className="alert error">
                        <FiAlertTriangle /> {deleteError}
                    </div>
                )}
                {createError && (
                    <div className="alert error">
                        <FiAlertTriangle /> {createError}
                    </div>
                )}
                {deleteStatus && (
                    <div className="alert success">
                        <FiActivity /> {deleteStatus}
                    </div>
                )}
                {createStatus && (
                    <div className="alert success">
                        <FiActivity /> {createStatus}
                    </div>
                )}
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
                <div className="routing-card">
                    <div className="card-title">
                        <FiSend />
                        <span>Rule Preview</span>
                    </div>
                    <p className="info-copy">Exact rule JSON saved to the backend and used by the helper.</p>
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
