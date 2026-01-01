import type { ScalingRule, LatestMetric, DeploymentInfo } from '../types/scaling';

interface Props {
    rules: ScalingRule[];
    deployments: Record<string, DeploymentInfo>;
    latestMetrics: Record<string, LatestMetric>;
    onToggle: (id: string, enabled: boolean) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}

export function ScalingRulesTable({ rules, deployments, latestMetrics, onToggle, onDelete }: Props) {
    return (
        <table className="scaling-table">
            <thead>
                <tr>
                    <th>Namespace</th>
                    <th>Deployment</th>
                    <th>Metric</th>
                    <th>Op</th>
                    <th>Threshold</th>
                    <th>Min Replicas</th>
                    <th>Max Replicas</th>
                    <th>Step</th>
                    <th>Current Replicas</th>
                    <th>Latest Metric</th>
                    <th>Last Action</th>
                    <th>Enabled</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                {rules.map((r) => {
                    const depKey = `${r.namespace}/${r.deployment}`;
                    const dep = deployments[depKey];
                    const metricKey = `${r.namespace}/${r.deployment}/${r.metric}`;
                    const latest = latestMetrics[metricKey];
                    const lastActionText = r.lastAction
                        ? `${r.lastAction}${r.lastFrom !== undefined && r.lastTo !== undefined ? ` (${r.lastFrom}→${r.lastTo})` : ''}`
                        : '—';
                    const lastActionAt = r.lastActionAt ? new Date(r.lastActionAt).toLocaleString() : '';
                    return (
                        <tr key={r._id} className={r.enabled ? '' : 'disabled-row'}>
                            <td>{r.namespace}</td>
                            <td>{r.deployment}</td>
                            <td>{r.metric}</td>
                            <td>{r.operator}</td>
                            <td>{r.threshold}</td>
                            <td>{r.minReplicas}</td>
                            <td>{r.maxReplicas}</td>
                            <td>{r.step}</td>
                            <td>{dep ? `${dep.replicas}` : '—'}</td>
                            <td>{latest ? `${latest.value}` : '—'}</td>
                            <td title={lastActionAt}>{lastActionText}</td>
                            <td>
                                <input type="checkbox" checked={r.enabled} onChange={() => { void onToggle(r._id, !r.enabled); }} />
                            </td>
                            <td>
                                <button className="btn btn-sm" onClick={() => { void onDelete(r._id); }}>Delete</button>
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}
