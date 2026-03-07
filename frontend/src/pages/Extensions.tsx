import './Page.css';
import './NotificationsAlerts.css';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type ExtensionInfo, type ExtensionInput } from '../services/api';
import { useUnifiedMetricsFromWebSocket } from '../hooks/useMetrics';
import { FiSave, FiPlusCircle, FiEdit2, FiTrash2, FiChevronRight, FiActivity, FiSend, FiSliders, FiInfo, FiMail, FiEye, FiEyeOff, FiCopy, FiX, FiCheckCircle } from 'react-icons/fi';
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
    const [saveSuccess, setSaveSuccess] = useState<{ title: string; subtitle: string } | null>(null);
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
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [drawerMode, setDrawerMode] = useState<'add-rule' | 'edit-rule' | 'add-channel' | 'edit-channel' | 'edit-email'>('add-rule');

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

    // Accepts an optional configOverride so drawers can pass the freshly-built
    // config directly, avoiding the async state-update timing issue.
    const handleSaveConfig = async (configOverride?: Record<string, unknown>, label?: string, triggerEval = false) => {
        if (!selected || !ext) return;
        if (triggerEval && selected === 'notification') {
            const base = configOverride ?? config;
            const wh = Array.isArray(base.webhooks) ? (base.webhooks as WebhookRow[]) : [];
            const th = Array.isArray(base.thresholds) ? (base.thresholds as ThresholdRow[]) : [];
            const channelOk = wh.some(w => w.enabled !== false && w.url) || base.email_enabled === true;
            const ruleOk = th.some(t => Number(t.threshold_value) > 0);
            if (!channelOk) { setError('Add at least one enabled alert channel (webhook or email) before running a check.'); return; }
            if (!ruleOk) { setError('Add at least one alert rule with a threshold value > 0 before running a check.'); return; }
        }
        setSaving(true);
        setError(null);
        setSaveSuccess(null);
        let fullConfig: Record<string, unknown> = {};
        const base = configOverride ?? config;
        if (selected === 'notification') {
            fullConfig = {
                enabled: base.enabled !== false,
                interval_seconds: Number(base.interval_seconds) || 15,
                webhooks: Array.isArray(base.webhooks) ? base.webhooks : [],
                thresholds: Array.isArray(base.thresholds) ? base.thresholds : [],
                email_enabled: base.email_enabled === true,
                smtp_host: String(base.smtp_host ?? '').trim(),
                smtp_port: Number(base.smtp_port) || 587,
                smtp_use_tls: base.smtp_use_tls !== false,
                smtp_username: String(base.smtp_username ?? '').trim(),
                smtp_password: String(base.smtp_password ?? '').trim(),
                email_from: String(base.email_from ?? '').trim(),
                email_to: String(base.email_to ?? '').trim(),
            };
        } else {
            ext.inputs?.forEach((input) => {
                fullConfig[input.key] = base[input.key] ?? input.default;
            });
        }
        try {
            await api.setExtensionConfig(selected, fullConfig);
            setConfig(fullConfig);
            if (selected === 'notification') {
                setEditingEmail(false);
                setEditingWebhookId(null);
                setNewWebhookUrl('');
                const validThresholds = Array.isArray(fullConfig.thresholds)
                    ? (fullConfig.thresholds as ThresholdRow[]).filter(t => Number(t.threshold_value) > 0)
                    : [];
                if (triggerEval && validThresholds.length > 0) {
                    await api.triggerNotificationExtension();
                }
                setSaveSuccess({ title: 'Configuration Saved', subtitle: label ?? 'Notification settings updated.' });
            } else {
                setSaveSuccess({ title: 'Configuration Saved', subtitle: label ?? 'Extension settings updated.' });
            }
            setTimeout(() => setSaveSuccess(null), 3500);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save config');
        } finally {
            setSaving(false);
        }
    };

    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const updateConfig = (key: string, value: unknown) => {
        const updated = { ...config, [key]: value };
        setConfig(updated);
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(() => {
            handleSaveConfig(updated, 'Settings auto-saved.');
        }, 800);
    };

    const webhooksList = (selected === 'notification' && Array.isArray(config.webhooks) ? config.webhooks : []) as WebhookRow[];
    const thresholdsList = (selected === 'notification' && Array.isArray(config.thresholds) ? config.thresholds : []) as ThresholdRow[];

    const addWebhook = (type: 'teams' | 'discord' | 'slack', url: string) => {
        const label = type === 'discord' ? 'Discord' : type === 'slack' ? 'Slack' : 'Microsoft Teams';
        const updated = { ...config, webhooks: [...(Array.isArray(config.webhooks) ? config.webhooks : []), { id: genId(), type, url: url.trim(), enabled: true }] };
        setConfig(updated);
        setNewWebhookUrl('');
        setDrawerOpen(false);
        handleSaveConfig(updated, `${label} channel added.`);
    };
    const deleteWebhook = (id: string) => {
        const w = (Array.isArray(config.webhooks) ? config.webhooks : []).find((x: WebhookRow) => x.id === id) as WebhookRow | undefined;
        const label = w ? (w.type === 'discord' ? 'Discord' : w.type === 'slack' ? 'Slack' : 'Microsoft Teams') : 'Channel';
        const updated = { ...config, webhooks: (Array.isArray(config.webhooks) ? config.webhooks : []).filter((x: WebhookRow) => x.id !== id) };
        setConfig(updated);
        handleSaveConfig(updated, `${label} channel removed.`);
    };
    const setWebhookEnabled = (id: string, enabled: boolean) => {
        const w = (Array.isArray(config.webhooks) ? config.webhooks : []).find((x: WebhookRow) => x.id === id) as WebhookRow | undefined;
        const label = w ? (w.type === 'discord' ? 'Discord' : w.type === 'slack' ? 'Slack' : 'Microsoft Teams') : 'Channel';
        const updated = { ...config, webhooks: (Array.isArray(config.webhooks) ? config.webhooks : []).map((x: WebhookRow) => x.id === id ? { ...x, enabled } : x) };
        setConfig(updated);
        handleSaveConfig(updated, `${label} ${enabled ? 'enabled' : 'disabled'}.`);
    };
    const updateWebhook = (id: string, type: 'teams' | 'discord' | 'slack', url: string) => {
        const label = type === 'discord' ? 'Discord' : type === 'slack' ? 'Slack' : 'Microsoft Teams';
        const updated = { ...config, webhooks: (Array.isArray(config.webhooks) ? config.webhooks : []).map((x: WebhookRow) => x.id === id ? { ...x, type, url: url.trim() } : x) };
        setConfig(updated);
        setEditingWebhookId(null);
        setNewWebhookType('discord');
        setNewWebhookUrl('');
        setDrawerOpen(false);
        handleSaveConfig(updated, `${label} channel updated.`);
    };
    const startEditWebhook = (w: WebhookRow) => {
        setNewWebhookType(w.type);
        setNewWebhookUrl(w.url || '');
        setEditingWebhookId(w.id);
        setDrawerMode('edit-channel');
        setDrawerOpen(true);
    };

    const addThreshold = () => {
        if (Number(newThreshold.threshold_value) <= 0) { setError('Threshold value must be greater than 0.'); return; }
        const updated = { ...config, thresholds: [...(Array.isArray(config.thresholds) ? config.thresholds : []), { id: genId(), ...newThreshold }] };
        setConfig(updated);
        setNewThreshold({ metric_type: 'dns_latency', level: 'pod', threshold_value: 100, node_name: '', pod_name: '' });
        setDrawerOpen(false);
        handleSaveConfig(updated, 'Alert rule added.');
    };
    const updateThresholdAt = () => {
        if (editingThresholdIndex == null) return;
        if (Number(newThreshold.threshold_value) <= 0) { setError('Threshold value must be greater than 0.'); return; }
        const th = Array.isArray(config.thresholds) ? [...config.thresholds] : [];
        if (editingThresholdIndex >= 0 && editingThresholdIndex < th.length) th[editingThresholdIndex] = { ...th[editingThresholdIndex], ...newThreshold };
        const updated = { ...config, thresholds: th };
        setConfig(updated);
        setEditingThresholdIndex(null);
        setNewThreshold({ metric_type: 'dns_latency', level: 'pod', threshold_value: 100, node_name: '', pod_name: '' });
        setDrawerOpen(false);
        handleSaveConfig(updated, 'Alert rule updated.');
    };
    const deleteThresholdAt = (index: number) => {
        const th = Array.isArray(config.thresholds) ? config.thresholds : [];
        const updated = { ...config, thresholds: th.filter((_, i) => i !== index) };
        setConfig(updated);
        handleSaveConfig(updated, 'Alert rule deleted.');
        if (editingThresholdIndex === index) { setEditingThresholdIndex(null); setDrawerOpen(false); }
        else if (editingThresholdIndex != null && editingThresholdIndex > index) setEditingThresholdIndex(editingThresholdIndex - 1);
    };
    const startEditThreshold = (index: number) => {
        const row = thresholdsList[index];
        if (row) setNewThreshold({ metric_type: row.metric_type || 'dns_latency', level: row.level || 'pod', threshold_value: Number(row.threshold_value) || 100, node_name: row.node_name ?? '', pod_name: row.pod_name ?? '' });
        setEditingThresholdIndex(index);
        setDrawerMode('edit-rule');
        setDrawerOpen(true);
    };

    const ext = extensions.find((e) => e.name === selected);
    const hasConfigEndpoint = selected === 'notification';

    // Readiness checks for sending notifications
    const hasChannel = webhooksList.some(w => w.enabled !== false && w.url) || config.email_enabled === true;
    const hasValidRule = thresholdsList.some(t => Number(t.threshold_value) > 0);
    const readyToNotify = hasChannel && hasValidRule;

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
                    <div className="ext-toast" role="alert" aria-live="polite">
                        <div className="ext-toast-icon-wrap"><FiCheckCircle className="ext-toast-icon" /></div>
                        <div className="ext-toast-body">
                            <span className="ext-toast-title">{saveSuccess.title}</span>
                            <span className="ext-toast-subtitle">{saveSuccess.subtitle}</span>
                        </div>
                        <div className="ext-toast-bar" />
                    </div>
                )}

                {!loading && !error && extensions.length === 0 && (
                    <div className="extensions-empty feature-card">
                        <p className="list-subtext">No extensions registered.</p>
                    </div>
                )}

                {!loading && !error && ext && (
                    <div className="extensions-detail feature-card extensions-detail-card">
                        {hasConfigEndpoint ? (
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
                                                            <div className="na-readiness-row">
                                                                <span className={`na-readiness-chip ${hasChannel ? 'ok' : 'missing'}`}>{hasChannel ? <FiCheckCircle size={14} /> : <FiX size={14} />} Alert channel</span>
                                                                <span className={`na-readiness-chip ${hasValidRule ? 'ok' : 'missing'}`}>{hasValidRule ? <FiCheckCircle size={14} /> : <FiX size={14} />} Alert rule</span>
                                                                {readyToNotify && <span className="na-readiness-chip ok na-readiness-ready"><FiCheckCircle size={14} /> Ready to notify</span>}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* 2️⃣ Alert Channels */}
                                                    <div className="na-card">
                                                        <div className="na-rules-header">
                                                            <h2 className="na-card-title"><FiSend className="na-card-icon" aria-hidden /> Alert Channels</h2>
                                                            <button type="button" className="btn btn-primary" onClick={() => { setEditingWebhookId(null); setNewWebhookType('discord'); setNewWebhookUrl(''); setDrawerMode('add-channel'); setDrawerOpen(true); }}><FiPlusCircle /> Add Channel</button>
                                                        </div>
                                                        <div className="na-channels-grid">
                                                            {webhooksList.map((w) => {
                                                                const ChanIcon = w.type === 'discord' ? SiDiscord : w.type === 'slack' ? SiSlack : FiMessageCircle;
                                                                const chanName = w.type === 'discord' ? 'Discord' : w.type === 'slack' ? 'Slack' : 'Microsoft Teams';
                                                                const chanColor = w.type === 'discord' ? '#5865F2' : w.type === 'slack' ? '#E01E5A' : '#6264A7';
                                                                const enabled = w.enabled !== false;
                                                                return (
                                                                    <div key={w.id} className={`na-chan-card ${enabled ? 'na-chan-card-on' : 'na-chan-card-off'}`} style={{ '--chan-color': chanColor } as React.CSSProperties}>
                                                                        <div className="na-chan-top">
                                                                            <div className="na-chan-icon-wrap">
                                                                                <ChanIcon className="na-chan-icon" aria-hidden />
                                                                            </div>
                                                                            <div className="na-chan-info">
                                                                                <span className="na-chan-name">{chanName}</span>
                                                                                <span className="na-chan-type">{w.type} · webhook</span>
                                                                            </div>
                                                                            <span className={`na-chan-badge ${enabled ? 'na-chan-badge-on' : 'na-chan-badge-off'}`}>{enabled ? 'Active' : 'Inactive'}</span>
                                                                        </div>
                                                                        {w.url && (
                                                                            <div className="na-chan-url-row">
                                                                                <span className="na-chan-url" title={w.url}>{w.url}</span>
                                                                                <button type="button" className="na-chan-copy" onClick={() => navigator.clipboard.writeText(w.url)} title="Copy URL"><FiCopy size={11} /></button>
                                                                            </div>
                                                                        )}
                                                                        <div className="na-chan-footer">
                                                                            <div className={`na-toggle na-toggle-sm ${enabled ? 'on' : ''}`} role="switch" aria-checked={enabled} tabIndex={0} onClick={() => setWebhookEnabled(w.id, !enabled)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWebhookEnabled(w.id, !enabled); } }} title={enabled ? 'Disable' : 'Enable'}><div className="na-toggle-thumb" /></div>
                                                                            <div className="na-chan-actions">
                                                                                <button type="button" className="na-chan-btn" onClick={() => startEditWebhook(w)}><FiEdit2 size={12} /> Edit</button>
                                                                                <button type="button" className="na-chan-btn na-chan-btn-del" onClick={() => deleteWebhook(w.id)}><FiTrash2 size={12} /> Delete</button>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                            {config.email_enabled === true && (String(config.smtp_host ?? '').trim() !== '' || String(config.email_to ?? '').trim() !== '') && (
                                                                <div className="na-chan-card na-chan-card-on" style={{ '--chan-color': '#60a5fa' } as React.CSSProperties}>
                                                                    <div className="na-chan-top">
                                                                        <div className="na-chan-icon-wrap">
                                                                            <FiMail className="na-chan-icon" aria-hidden />
                                                                        </div>
                                                                        <div className="na-chan-info">
                                                                            <span className="na-chan-name">Email</span>
                                                                            <span className="na-chan-type">SMTP · {String(config.smtp_host || '—')}</span>
                                                                        </div>
                                                                        <span className="na-chan-badge na-chan-badge-on">Active</span>
                                                                    </div>
                                                                    <div className="na-chan-footer" style={{ justifyContent: 'flex-end' }}>
                                                                        <div className="na-chan-actions">
                                                                            <button type="button" className="na-chan-btn" onClick={() => { setDrawerMode('edit-email'); setDrawerOpen(true); }}><FiEdit2 size={12} /> Configure</button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                            {webhooksList.length === 0 && config.email_enabled !== true && (
                                                                <p className="ext-notif-empty">No channels yet. Click <strong>Add Channel</strong> to configure one.</p>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* 3️⃣ Email SMTP */}
                                                    <div className="na-card">
                                                        <div className="na-rules-header">
                                                            <h2 className="na-card-title"><FiMail className="na-card-icon" aria-hidden /> Email SMTP</h2>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                <label className="na-channel-enable-label" style={{ margin: 0 }}>
                                                                    <span className="na-toggle-wrap-inline">
                                                                        <div className={`na-toggle na-toggle-sm ${config.email_enabled === true ? 'on' : ''}`} role="switch" aria-checked={config.email_enabled === true} tabIndex={0} onClick={() => updateConfig('email_enabled', !(config.email_enabled === true))} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); updateConfig('email_enabled', !(config.email_enabled === true)); } }}><div className="na-toggle-thumb" /></div>
                                                                    </span>
                                                                    <span className="na-channel-enable-text">{config.email_enabled === true ? 'Enabled' : 'Disabled'}</span>
                                                                </label>
                                                                <button type="button" className="btn btn-primary" onClick={() => { setDrawerMode('edit-email'); setDrawerOpen(true); }}><FiEdit2 /> Configure</button>
                                                            </div>
                                                        </div>
                                                        {String(config.smtp_host ?? '').trim() !== '' ? (
                                                            <div className="na-email-summary-row">
                                                                <span className="na-email-summary-chip"><span className="na-email-summary-chip-label">Server</span>{String(config.smtp_host)}:{Number(config.smtp_port) || 587}</span>
                                                                <span className="na-email-summary-chip"><span className="na-email-summary-chip-label">From</span>{String(config.email_from || '—')}</span>
                                                                {emailToList.length > 0 && <span className="na-email-summary-chip"><span className="na-email-summary-chip-label">To</span>{emailToList.join(', ')}</span>}
                                                            </div>
                                                        ) : (
                                                            <p className="ext-notif-empty" style={{ margin: '0.25rem 0 0' }}>Not configured. Click <strong>Configure</strong> to set up SMTP.</p>
                                                        )}
                                                    </div>

                                                    {/* 4️⃣ Alert Rules */}
                                                    <div className="na-card">
                                                        <div className="na-rules-header">
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                <h2 className="na-card-title" style={{ margin: 0 }}><FiSliders className="na-card-icon" aria-hidden /> Alert Rules</h2>
                                                                <span className="na-rule-count-badge">{thresholdsList.length} rule{thresholdsList.length !== 1 ? 's' : ''}</span>
                                                            </div>
                                                            <button type="button" className="btn btn-primary" onClick={() => { setEditingThresholdIndex(null); setNewThreshold({ metric_type: 'dns_latency', level: 'pod', threshold_value: 100, node_name: '', pod_name: '' }); setDrawerMode('add-rule'); setDrawerOpen(true); }}>
                                                                <FiPlusCircle /> Add Rule
                                                            </button>
                                                        </div>
                                                        <table className="na-rules-table">
                                                            <thead>
                                                                <tr>
                                                                    <th>Metric</th>
                                                                    <th>Scope</th>
                                                                    <th>Threshold</th>
                                                                    <th>Node</th>
                                                                    <th>Pod</th>
                                                                    <th>Actions</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {thresholdsList.length === 0 ? (
                                                                    <tr><td colSpan={6} style={{ color: 'var(--na-text-muted)', padding: '1rem', textAlign: 'center' }}>No rules yet. Click <strong>Add Rule</strong> to create one.</td></tr>
                                                                ) : thresholdsList.map((row, i) => (
                                                                    <tr key={row.id}>
                                                                        <td>{({ dns_latency: 'DNS latency', rtt: 'RTT', node_system: 'Node CPU/mem %', sched_latency: 'Sched latency', disk_io: 'Disk I/O', tcp_metrics: 'TCP', service_health: 'Svc health', nat_metadata: 'NAT', packet_distribution: 'Packets' } as Record<string, string>)[row.metric_type] || row.metric_type}</td>
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
                                                    </div>

                                                </>
                        ) : ext.inputs && ext.inputs.length > 0 ? (
                            <SavedConfigSummary inputs={ext.inputs} config={config} summaryKeys={ext.summary_keys} />
                        ) : (
                            <p className="list-subtext">No configuration options for this extension.</p>
                        )}
                    </div>
                )}
            </div>

            {/* ── Right-side drawer for Add/Edit Rule and Add/Edit Channel ── */}
            {drawerOpen && <div className="drawer-overlay" onClick={() => { setDrawerOpen(false); setEditingThresholdIndex(null); setEditingWebhookId(null); }} />}
            <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
                <div className="drawer-header">
                    <div>
                        <div className="drawer-title">
                            {drawerMode === 'add-rule' && 'Add Rule'}
                            {drawerMode === 'edit-rule' && 'Edit Rule'}
                            {drawerMode === 'add-channel' && 'Add Channel'}
                            {drawerMode === 'edit-channel' && 'Edit Channel'}
                            {drawerMode === 'edit-email' && 'Email SMTP'}
                        </div>
                        <div className="drawer-subtitle">
                            {(drawerMode === 'add-rule' || drawerMode === 'edit-rule') && 'Alert when a metric exceeds the threshold'}
                            {(drawerMode === 'add-channel' || drawerMode === 'edit-channel') && 'Webhook destination for alert messages'}
                            {drawerMode === 'edit-email' && 'SMTP server, credentials and recipient addresses'}
                        </div>
                    </div>
                    <button className="icon-button" aria-label="Close drawer" onClick={() => { setDrawerOpen(false); setEditingThresholdIndex(null); setEditingWebhookId(null); setNewWebhookUrl(''); }}><FiX /></button>
                </div>

                {/* Rule form */}
                {(drawerMode === 'add-rule' || drawerMode === 'edit-rule') && (
                    <div className="drawer-form na-drawer-rule-form">
                        <div className="na-drawer-field">
                            <label className="na-drawer-label">Metric</label>
                            <select className="na-drawer-select" value={newThreshold.metric_type} onChange={(e) => setNewThreshold((p) => ({ ...p, metric_type: e.target.value }))}>
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
                            <span className="ext-notif-hint na-drawer-hint">
                                <FiInfo className="ext-notif-hint-icon" aria-hidden />
                                {({
                                    dns_latency: 'Average DNS resolution latency. Healthy: < 1000 µs.',
                                    rtt: 'Average network round-trip time. Healthy: < 500 µs.',
                                    node_system: 'Node CPU or memory usage %. Common threshold: 80–90 %.',
                                    sched_latency: 'Kernel run-queue wait time. High = CPU contention.',
                                    disk_io: 'Total read + write bytes per pod/container per interval.',
                                    tcp_metrics: 'TCP packet loss / retransmission count.',
                                    service_health: 'Unhealthy Kubernetes services detected by eBPF.',
                                    nat_metadata: 'Active or total NAT connections tracked by the kernel.',
                                    packet_distribution: 'Total packet count on the node per interval.',
                                } as Record<string,string>)[newThreshold.metric_type] ?? ''}
                            </span>
                        </div>
                        <div className="na-drawer-field">
                            <label className="na-drawer-label">Scope</label>
                            <select className="na-drawer-select" value={newThreshold.level} onChange={(e) => setNewThreshold((p) => ({ ...p, level: e.target.value }))}>
                                <option value="node">Node – entire host</option>
                                <option value="pod">Pod – per workload</option>
                                <option value="container">Container – per container</option>
                            </select>
                        </div>
                        <div className="na-drawer-field">
                            <label className="na-drawer-label">
                                Threshold value
                                <span className="ext-notif-unit-badge" style={{ marginLeft: '0.4rem' }}>
                                    {({'dns_latency':'µs','rtt':'µs','node_system':'%','sched_latency':'µs','disk_io':'bytes'} as Record<string,string>)[newThreshold.metric_type] ?? 'count'}
                                </span>
                            </label>
                            <input className="na-drawer-input" type="number" value={newThreshold.threshold_value} onChange={(e) => setNewThreshold((p) => ({ ...p, threshold_value: Number(e.target.value) || 0 }))} />
                            <span className="ext-notif-hint na-drawer-hint"><FiInfo className="ext-notif-hint-icon" aria-hidden />Alert fires when the live value <strong>exceeds</strong> this number.</span>
                        </div>
                        <div className="na-drawer-field">
                            <label className="na-drawer-label">Node filter</label>
                            <select className="na-drawer-select" value={newThreshold.node_name || ''} onChange={(e) => setNewThreshold((p) => ({ ...p, node_name: e.target.value || undefined, pod_name: '' }))}>
                                <option value="">Any node (cluster-wide)</option>
                                {nodeOptions.map((n: { key: string; name: string }) => (
                                    <option key={n.key} value={n.name || n.key}>{n.name || n.key}</option>
                                ))}
                            </select>
                        </div>
                        <div className="na-drawer-field">
                            <label className="na-drawer-label">Pod filter</label>
                            <select className="na-drawer-select" value={newThreshold.pod_name || ''} onChange={(e) => setNewThreshold((p) => ({ ...p, pod_name: e.target.value || undefined }))}>
                                <option value="">All pods</option>
                                {podsForNode.map((key: string) => (
                                    <option key={key} value={key}>{key}</option>
                                ))}
                            </select>
                        </div>
                        <div className="drawer-footer">
                            {drawerMode === 'edit-rule' ? (
                                <button type="button" className="btn btn-primary" onClick={updateThresholdAt}><FiEdit2 /> Update rule</button>
                            ) : (
                                <button type="button" className="btn btn-primary" onClick={addThreshold}><FiPlusCircle /> Add Rule</button>
                            )}
                            <button type="button" className="btn btn-muted" onClick={() => { setDrawerOpen(false); setEditingThresholdIndex(null); setNewThreshold({ metric_type: 'dns_latency', level: 'pod', threshold_value: 100, node_name: '', pod_name: '' }); }}>Cancel</button>
                        </div>
                    </div>
                )}

                {/* Channel form */}
                {(drawerMode === 'add-channel' || drawerMode === 'edit-channel') && (
                    <div className="drawer-form na-drawer-rule-form">
                        <div className="na-drawer-field">
                            <label className="na-drawer-label">Channel type</label>
                            <select className="na-drawer-select" value={newWebhookType} onChange={(e) => { setNewWebhookType(e.target.value as 'teams'|'discord'|'slack'); if (!editingWebhookId) setNewWebhookUrl(''); }}>
                                <option value="discord">Discord</option>
                                <option value="teams">Microsoft Teams</option>
                                <option value="slack">Slack</option>
                            </select>
                        </div>
                        <div className="na-drawer-field">
                            <label className="na-drawer-label">Webhook URL</label>
                            <input className="na-drawer-input" type="url" placeholder={newWebhookType === 'teams' ? 'https://xxxx.webhook.office.com/…' : newWebhookType === 'slack' ? 'https://hooks.slack.com/…' : 'https://discord.com/api/webhooks/…'} value={newWebhookUrl} onChange={(e) => setNewWebhookUrl(e.target.value)} />
                        </div>
                        <div className="drawer-footer">
                            {drawerMode === 'edit-channel' && editingWebhookId ? (
                                <button type="button" className="btn btn-primary" onClick={() => { if (newWebhookUrl.trim() && editingWebhookId) updateWebhook(editingWebhookId, newWebhookType, newWebhookUrl); }}><FiEdit2 /> Update</button>
                            ) : (
                                <button type="button" className="btn btn-primary" onClick={() => { if (newWebhookUrl.trim()) addWebhook(newWebhookType, newWebhookUrl); }}><FiPlusCircle /> Add Channel</button>
                            )}
                            <button type="button" className="btn btn-muted" onClick={() => { setDrawerOpen(false); setEditingWebhookId(null); setNewWebhookUrl(''); }}>Cancel</button>
                        </div>
                    </div>
                )}

                {/* Email SMTP form */}
                {drawerMode === 'edit-email' && (
                    <div className="drawer-form na-drawer-rule-form">
                        <div className="na-drawer-section-label">Server</div>
                        <div className="na-drawer-field">
                            <label className="na-drawer-label">SMTP host</label>
                            <input className="na-drawer-input" type="text" placeholder="smtp.gmail.com" value={String(config.smtp_host ?? '')} onChange={(e) => updateConfig('smtp_host', e.target.value)} />
                            <span className="ext-notif-hint na-drawer-hint"><FiInfo className="ext-notif-hint-icon" aria-hidden />e.g. smtp.gmail.com, smtp.office365.com</span>
                        </div>
                        <div className="na-drawer-field">
                            <label className="na-drawer-label">Port</label>
                            <input className="na-drawer-input" type="number" min={1} max={65535} value={Number(config.smtp_port) || 587} onChange={(e) => updateConfig('smtp_port', Number(e.target.value) || 587)} />
                            <span className="ext-notif-hint na-drawer-hint"><FiInfo className="ext-notif-hint-icon" aria-hidden />587 (STARTTLS) or 465 (TLS).</span>
                        </div>
                        <div className="na-drawer-field">
                            <label className="ext-notif-checkbox">
                                <input type="checkbox" checked={config.smtp_use_tls !== false} onChange={(e) => updateConfig('smtp_use_tls', e.target.checked)} />
                                <span>Use TLS / STARTTLS</span>
                            </label>
                        </div>

                        <div className="na-drawer-section-label" style={{ marginTop: '0.5rem' }}>Authentication</div>
                        <div className="na-drawer-field">
                            <label className="na-drawer-label">Username <span className="ext-notif-optional-badge">optional</span></label>
                            <input className="na-drawer-input" type="text" placeholder="Leave empty if no auth" value={String(config.smtp_username ?? '')} onChange={(e) => updateConfig('smtp_username', e.target.value)} autoComplete="off" />
                        </div>
                        <div className="na-drawer-field">
                            <label className="na-drawer-label">Password <span className="ext-notif-optional-badge">optional</span></label>
                            <div className="na-password-wrap">
                                <input className="na-drawer-input" type={showPassword ? 'text' : 'password'} placeholder="App password for Gmail/2FA" value={String(config.smtp_password ?? '')} onChange={(e) => updateConfig('smtp_password', e.target.value)} autoComplete="off" />
                                <button type="button" className="na-password-toggle" onClick={() => setShowPassword((p) => !p)} title={showPassword ? 'Hide' : 'Show'}>{showPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}</button>
                            </div>
                            <span className="ext-notif-hint na-drawer-hint"><FiInfo className="ext-notif-hint-icon" aria-hidden />Use an app password for Gmail or 2FA accounts.</span>
                        </div>

                        <div className="na-drawer-section-label" style={{ marginTop: '0.5rem' }}>Recipients</div>
                        <div className="na-drawer-field">
                            <label className="na-drawer-label">From address</label>
                            <input className={`na-drawer-input ${String(config.email_from ?? '').trim() && !isValidEmail(String(config.email_from ?? '')) ? 'ext-notif-input-invalid' : ''}`} type="email" placeholder="alerts@example.com" value={String(config.email_from ?? '')} onChange={(e) => updateConfig('email_from', e.target.value)} />
                            {String(config.email_from ?? '').trim() && !isValidEmail(String(config.email_from ?? '')) && <span className="ext-notif-validation-err">Enter a valid email (e.g. user@gmail.com)</span>}
                        </div>
                        <div className="na-drawer-field">
                            <label className="na-drawer-label">To addresses</label>
                            <div className="ext-notif-email-to-list">
                                {emailToList.map((addr, i) => (
                                    <div key={i} className="ext-notif-email-to-row">
                                        <div className="ext-notif-email-to-cell">
                                            <input className={`na-drawer-input ${addr.trim() && !isValidEmail(addr) ? 'ext-notif-input-invalid' : ''}`} type="email" placeholder="email@example.com" value={addr} onChange={(e) => updateEmailToRecipient(i, e.target.value)} />
                                            {addr.trim() && !isValidEmail(addr) && <span className="ext-notif-validation-err">Invalid email</span>}
                                        </div>
                                        <button type="button" className="btn btn-sm extensions-table-btn extensions-table-btn-danger" onClick={() => removeEmailToRecipient(i)} title="Remove"><FiTrash2 /></button>
                                    </div>
                                ))}
                                <div className="ext-notif-email-to-row ext-notif-email-to-add">
                                    <div className="ext-notif-email-to-cell">
                                        <input className={`na-drawer-input ${newEmailTo.trim() && !isValidEmail(newEmailTo) ? 'ext-notif-input-invalid' : ''}`} type="email" placeholder="Add recipient…" value={newEmailTo} onChange={(e) => setNewEmailTo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addEmailToRecipient())} />
                                        {newEmailTo.trim() && !isValidEmail(newEmailTo) && <span className="ext-notif-validation-err">Enter a valid email</span>}
                                    </div>
                                    <button type="button" className="btn btn-primary btn-sm" onClick={addEmailToRecipient} disabled={!newEmailTo.trim() || !isValidEmail(newEmailTo)}><FiPlusCircle /> Add</button>
                                </div>
                            </div>
                            <span className="ext-notif-hint na-drawer-hint"><FiInfo className="ext-notif-hint-icon" aria-hidden />Alerts are sent to all listed addresses.</span>
                        </div>
                        <p className="na-email-hint" style={{ margin: '0.25rem 0 0' }}>Gmail requires an App Password when 2-factor authentication is enabled.</p>

                        <div className="drawer-footer">
                            <button type="button" className="btn btn-primary" onClick={() => handleSaveConfig(undefined, 'Email SMTP settings saved.')} disabled={saving}><FiSave /> {saving ? 'Saving…' : 'Save'}</button>
                            <button type="button" className="btn btn-muted" onClick={() => { setDrawerOpen(false); setEditingEmail(false); }}>Cancel</button>
                        </div>
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
