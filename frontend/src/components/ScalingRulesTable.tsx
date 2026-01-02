import type { ScalingRule, LatestMetric, DeploymentInfo } from '../types/scaling';

interface Props {
    rules: ScalingRule[];
    deployments: Record<string, DeploymentInfo>;
    latestMetrics: Record<string, LatestMetric>;
    onToggle: (id: string, enabled: boolean) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    selectedId?: string | null;
    onSelect: (id: string) => void;
}

export function ScalingRulesTable({ rules, deployments, latestMetrics, onToggle, onDelete, selectedId, onSelect }: Props) {
    return (
        <table className="scaling-table">
            <thead>
                <tr>
                    <th>Namespace</th>
                    <th>Metric</th>
                    <th>Op</th>
                    <th>Threshold</th>
                    <th>Min Repl</th>
                    <th>Max Repl</th>
                    <th>Current Replicas</th>
                    <th>Enabled</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                {rules.map((r) => {
                    const depKey = `${r.namespace}/${r.deployment}`;
                    const dep = deployments[depKey];
                    const metricKey = `${r.namespace}/${r.deployment}/${r.metric}`;
                    const latest = latestMetrics[metricKey];
                    const isSelected = selectedId === r._id;
                    return (
                        <tr
                            key={r._id}
                            className={`${r.enabled ? '' : 'disabled-row'}${isSelected ? ' selected-row' : ''}`}
                            onClick={() => onSelect(r._id)}
                        >
                            <td>{r.namespace}</td>
                            <td>{r.metric}</td>
                            <td>{r.operator}</td>
                            <td>{r.threshold}</td>
                            <td>{r.minReplicas}</td>
                            <td>{r.maxReplicas}</td>
                            <td>{dep ? `${dep.replicas}` : '—'}</td>
                            <td>
                                <input type="checkbox" checked={r.enabled} onChange={() => { void onToggle(r._id, !r.enabled); }} />
                            </td>
                            <td>
                                <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); void onDelete(r._id); }}>Delete</button>
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}
