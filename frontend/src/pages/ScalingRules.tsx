import './Page.css';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ScalingRulesTable } from '../components/ScalingRulesTable';
import { ScalingRuleForm } from '../components/ScalingRuleForm';
import { useScalingRules } from '../hooks/useScalingRules';
import { api } from '../services/api';
import type { ScalingRule } from '../types/scaling';
import type { Node, Pod } from '../types/api';

export function ScalingRules() {
    const [showForm, setShowForm] = useState(false);
    const [editingRule, setEditingRule] = useState<ScalingRule | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
    const [sortBy, setSortBy] = useState<'name' | 'metric' | 'action'>('name');
    const [clusterNodes, setClusterNodes] = useState<Array<Node & { ip?: string }>>([]);
    const [selectedNodeKey, setSelectedNodeKey] = useState<string>(() => localStorage.getItem('selectedNodeKey') || '');
    const [loadingNodes, setLoadingNodes] = useState(false);
    const [nodeError, setNodeError] = useState<string | null>(null);
    const pollingInterval = showForm ? 0 : 15000;
    const { rules, deployments, latestMetrics, loading, error, createRule, updateRule, toggleRule, deleteRule, reload } = useScalingRules(selectedNodeKey, pollingInterval);
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
        let cancelled = false;
        const loadTopology = async () => {
            setLoadingNodes(true);
            setNodeError(null);
            try {
                const topology = await api.getClusterTopology();
                if (cancelled) return;
                const nodes = (topology.nodes || []).map((node: Node) => ({
                    ...node,
                    ip: (node as any).ip || (node as any).node_ip || '',
                    pods: node.pods || [],
                }));
                setClusterNodes(nodes);
            } catch (err: any) {
                if (!cancelled) {
                    setNodeError(err?.message || 'Failed to load nodes');
                }
            } finally {
                if (!cancelled) setLoadingNodes(false);
            }
        };
        void loadTopology();
        return () => { cancelled = true; };
    }, []);

    const nodeOptions = useMemo(() => {
        return clusterNodes.map((node) => ({
            key: node.name,
            label: node.ip ? `${node.name} (${node.ip})` : node.name,
        }));
    }, [clusterNodes]);

    const selectedNode = useMemo(() => {
        if (!clusterNodes.length) return null;
        const match = clusterNodes.find((node) => node.name === selectedNodeKey || node.ip === selectedNodeKey);
        return match || clusterNodes[0];
    }, [clusterNodes, selectedNodeKey]);

    useEffect(() => {
        if (!clusterNodes.length) return;
        if (!selectedNodeKey || !clusterNodes.some((node) => node.name === selectedNodeKey || node.ip === selectedNodeKey)) {
            setSelectedNodeKey(clusterNodes[0].name);
        }
    }, [clusterNodes, selectedNodeKey]);

    useEffect(() => {
        if (selectedNodeKey) {
            localStorage.setItem('selectedNodeKey', selectedNodeKey);
        }
    }, [selectedNodeKey]);

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

    const activeRuleData = useMemo(() => {
        if (!rules || rules.length === 0) return null;
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

        return { active, ruleEnabled, dep, latestValue, lastActionText, lastActionAt };
    }, [rules, selectedId, deployments, latestMetrics]);

    const filteredRules = useMemo(() => {
        if (!rules) return [];
        const query = search.trim().toLowerCase();
        const filtered = rules.filter((rule) => {
            if (statusFilter === 'enabled' && !rule.enabled) return false;
            if (statusFilter === 'disabled' && rule.enabled) return false;
            if (!query) return true;
            const target = `${rule.namespace}/${rule.deployment}`.toLowerCase();
            return target.includes(query) || rule.metric.toLowerCase().includes(query);
        });
        const sorter = (a: ScalingRule, b: ScalingRule) => {
            if (sortBy === 'metric') return a.metric.localeCompare(b.metric);
            if (sortBy === 'action') return a.action.localeCompare(b.action);
            const aTarget = `${a.namespace}/${a.deployment}`;
            const bTarget = `${b.namespace}/${b.deployment}`;
            return aTarget.localeCompare(bTarget);
        };
        return [...filtered].sort(sorter);
    }, [rules, search, statusFilter, sortBy]);

    const metricsSummary = useMemo(() => {
        const total = rules?.length ?? 0;
        const enabled = rules?.filter((r) => r.enabled).length ?? 0;
        const disabled = total - enabled;
        const metrics = rules?.reduce<Record<string, number>>((acc, rule) => {
            acc[rule.metric] = (acc[rule.metric] || 0) + 1;
            return acc;
        }, {}) ?? {};
        const topMetric = Object.entries(metrics).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
        return { total, enabled, disabled, topMetric };
    }, [rules]);

    const recentUpdates = useMemo(() => {
        if (!rules) return [];
        return [...rules]
            .filter((rule) => Boolean(rule.lastActionAt))
            .sort((a, b) => new Date(b.lastActionAt as string).getTime() - new Date(a.lastActionAt as string).getTime())
            .slice(0, 5);
    }, [rules]);

    return (
        <div className="page-container">
            <div className="page-header scaling-header">
                <div className="page-title-section">
                    <h1 className="page-title">Scaling Rules Management</h1>
                    <p className="page-subtitle">Manage autoscaling rules driven by eBPF telemetry</p>
                </div>
                <div className="scaling-node-picker">
                    <label>Selected Node</label>
                    <select
                        value={selectedNode?.name || ''}
                        onChange={(e) => setSelectedNodeKey(e.target.value)}
                        disabled={loadingNodes || nodeOptions.length === 0}
                    >
                        {nodeOptions.map((node) => (
                            <option key={node.key} value={node.key}>
                                {node.label}
                            </option>
                        ))}
                    </select>
                    {loadingNodes && <span className="list-subtext">Loading nodes...</span>}
                    {nodeError && <span className="list-subtext">{nodeError}</span>}
                </div>
            </div>

            <div className="page-content">
                {activeRuleData && (
                    <div className="scaling-hero">
                        <div className="scaling-hero-header">
                            <div>
                                <div className="hero-title">Active Rule Focus</div>
                                <div className="list-subtext">Live snapshot for the selected rule.</div>
                            </div>
                            <div className={`hero-chip ${activeRuleData.ruleEnabled ? 'enabled' : 'disabled'}`}>
                                {activeRuleData.ruleEnabled ? 'Enabled' : 'Disabled'}
                            </div>
                        </div>

                        <div className="scaling-hero-body">
                            <div className="active-summary-card">
                                <div className="summary-title">Rule Details</div>
                                <div className="summary-row">
                                    <span>Target</span>
                                    <strong>{activeRuleData.active.namespace}/{activeRuleData.active.deployment}</strong>
                                </div>
                                <div className="summary-row">
                                    <span>Trigger</span>
                                    <strong>{activeRuleData.active.metric} {activeRuleData.active.operator} {activeRuleData.active.threshold}</strong>
                                </div>
                                <div className="summary-row">
                                    <span>Action</span>
                                    <strong>{activeRuleData.active.action} by {activeRuleData.active.step}</strong>
                                </div>
                                <div className="summary-row">
                                    <span>Guardrails</span>
                                    <strong>{activeRuleData.active.minReplicas} - {activeRuleData.active.maxReplicas}</strong>
                                </div>
                                <div className="summary-actions">
                                    <button className="btn btn-sm" onClick={() => { setEditingRule(activeRuleData.active); setShowForm(true); }}>Edit Rule</button>
                                </div>
                            </div>

                            <div className="scaling-metric-cards">
                                <div className="scaling-metric-card">
                                    <div className="metric-label">Current Replicas</div>
                                    <div className="metric-value">{activeRuleData.dep ? `${activeRuleData.dep.replicas}` : '—'}</div>
                                    <div className="metric-subtext">{activeRuleData.active.namespace}/{activeRuleData.active.deployment}</div>
                                </div>
                                <div className="scaling-metric-card">
                                    <div className="metric-label">Latest Metric</div>
                                    <div className="metric-value">{activeRuleData.latestValue !== undefined ? `${activeRuleData.latestValue}` : '—'}</div>
                                    <div className="metric-subtext">{activeRuleData.active.metric}</div>
                                </div>
                                <div className="scaling-metric-card">
                                    <div className="metric-label">Last Action</div>
                                    <div className="metric-value" title={activeRuleData.lastActionAt}>{activeRuleData.lastActionText}</div>
                                    <div className="metric-subtext">{activeRuleData.ruleEnabled ? (activeRuleData.lastActionAt || 'No actions yet') : '—'}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="scaling-overview">
                    <div className="overview-card">
                        <div className="overview-label">Total Rules</div>
                        <div className="overview-value">{metricsSummary.total}</div>
                        <div className="overview-subtext">All configured autoscaling rules.</div>
                    </div>
                    <div className="overview-card">
                        <div className="overview-label">Enabled</div>
                        <div className="overview-value">{metricsSummary.enabled}</div>
                        <div className="overview-subtext">Active and monitoring.</div>
                    </div>
                    <div className="overview-card">
                        <div className="overview-label">Disabled</div>
                        <div className="overview-value">{metricsSummary.disabled}</div>
                        <div className="overview-subtext">Paused or under review.</div>
                    </div>
                    <div className="overview-card">
                        <div className="overview-label">Top Metric</div>
                        <div className="overview-value">{metricsSummary.topMetric}</div>
                        <div className="overview-subtext">Most used signal.</div>
                    </div>
                </div>

                <div className="scaling-grid">
                    <div className="feature-card">
                        <div className="scaling-toolbar">
                            <div style={{ flex: 1 }}>
                                <strong>Rules</strong>
                                <div className="list-subtext">Create and manage autoscaling rules.</div>
                            </div>
                            <div className="toolbar-actions">
                                <input
                                    className="toolbar-input"
                                    placeholder="Search namespace, deployment, metric..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                                <select className="toolbar-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | 'enabled' | 'disabled')}>
                                    <option value="all">All</option>
                                    <option value="enabled">Enabled</option>
                                    <option value="disabled">Disabled</option>
                                </select>
                                <select className="toolbar-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as 'name' | 'metric' | 'action')}>
                                    <option value="name">Sort: Target</option>
                                    <option value="metric">Sort: Metric</option>
                                    <option value="action">Sort: Action</option>
                                </select>
                                <button className="btn btn-primary" onClick={() => { setEditingRule(null); setShowForm(true); }}>Create Rule</button>
                            </div>
                        </div>

                        {loading && <div>Loading rules...</div>}
                        {error && <div className="error">{error}</div>}

                        {rules && rules.length === 0 && <div className="list-subtext">No scaling rules found.</div>}

                        {rules && rules.length > 0 && (
                            <ScalingRulesTable
                                rules={filteredRules}
                                onToggle={async (id, enabled) => { try { await toggleRule(id, enabled); } catch (err) { console.error(err); } }}
                                onDelete={async (id) => { try { await deleteRule(id); } catch (err) { console.error(err); } }}
                                selectedId={selectedId}
                                onSelect={(id) => setSelectedId(id)}
                                onEdit={(rule) => { setEditingRule(rule); setShowForm(true); }}
                            />
                        )}
                    </div>

                </div>

                <div className="scaling-side-row">
                    <div className="feature-card">
                        <div className="panel-header">
                            <div>
                                <strong>Rule Health</strong>
                                <div className="list-subtext">Quick checks based on current settings.</div>
                            </div>
                        </div>
                        <div className="health-list">
                            {filteredRules.slice(0, 6).map((rule) => {
                                const target = `${rule.namespace}/${rule.deployment}`;
                                const healthOk = rule.minReplicas <= rule.maxReplicas && rule.step >= 1;
                                return (
                                    <div className="health-item" key={rule._id}>
                                        <div>
                                            <div className="health-title">{target}</div>
                                            <div className="health-meta">{rule.metric} {rule.operator} {rule.threshold}</div>
                                        </div>
                                        <div className={`health-status ${healthOk ? 'ok' : 'warn'}`}>
                                            {healthOk ? 'OK' : 'Check limits'}
                                        </div>
                                    </div>
                                );
                            })}
                            {filteredRules.length === 0 && <div className="list-subtext">No rules to evaluate.</div>}
                        </div>
                    </div>

                    <div className="feature-card">
                        <div className="panel-header">
                            <div>
                                <strong>Recent Scaling Activity</strong>
                                <div className="list-subtext">Latest actions recorded for your rules.</div>
                            </div>
                        </div>
                        <div className="activity-list">
                            {recentUpdates.length === 0 && <div className="list-subtext">No scaling actions recorded yet.</div>}
                            {recentUpdates.map((rule) => {
                                const actionTime = rule.lastActionAt ? new Date(rule.lastActionAt as string).toLocaleString() : '—';
                                return (
                                    <div className="activity-item" key={rule._id}>
                                        <div className="activity-title">{rule.namespace}/{rule.deployment}</div>
                                        <div className="activity-meta">{rule.metric} {rule.operator} {rule.threshold}</div>
                                        <div className="activity-foot">
                                            <span>{rule.lastAction || '—'}</span>
                                            <span>{actionTime}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {showForm && (
                <div className="scaling-modal">
                    <div className="scaling-modal-card">
                        <h2>{editingRule ? 'Edit Rule' : 'Create Rule'}</h2>
                        <ScalingRuleForm
                            initial={editingRule ?? undefined}
                            nodeScope={selectedNode ? { name: selectedNode.name, ip: selectedNode.ip, pods: selectedNode.pods as Pod[] } : undefined}
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
