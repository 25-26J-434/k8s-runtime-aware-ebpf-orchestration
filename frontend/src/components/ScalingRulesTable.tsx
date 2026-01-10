import type { ScalingRule } from '../types/scaling';

interface Props {
    rules: ScalingRule[];
    onToggle: (id: string, enabled: boolean) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    selectedId?: string | null;
    onSelect: (id: string) => void;
    onEdit: (rule: ScalingRule) => void;
}

export function ScalingRulesTable({ rules, onToggle, onDelete, selectedId, onSelect, onEdit }: Props) {
    return (
        <table className="scaling-table">
            <thead>
                <tr>
                    <th>Namespace</th>
                    <th>Metric</th>
                    <th>Operator</th>
                    <th>Threshold</th>
                    <th>Scale Action</th>
                    <th>Change</th>
                    <th>Min Repl</th>
                    <th>Max Repl</th>
                    <th>Enabled</th>
                    <th>Edit</th>
                    <th>Delete</th>
                </tr>
            </thead>
            <tbody>
                {rules.map((r) => {
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
                            <td>{r.action || 'auto'}</td>
                            <td>{r.step}</td>
                            <td>{r.minReplicas}</td>
                            <td>{r.maxReplicas}</td>
                            <td>
                                <input
                                    type="checkbox"
                                    checked={r.enabled}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                        e.stopPropagation();
                                        void onToggle(r._id, !r.enabled);
                                    }}
                                />
                            </td>
                            <td>
                                <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); onEdit(r); }}>
                                    Edit
                                </button>
                            </td>
                            <td>
                                <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); void onDelete(r._id); }}>
                                    Delete
                                </button>
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}
