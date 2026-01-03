import './Page.css';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { FiServer } from 'react-icons/fi';
import { ScalingRulesTable } from '../components/ScalingRulesTable';
import { ScalingRuleForm } from '../components/ScalingRuleForm';
import { useScalingRules } from '../hooks/useScalingRules';
import { useMetrics } from '../hooks/useMetrics';
import type { ScalingRule } from '../types/scaling';

export function ScalingRules() {
    const { rules, deployments, latestMetrics, loading, error, createRule, updateRule, toggleRule, deleteRule, reload } = useScalingRules();
    const [showForm, setShowForm] = useState(false);
    const [editingRule, setEditingRule] = useState<ScalingRule | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(() => {
        return localStorage.getItem('selectedNodeKey');
    });
    const { availableNodes, metrics } = useMetrics(5000, selectedNodeKey);
    const location = useLocation();

    useEffect(() => {
        if (rules && rules.length > 0 && !selectedId) {
            setSelectedId(rules[0]._id);
        }
    }, [rules, selectedId]);

    useEffect(() => {
        reload();
    }, [location.pathname, reload]);

    useEffect(() => {
        if (availableNodes.length > 0 && !selectedNodeKey) {
            setSelectedNodeKey(availableNodes[0].key);
        }
    }, [availableNodes, selectedNodeKey]);

    useEffect(() => {
        if (selectedNodeKey) {
            localStorage.setItem('selectedNodeKey', selectedNodeKey);
        }
    }, [selectedNodeKey]);

    const selectedNodeName = selectedNodeKey
        ? availableNodes.find((node) => node.key === selectedNodeKey)?.name
        : undefined;

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
            {availableNodes.length > 0 && (
                <div style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 100,
                    background: 'rgba(15, 23, 42, 0.95)',
                    backdropFilter: 'blur(10px)',
                    borderBottom: '1px solid rgba(71, 85, 105, 0.3)',
                    padding: '1.25rem 2rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '2rem',
                    flexWrap: 'wrap'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <FiServer style={{ color: '#60a5fa', fontSize: '1.25rem' }} />
                            <label style={{ color: '#e2e8f0', fontSize: '0.95rem', fontWeight: 600 }}>
                                Selected Node:
                            </label>
                            <select
                                value={selectedNodeKey || ''}
                                onChange={(e) => {
                                    const newKey = e.target.value || null;
                                    setSelectedNodeKey(newKey);
                                    if (newKey) {
                                        localStorage.setItem('selectedNodeKey', newKey);
                                    }
                                }}
                                style={{
                                    padding: '0.625rem 1.25rem',
                                    background: 'rgba(30, 41, 59, 0.8)',
                                    border: '2px solid rgba(59, 130, 246, 0.4)',
                                    borderRadius: '8px',
                                    color: '#e2e8f0',
                                    fontSize: '0.95rem',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    minWidth: '280px',
                                    outline: 'none',
                                    transition: 'all 0.2s ease'
                                }}
                                onFocus={(e) => {
                                    e.target.style.borderColor = 'rgba(59, 130, 246, 0.6)';
                                    e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
                                }}
                                onBlur={(e) => {
                                    e.target.style.borderColor = 'rgba(59, 130, 246, 0.4)';
                                    e.target.style.boxShadow = 'none';
                                }}
                            >
                                {availableNodes.map((node) => (
                                    <option key={node.key} value={node.key}>
                                        {node.name} {node.ip ? `(${node.ip})` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    {metrics?.node_name && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            padding: '0.5rem 1rem',
                            background: 'rgba(30, 41, 59, 0.6)',
                            border: '1px solid rgba(59, 130, 246, 0.2)',
                            borderRadius: '8px',
                            color: '#e2e8f0',
                            fontSize: '0.85rem',
                            fontWeight: 500
                        }}>
                            <FiServer style={{ color: '#60a5fa', fontSize: '1rem' }} />
                            <div>
                                <div style={{ opacity: 0.7, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Current Node
                                </div>
                                <div>
                                    {metrics.node_name}{metrics.node_ip ? ` (${metrics.node_ip})` : ''}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
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
                            nodeFilter={selectedNodeName}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
