import { useState, useEffect } from 'react';
import type { ScalingRule, MetricType, OperatorType, DeploymentInfo, ScalingAction } from '../types/scaling';
import { api } from '../services/api';

interface Props {
    initial?: Partial<ScalingRule>;
    onCancel: () => void;
    onSubmit: (rule: Partial<ScalingRule>) => Promise<void> | void;
    submitLabel?: string;
}

export function ScalingRuleForm({ initial = {}, onCancel, onSubmit, submitLabel = 'Save' }: Props) {
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

    useEffect(() => {
        setError(null);
    }, [namespace, deployment, metric, operator, threshold, step, minReplicas, maxReplicas, action, enabled]);

    useEffect(() => {
        let cancelled = false;
        const loadNamespaces = async () => {
            setLoadingNamespaces(true);
            try {
                const list = await api.getNamespaces();
                if (cancelled) return;
                setNamespaces(list);
                if (!initial.namespace && list.length > 0) {
                    const preferred = list.includes('default') ? 'default' : list[0];
                    if (!namespace || !list.includes(namespace)) {
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
    }, [initial.namespace]);

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
                const list = await api.getDeployments(namespace);
                if (cancelled) return;
                setDeploymentOptions(list);
                const hasCurrent = list.some((d) => d.name === deployment);
                if (!hasCurrent) {
                    setDeployment(list[0]?.name || '');
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
    }, [namespace]);

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
        <form className="scaling-form" onSubmit={handleSubmit}>
            {error && <div className="error">{error}</div>}

            <div className="form-row">
                <label>Namespace</label>
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
            </div>

            <div className="form-row">
                <label>Deployment</label>
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
                    <div className="list-subtext">No deployments found in this namespace</div>
                )}
            </div>

            <div className="form-row">
                <label>Metric</label>
                <select value={metric} onChange={(e) => setMetric(e.target.value as MetricType)}>
                    <option value="dns_latency">dns_latency</option>
                    <option value="rtt">rtt</option>
                    <option value="tcp_retrans">tcp_retrans</option>
                </select>
            </div>

            <div className="form-row">
                <label>Operator</label>
                <select value={operator} onChange={(e) => setOperator(e.target.value as OperatorType)}>
                    <option value=">">&gt;</option>
                    <option value="<">&lt;</option>
                </select>
            </div>

            <div className="form-row">
                <label>Threshold</label>
                <input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </div>

            <div className="form-row">
                <label>Action</label>
                <select value={action} onChange={(e) => setAction(e.target.value as ScalingAction)}>
                    <option value="scale_up">scale_up</option>
                    <option value="scale_down">scale_down</option>
                </select>
            </div>

            <div className="form-row">
                <label>Replicas Change</label>
                <input type="number" min={1} value={step} onChange={(e) => setStep(Number(e.target.value))} />
            </div>

            <div className="form-row">
                <label>Min Replicas</label>
                <input type="number" min={0} value={minReplicas} onChange={(e) => setMinReplicas(Number(e.target.value))} />
            </div>

            <div className="form-row">
                <label>Max Replicas</label>
                <input type="number" min={0} value={maxReplicas} onChange={(e) => setMaxReplicas(Number(e.target.value))} />
            </div>

            <div className="form-row">
                <label>Enabled</label>
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            </div>

            <div className="form-row form-actions">
                <div className="spacer"></div>
                <button type="button" className="btn btn-muted" onClick={onCancel} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitLabel}</button>
            </div>
        </form>
    );
}
