import { useState, useEffect } from 'react';
import type { ScalingRule, MetricType, OperatorType } from '../types/scaling';

interface Props {
    initial?: Partial<ScalingRule>;
    onCancel: () => void;
    onSubmit: (rule: Partial<ScalingRule>) => Promise<void> | void;
}

export function ScalingRuleForm({ initial = {}, onCancel, onSubmit }: Props) {
    const [namespace, setNamespace] = useState(initial.namespace || 'default');
    const [deployment, setDeployment] = useState(initial.deployment || '');
    const [metric, setMetric] = useState<MetricType>(initial.metric || 'dns_latency');
    const [operator, setOperator] = useState<OperatorType>(initial.operator || '>');
    const [threshold, setThreshold] = useState<number>(initial.threshold ?? 0);
    const [minReplicas, setMinReplicas] = useState<number>(initial.minReplicas ?? 1);
    const [maxReplicas, setMaxReplicas] = useState<number>(initial.maxReplicas ?? 1);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setError(null);
    }, [namespace, deployment, metric, operator, threshold, minReplicas, maxReplicas]);

    const validate = () => {
        if (!deployment) return 'Deployment is required';
        if (minReplicas > maxReplicas) return 'minReplicas must be ≤ maxReplicas';
        if (minReplicas < 0 || maxReplicas < 0) return 'Replicas must be non-negative';
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const v = validate();
        if (v) { setError(v); return; }
        setSubmitting(true);
        try {
        await onSubmit({ namespace, deployment, metric, operator, threshold, minReplicas, maxReplicas, enabled: true });
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
                <input value={namespace} onChange={(e) => setNamespace(e.target.value)} />
            </div>

            <div className="form-row">
                <label>Deployment</label>
                <input value={deployment} onChange={(e) => setDeployment(e.target.value)} placeholder="deployment name" />
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
                <label>Min Replicas</label>
                <input type="number" value={minReplicas} onChange={(e) => setMinReplicas(Number(e.target.value))} />
            </div>

            <div className="form-row">
                <label>Max Replicas</label>
                <input type="number" value={maxReplicas} onChange={(e) => setMaxReplicas(Number(e.target.value))} />
            </div>

            <div className="form-row form-actions">
                <div className="spacer"></div>
                <button type="button" className="btn btn-muted" onClick={onCancel} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>Create</button>
            </div>
        </form>
    );
}
