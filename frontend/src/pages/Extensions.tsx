import './Page.css';
import './NotificationsAlerts.css';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type ExtensionInfo, type ExtensionInput } from '../services/api';
import { useUnifiedMetricsFromWebSocket } from '../hooks/useMetrics';
import { FiSave, FiPlusCircle, FiEdit2, FiTrash2, FiChevronRight, FiActivity, FiSend, FiSliders, FiInfo, FiMail, FiEye, FiEyeOff, FiCopy } from 'react-icons/fi';
import { SiDiscord, SiSlack } from 'react-icons/si';
import { FiMessageCircle } from 'react-icons/fi';

export type WebhookRow = { id: string; type: 'teams' | 'discord' | 'slack'; url: string; enabled: boolean };
export type ThresholdRow = { id: string; metric_type: string; level: string; threshold_value: number; node_name?: string; pod_name?: string };

/** Form state for adding/editing a threshold (no id until saved). */
type NewThresholdForm = Omit<ThresholdRow, 'id'> & { node_name?: string; pod_name?: string };

function genId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Email validation (aligned with backend expectation: valid address format). */
function isValidEmail(value: string): boolean {
    const s = value.trim();
    if (!s) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Webhooks table for notification: Type | URL | Enabled | Actions (Edit / Delete). */
function NotificationWebhooksTable({
    webhooks,
    onEdit,
    onDelete,
    onToggleEnabled,
}: {
    webhooks: WebhookRow[];
    onEdit: (w: WebhookRow) => void;
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
                        <td><span className={`ext-webhook-pill ext-webhook-pill-${w.type}`}>{typeLabel(w.type)}</span></td>
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
                            <button type="button" className="btn btn-sm extensions-table-btn" onClick={() => onEdit(w)} title="Edit"><FiEdit2 /></button>
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
                <tr><th>Metric</th><th>Level</th><th>Threshold</th><th>Node</th><th>Pod</th><th>Actions</th></tr>
            </thead>
            <tbody>
                {thresholds.map((row, i) => (
                    <tr key={row.id}>
                        <td>{metricLabels[row.metric_type] || row.metric_type}</td>
                        <td>{row.level || '—'}</td>
                        <td>{row.threshold_value ?? '—'}</td>
                        <td>{row.node_name || '—'}</td>
                        <td>{row.pod_name || '—'}</td>
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
    const [editingThresholdIndex, setEditingThresholdIndex] = useState<number | null>(null);
    const [newThreshold, setNewThreshold] = useState<NewThresholdForm>({ metric_type: 'dns_latency', level: 'pod', threshold_value: 100, node_name: '', pod_name: '' });
    // Cluster-wide: same WebSocket as Dashboard for all nodes; per-threshold node (or any) saved to MongoDB
    const nodeKeyForPods = selected === 'notification' && newThreshold?.node_name ? newThreshold.node_name : undefined;
    const { availableNodes: wsNodes } = useUnifiedMetricsFromWebSocket(nodeKeyForPods ?? undefined);
    const [newWebhookType, setNewWebhookType] = useState<'teams' | 'discord' | 'slack'>('teams');
    const [newWebhookUrl, setNewWebhookUrl] = useState('');
    const [editingWebhookId, setEditingWebhookId] = useState<string | null>(null);
    const [editingEmail, setEditingEmail] = useState(false);
    const [newEmailTo, setNewEmailTo] = useState('');
    const [emailSectionCollapsed, setEmailSectionCollapsed] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [addChannelOpen, setAddChannelOpen] = useState(false);
    const [showAddWebhookForm, setShowAddWebhookForm] = useState(false);
    const addChannelRef = useRef<HTMLDivElement>(null);

    const emailToList = (String(config.email_to ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)) as string[];
    const updateEmailToList = (list: string[]) => updateConfig('email_to', list.join(', '));
    const addEmailToRecipient = () => {
        const v = newEmailTo.trim();
        if (!v) return;
        updateEmailToList([...emailToList, v]);
        setNewEmailTo('');
    };
    const removeEmailToRecipient = (index: number) => updateEmailToList(emailToList.filter((_, i) => i !== index));
    const updateEmailToRecipient = (index: number, value: string) => {
        const next = [...emailToList];
        next[index] = value;
        updateEmailToList(next);
    };

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
                // Migrate to webhooks[] + thresholds[] with ids; ensure webhooks is always an array
                const rawWebhooks = cc.webhooks;
                if (!Array.isArray(rawWebhooks)) {
                    const wt = String(cc.webhook_type ?? 'discord').toLowerCase();
                    let url = '';
                    if (wt === 'teams') url = String(cc.webhook_url_teams ?? '').trim();
                    else if (wt === 'slack') url = String(cc.webhook_url_slack ?? '').trim();
                    else url = String(cc.webhook_url ?? '').trim();
                    cc.webhooks = url ? [{ id: genId(), type: wt as 'teams'|'discord'|'slack', url, enabled: true }] : [];
                }
                cc.webhooks = Array.isArray(cc.webhooks) ? cc.webhooks : [];
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
                            pod_name: cc.pod_name ?? '',
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
        if (!addChannelOpen) return;
        const onOutside = (e: MouseEvent) => {
            if (addChannelRef.current && !addChannelRef.current.contains(e.target as Node)) setAddChannelOpen(false);
        };
        document.addEventListener('click', onOutside, true);
        return () => document.removeEventListener('click', onOutside, true);
    }, [addChannelOpen]);

    // Keep dropdown closed when add/edit form is visible to avoid overlap (e.g. "Editing destination" over dropdown)
    useEffect(() => {
        if (editingWebhookId || showAddWebhookForm) setAddChannelOpen(false);
    }, [editingWebhookId, showAddWebhookForm]);

    // Node list: same WebSocket as Dashboard (cluster-wide); fallback to cluster topology when WS has no nodes yet
    const nodeOptions = wsNodes.length > 0
        ? wsNodes
        : nodeNames.map((name) => ({ key: name, name }));
    useEffect(() => {
        if (selected === 'notification' && wsNodes.length === 0) {
            api.getClusterTopology()
                .then((t) => setNodeNames((t?.nodes ?? []).map((n) => n.name).filter(Boolean)))
                .catch(() => setNodeNames([]));
        } else if (selected !== 'notification') {
            setNodeNames([]);
        }
    }, [selected, wsNodes.length]);

    const { podsOnSelectedNode } = useUnifiedMetricsFromWebSocket(nodeKeyForPods ?? undefined);
    const podsForNode = selected === 'notification' && nodeKeyForPods ? podsOnSelectedNode : [];

    const handleSaveConfig = async () => {
        if (!selected || !ext) return;
        setSaving(true);
        setError(null);
        setSaveSuccess(null);
        let fullConfig: Record<string, unknown> = {};
        if (selected === 'notification') {
            // Cluster-wide: thresholds saved to MongoDB with node_name per rule (empty = any node); daemons evaluate and alert when any threshold exceeded on any node
            fullConfig = {
                enabled: config.enabled !== false,
                interval_seconds: Number(config.interval_seconds) || 15,
                webhooks: Array.isArray(config.webhooks) ? config.webhooks : [],
                thresholds: Array.isArray(config.thresholds) ? config.thresholds : [],
                email_enabled: config.email_enabled === true,
                smtp_host: String(config.smtp_host ?? '').trim(),
                smtp_port: Number(config.smtp_port) || 587,
                smtp_use_tls: config.smtp_use_tls !== false,
                smtp_username: String(config.smtp_username ?? '').trim(),
                smtp_password: String(config.smtp_password ?? '').trim(),
                email_from: String(config.email_from ?? '').trim(),
                email_to: String(config.email_to ?? '').trim(),
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
                setEditingEmail(false);
                setEditingWebhookId(null);
                setNewWebhookUrl('');
                await api.triggerNotificationExtension();
                setSaveSuccess('Configuration saved.');
            } else {
                setSaveSuccess('Configuration saved.');
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
    const updateWebhook = (id: string, type: 'teams' | 'discord' | 'slack', url: string) => {
        setConfig((prev) => ({
            ...prev,
            webhooks: (Array.isArray(prev.webhooks) ? prev.webhooks : []).map((w: WebhookRow) =>
                w.id === id ? { ...w, type, url: url.trim() } : w
            ),
        }));
        setEditingWebhookId(null);
        setNewWebhookType('discord');
        setNewWebhookUrl('');
    };
    const startEditWebhook = (w: WebhookRow) => {
        setAddChannelOpen(false);
        setNewWebhookType(w.type);
        setNewWebhookUrl(w.url || '');
        setEditingWebhookId(w.id);
        setShowAddWebhookForm(true);
    };

    const addThreshold = () => {
        setConfig((prev) => ({
            ...prev,
            thresholds: [...(Array.isArray(prev.thresholds) ? prev.thresholds : []), { id: genId(), ...newThreshold }],
        }));
        setNewThreshold({ metric_type: 'dns_latency', level: 'pod', threshold_value: 100, node_name: '', pod_name: '' });
    };
    const updateThresholdAt = () => {
        if (editingThresholdIndex == null) return;
        setConfig((prev) => {
            const th = Array.isArray(prev.thresholds) ? [...prev.thresholds] : [];
            if (editingThresholdIndex >= 0 && editingThresholdIndex < th.length) th[editingThresholdIndex] = { ...th[editingThresholdIndex], ...newThreshold };
            return { ...prev, thresholds: th };
        });
        setEditingThresholdIndex(null);
        setNewThreshold({ metric_type: 'dns_latency', level: 'pod', threshold_value: 100, node_name: '', pod_name: '' });
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
        if (row) setNewThreshold({ metric_type: row.metric_type || 'dns_latency', level: row.level || 'pod', threshold_value: Number(row.threshold_value) || 100, node_name: row.node_name ?? '', pod_name: row.pod_name ?? '' });
        setEditingThresholdIndex(index);
    };

    const ext = extensions.find((e) => e.name === selected);
    const hasConfigEndpoint = selected === 'notification';

    return (
        <div className={`page-container extensions-page ${selected === 'notification' ? 'notif-alerts-fullwidth' : ''}`}>
            <div className="page-header extensions-header">
                <nav className="extensions-breadcrumb" aria-label="Breadcrumb">
                    <span className="extensions-breadcrumb-item">Extensions</span>
                    <FiChevronRight className="extensions-breadcrumb-sep" aria-hidden />
                    <span className="extensions-breadcrumb-item extensions-breadcrumb-current">
                        {ext ? (ext.label || ext.name) : (selected || '…')}
                    </span>
                </nav>
                <div className="page-title-section">
                    <h1 className="page-title extensions-title">
                        {selected === 'notification' ? 'Notification Alerts' : (ext ? (ext.label || ext.name) : 'Extensions')}
                    </h1>
                    {selected !== 'notification' && ext?.description && <p className="page-subtitle extensions-subtitle">{ext.description}</p>}
                </div>
            </div>

            <div className={`page-content extensions-content ${selected === 'notification' ? 'notif-alerts-page' : ''}`}>
                {loading && <div className="extensions-loading">Loading extensions…</div>}
                {error && <div className="error">{error}</div>}
                {saveSuccess && (
                    <div className="extensions-save-success-popup" role="alert" aria-live="polite">
                        <div className="extensions-save-success-popup-inner">
                            <span className="extensions-save-success-popup-icon">✓</span>
                            <span>{saveSuccess}</span>
                        </div>
                    </div>
                )}

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
                                                    {/* 1️⃣ Enable / interval */}
                                                    <div className="na-card">
                                                        <div className="na-engine-row">
                                                            <div className="na-toggle-wrap">
                                                                <div className={`na-toggle ${config.enabled !== false ? 'on' : ''}`} role="switch" aria-checked={config.enabled !== false} tabIndex={0} onClick={() => updateConfig('enabled', !(config.enabled !== false))} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); updateConfig('enabled', !(config.enabled !== false)); } }}><div className="na-toggle-thumb" /></div>
                                                                <span className="ext-notif-toggle-text">Enable Notifications</span>
                                                            </div>
                                                            <div className="na-interval">
                                                                <label htmlFor="na-interval-input">Check interval</label>
                                                                <input id="na-interval-input" type="number" min={5} value={Number(config.interval_seconds) || 15} onChange={(e) => updateConfig('interval_seconds', Number(e.target.value) || 15)} />
                                                                <span className="na-interval-unit">seconds</span>
                                                            </div>
                                                        </div>
                                                        <div className="na-engine-actions">
                                                            <button type="button" className="btn btn-primary" onClick={handleSaveConfig} disabled={saving}><FiSave /> {saving ? 'Saving…' : 'Save Configuration'}</button>
                                                        </div>
                                                    </div>

                                                    {/* 2️⃣ Alert Channels */}
                                                    <div className="na-card">
                                                        <h2 className="na-card-title"><FiSend className="na-card-icon" aria-hidden /> Alert Channels</h2>
                                                        <p className="na-card-desc">Configure where alerts are sent.</p>
                                                        <div className="na-channels-grid">
                                                            {webhooksList.map((w) => {
                                                                const ChanIcon = w.type === 'discord' ? SiDiscord : w.type === 'slack' ? SiSlack : FiMessageCircle;
                                                                const name = w.type === 'discord' ? 'Discord' : w.type === 'slack' ? 'Slack' : 'Microsoft Teams';
                                                                return (
                                                                    <div key={w.id} className="na-channel-card">
                                                                        <div className="na-channel-header">
                                                                            <ChanIcon className="na-channel-icon" style={{ color: w.type === 'discord' ? '#5865F2' : w.type === 'slack' ? '#E01E5A' : '#6264A7' }} aria-hidden />
                                                                            <span className="na-channel-name">{name}</span>
                                                                        </div>
                                                                        <div className="na-channel-url-row">
                                                                            <span className="na-channel-url" title={w.url}>{w.url ? (w.url.length > 40 ? w.url.slice(0, 40) + '…' : w.url) : '—'}</span>
                                                                            {w.url && (
                                                                                <button type="button" className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(w.url); }} title="Copy URL"><FiCopy /></button>
                                                                            )}
                                                                        </div>
                                                                        <div className="na-channel-enable-row">
                                                                            <label className="na-channel-enable-label">
                                                                                <span className="na-toggle-wrap-inline">
                                                                                    <div className={`na-toggle na-toggle-sm ${w.enabled !== false ? 'on' : ''}`} role="switch" aria-checked={w.enabled !== false} tabIndex={0} onClick={() => setWebhookEnabled(w.id, !(w.enabled !== false))} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWebhookEnabled(w.id, !(w.enabled !== false)); } }}><div className="na-toggle-thumb" /></div>
                                                                                </span>
                                                                                <span className="na-channel-enable-text">{w.enabled !== false ? 'Enabled' : 'Disabled'}</span>
                                                                            </label>
                                                                        </div>
                                                                        <div className="na-channel-actions">
                                                                            <button type="button" className="btn btn-sm btn-muted" onClick={() => startEditWebhook(w)}>Edit</button>
                                                                            <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteWebhook(w.id)}>Delete</button>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                            {config.email_enabled === true && (String(config.smtp_host ?? '').trim() !== '' || String(config.email_to ?? '').trim() !== '') && (
                                                                <div className="na-channel-card">
                                                                    <div className="na-channel-header">
                                                                        <FiMail className="na-channel-icon" style={{ color: '#60a5fa' }} aria-hidden />
                                                                        <span className="na-channel-name">Email</span>
                                                                    </div>
                                                                    <div className="na-channel-url">{String(config.smtp_host || '—')} · SMTP configured</div>
                                                                    <div className="na-channel-status active"><span className="na-channel-status-dot" />Active</div>
                                                                    <div className="na-channel-actions">
                                                                        <button type="button" className="btn btn-sm btn-muted" onClick={() => setEditingEmail(true)}>Edit</button>
                                                                        <button type="button" className="btn btn-sm btn-muted" onClick={() => setEmailSectionCollapsed(false)}>Edit SMTP</button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="na-add-channel-wrap" ref={addChannelRef}>
                                                            <button type="button" className="btn btn-primary" onClick={() => setAddChannelOpen((o) => !o)}><FiPlusCircle /> Add Channel</button>
                                                            {addChannelOpen && (
                                                                <div className="na-add-channel-dropdown">
                                                                    <button type="button" className="btn btn-sm btn-muted" onClick={() => { setNewWebhookType('discord'); setAddChannelOpen(false); setShowAddWebhookForm(true); }}><SiDiscord style={{ color: '#5865F2' }} /> Discord</button>
                                                                    <button type="button" className="btn btn-sm btn-muted" onClick={() => { setNewWebhookType('slack'); setAddChannelOpen(false); setShowAddWebhookForm(true); }}><SiSlack style={{ color: '#E01E5A' }} /> Slack</button>
                                                                    <button type="button" className="btn btn-sm btn-muted" onClick={() => { setNewWebhookType('teams'); setAddChannelOpen(false); setShowAddWebhookForm(true); }}><FiMessageCircle style={{ color: '#6264A7' }} /> Microsoft Teams</button>
                                                                    <button type="button" className="btn btn-sm btn-muted" onClick={() => { setEditingEmail(true); setEmailSectionCollapsed(false); setAddChannelOpen(false); }}><FiMail /> Email (SMTP)</button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        {(editingWebhookId || showAddWebhookForm) && (
                                                            <div className="ext-notif-add-webhook" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                                                {editingWebhookId && <span className="ext-notif-editing-badge">Editing destination</span>}
                                                                <select value={newWebhookType} onChange={(e) => { setNewWebhookType(e.target.value as 'teams'|'discord'|'slack'); if (!editingWebhookId) setNewWebhookUrl(''); }}>
                                                                    <option value="discord">Discord</option>
                                                                    <option value="teams">Microsoft Teams</option>
                                                                    <option value="slack">Slack</option>
                                                                </select>
                                                                <div className="ext-notif-url-wrap">
                                                                    <input type="url" placeholder={newWebhookType === 'teams' ? 'https://xxxx.webhook.office.com/…' : newWebhookType === 'slack' ? 'https://hooks.slack.com/…' : 'https://discord.com/api/webhooks/…'} value={newWebhookUrl} onChange={(e) => setNewWebhookUrl(e.target.value)} className="ext-notif-url-input" />
                                                                </div>
                                                                {editingWebhookId ? (
                                                                    <><button type="button" className="btn btn-primary" style={{ marginRight: '0.5rem' }} onClick={() => { if (newWebhookUrl.trim() && editingWebhookId) { updateWebhook(editingWebhookId, newWebhookType, newWebhookUrl); setAddChannelOpen(false); } }}><FiEdit2 /> Update</button><button type="button" className="btn btn-muted" onClick={() => { setEditingWebhookId(null); setNewWebhookType('discord'); setNewWebhookUrl(''); setAddChannelOpen(false); }}>Cancel</button></>
                                                                ) : (
                                                                    <><button type="button" className="btn btn-primary" style={{ marginRight: '0.5rem' }} onClick={() => { if (newWebhookUrl.trim()) { addWebhook(newWebhookType, newWebhookUrl); setNewWebhookUrl(''); setShowAddWebhookForm(false); } }}><FiPlusCircle /> Add destination</button><button type="button" className="btn btn-muted" onClick={() => { setShowAddWebhookForm(false); setNewWebhookUrl(''); }}>Cancel</button></>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* 3️⃣ Email SMTP Settings (collapsible) */}
                                                    <div className="na-card">
                                                        <div className={`na-email-collapse ${emailSectionCollapsed ? '' : 'open'}`}>
                                                            <div className="na-email-collapse-header" onClick={() => setEmailSectionCollapsed((c) => !c)}>
                                                                <h2 className="na-card-title"><FiMail className="na-card-icon" aria-hidden /> Email SMTP Settings</h2>
                                                                <FiChevronRight className="na-email-collapse-chevron" aria-hidden />
                                                            </div>
                                                        <label className="ext-notif-checkbox" style={{ marginBottom: '0.5rem' }}>
                                                            <input type="checkbox" checked={config.email_enabled === true} onChange={(e) => { updateConfig('email_enabled', e.target.checked); if (!e.target.checked) setEditingEmail(false); }} />
                                                            <span>Enable email alerts</span>
                                                        </label>
                                                        {!emailSectionCollapsed && (
                                                        <>
                                                        {/* Saved email summary: ordered card when configured and not editing */}
                                                        {config.email_enabled === true && String(config.smtp_host ?? '').trim() !== '' && String(config.email_to ?? '').trim() !== '' && !editingEmail && (
                                                            <div className="ext-notif-email-summary">
                                                                <div className="ext-notif-email-summary-grid">
                                                                    <div className="ext-notif-email-summary-item">
                                                                        <span className="ext-notif-email-summary-label">Server</span>
                                                                        <span className="ext-notif-email-summary-value">{String(config.smtp_host)}:{Number(config.smtp_port) || 587}</span>
                                                                    </div>
                                                                    <div className="ext-notif-email-summary-item">
                                                                        <span className="ext-notif-email-summary-label">From</span>
                                                                        <span className="ext-notif-email-summary-value">{String(config.email_from || '—')}</span>
                                                                    </div>
                                                                    <div className="ext-notif-email-summary-item ext-notif-email-summary-to">
                                                                        <span className="ext-notif-email-summary-label">To</span>
                                                                        <div className="ext-notif-email-summary-to-list">
                                                                            {emailToList.map((addr, i) => (
                                                                                <span key={i} className="ext-notif-email-chip">{addr}</span>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="ext-notif-email-summary-actions">
                                                                    <button type="button" className="btn btn-primary" onClick={() => { setEditingEmail(true); setEmailSectionCollapsed(false); }}><FiEdit2 /> Edit email settings</button>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {/* Email form: when enabled and (editing or no saved config yet) */}
                                                        {config.email_enabled === true && (editingEmail || String(config.smtp_host ?? '').trim() === '' || String(config.email_to ?? '').trim() === '') && (
                                                            <div className="ext-notif-email-form na-email-form-compact">
                                                                <div className="ext-notif-email-form-block">
                                                                    <h4 className="ext-notif-email-form-block-title">Server</h4>
                                                                    <div className="ext-notif-email-grid">
                                                                        <div className="extensions-form-row">
                                                                            <label>SMTP host</label>
                                                                            <input type="text" placeholder="smtp.gmail.com" value={String(config.smtp_host ?? '')} onChange={(e) => updateConfig('smtp_host', e.target.value)} className="ext-notif-url-input" />
                                                                            <span className="ext-notif-hint"><FiInfo className="ext-notif-hint-icon" aria-hidden />e.g. smtp.gmail.com, smtp.office365.com</span>
                                                                        </div>
                                                                        <div className="extensions-form-row">
                                                                            <label>Port</label>
                                                                            <input type="number" min={1} max={65535} value={Number(config.smtp_port) || 587} onChange={(e) => updateConfig('smtp_port', Number(e.target.value) || 587)} />
                                                                            <span className="ext-notif-hint"><FiInfo className="ext-notif-hint-icon" aria-hidden />587 (STARTTLS) or 465 (TLS).</span>
                                                                        </div>
                                                                        <div className="extensions-form-row ext-notif-checkbox-row ext-rule-full">
                                                                            <label className="ext-notif-checkbox">
                                                                                <input type="checkbox" checked={config.smtp_use_tls !== false} onChange={(e) => updateConfig('smtp_use_tls', e.target.checked)} />
                                                                                <span>Use TLS / STARTTLS</span>
                                                                            </label>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="ext-notif-email-form-block">
                                                                    <h4 className="ext-notif-email-form-block-title">Authentication</h4>
                                                                    <div className="ext-notif-email-grid">
                                                                        <div className="extensions-form-row">
                                                                            <label>Username <span className="ext-notif-optional-badge">optional</span></label>
                                                                            <input type="text" placeholder="Leave empty if no auth" value={String(config.smtp_username ?? '')} onChange={(e) => updateConfig('smtp_username', e.target.value)} className="ext-notif-url-input" autoComplete="off" />
                                                                        </div>
                                                                        <div className="extensions-form-row">
                                                                            <label>Password <span className="ext-notif-optional-badge">optional</span></label>
                                                                            <div className="na-password-wrap">
                                                                                <input type={showPassword ? 'text' : 'password'} placeholder="App password for Gmail/2FA" value={String(config.smtp_password ?? '')} onChange={(e) => updateConfig('smtp_password', e.target.value)} className="ext-notif-url-input" autoComplete="off" />
                                                                                <button type="button" className="na-password-toggle" onClick={() => setShowPassword((p) => !p)} title={showPassword ? 'Hide password' : 'Show password'} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}</button>
                                                                            </div>
                                                                            <span className="ext-notif-hint"><FiInfo className="ext-notif-hint-icon" aria-hidden />Use an app password for Gmail or 2FA accounts.</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="ext-notif-email-form-block">
                                                                    <h4 className="ext-notif-email-form-block-title">Recipients</h4>
                                                                    <div className="ext-notif-email-grid">
                                                                        <div className="extensions-form-row ext-rule-full">
                                                                            <label>From address</label>
                                                                            <input type="email" placeholder="alerts@example.com" value={String(config.email_from ?? '')} onChange={(e) => updateConfig('email_from', e.target.value)} className={`ext-notif-url-input ${String(config.email_from ?? '').trim() && !isValidEmail(String(config.email_from ?? '')) ? 'ext-notif-input-invalid' : ''}`} />
                                                                            {String(config.email_from ?? '').trim() && !isValidEmail(String(config.email_from ?? '')) && (
                                                                                <span className="ext-notif-validation-err">Enter a valid email address (e.g. user@gmail.com)</span>
                                                                            )}
                                                                        </div>
                                                                        <div className="extensions-form-row ext-rule-full">
                                                                            <label>To addresses</label>
                                                                            <div className="ext-notif-email-to-list">
                                                                                {emailToList.map((addr, i) => (
                                                                                    <div key={i} className="ext-notif-email-to-row">
                                                                                        <div className="ext-notif-email-to-cell">
                                                                                            <input type="email" placeholder="email@example.com" value={addr} onChange={(e) => updateEmailToRecipient(i, e.target.value)} className={`ext-notif-url-input ${addr.trim() && !isValidEmail(addr) ? 'ext-notif-input-invalid' : ''}`} />
                                                                                            {addr.trim() && !isValidEmail(addr) && <span className="ext-notif-validation-err">Invalid email</span>}
                                                                                        </div>
                                                                                        <button type="button" className="btn btn-sm extensions-table-btn extensions-table-btn-danger" onClick={() => removeEmailToRecipient(i)} title="Remove"><FiTrash2 /></button>
                                                                                    </div>
                                                                                ))}
                                                                                <div className="ext-notif-email-to-row ext-notif-email-to-add">
                                                                                    <div className="ext-notif-email-to-cell">
                                                                                        <input type="email" placeholder="Add recipient…" value={newEmailTo} onChange={(e) => setNewEmailTo(e.target.value)} className={`ext-notif-url-input ${newEmailTo.trim() && !isValidEmail(newEmailTo) ? 'ext-notif-input-invalid' : ''}`} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addEmailToRecipient())} />
                                                                                        {newEmailTo.trim() && !isValidEmail(newEmailTo) && <span className="ext-notif-validation-err">Enter a valid email (e.g. user@gmail.com)</span>}
                                                                                    </div>
                                                                                    <button type="button" className="btn btn-primary btn-sm" onClick={addEmailToRecipient} disabled={!newEmailTo.trim() || !isValidEmail(newEmailTo)} title="Add recipient"><FiPlusCircle /> Add</button>
                                                                                </div>
                                                                            </div>
                                                                            <span className="ext-notif-hint"><FiInfo className="ext-notif-hint-icon" aria-hidden />Alerts are sent to all listed addresses.</span>
                                                                        </div>
                                                                        <div className="ext-notif-email-actions ext-rule-full">
                                                                            {editingEmail && (
                                                                                <>
                                                                                    <button type="button" className="btn btn-primary" onClick={handleSaveConfig} disabled={saving}>
                                                                                        <FiSave /> {saving ? 'Saving…' : 'Save configuration'}
                                                                                    </button>
                                                                                    {String(config.smtp_host ?? '').trim() !== '' && emailToList.length > 0 && (
                                                                                        <button type="button" className="btn btn-muted" onClick={() => setEditingEmail(false)}>Cancel</button>
                                                                                    )}
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                        <p className="na-email-hint">Gmail requires an App Password when 2-factor authentication is enabled.</p>
                                                        </>
                                                        )}
                                                        </div>
                                                    </div>

                                                    {/* 4️⃣ Alert Rules */}
                                                    <div className="na-card">
                                                        <div className="na-rules-header">
                                                            <h2 className="na-card-title"><FiSliders className="na-card-icon" aria-hidden /> Alert Rules</h2>
                                                            <span className="na-rule-count-badge">{thresholdsList.length} rule{thresholdsList.length !== 1 ? 's' : ''}</span>
                                                        </div>
                                                        <table className="na-rules-table">
                                                            <thead>
                                                                <tr>
                                                                    <th>Metric</th>
                                                                    <th>Scope</th>
                                                                    <th>Threshold</th>
                                                                    <th>Node Filter</th>
                                                                    <th>Pod Filter</th>
                                                                    <th>Actions</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {thresholdsList.length === 0 ? (
                                                                    <tr><td colSpan={6} style={{ color: 'var(--na-text-muted)', padding: '1rem' }}>No rules yet. Add one below.</td></tr>
                                                                ) : thresholdsList.map((row, i) => (
                                                                    <tr key={row.id}>
                                                                        <td>{({ dns_latency: 'DNS latency', rtt: 'RTT', node_system: 'Node CPU/memory %', sched_latency: 'Scheduling latency', disk_io: 'Disk I/O', tcp_metrics: 'TCP metrics', service_health: 'Service health', nat_metadata: 'NAT metadata', packet_distribution: 'Packet distribution' } as Record<string, string>)[row.metric_type] || row.metric_type}</td>
                                                                        <td>{row.level || '—'}</td>
                                                                        <td><span className="na-threshold-highlight">{row.threshold_value ?? '—'} {({'dns_latency':'µs','rtt':'µs','node_system':'%','sched_latency':'µs','disk_io':'bytes'} as Record<string,string>)[row.metric_type] || ''}</span></td>
                                                                        <td>{row.node_name || 'all'}</td>
                                                                        <td>{row.pod_name || 'all'}</td>
                                                                        <td>
                                                                            <div className="na-channel-actions">
                                                                                <button type="button" className="btn btn-sm btn-muted" onClick={() => startEditThreshold(i)}>Edit</button>
                                                                                <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteThresholdAt(i)}>Delete</button>
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                        <div className="na-rule-builder">
                                                            <div className="extensions-form-row full">
                                                                <label>Metric</label>
                                                                <select
                                                                    value={newThreshold.metric_type}
                                                                    onChange={(e) => setNewThreshold((p) => ({ ...p, metric_type: e.target.value }))}
                                                                >
                                                                    <option value="dns_latency">DNS latency (avg µs)</option>
                                                                    <option value="rtt">RTT – round-trip time (avg µs)</option>
                                                                    <option value="node_system">Node CPU / memory %</option>
                                                                    <option value="sched_latency">Scheduling latency (µs)</option>
                                                                    <option value="disk_io">Disk I/O (bytes)</option>
                                                                    <option value="tcp_metrics">TCP – packet loss / retrans</option>
                                                                    <option value="service_health">Service health</option>
                                                                    <option value="nat_metadata">NAT metadata</option>
                                                                    <option value="packet_distribution">Packet distribution</option>
                                                                </select>
                                                                <span className="ext-notif-hint">
                                                                    <FiInfo className="ext-notif-hint-icon" aria-hidden />
                                                                    {{
                                                                        dns_latency: 'Average DNS resolution latency per pod/node. Typical healthy range: < 1000 µs.',
                                                                        rtt: 'Average network round-trip time. Typical healthy range: < 500 µs.',
                                                                        node_system: 'Node-level CPU or memory usage percentage. Alert above 80–90 % is common.',
                                                                        sched_latency: 'Kernel run-queue wait time. High values indicate CPU contention.',
                                                                        disk_io: 'Total read + write bytes for the pod/container per interval.',
                                                                        tcp_metrics: 'TCP packet loss or retransmission count. Any non-zero value may warrant an alert.',
                                                                        service_health: 'Number of unhealthy Kubernetes services detected by eBPF.',
                                                                        nat_metadata: 'Active or total NAT connections tracked by the kernel.',
                                                                        packet_distribution: 'Total packet count on the node per interval.',
                                                                    }[newThreshold.metric_type] ?? ''}
                                                                </span>
                                                            </div>
                                                            <div className="extensions-form-row">
                                                                <label>Granularity level (Scope)</label>
                                                                <select value={newThreshold.level} onChange={(e) => setNewThreshold((p) => ({ ...p, level: e.target.value }))}>
                                                                    <option value="node">Node – entire host</option>
                                                                    <option value="pod">Pod – per workload</option>
                                                                    <option value="container">Container – per container</option>
                                                                </select>
                                                                <span className="ext-notif-hint"><FiInfo className="ext-notif-hint-icon" aria-hidden />
                                                                    {newThreshold.level === 'node' && 'Aggregated across all pods on the node.'}
                                                                    {newThreshold.level === 'pod' && 'Evaluated per Kubernetes pod. Best for workload-level alerting.'}
                                                                    {newThreshold.level === 'container' && 'Evaluated per individual container. Most granular.'}
                                                                </span>
                                                            </div>
                                                            <div className="extensions-form-row">
                                                                <label>
                                                                    Threshold value
                                                                    <span className="ext-notif-unit-badge">
                                                                        {({'dns_latency':'µs','rtt':'µs','node_system':'%','sched_latency':'µs','disk_io':'bytes'} as Record<string,string>)[newThreshold.metric_type] ?? 'count'}
                                                                    </span>
                                                                </label>
                                                                <input
                                                                    type="number"
                                                                    value={newThreshold.threshold_value}
                                                                    onChange={(e) => setNewThreshold((p) => ({ ...p, threshold_value: Number(e.target.value) || 0 }))}
                                                                />
                                                                <span className="ext-notif-hint"><FiInfo className="ext-notif-hint-icon" aria-hidden />Alert fires when the live value <strong>exceeds</strong> this number.</span>
                                                            </div>
                                                            <div className="extensions-form-row">
                                                                <label>Node filter</label>
                                                                <select
                                                                    value={newThreshold.node_name || ''}
                                                                    onChange={(e) => setNewThreshold((p) => ({ ...p, node_name: e.target.value || undefined, pod_name: '' }))}
                                                                >
                                                                    <option value="">Any node (cluster-wide)</option>
                                                                    {nodeOptions.map((n: { key: string; name: string }) => (
                                                                        <option key={n.key} value={n.name || n.key}>{n.name || n.key}</option>
                                                                    ))}
                                                                </select>
                                                                <span className="ext-notif-hint"><FiInfo className="ext-notif-hint-icon" aria-hidden />Leave empty to alert on any node.</span>
                                                            </div>
                                                            <div className="extensions-form-row">
                                                                <label>Pod filter</label>
                                                                <select
                                                                    value={newThreshold.pod_name || ''}
                                                                    onChange={(e) => setNewThreshold((p) => ({ ...p, pod_name: e.target.value || undefined }))}
                                                                >
                                                                    <option value="">All pods</option>
                                                                    {podsForNode.map((key: string) => (
                                                                        <option key={key} value={key}>{key}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            <div className="full na-add-rule-btn">
                                                                {editingThresholdIndex != null ? (
                                                                    <>
                                                                        <button type="button" className="btn btn-primary" onClick={updateThresholdAt}><FiEdit2 /> Update rule</button>
                                                                        <button type="button" className="btn btn-muted" style={{ marginLeft: '0.5rem' }} onClick={() => { setEditingThresholdIndex(null); setNewThreshold({ metric_type: 'dns_latency', level: 'pod', threshold_value: 100, node_name: '', pod_name: '' }); }}>Cancel</button>
                                                                    </>
                                                                ) : (
                                                                    <button type="button" className="btn btn-primary" onClick={addThreshold}><FiPlusCircle /> Add Rule</button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* 5️⃣ Live Metrics */}
                                                    <div className="na-card na-live-panel">
                                                        <h2 className="na-card-title"><FiActivity className="na-card-icon" aria-hidden /> Live Metrics</h2>
                                                        <NotificationMetricsPreview
                                                            nodeKey={newThreshold.node_name || undefined}
                                                            podName={newThreshold.pod_name || undefined}
                                                            metricType={newThreshold.metric_type}
                                                            level={newThreshold.level}
                                                            threshold={newThreshold.threshold_value ? Number(newThreshold.threshold_value) : undefined}
                                                            savedThreshold={thresholdsList[0]?.threshold_value != null ? Number(thresholdsList[0].threshold_value) : undefined}
                                                        />
                                                    </div>
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
                        <th>Pod</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {thresholds.length === 0 ? (
                        <tr><td colSpan={6} className="extensions-saved-empty">No thresholds yet. Add one below and save.</td></tr>
                    ) : (
                        thresholds.map((row, i) => (
                            <tr key={i}>
                                <td>{metricLabels[row.metric_type] || row.metric_type}</td>
                                <td>{row.level || '—'}</td>
                                <td>{row.threshold_value ?? '—'}</td>
                                <td>{row.node_name || '—'}</td>
                                <td>{row.pod_name || '—'}</td>
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

/** Live metrics from the same WebSocket as the Dashboard; pass nodeKey for the node to show (same WS as Dashboard). */
function NotificationMetricsPreview({
    nodeKey,
    podName,
    metricType,
    level,
    threshold,
    savedThreshold,
}: {
    nodeKey?: string | null;
    podName?: string | null;
    metricType: string;
    level: string;
    threshold?: number;
    savedThreshold?: number;
}) {
    const { unifiedMetrics: metrics, loading, error } = useUnifiedMetricsFromWebSocket(nodeKey ?? undefined);

    if (loading && !metrics) return <div className="extensions-metrics-preview">Loading current metrics…</div>;
    if (error) return <div className="extensions-metrics-preview error">{error.message}</div>;
    if (!metrics) return null;

    type Row = { key: string; level: 'Node' | 'Pod' | 'Container'; source: string; value: number; unit: string };
    const rows: Row[] = [];
    const node: Record<string, any> = metrics.node || {};
    const pods: Record<string, Record<string, any>> = metrics.pods || {};
    const containers: Record<string, Record<string, any>> = metrics.containers || {};
    const podFilter = podName && podName.trim() !== '' ? podName.trim() : null;

    const add = (key: string, lvl: 'Node' | 'Pod' | 'Container', source: string, value: number, unit: string) => {
        if (!Number.isFinite(value)) return;
        if (podFilter && lvl === 'Pod' && key !== podFilter) return;
        if (podFilter && lvl === 'Container' && !key.startsWith(podFilter + '/')) return;
        rows.push({ key, level: lvl, source, value, unit });
    };

    const metricTypeLabel: Record<string, string> = {
        dns_latency: 'DNS latency (avg)',
        rtt: 'RTT (avg)',
        node_system: 'Node CPU / memory',
        sched_latency: 'Scheduling latency',
        disk_io: 'Disk I/O',
        tcp_metrics: 'TCP (e.g. packet loss, retrans)',
        service_health: 'Service health',
        nat_metadata: 'NAT metadata',
        packet_distribution: 'Packet distribution',
    };
    const metricLabel = metricTypeLabel[metricType] || metricType;
    let unitLabel = 'µs';
    if (metricType === 'node_system') unitLabel = '%';
    else if (metricType === 'disk_io') unitLabel = 'bytes';
    else if (['tcp_metrics', 'service_health', 'nat_metadata', 'packet_distribution'].includes(metricType)) unitLabel = 'count';

    if (metricType === 'dns_latency') {
        const unit = 'µs';
        if (level === 'node') {
            const d = node.dns_latency as { avg_latency_ns?: number; total_events?: number; total_latency_ns?: number } | undefined;
            if (d && d.total_events) add('node', 'Node', '—', (d.avg_latency_ns ?? (d.total_latency_ns! / d.total_events)) / 1000, unit);
        } else if (level === 'pod') {
            Object.entries(pods).forEach(([podKey, p]) => {
                const d = p?.dns_latency as { avg_latency_ns?: number; total_events?: number; total_latency_ns?: number } | undefined;
                if (d && d.total_events) add(podKey, 'Pod', podKey, (d.avg_latency_ns ?? (d.total_latency_ns! / d.total_events)) / 1000, unit);
            });
        } else {
            Object.entries(containers).forEach(([cKey, c]) => {
                const d = c?.dns_latency as { avg_latency_ns?: number; total_events?: number; total_latency_ns?: number } | undefined;
                if (d && d.total_events) add(cKey, 'Container', cKey, (d.avg_latency_ns ?? (d.total_latency_ns! / d.total_events)) / 1000, unit);
            });
        }
    } else if (metricType === 'rtt') {
        const unit = 'µs';
        if (level === 'node') {
            const d = node.rtt as { avg_rtt_ns?: number; total_events?: number; total_rtt_ns?: number } | undefined;
            if (d && d.total_events) add('node', 'Node', '—', (d.avg_rtt_ns ?? (d.total_rtt_ns! / d.total_events)) / 1000, unit);
        } else if (level === 'pod') {
            Object.entries(pods).forEach(([podKey, p]) => {
                const d = p?.rtt as { avg_rtt_ns?: number; total_events?: number; total_rtt_ns?: number } | undefined;
                if (d && d.total_events) add(podKey, 'Pod', podKey, (d.avg_rtt_ns ?? (d.total_rtt_ns! / d.total_events)) / 1000, unit);
            });
        } else {
            Object.entries(containers).forEach(([cKey, c]) => {
                const d = c?.tcp_metrics as { smoothed_rtt_us?: number; min_rtt_us?: number } | undefined;
                const v = d?.min_rtt_us ?? d?.smoothed_rtt_us;
                if (v != null) add(cKey, 'Container', cKey, v, unit);
            });
        }
    } else if (metricType === 'node_system' && level === 'node') {
        const d = node.node_system as { cpu_usage_percent?: number; memory_usage_percent?: number } | undefined;
        if (d?.cpu_usage_percent != null) add('node_cpu', 'Node', 'CPU', d.cpu_usage_percent, '%');
        if (d?.memory_usage_percent != null) add('node_mem', 'Node', 'Memory', d.memory_usage_percent, '%');
    } else if (metricType === 'sched_latency') {
        const unit = 'µs';
        if (level === 'node') {
            const d = node.sched_latency as { avg_runqueue_latency_us?: number } | undefined;
            if (d?.avg_runqueue_latency_us != null) add('node', 'Node', '—', d.avg_runqueue_latency_us, unit);
        } else if (level === 'pod') {
            Object.entries(pods).forEach(([podKey, p]) => {
                const d = p?.sched_latency as { avg_runqueue_latency_us?: number } | undefined;
                if (d?.avg_runqueue_latency_us != null) add(podKey, 'Pod', podKey, d.avg_runqueue_latency_us, unit);
            });
        } else {
            Object.entries(containers).forEach(([cKey, c]) => {
                const d = c?.sched_latency as { avg_runqueue_latency_us?: number } | undefined;
                if (d?.avg_runqueue_latency_us != null) add(cKey, 'Container', cKey, d.avg_runqueue_latency_us, unit);
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
            if (total > 0) add('node', 'Node', 'Sum (pods)', total, unit);
        } else if (level === 'pod') {
            Object.entries(pods).forEach(([podKey, p]) => {
                const d = p?.disk_io as { total_read_bytes?: number; total_write_bytes?: number } | undefined;
                if (d) add(podKey, 'Pod', podKey, (d.total_read_bytes ?? 0) + (d.total_write_bytes ?? 0), unit);
            });
        } else {
            Object.entries(containers).forEach(([cKey, c]) => {
                const d = c?.disk_io as { total_read_bytes?: number; total_write_bytes?: number } | undefined;
                if (d) add(cKey, 'Container', cKey, (d.total_read_bytes ?? 0) + (d.total_write_bytes ?? 0), unit);
            });
        }
    } else if (metricType === 'tcp_metrics') {
        const unit = 'count';
        const tcpNode = node.tcp_metrics as { packet_loss?: number; retransmissions?: number; avg_srtt_us?: number } | undefined;
        if (level === 'node' && tcpNode) {
            if (tcpNode.packet_loss != null) add('node_pl', 'Node', 'Packet loss', tcpNode.packet_loss, unit);
            if (tcpNode.retransmissions != null) add('node_retrans', 'Node', 'Retransmissions', tcpNode.retransmissions, unit);
        } else if (level === 'pod') {
            Object.entries(pods).forEach(([podKey, p]) => {
                const t = p?.tcp_metrics as { packet_loss?: number; retransmissions?: number } | undefined;
                if (t?.packet_loss != null) add(podKey + '_pl', 'Pod', podKey + ' (loss)', t.packet_loss, unit);
                if (t?.retransmissions != null) add(podKey + '_retrans', 'Pod', podKey + ' (retrans)', t.retransmissions, unit);
            });
        } else {
            Object.entries(containers).forEach(([cKey, c]) => {
                const t = c?.tcp_metrics as { packet_loss?: number; retransmissions?: number } | undefined;
                if (t?.packet_loss != null) add(cKey + '_pl', 'Container', cKey + ' (loss)', t.packet_loss, unit);
                if (t?.retransmissions != null) add(cKey + '_retrans', 'Container', cKey + ' (retrans)', t.retransmissions, unit);
            });
        }
    } else if (metricType === 'service_health' && level === 'node') {
        const sh = node.service_health as { unhealthy_services?: number; total_services?: number; healthy_services?: number } | undefined;
        if (sh?.unhealthy_services != null) add('unhealthy', 'Node', 'Unhealthy services', sh.unhealthy_services, 'count');
        if (sh?.healthy_services != null) add('healthy', 'Node', 'Healthy services', sh.healthy_services, 'count');
        if (sh?.total_services != null) add('total', 'Node', 'Total services', sh.total_services, 'count');
    } else if (metricType === 'nat_metadata' && level === 'node') {
        const nat = node.nat_metadata as { total_connections?: number; active_connections?: number } | undefined;
        if (nat?.total_connections != null) add('total', 'Node', 'Total connections', nat.total_connections, 'count');
        if (nat?.active_connections != null) add('active', 'Node', 'Active connections', nat.active_connections, 'count');
    } else if (metricType === 'packet_distribution' && level === 'node') {
        const pd = node.packet_distribution as { total_packets?: number } | undefined;
        if (pd?.total_packets != null) add('node', 'Node', 'Total packets', pd.total_packets, 'count');
    }

    if (rows.length === 0) {
        return (
            <div className="extensions-metrics-preview feature-card">
                <h3><FiActivity className="extensions-metrics-icon" /> Current metrics</h3>
                <p className="ext-metrics-meta">Metric type: <strong>{metricLabel}</strong> · Unit: <strong>{unitLabel}</strong></p>
                <p className="list-subtext">No data yet for {metricLabel} at {level} level. Metrics will appear as telemetry is collected.</p>
            </div>
        );
    }

    const displayUnit = rows[0]?.unit ?? unitLabel;
    const valueStr = (v: number, u: string) => (typeof v === 'number' && v % 1 !== 0 ? v.toFixed(2) : String(v)) + ' ' + u;

    return (
        <div className="extensions-metrics-preview feature-card">
            <h3><FiActivity className="extensions-metrics-icon" /> Current metrics</h3>
            <p className="ext-metrics-meta">Metric type: <strong>{metricLabel}</strong> · Unit: <strong>{displayUnit}</strong> {displayUnit === 'µs' ? '(microseconds)' : displayUnit === '%' ? '(percentage)' : ''}</p>
            {savedThreshold != null && Number.isFinite(savedThreshold) && (
                <p className="extensions-saved-threshold">Saved threshold: <strong>{valueStr(savedThreshold, displayUnit)}</strong></p>
            )}
            <p className="list-subtext">Node → Pod → Container. Alerts are sent when a value exceeds the saved threshold.</p>
            <table className="extensions-metrics-table">
                <thead>
                    <tr>
                        <th>Level</th>
                        <th>Source</th>
                        <th>Value ({displayUnit})</th>
                        {threshold != null && <th>Status</th>}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.key}>
                            <td><span className="ext-metrics-level">{r.level}</span></td>
                            <td>{r.source}</td>
                            <td>{valueStr(r.value, r.unit)}</td>
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
