import { useState, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ScalingRule, MetricType, OperatorType, DeploymentInfo, ScalingAction } from '../types/scaling';
import type { Pod } from '../types/api';
import { api } from '../services/api';

interface NodeScope {
    name: string;
    ip?: string;
    pods?: Pod[];
}

interface Props {
    initial?: Partial<ScalingRule>;
    nodeScope?: NodeScope;
    onCancel: () => void;
    onSubmit: (rule: Partial<ScalingRule>) => Promise<void> | void;
    submitLabel?: string;
    onTargetChange?: (target: { namespace?: string; deployment?: string }) => void;
    schedulingContent?: ReactNode;
}

export function ScalingRuleForm({ initial = {}, nodeScope, onCancel, onSubmit, submitLabel = 'Save', onTargetChange, schedulingContent }: Props) {
    const [namespaces, setNamespaces] = useState<string[]>([]);
    const [namespace, setNamespace] = useState(initial.namespace || 'default');
    const [deploymentOptions, setDeploymentOptions] = useState<DeploymentInfo[]>([]);
    const [deployment, setDeployment] = useState(initial.deployment || '');
    const [metric, setMetric] = useState<MetricType>(initial.metric || 'dns_latency');
    const [operator, setOperator] = useState<OperatorType>(initial.operator || '>');
    const [threshold, setThreshold] = useState<number>(initial.threshold ?? 0);
    const [step, setStep] = useState<number>(initial.step ?? 1);
    const [minReplicas, setMinReplicas] = useState<number>(initial.minReplicas ?? 1);
    const [maxReplicas, setMaxReplicas] = useState<number>(initial.maxReplicas ?? 1);
    const [action, setAction] = useState<ScalingAction>(initial.action || 'scale_up');
    const [enabled, setEnabled] = useState<boolean>(initial.enabled ?? true);
    const [submitting, setSubmitting] = useState(false);
    const [loadingNamespaces, setLoadingNamespaces] = useState(false);
    const [loadingDeployments, setLoadingDeployments] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const metricDetails: Record<MetricType, { label: string; unit: string; description: string; typical: string }> = {
        dns_latency: {
            label: 'DNS Latency',
            unit: 'ms',
            description: 'Average DNS lookup latency observed across selected pods.',
            typical: '15-120ms',
        },
        rtt: {
            label: 'Round Trip Time',
            unit: 'ms',
            description: 'TCP round-trip time for service traffic.',
            typical: '5-90ms',
        },
        tcp_retrans: {
            label: 'TCP Retransmits',
            unit: 'retransmits/s',
            description: 'Rate of TCP retransmissions per second.',
            typical: '0-5/s',
        },
        disk_read_latency: {
            label: 'Disk Read Latency',
            unit: 'ns',
            description: 'Average disk read latency observed across selected pods.',
            typical: '10000-5000000ns',
        },
        disk_write_latency: {
            label: 'Disk Write Latency',
            unit: 'ns',
            description: 'Average disk write latency observed across selected pods.',
            typical: '10000-5000000ns',
        },
    };

    const metricInfo = metricDetails[metric];
    const safetyChecks = [
        { label: 'Deployment selected', ok: Boolean(namespace && deployment) },
        { label: 'Step >= 1', ok: step >= 1 },
        { label: 'Min <= Max', ok: minReplicas <= maxReplicas },
        { label: 'Threshold set', ok: Number.isFinite(threshold) && threshold >= 0 },
    ];

    useEffect(() => {
        setError(null);
    }, [namespace, deployment, metric, operator, threshold, step, minReplicas, maxReplicas, action, enabled]);

    useEffect(() => {
        onTargetChange?.({
            namespace: namespace || undefined,
            deployment: deployment || undefined,
        });
    }, [namespace, deployment, onTargetChange]);

    const nodeNamespaces = useMemo(() => {
        if (!nodeScope?.pods || nodeScope.pods.length === 0) return [];
        const set = new Set<string>();
        nodeScope.pods.forEach((pod) => {
            if (pod.namespace) set.add(pod.namespace);
        });
        return Array.from(set);
    }, [nodeScope]);

    useEffect(() => {
        let cancelled = false;
        const loadNamespaces = async () => {
            setLoadingNamespaces(true);
            try {
                const list = await api.getNamespaces(nodeScope?.name || nodeScope?.ip);
                if (cancelled) return;
                const scoped = nodeNamespaces.length > 0 ? list.filter((ns) => nodeNamespaces.includes(ns)) : list;
                const finalList = scoped.length > 0 ? scoped : list;
                setNamespaces(finalList);
                if (!initial.namespace && finalList.length > 0) {
                    const preferred = finalList.includes('default') ? 'default' : finalList[0];
                    if (!namespace || !finalList.includes(namespace)) {
                        setNamespace(preferred);
                    }
                }
            } catch (err: any) {
                if (!cancelled) setError(err?.message || 'Failed to load namespaces');
            } finally {
                if (!cancelled) setLoadingNamespaces(false);
            }
        };
        void loadNamespaces();
        return () => { cancelled = true; };
    }, [initial.namespace, nodeNamespaces, nodeScope]);

    useEffect(() => {
        if (!namespace) {
            setDeploymentOptions([]);
            setDeployment('');
            return;
        }

        let cancelled = false;
        const loadDeployments = async () => {
            setLoadingDeployments(true);
            try {
                const list = await api.getDeployments(namespace, nodeScope?.name || nodeScope?.ip);
                if (cancelled) return;
                const podNames = (nodeScope?.pods || [])
                    .filter((pod) => pod.namespace === namespace)
                    .map((pod) => pod.name);
                const filtered = podNames.length > 0
                    ? list.filter((d) => podNames.some((podName) => podName === d.name || podName.startsWith(`${d.name}-`)))
                    : list;
                setDeploymentOptions(filtered);
                const hasCurrent = filtered.some((d) => d.name === deployment);
                if (!hasCurrent) {
                    setDeployment(filtered[0]?.name || '');
                }
            } catch (err: any) {
                if (!cancelled) {
                    setDeploymentOptions([]);
                    setDeployment('');
                    setError(err?.message || 'Failed to load deployments');
                }
            } finally {
                if (!cancelled) setLoadingDeployments(false);
            }
        };
        void loadDeployments();
        return () => { cancelled = true; };
    }, [namespace, nodeScope]);

    const validate = () => {
        if (!namespace) return 'Namespace is required';
        if (!deployment) return 'Deployment is required';
        if (step < 1) return 'Replicas change must be at least 1';
        if (minReplicas < 0 || maxReplicas < 0) return 'Replicas must be non-negative';
        if (minReplicas > maxReplicas) return 'minReplicas must be ≤ maxReplicas';
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const v = validate();
        if (v) { setError(v); return; }
        setSubmitting(true);
        try {
            await onSubmit({ namespace, deployment, metric, operator, threshold, step, minReplicas, maxReplicas, action, enabled });
        } catch (err: any) {
            setError(err?.message || 'Error submitting');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="scaling-form-layout">
            <form className="scaling-form" onSubmit={handleSubmit}>
                {error && <div className="error">{error}</div>}

                <div className="form-section">
                    <div className="section-header">
                        <div>
                            <div className="section-title">1. Target Workload</div>
                            <div className="section-subtitle">Choose where this rule applies.</div>
                        </div>
                        <div className="section-chip">Required</div>
                    </div>
                    <div className="section-body">
                        <div className="form-row">
                            <div className="label-with-info">
                                <label>Trigger Node (Observed)</label>
                                <button
                                    type="button"
                                    className="field-info-trigger"
                                    title="This node is only used to evaluate telemetry and decide scaling. New pods may be scheduled onto other healthier nodes."
                                    aria-label="About Trigger Node (Observed)"
                                >
                                    !
                                </button>
                            </div>
                            <div className="node-scope-pill">
                                {nodeScope ? `${nodeScope.name}${nodeScope.ip ? ` (${nodeScope.ip})` : ''}` : 'All nodes'}
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="label-with-info">
                                <label>Namespace</label>
                                <button
                                    type="button"
                                    className="field-info-trigger"
                                    title="Pick the namespace that owns the deployment you want to scale."
                                    aria-label="About Namespace"
                                >
                                    !
                                </button>
                            </div>
                            <select
                                value={namespace}
                                onChange={(e) => { setNamespace(e.target.value); setDeployment(''); }}
                                disabled={loadingNamespaces || namespaces.length === 0}
                            >
                                <option value="" disabled>Select a namespace</option>
                                {namespaces.map((ns) => (
                                    <option key={ns} value={ns}>{ns}</option>
                                ))}
                            </select>
                            {loadingNamespaces && <div className="list-subtext">Loading namespaces...</div>}
                            {!loadingNamespaces && namespaces.length === 0 && (
                                <div className="list-subtext">No namespaces match this node</div>
                            )}
                        </div>

                        <div className="form-row">
                            <div className="label-with-info">
                                <label>Deployment</label>
                                <button
                                    type="button"
                                    className="field-info-trigger"
                                    title="Select the specific workload that should scale automatically."
                                    aria-label="About Deployment"
                                >
                                    !
                                </button>
                            </div>
                            <select
                                value={deployment}
                                onChange={(e) => setDeployment(e.target.value)}
                                disabled={!namespace || loadingDeployments || deploymentOptions.length === 0}
                            >
                                <option value="" disabled>{namespace ? 'Select a deployment' : 'Select a namespace first'}</option>
                                {deploymentOptions.map((d) => (
                                    <option key={`${d.namespace}/${d.name}`} value={d.name}>
                                        {d.name}
                                    </option>
                                ))}
                            </select>
                            {loadingDeployments && <div className="list-subtext">Loading deployments...</div>}
                            {!loadingDeployments && namespace && deploymentOptions.length === 0 && (
                                <div className="list-subtext">No deployments found for this node</div>
                            )}
                        </div>

                        <div className="form-row">
                            <label>Enabled</label>
                            <div className="toggle-row">
                                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                                <span>{enabled ? 'Rule is active and will execute actions.' : 'Rule is paused and will not scale.'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="form-section">
                    <div className="section-header">
                        <div>
                            <div className="section-title">2. Trigger Signal</div>
                            <div className="section-subtitle">Define the metric and threshold that triggers scaling.</div>
                        </div>
                        <div className="section-chip">Telemetry</div>
                    </div>
                    <div className="section-body">
                        <div className="form-row">
                            <div className="label-with-info">
                                <label>Metric</label>
                                <button
                                    type="button"
                                    className="field-info-trigger"
                                    title={metricInfo.description}
                                    aria-label="About Metric"
                                >
                                    !
                                </button>
                            </div>
                            <select value={metric} onChange={(e) => setMetric(e.target.value as MetricType)}>
                                <option value="dns_latency">dns_latency</option>
                                <option value="rtt">rtt</option>
                                <option value="tcp_retrans">tcp_retrans</option>
                                <option value="disk_read_latency">disk_read_latency</option>
                                <option value="disk_write_latency">disk_write_latency</option>
                            </select>
                        </div>

                        <div className="form-row">
                            <div className="label-with-info">
                                <label>Operator</label>
                                <button
                                    type="button"
                                    className="field-info-trigger"
                                    title={`Trigger when metric is ${operator === '>' ? 'higher' : 'lower'} than the threshold.`}
                                    aria-label="About Operator"
                                >
                                    !
                                </button>
                            </div>
                            <select value={operator} onChange={(e) => setOperator(e.target.value as OperatorType)}>
                                <option value=">">&gt;</option>
                                <option value="<">&lt;</option>
                            </select>
                        </div>

                        <div className="form-row">
                            <div className="label-with-info">
                                <label>Threshold</label>
                                <button
                                    type="button"
                                    className="field-info-trigger"
                                    title={`Units: ${metricInfo.unit}. Typical range: ${metricInfo.typical}.`}
                                    aria-label="About Threshold"
                                >
                                    !
                                </button>
                            </div>
                            <input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
                        </div>
                    </div>
                </div>

                <div className="form-section">
                    <div className="section-header">
                        <div>
                            <div className="section-title">3. Scaling Action</div>
                            <div className="section-subtitle">Choose how the platform should respond.</div>
                        </div>
                        <div className="section-chip">Behavior</div>
                    </div>
                    <div className="section-body">
                        <div className="form-row">
                            <div className="label-with-info">
                                <label>Action</label>
                                <button
                                    type="button"
                                    className="field-info-trigger"
                                    title={action === 'scale_up' ? 'Add replicas when conditions worsen.' : 'Reduce replicas when conditions improve.'}
                                    aria-label="About Action"
                                >
                                    !
                                </button>
                            </div>
                            <select value={action} onChange={(e) => setAction(e.target.value as ScalingAction)}>
                                <option value="scale_up">scale_up</option>
                                <option value="scale_down">scale_down</option>
                            </select>
                        </div>

                        <div className="form-row">
                            <div className="label-with-info">
                                <label>Replicas Change</label>
                                <button
                                    type="button"
                                    className="field-info-trigger"
                                    title="Change the replica count by this amount each time the rule fires."
                                    aria-label="About Replicas Change"
                                >
                                    !
                                </button>
                            </div>
                            <input type="number" min={1} value={step} onChange={(e) => setStep(Number(e.target.value))} />
                        </div>
                    </div>
                </div>

                <div className="form-section form-section-full">
                    <div className="section-header">
                        <div>
                            <div className="section-title">4. Safety Guardrails</div>
                            <div className="section-subtitle">Set hard limits to prevent runaway scaling.</div>
                        </div>
                        <div className="section-chip">Limits</div>
                    </div>
                    <div className="section-body guardrail-grid">
                        <div className="form-row">
                            <div className="label-with-info">
                                <label>Min Replicas</label>
                                <button
                                    type="button"
                                    className="field-info-trigger"
                                    title="Lower bound even when scaling down."
                                    aria-label="About Min Replicas"
                                >
                                    !
                                </button>
                            </div>
                            <input type="number" min={0} value={minReplicas} onChange={(e) => setMinReplicas(Number(e.target.value))} />
                        </div>

                        <div className="form-row">
                            <div className="label-with-info">
                                <label>Max Replicas</label>
                                <button
                                    type="button"
                                    className="field-info-trigger"
                                    title="Upper bound even when scaling up."
                                    aria-label="About Max Replicas"
                                >
                                    !
                                </button>
                            </div>
                            <input type="number" min={0} value={maxReplicas} onChange={(e) => setMaxReplicas(Number(e.target.value))} />
                        </div>
                        <div className="guardrail-status">
                            <div className="guardrail-title">Safety Checks</div>
                            {safetyChecks.map((check) => (
                                <div key={check.label} className={`guardrail-item ${check.ok ? 'ok' : 'warn'}`}>
                                    <span>{check.label}</span>
                                    <span>{check.ok ? 'OK' : 'Needs attention'}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="form-section form-section-full">
                    <div className="section-header">
                        <div>
                            <div className="section-title">5. Scheduling</div>
                            <div className="section-subtitle">See where Kubernetes actually placed the workload after scaling decisions were made.</div>
                        </div>
                        <div className="section-chip">Visibility</div>
                    </div>
                    <div className="section-body">
                        {schedulingContent || (
                            <div className="list-subtext">Select a deployment to view node placement.</div>
                        )}
                    </div>
                </div>

                <div className="form-row form-actions">
                    <div className="spacer"></div>
                    <button type="button" className="btn btn-muted" onClick={onCancel} disabled={submitting}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>{submitLabel}</button>
                </div>
            </form>
        </div>
    );
}
