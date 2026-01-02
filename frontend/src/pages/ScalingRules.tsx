import './Page.css';
import { useEffect, useState } from 'react';
import { ScalingRulesTable } from '../components/ScalingRulesTable';
import { ScalingRuleForm } from '../components/ScalingRuleForm';
import { useScalingRules } from '../hooks/useScalingRules';
import type { ScalingRule } from '../types/scaling';

export function ScalingRules() {
    const { rules, deployments, latestMetrics, loading, error, createRule, toggleRule, deleteRule } = useScalingRules();
    const [showForm, setShowForm] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        if (rules && rules.length > 0 && !selectedId) {
            setSelectedId(rules[0]._id);
        }
    }, [rules, selectedId]);

    const handleCreate = async (rule: Partial<ScalingRule>) => {
        await createRule(rule);
        setShowForm(false);
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <div className="page-title-section">
                    <h1 className="page-title">Scaling Rules Management</h1>
                    <p className="page-subtitle">Manage autoscaling rules driven by eBPF telemetry</p>
                </div>
            </div>

            <div className="page-content">
                <div className="feature-card">
                    <div className="scaling-toolbar">
                        <div style={{ flex: 1 }}>
                            <strong>Rules</strong>
                            <div className="list-subtext">Create and manage autoscaling rules.</div>
                        </div>
                        <div>
                            <button className="btn btn-primary" onClick={() => { setShowForm(true); }}>Create Rule</button>
                        </div>
                    </div>

                    {loading && <div>Loading rules...</div>}
                    {error && <div className="error">{error}</div>}

                    {rules && rules.length === 0 && <div className="list-subtext">No scaling rules found.</div>}

                    {rules && rules.length > 0 && (
                        <ScalingRulesTable
                            rules={rules}
                            onToggle={async (id, enabled) => { try { await toggleRule(id, enabled); } catch (err) { console.error(err); } }}
                            onDelete={async (id) => { try { await deleteRule(id); } catch (err) { console.error(err); } }}
                            selectedId={selectedId}
                            onSelect={(id) => setSelectedId(id)}
                        />
                    )}

                </div>
            </div>

            {rules && rules.length > 0 && (() => {
                const active = rules.find((r) => r._id === selectedId) || rules[0];
                const depKey = `${active.namespace}/${active.deployment}`;
                const dep = deployments[depKey];
                const metricKey = `${active.namespace}/${active.deployment}/${active.metric}`;
                const latest = latestMetrics[metricKey];
                const latestValue = latest?.value ?? active.lastValue;
                const hasLastAction = Boolean(active.lastAction && active.lastAction !== 'noop' && active.lastActionAt);
                const isStaleAction = hasLastAction && dep && active.lastTo !== undefined && dep.replicas !== active.lastTo;
                const lastActionText = hasLastAction && !isStaleAction
                    ? `${active.lastAction}${active.lastFrom !== undefined && active.lastTo !== undefined ? ` (${active.lastFrom}→${active.lastTo})` : ''}`
                    : '—';
                const lastActionAt = hasLastAction && !isStaleAction ? new Date(active.lastActionAt as string).toLocaleString() : '';

                return (
                    <div className="page-content">
                        <div className="scaling-metric-cards">
                            <div className="scaling-metric-card">
                                <div className="metric-label">Current Replicas</div>
                                <div className="metric-value">{dep ? `${dep.replicas}` : '—'}</div>
                                <div className="metric-subtext">{active.namespace}/{active.deployment}</div>
                            </div>
                            <div className="scaling-metric-card">
                                <div className="metric-label">Latest Metric</div>
                                <div className="metric-value">{latestValue !== undefined ? `${latestValue}` : '—'}</div>
                                <div className="metric-subtext">{active.metric}</div>
                            </div>
                            <div className="scaling-metric-card">
                                <div className="metric-label">Last Action</div>
                                <div className="metric-value" title={lastActionAt}>{lastActionText}</div>
                                <div className="metric-subtext">{lastActionAt || 'No actions yet'}</div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {showForm && (
                <div className="modal">
                    <div className="modal-card">
                        <h2>Create Rule</h2>
                        <ScalingRuleForm
                            onCancel={() => { setShowForm(false); }}
                            onSubmit={handleCreate}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
