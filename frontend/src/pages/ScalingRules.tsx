import './Page.css';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ScalingRulesTable } from '../components/ScalingRulesTable';
import { ScalingRuleForm } from '../components/ScalingRuleForm';
import { useScalingRules } from '../hooks/useScalingRules';
import type { ScalingRule } from '../types/scaling';

export function ScalingRules() {
    const { rules, deployments, latestMetrics, loading, error, createRule, updateRule, toggleRule, deleteRule, reload } = useScalingRules();
    const [showForm, setShowForm] = useState(false);
    const [editingRule, setEditingRule] = useState<ScalingRule | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const location = useLocation();

    useEffect(() => {
        if (rules && rules.length > 0 && !selectedId) {
            setSelectedId(rules[0]._id);
        }
    }, [rules, selectedId]);

    useEffect(() => {
        reload();
    }, [location.pathname, reload]);

    const handleCreate = async (rule: Partial<ScalingRule>) => {
        const created = await createRule(rule);
        if (created?._id) {
            setSelectedId(created._id);
        }
        setShowForm(false);
        setEditingRule(null);
    };

    const handleUpdate = async (rule: Partial<ScalingRule>) => {
        if (!editingRule?._id) return;
        await updateRule(editingRule._id, rule);
        setShowForm(false);
        setEditingRule(null);
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
                            <button className="btn btn-primary" onClick={() => { setEditingRule(null); setShowForm(true); }}>Create Rule</button>
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
                            onEdit={(rule) => { setEditingRule(rule); setShowForm(true); }}
                        />
                    )}

                </div>
            </div>

            {rules && rules.length > 0 && (() => {
                const active = rules.find((r) => r._id === selectedId) || rules[0];
                const ruleEnabled = Boolean(active.enabled);
                const depKey = `${active.namespace}/${active.deployment}`;
                const dep = ruleEnabled ? deployments[depKey] : undefined;
                const metricKey = `${active.namespace}/${active.deployment}/${active.metric}`;
                const latest = ruleEnabled ? latestMetrics[metricKey] : undefined;
                const latestValue = ruleEnabled ? (latest?.value ?? active.lastValue) : undefined;
                const hasLastAction = ruleEnabled && Boolean(active.lastAction && active.lastAction !== 'noop' && active.lastActionAt);
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
                                <div className="metric-subtext">{ruleEnabled ? (lastActionAt || 'No actions yet') : '—'}</div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {showForm && (
                <div className="modal">
                    <div className="modal-card">
                        <h2>{editingRule ? 'Edit Rule' : 'Create Rule'}</h2>
                        <ScalingRuleForm
                            initial={editingRule ?? undefined}
                            onCancel={() => { setShowForm(false); }}
                            onSubmit={editingRule ? handleUpdate : handleCreate}
                            submitLabel={editingRule ? 'Update' : 'Create'}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
