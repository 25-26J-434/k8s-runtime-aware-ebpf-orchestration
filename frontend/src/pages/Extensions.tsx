import './Page.css';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type ExtensionInfo, type ExtensionInput } from '../services/api';
import type { UnifiedMetricsResponse } from '../types/api';
import { FiSave, FiPlusCircle, FiEdit2, FiTrash2, FiChevronRight, FiActivity } from 'react-icons/fi';

export type WebhookRow = { id: string; type: 'teams' | 'discord' | 'slack'; url: string; enabled: boolean };
export type ThresholdRow = { id: string; metric_type: string; level: string; threshold_value: number; node_name?: string };

/** Form state for adding/editing a threshold (no id until saved). */
type NewThresholdForm = Omit<ThresholdRow, 'id'> & { node_name?: string };

function genId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Webhooks table for notification: Type | URL | Enabled | Actions. */
function NotificationWebhooksTable({
    webhooks,
    onDelete,
    onToggleEnabled,
}: {
    webhooks: WebhookRow[];
    onDelete: (id: string) => void;
    onToggleEnabled: (id: string, enabled: boolean) => void;
}) {
    const typeLabel = (t: string) => t === 'teams' ? 'Microsoft Teams' : t === 'slack' ? 'Slack' : 'Discord';
    if (webhooks.length === 0) {
        return <p className="ext-notif-empty">No destinations yet. Add one below.</p>;
    }
    return (
        <table className="extensions-saved-table ext-notif-table">
            <thead>
                <tr><th>Type</th><th>URL</th><th>Enabled</th><th>Actions</th></tr>
            </thead>
            <tbody>
                {webhooks.map((w) => (
                    <tr key={w.id}>
                        <td>{typeLabel(w.type)}</td>
                        <td>
                            {w.url?.startsWith('http') ? (
                                <a href={w.url} target="_blank" rel="noopener noreferrer" className="extensions-saved-link">{w.url.length > 48 ? w.url.slice(0, 48) + '…' : w.url}</a>
                            ) : (
                                w.url || '—'
                            )}
                        </td>
                        <td>
                            <label className="ext-notif-checkbox-inline">
                                <input type="checkbox" checked={w.enabled !== false} onChange={(e) => onToggleEnabled(w.id, e.target.checked)} />
                                <span>{w.enabled ? 'On' : 'Off'}</span>
                            </label>
                        </td>
                        <td>
                            <button type="button" className="btn btn-sm extensions-table-btn extensions-table-btn-danger" onClick={() => onDelete(w.id)} title="Remove"><FiTrash2 /></button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** Thresholds table for notification: Metric | Level | Threshold | Node | Edit/Delete. */
function NotificationThresholdsTable({
    thresholds,
    onEdit,
    onDelete,
}: {
    thresholds: ThresholdRow[];
    onEdit: (index: number) => void;
    onDelete: (index: number) => void;
}) {
    const metricLabels: Record<string, string> = {
        dns_latency: 'DNS latency',
        rtt: 'RTT',
        node_system: 'Node CPU/memory %',
        sched_latency: 'Scheduling latency',
        disk_io: 'Disk I/O',
    };
    if (thresholds.length === 0) {
        return <p className="ext-notif-empty">No rules yet. Add one below and save.</p>;
    }
    return (
        <table className="extensions-saved-table ext-notif-table">
            <thead>
                <tr><th>Metric</th><th>Level</th><th>Threshold</th><th>Node</th><th>Actions</th></tr>
            </thead>
            <tbody>
                {thresholds.map((row, i) => (
                    <tr key={row.id}>
                        <td>{metricLabels[row.metric_type] || row.metric_type}</td>
                        <td>{row.level || '—'}</td>
                        <td>{row.threshold_value ?? '—'}</td>
                        <td>{row.node_name || '—'}</td>
                        <td>
                            <button type="button" className="btn btn-sm extensions-table-btn" onClick={() => onEdit(i)} title="Edit"><FiEdit2 /></button>
                            <button type="button" className="btn btn-sm extensions-table-btn extensions-table-btn-danger" onClick={() => onDelete(i)} title="Delete"><FiTrash2 /></button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function Extensions() {
    const { extensionName } = useParams<{ extensionName?: string }>();
    const navigate = useNavigate();
    const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelectedState] = useState<string | null>(null);
    const [config, setConfig] = useState<Record<string, unknown>>({});
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
    const [nodeNames, setNodeNames] = useState<string[]>([]);
    const [podsOnNode, setPodsOnNode] = useState<string[]>([]);
    const [editingThresholdIndex, setEditingThresholdIndex] = useState<number | null>(null);
    const [newThreshold, setNewThreshold] = useState<NewThresholdForm>({ metric_type: 'dns_latency', level: 'pod', threshold_value: 100, node_name: '' });
    const [newWebhookType, setNewWebhookType] = useState<'teams' | 'discord' | 'slack'>('teams');
    const [newWebhookUrl, setNewWebhookUrl] = useState('');

    const loadExtensions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.getExtensions();
            setExtensions(res.extensions || []);
            const list = res.extensions || [];
            if (list.length > 0) {
                const fromUrl = extensionName && list.some((e) => e.name === extensionName) ? extensionName : null;
                setSelectedState(fromUrl || list[0].name);
                if (!extensionName || !list.some((e) => e.name === extensionName)) {
                    navigate(`/extensions/${fromUrl || list[0].name}`, { replace: true });
                }
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load extensions');
        } finally {
            setLoading(false);
        }
    }, [extensionName, navigate]);

    const loadConfig = useCallback(async (name: string) => {
        try {
            const data = await api.getExtensionConfig(name);
            const c = data || {};
            if (name === 'notification') {
                const cc = c as Record<string, unknown>;
                // Migrate to webhooks[] + thresholds[] with ids
                if (!Array.isArray(cc.webhooks)) {
                    const wt = String(cc.webhook_type ?? 'discord').toLowerCase();
                    let url = '';
                    if (wt === 'teams') url = String(cc.webhook_url_teams ?? '').trim();
                    else if (wt === 'slack') url = String(cc.webhook_url_slack ?? '').trim();
                    else url = String(cc.webhook_url ?? '').trim();
                    cc.webhooks = url ? [{ id: genId(), type: wt as 'teams'|'discord'|'slack', url, enabled: true }] : [];
                }
                (cc.webhooks as WebhookRow[]).forEach((w) => { if (!w.id) w.id = genId(); if (w.enabled === undefined) w.enabled = true; });
                if (!Array.isArray(cc.thresholds)) {
                    cc.thresholds = [];
                    if (cc.metric_type != null || cc.threshold_value != null) {
                        cc.thresholds = [{
                            id: genId(),
                            metric_type: cc.metric_type ?? 'dns_latency',
                            level: cc.level ?? 'pod',
                            threshold_value: cc.threshold_value ?? 100,
                            node_name: cc.node_name ?? '',
                        }];
                    }
                }
                (cc.thresholds as ThresholdRow[]).forEach((t) => { if (!t.id) t.id = genId(); });
            }
            setConfig(c);
        } catch (e) {
            setConfig({});
        }
    }, []);

    useEffect(() => {
        loadExtensions();
    }, [loadExtensions]);

    useEffect(() => {
        if (extensionName && extensions.some((e) => e.name === extensionName)) {
            setSelectedState(extensionName);
        }
    }, [extensionName, extensions]);

    useEffect(() => {
        if (selected) {
            loadConfig(selected);
        } else {
            setConfig({});
        }
    }, [selected, loadConfig]);

    useEffect(() => {
        if (selected === 'notification') {
            api.getClusterTopology()
                .then((t) => setNodeNames((t?.nodes ?? []).map((n) => n.name).filter(Boolean)))
                .catch(() => setNodeNames([]));
        } else {
            setNodeNames([]);
            setPodsOnNode([]);
        }
    }, [selected]);

    const selectedNodeName = config.node_name != null ? String(config.node_name) : '';
    const nodeForPods = selected === 'notification' ? (newThreshold?.node_name || '') : selectedNodeName;
    useEffect(() => {
        if (selected !== 'notification') return;
        if (!nodeForPods) {
            setPodsOnNode([]);
            return;
        }
        api.getPodDetails()
            .then((res) => {
                const pods = res.pods || {};
                const list = Object.entries(pods)
                    .filter(([, p]) => (p as { node_name?: string }).node_name === nodeForPods)
                    .map(([key]) => key);
                setPodsOnNode(list);
            })
            .catch(() => setPodsOnNode([]));
    }, [selected, nodeForPods]);

    const handleSaveConfig = async () => {
        if (!selected || !ext) return;
        setSaving(true);
        setError(null);
        setSaveSuccess(null);
        let fullConfig: Record<string, unknown> = {};
        if (selected === 'notification') {
            fullConfig = {
                enabled: config.enabled !== false,
                interval_seconds: Number(config.interval_seconds) || 15,
                webhooks: Array.isArray(config.webhooks) ? config.webhooks : [],
                thresholds: Array.isArray(config.thresholds) ? config.thresholds : [],
            };
        } else {
            ext.inputs?.forEach((input) => {
                fullConfig[input.key] = config[input.key] ?? input.default;
            });
        }
        try {
            await api.setExtensionConfig(selected, fullConfig);
            setConfig(fullConfig);
            if (selected === 'notification') {
                await api.triggerNotificationExtension();
                const count = Array.isArray(fullConfig.webhooks) ? (fullConfig.webhooks as WebhookRow[]).filter((w) => w.enabled && w.url).length : 0;
                setSaveSuccess(count ? `Config saved. Alerts will be sent to ${count} destination(s) when rules are exceeded.` : 'Config saved.');
            } else {
                setSaveSuccess('Config saved.');
            }
            setTimeout(() => setSaveSuccess(null), 5000);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save config');
        } finally {
            setSaving(false);
        }
    };

    const updateConfig = (key: string, value: unknown) => {
        setConfig((prev) => ({ ...prev, [key]: value }));
    };

    const webhooksList = (selected === 'notification' && Array.isArray(config.webhooks) ? config.webhooks : []) as WebhookRow[];
    const thresholdsList = (selected === 'notification' && Array.isArray(config.thresholds) ? config.thresholds : []) as ThresholdRow[];

    const addWebhook = (type: 'teams' | 'discord' | 'slack', url: string) => {
        setConfig((prev) => ({
            ...prev,
            webhooks: [...(Array.isArray(prev.webhooks) ? prev.webhooks : []), { id: genId(), type, url: url.trim(), enabled: true }],
        }));
    };
    const deleteWebhook = (id: string) => {
        setConfig((prev) => ({
            ...prev,
            webhooks: (Array.isArray(prev.webhooks) ? prev.webhooks : []).filter((w: WebhookRow) => w.id !== id),
        }));
    };
    const setWebhookEnabled = (id: string, enabled: boolean) => {
        setConfig((prev) => ({
            ...prev,
            webhooks: (Array.isArray(prev.webhooks) ? prev.webhooks : []).map((w: WebhookRow) => (w.id === id ? { ...w, enabled } : w)),
        }));
    };

    const addThreshold = () => {
        setConfig((prev) => ({
            ...prev,
            thresholds: [...(Array.isArray(prev.thresholds) ? prev.thresholds : []), { id: genId(), ...newThreshold }],
        }));
        setNewThreshold({ metric_type: 'dns_latency', level: 'pod', threshold_value: 100, node_name: '' });
    };
    const updateThresholdAt = () => {
        if (editingThresholdIndex == null) return;
        setConfig((prev) => {
            const th = Array.isArray(prev.thresholds) ? [...prev.thresholds] : [];
            if (editingThresholdIndex >= 0 && editingThresholdIndex < th.length) th[editingThresholdIndex] = { ...th[editingThresholdIndex], ...newThreshold };
            return { ...prev, thresholds: th };
        });
        setEditingThresholdIndex(null);
        setNewThreshold({ metric_type: 'dns_latency', level: 'pod', threshold_value: 100, node_name: '' });
    };
    const deleteThresholdAt = (index: number) => {
        setConfig((prev) => {
            const th = Array.isArray(prev.thresholds) ? prev.thresholds : [];
            return { ...prev, thresholds: th.filter((_, i) => i !== index) };
        });
        if (editingThresholdIndex === index) setEditingThresholdIndex(null);
        else if (editingThresholdIndex != null && editingThresholdIndex > index) setEditingThresholdIndex(editingThresholdIndex - 1);
    };
    const startEditThreshold = (index: number) => {
        const row = thresholdsList[index];
        if (row) setNewThreshold({ metric_type: row.metric_type || 'dns_latency', level: row.level || 'pod', threshold_value: Number(row.threshold_value) || 100, node_name: row.node_name ?? '' });
        setEditingThresholdIndex(index);
    };

    const ext = extensions.find((e) => e.name === selected);
    const hasConfigEndpoint = selected === 'notification';

    return (
        <div className="page-container extensions-page">
            <div className="page-header extensions-header">
                <nav className="extensions-breadcrumb" aria-label="Breadcrumb">
                    <span className="extensions-breadcrumb-item">Extensions</span>
                    <FiChevronRight className="extensions-breadcrumb-sep" aria-hidden />
                    <span className="extensions-breadcrumb-item extensions-breadcrumb-current">
                        {ext ? (ext.label || ext.name) : (selected || '…')}
                    </span>
                </nav>
                <div className="page-title-section">
                    <h1 className="page-title extensions-title">{ext ? (ext.label || ext.name) : 'Extensions'}</h1>
                    {ext?.description && <p className="page-subtitle extensions-subtitle">{ext.description}</p>}
                </div>
            </div>

            <div className="page-content extensions-content">
                {loading && <div className="extensions-loading">Loading extensions…</div>}
                {error && <div className="error">{error}</div>}
                {saveSuccess && <div className="extensions-save-success">{saveSuccess}</div>}

                {!loading && !error && extensions.length === 0 && (
                    <div className="extensions-empty feature-card">
                        <p className="list-subtext">No extensions registered.</p>
                    </div>
                )}

                {!loading && !error && ext && (
                    <div className="extensions-detail feature-card extensions-detail-card">
                        {hasConfigEndpoint && ext.inputs && ext.inputs.length > 0 ? (
                                            hasConfigEndpoint ? (
                                                <>
                                                    <div className="ext-notif-global">
                                                        <label className="ext-notif-checkbox">
                                                            <input type="checkbox" checked={config.enabled !== false} onChange={(e) => updateConfig('enabled', e.target.checked)} />
                                                            <span>Enable notifications</span>
                                                        </label>
                                                        <div className="extensions-form-row ext-notif-interval">
                                                            <label>Check interval (seconds)</label>
                                                            <input type="number" min={5} value={Number(config.interval_seconds) || 15} onChange={(e) => updateConfig('interval_seconds', Number(e.target.value) || 15)} />
                                                        </div>
                                                    </div>
                                                    <section className="ext-notif-section">
                                                        <h3 className="ext-notif-section-title">Alert destinations</h3>
                                                        <p className="ext-notif-section-desc">When any rule below is exceeded, alerts are sent to all enabled destinations. Add multiple (e.g. Teams and Discord).</p>
                                                        <NotificationWebhooksTable webhooks={webhooksList} onDelete={deleteWebhook} onToggleEnabled={setWebhookEnabled} />
                                                        <div className="ext-notif-add-webhook">
                                                            <select value={newWebhookType} onChange={(e) => setNewWebhookType(e.target.value as 'teams'|'discord'|'slack')}>
                                                                <option value="teams">Microsoft Teams</option>
                                                                <option value="slack">Slack</option>
                                                                <option value="discord">Discord</option>
                                                            </select>
                                                            <input type="url" placeholder={newWebhookType === 'teams' ? 'Teams webhook URL' : newWebhookType === 'slack' ? 'Slack webhook URL' : 'Discord webhook URL'} value={newWebhookUrl} onChange={(e) => setNewWebhookUrl(e.target.value)} className="ext-notif-url-input" />
                                                            <button type="button" className="btn btn-primary" onClick={() => { if (newWebhookUrl.trim()) { addWebhook(newWebhookType, newWebhookUrl); setNewWebhookUrl(''); } }}><FiPlusCircle /> Add destination</button>
                                                        </div>
                                                    </section>
                                                    <section className="ext-notif-section">
                                                        <h3 className="ext-notif-section-title">Alert rules</h3>
                                                        <p className="ext-notif-section-desc">Define metric thresholds. When exceeded, alerts go to all destinations above.</p>
                                                        <NotificationThresholdsTable thresholds={thresholdsList} onEdit={startEditThreshold} onDelete={deleteThresholdAt} />
                                                        <div className="extensions-threshold-form ext-notif-add-threshold">
                                                        <div className="extensions-form-row">
                                                            <label>Metric</label>
                                                            <select
                                                                value={newThreshold.metric_type}
                                                                onChange={(e) => setNewThreshold((p) => ({ ...p, metric_type: e.target.value }))}
                                                            >
                                                                <option value="dns_latency">DNS latency (avg µs)</option>
                                                                <option value="rtt">RTT (avg µs)</option>
                                                                <option value="node_system">Node CPU / memory %</option>
                                                                <option value="sched_latency">Scheduling latency</option>
                                                                <option value="disk_io">Disk I/O</option>
                                                            </select>
                                                        </div>
                                                        <div className="extensions-form-row">
                                                            <label>Level</label>
                                                            <select value={newThreshold.level} onChange={(e) => setNewThreshold((p) => ({ ...p, level: e.target.value }))}>
                                                                <option value="node">Node</option>
                                                                <option value="pod">Pod</option>
                                                                <option value="container">Container</option>
                                                            </select>
                                                        </div>
                                                        <div className="extensions-form-row">
                                                            <label>Threshold value (exceed to alert)</label>
                                                            <input
                                                                type="number"
                                                                value={newThreshold.threshold_value}
                                                                onChange={(e) => setNewThreshold((p) => ({ ...p, threshold_value: Number(e.target.value) || 0 }))}
                                                            />
                                                        </div>
                                                        <div className="extensions-form-row">
                                                            <label>Node name (optional)</label>
                                                            <select
                                                                value={newThreshold.node_name || ''}
                                                                onChange={(e) => setNewThreshold((p) => ({ ...p, node_name: e.target.value || undefined }))}
                                                            >
                                                                <option value="">Current node</option>
                                                                {nodeNames.map((n) => (
                                                                    <option key={n} value={n}>{n}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div className="extensions-form-actions">
                                                            {editingThresholdIndex != null ? (
                                                                <>
                                                                    <button type="button" className="btn btn-primary" onClick={updateThresholdAt}>
                                                                        <FiEdit2 /> Update threshold
                                                                    </button>
                                                                    <button type="button" className="btn" onClick={() => { setEditingThresholdIndex(null); setNewThreshold({ metric_type: 'dns_latency', level: 'pod', threshold_value: 100, node_name: '' }); }}>
                                                                        Cancel
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <button type="button" className="btn btn-primary" onClick={addThreshold}>
                                                                    <FiPlusCircle /> Add threshold
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    </section>
                                                    <div className="ext-notif-save">
                                                        <button type="button" className="btn btn-primary" onClick={handleSaveConfig} disabled={saving}>
                                                            <FiSave /> {saving ? 'Saving…' : 'Save configuration'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="btn"
                                                            onClick={async () => {
                                                                try {
                                                                    setError(null);
                                                                    await api.sendTestNotification();
                                                                    setSaveSuccess('Test notification sent to all destinations. Check Discord/Teams/Slack.');
                                                                    setTimeout(() => setSaveSuccess(null), 5000);
                                                                } catch (e) {
                                                                    setError(e instanceof Error ? e.message : 'Test failed');
                                                                }
                                                            }}
                                                            title="Send a test message to all webhooks to verify they work"
                                                        >
                                                            Send test notification
                                                        </button>
                                                    </div>
                                                    {newThreshold.node_name && (
                                                        <div className="extensions-pods-on-node feature-card">
                                                            <h3>Pods on node &quot;{newThreshold.node_name}&quot;</h3>
                                                            {podsOnNode.length === 0 ? <p className="list-subtext">No pods on this node.</p> : <ul className="extensions-pods-list">{podsOnNode.map((key) => <li key={key}>{key}</li>)}</ul>}
                                                        </div>
                                                    )}
                                                    <NotificationMetricsPreview
                                                        metricType={newThreshold.metric_type}
                                                        level={newThreshold.level}
                                                        threshold={newThreshold.threshold_value ? Number(newThreshold.threshold_value) : undefined}
                                                        savedThreshold={thresholdsList[0]?.threshold_value != null ? Number(thresholdsList[0].threshold_value) : undefined}
                                                    />
                                                </>
                                            ) : (
                                                <SavedConfigSummary inputs={ext.inputs} config={config} summaryKeys={ext.summary_keys} />
                                            )
                        ) : (
                            (!ext.inputs || ext.inputs.length === 0) && (
                                <p className="list-subtext">No configuration options for this extension.</p>
                            )
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/** Saved configuration as editable tables: global settings + thresholds with Edit/Delete. */
function SavedConfigTable({
    config,
    thresholds,
    onEditThreshold,
    onDeleteThreshold,
    webhookTypeLabel,
}: {
    config: Record<string, unknown>;
    thresholds: ThresholdRow[];
    onEditThreshold: (index: number) => void;
    onDeleteThreshold: (index: number) => void;
    webhookTypeLabel: (t: string) => string;
}) {
    const wt = String(config.webhook_type ?? 'discord').toLowerCase();
    const urlKey = wt === 'teams' ? 'webhook_url_teams' : wt === 'slack' ? 'webhook_url_slack' : 'webhook_url';
    const webhookUrl = config[urlKey];
    const urlDisplay = webhookUrl == null || webhookUrl === '' ? '—' : String(webhookUrl);
    const metricLabels: Record<string, string> = {
        dns_latency: 'DNS latency',
        rtt: 'RTT',
        node_system: 'Node CPU/memory %',
        sched_latency: 'Scheduling latency',
        disk_io: 'Disk I/O',
    };
    return (
        <div className="extensions-saved-tables feature-card">
            <h3>Saved configuration</h3>
            <p className="list-subtext">Edit rows below or use the Add threshold section and Save to update.</p>
            <table className="extensions-saved-table extensions-saved-table-global">
                <thead>
                    <tr>
                        <th>Setting</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>Enabled</td><td>{config.enabled ? 'Yes' : 'No'}</td></tr>
                    <tr><td>Webhook type</td><td>{webhookTypeLabel(wt)}</td></tr>
                    <tr>
                        <td>Webhook URL (in use)</td>
                        <td>
                            {urlDisplay.startsWith('http') ? (
                                <a href={urlDisplay} target="_blank" rel="noopener noreferrer" className="extensions-saved-link">{urlDisplay.length > 50 ? urlDisplay.slice(0, 50) + '…' : urlDisplay}</a>
                            ) : (
                                urlDisplay
                            )}
                        </td>
                    </tr>
                    <tr><td>Interval (seconds)</td><td>{String(Number(config.interval_seconds) || 15)}</td></tr>
                </tbody>
            </table>
            <h4 className="extensions-saved-table-heading">Saved thresholds</h4>
            <table className="extensions-saved-table extensions-saved-table-thresholds">
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th>Level</th>
                        <th>Threshold</th>
                        <th>Node</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {thresholds.length === 0 ? (
                        <tr><td colSpan={5} className="extensions-saved-empty">No thresholds yet. Add one below and save.</td></tr>
                    ) : (
                        thresholds.map((row, i) => (
                            <tr key={i}>
                                <td>{metricLabels[row.metric_type] || row.metric_type}</td>
                                <td>{row.level || '—'}</td>
                                <td>{row.threshold_value ?? '—'}</td>
                                <td>{row.node_name || '—'}</td>
                                <td>
                                    <button type="button" className="btn btn-sm extensions-table-btn" onClick={() => onEditThreshold(i)} title="Edit"><FiEdit2 /></button>
                                    <button type="button" className="btn btn-sm extensions-table-btn extensions-table-btn-danger" onClick={() => onDeleteThreshold(i)} title="Delete"><FiTrash2 /></button>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

/** Displays saved configuration in an ordered list from ui.json summary_keys and config. */
function SavedConfigSummary({
    inputs,
    config,
    summaryKeys,
}: {
    inputs: ExtensionInput[];
    config: Record<string, unknown>;
    summaryKeys?: string[];
}) {
    const order = summaryKeys && summaryKeys.length > 0
        ? summaryKeys
        : ['webhook_type', 'threshold_value', 'metric_type', 'level', 'node_name', 'webhook_url', 'webhook_url_teams', 'webhook_url_slack'];
    const inputByKey = new Map(inputs.map((i) => [i.key, i]));
    const webhookType = String(config.webhook_type ?? 'discord').toLowerCase();
    const effectiveUrlKey = webhookType === 'teams' ? 'webhook_url_teams' : webhookType === 'slack' ? 'webhook_url_slack' : 'webhook_url';

    const isWrongUrlForField = (urlKey: string, val: string): boolean => {
        const v = val.toLowerCase();
        if (urlKey === 'webhook_url_teams' && v.includes('discord.com')) return true;
        if (urlKey === 'webhook_url_slack' && v.includes('discord.com')) return true;
        if (urlKey === 'webhook_url' && (v.includes('webhook.office') || v.includes('teams.microsoft'))) return true;
        return false;
    };

    const items = order
        .filter((key) => inputByKey.has(key))
        .map((key) => {
            const input = inputByKey.get(key)!;
            const isUrlField = key === 'webhook_url' || key === 'webhook_url_teams' || key === 'webhook_url_slack';
            let value = config[key] ?? input.default;
            let display = value == null || value === '' ? '—' : String(value);
            if (isUrlField && display !== '—' && isWrongUrlForField(key, display)) {
                display = '—';
            }
            const showAsLink = isUrlField && (display.startsWith('http://') || display.startsWith('https://'));
            const isActiveUrl = isUrlField && key === effectiveUrlKey;
            const urlEmptyButInUse = isUrlField && key === effectiveUrlKey && (display === '—' || !display.trim());
            return { label: input.label, key, value: display, showAsLink, isActiveUrl, urlEmptyButInUse };
        });

    if (items.length === 0) return null;
    return (
        <div className="extensions-saved-summary feature-card">
            <h3>Saved configuration</h3>
            <p className="list-subtext">Current saved values. Edit the form below and save to update.</p>
            <ol className="extensions-saved-list">
                {items.map(({ label, key, value, showAsLink, isActiveUrl, urlEmptyButInUse }) => (
                    <li key={key} className="extensions-saved-item">
                        <span className="extensions-saved-label">{label}</span>
                        <span className="extensions-saved-value">
                            {urlEmptyButInUse ? (
                                <span className="extensions-saved-missing">Not set – set in form below and save to send to {webhookType === 'teams' ? 'Teams' : webhookType === 'slack' ? 'Slack' : 'Discord'}</span>
                            ) : showAsLink ? (
                                <a href={value} target="_blank" rel="noopener noreferrer" className="extensions-saved-link">
                                    {value.length > 50 ? value.slice(0, 50) + '…' : value}
                                </a>
                            ) : (
                                value
                            )}
                            {isActiveUrl && !urlEmptyButInUse && <span className="extensions-saved-active"> (in use)</span>}
                        </span>
                    </li>
                ))}
            </ol>
        </div>
    );
}

/** Live metrics from Component 1 for the selected metric_type and level; helps user set threshold. */
function NotificationMetricsPreview({
    metricType,
    level,
    threshold,
    savedThreshold,
}: {
    metricType: string;
    level: string;
    threshold?: number;
    savedThreshold?: number;
}) {
    const [metrics, setMetrics] = useState<UnifiedMetricsResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        api.getUnifiedMetrics()
            .then((data) => {
                if (!cancelled) setMetrics(data);
            })
            .catch((e) => {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load metrics');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        const t = setInterval(() => {
            api.getUnifiedMetrics().then((data) => { if (!cancelled) setMetrics(data); }).catch(() => {});
        }, 8000);
        return () => { cancelled = true; clearInterval(t); };
    }, [metricType, level]);

    if (loading && !metrics) return <div className="extensions-metrics-preview">Loading current metrics…</div>;
    if (error) return <div className="extensions-metrics-preview error">{error}</div>;
    if (!metrics) return null;

    const rows: { key: string; label: string; value: number; unit: string }[] = [];
    const node = metrics.node || {};
    const pods = metrics.pods || {};
    const containers = metrics.containers || {};

    const add = (key: string, label: string, value: number, unit: string) => {
        if (Number.isFinite(value)) rows.push({ key, label, value, unit });
    };

    if (metricType === 'dns_latency') {
        const unit = 'µs';
        if (level === 'node') {
            const d = node.dns_latency as { avg_latency_ns?: number; total_events?: number; total_latency_ns?: number } | undefined;
            if (d && d.total_events) add('node', 'Node', (d.avg_latency_ns ?? (d.total_latency_ns! / d.total_events)) / 1000, unit);
        } else if (level === 'pod') {
            Object.entries(pods).forEach(([podKey, p]) => {
                const d = p?.dns_latency as { avg_latency_ns?: number; total_events?: number; total_latency_ns?: number } | undefined;
                if (d && d.total_events) add(podKey, podKey, (d.avg_latency_ns ?? (d.total_latency_ns! / d.total_events)) / 1000, unit);
            });
        } else {
            Object.entries(containers).forEach(([cKey, c]) => {
                const d = c?.dns_latency as { avg_latency_ns?: number; total_events?: number; total_latency_ns?: number } | undefined;
                if (d && d.total_events) add(cKey, cKey, (d.avg_latency_ns ?? (d.total_latency_ns! / d.total_events)) / 1000, unit);
            });
        }
    } else if (metricType === 'rtt') {
        const unit = 'µs';
        if (level === 'node') {
            const d = node.rtt as { avg_rtt_ns?: number; total_events?: number; total_rtt_ns?: number } | undefined;
            if (d && d.total_events) add('node', 'Node', (d.avg_rtt_ns ?? (d.total_rtt_ns! / d.total_events)) / 1000, unit);
        } else if (level === 'pod') {
            Object.entries(pods).forEach(([podKey, p]) => {
                const d = p?.rtt as { avg_rtt_ns?: number; total_events?: number; total_rtt_ns?: number } | undefined;
                if (d && d.total_events) add(podKey, podKey, (d.avg_rtt_ns ?? (d.total_rtt_ns! / d.total_events)) / 1000, unit);
            });
        } else {
            Object.entries(containers).forEach(([cKey, c]) => {
                const d = c?.tcp_metrics as { smoothed_rtt_us?: number; min_rtt_us?: number } | undefined;
                const v = d?.min_rtt_us ?? d?.smoothed_rtt_us;
                if (v != null) add(cKey, cKey, v, unit);
            });
        }
    } else if (metricType === 'node_system' && level === 'node') {
        const d = node.node_system as { cpu_usage_percent?: number; memory_usage_percent?: number } | undefined;
        if (d?.cpu_usage_percent != null) add('node_cpu', 'Node CPU %', d.cpu_usage_percent, '%');
        if (d?.memory_usage_percent != null) add('node_mem', 'Node memory %', d.memory_usage_percent, '%');
    } else if (metricType === 'sched_latency') {
        const unit = 'µs';
        if (level === 'node') {
            const d = node.sched_latency as { avg_runqueue_latency_us?: number } | undefined;
            if (d?.avg_runqueue_latency_us != null) add('node', 'Node', d.avg_runqueue_latency_us, unit);
        } else if (level === 'pod') {
            Object.entries(pods).forEach(([podKey, p]) => {
                const d = p?.sched_latency as { avg_runqueue_latency_us?: number } | undefined;
                if (d?.avg_runqueue_latency_us != null) add(podKey, podKey, d.avg_runqueue_latency_us, unit);
            });
        } else {
            Object.entries(containers).forEach(([cKey, c]) => {
                const d = c?.sched_latency as { avg_runqueue_latency_us?: number } | undefined;
                if (d?.avg_runqueue_latency_us != null) add(cKey, cKey, d.avg_runqueue_latency_us, unit);
            });
        }
    } else if (metricType === 'disk_io') {
        const unit = 'bytes';
        if (level === 'node') {
            let total = 0;
            Object.values(pods).forEach((p) => {
                const d = p?.disk_io as { total_read_bytes?: number; total_write_bytes?: number } | undefined;
                if (d) total += (d.total_read_bytes ?? 0) + (d.total_write_bytes ?? 0);
            });
            if (total > 0) add('node', 'Node (sum pods)', total, unit);
        } else if (level === 'pod') {
            Object.entries(pods).forEach(([podKey, p]) => {
                const d = p?.disk_io as { total_read_bytes?: number; total_write_bytes?: number } | undefined;
                if (d) add(podKey, podKey, (d.total_read_bytes ?? 0) + (d.total_write_bytes ?? 0), unit);
            });
        } else {
            Object.entries(containers).forEach(([cKey, c]) => {
                const d = c?.disk_io as { total_read_bytes?: number; total_write_bytes?: number } | undefined;
                if (d) add(cKey, cKey, (d.total_read_bytes ?? 0) + (d.total_write_bytes ?? 0), unit);
            });
        }
    }

    if (rows.length === 0) {
        return (
            <div className="extensions-metrics-preview feature-card">
                <h3><FiActivity className="extensions-metrics-icon" /> Current metrics (Component 1)</h3>
                <p className="list-subtext">No data yet for {metricType} at {level}. Metrics will appear as telemetry is collected.</p>
            </div>
        );
    }

    return (
        <div className="extensions-metrics-preview feature-card">
            <h3><FiActivity className="extensions-metrics-icon" /> Current metrics (Component 1)</h3>
            {savedThreshold != null && Number.isFinite(savedThreshold) && (
                <p className="extensions-saved-threshold">Saved threshold: <strong>{savedThreshold}</strong></p>
            )}
            <p className="list-subtext">Live values from the daemon. Alerts (with Node + Pod name) are sent when a value exceeds the saved threshold.</p>
            <table className="extensions-metrics-table">
                <thead>
                    <tr>
                        <th>Source</th>
                        <th>Value</th>
                        {threshold != null && <th>Status</th>}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.key}>
                            <td>{r.label}</td>
                            <td>{typeof r.value === 'number' && r.value % 1 !== 0 ? r.value.toFixed(2) : r.value} {r.unit}</td>
                            {threshold != null && (
                                <td>
                                    {r.value >= threshold ? (
                                        <span className="extensions-metrics-over">Above threshold</span>
                                    ) : (
                                        <span className="extensions-metrics-ok">OK</span>
                                    )}
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ExtensionInputField({
    input,
    value,
    onChange,
    nodeNames,
}: {
    input: ExtensionInput;
    value: unknown;
    onChange: (v: unknown) => void;
    nodeNames?: string[];
}) {
    const id = `ext-input-${input.key}`;
    if (input.key === 'node_name' && nodeNames && nodeNames.length > 0) {
        return (
            <div className="extensions-form-row">
                <label htmlFor={id}>{input.label}</label>
                <select
                    id={id}
                    value={String(value ?? '')}
                    onChange={(e) => onChange(e.target.value)}
                >
                    <option value="">Current node</option>
                    {nodeNames.map((n) => (
                        <option key={n} value={n}>{n}</option>
                    ))}
                </select>
            </div>
        );
    }
    if (input.type === 'boolean') {
        return (
            <label className="extensions-form-row extensions-form-row-checkbox">
                <input
                    id={id}
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => onChange(e.target.checked)}
                />
                <span>{input.label}</span>
            </label>
        );
    }
    if (input.type === 'select') {
        const raw = String(value ?? input.default ?? '');
        const matched = input.options?.find((o) => String(o.value).toLowerCase() === raw.toLowerCase());
        const selectValue = matched ? matched.value : (input.options?.[0]?.value ?? '');
        return (
            <div className="extensions-form-row">
                <label htmlFor={id}>{input.label}</label>
                <select
                    id={id}
                    value={selectValue}
                    onChange={(e) => onChange(e.target.value)}
                >
                    {input.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>
            </div>
        );
    }
    if (input.type === 'number') {
        return (
            <div className="extensions-form-row">
                <label htmlFor={id}>{input.label}</label>
                <input
                    id={id}
                    type="number"
                    value={value != null ? Number(value) : ''}
                    onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                />
            </div>
        );
    }
    return (
        <div className="extensions-form-row">
            <label htmlFor={id}>{input.label}</label>
            <input
                id={id}
                type="text"
                value={value != null ? String(value) : ''}
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
}
