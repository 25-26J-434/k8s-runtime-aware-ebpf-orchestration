import { useCallback, useEffect, useMemo, useState } from 'react';
import './Page.css';
import './Federation.css';
import { api } from '../services/api';
import type { CommLogEntry, CommStats } from '../types/api';

type OutboundCommMode = 'BROADCAST' | 'UNICAST' | 'MULTICAST';

interface ClusterNode {
    name: string;
    ip: string;
    status: string;
    role?: string;
    podCount: number;
    runningPods: number;
    kernelVersion?: string;
    osImage?: string;
}

const COMMUNICATION_MODES: Array<{
    value: OutboundCommMode;
    icon: string;
    title: string;
    description: string;
}> = [
    { value: 'BROADCAST', icon: '📡', title: 'Broadcast', description: 'Notify every node simultaneously.' },
    { value: 'UNICAST', icon: '🎯', title: 'Unicast', description: 'Deliver to a single, targeted peer.' },
    { value: 'MULTICAST', icon: '🔀', title: 'Multicast', description: 'Fan out to a curated set of peers.' },
];

const EVENT_OPTIONS = ['HANDSHAKE', 'SCHEDULING', 'STATE_UPDATE', 'METRIC_UPDATE', 'DISCOVERY'] as const;

const DEFAULT_PAYLOAD = `{
  "message": "Hello peers",
  "priority": "info"
}`;

const LOG_FETCH_LIMIT = 120;
const LOG_REFRESH_INTERVAL = 5000;
const FAILURE_RESULTS = new Set(['failed', 'partial', 'no_peers', 'no_targets']);
const ALL_NODES_OPTION = 'ALL_NODES';

const parseMessagePayload = (input: string): Record<string, unknown> => {
    if (!input.trim()) {
        return {};
    }
    try {
        return JSON.parse(input);
    } catch {
        return { message: input };
    }
};

const formatTime = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }
    return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export function Federation() {
    const [nodes, setNodes] = useState<ClusterNode[]>([]);
    const [loadingNodes, setLoadingNodes] = useState(true);
    const [topologyError, setTopologyError] = useState<string | null>(null);
    const [stats, setStats] = useState<CommStats | null>(null);
    const [statsError, setStatsError] = useState<string | null>(null);
    const [messageType, setMessageType] = useState<OutboundCommMode>('BROADCAST');
    const [eventType, setEventType] = useState<typeof EVENT_OPTIONS[number]>(EVENT_OPTIONS[0]);
    const [messagePayload, setMessagePayload] = useState(DEFAULT_PAYLOAD);
    const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
    const [sending, setSending] = useState(false);
    const [consoleError, setConsoleError] = useState<string | null>(null);
    const [logNodeFilter, setLogNodeFilter] = useState<string>(ALL_NODES_OPTION);
    const [logEntries, setLogEntries] = useState<CommLogEntry[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logsError, setLogsError] = useState<string | null>(null);
    const [autoRefreshLogs, setAutoRefreshLogs] = useState(true);

    const nodeMap = useMemo(() => {
        const map = new Map<string, ClusterNode>();
        nodes.forEach((node) => map.set(node.ip, node));
        return map;
    }, [nodes]);

    const summary = useMemo(() => {
        const totalNodes = nodes.length;
        const readyNodes = nodes.filter((node) => node.status === 'Ready').length;
        const totalPods = nodes.reduce((acc, node) => acc + node.podCount, 0);
        const runningPods = nodes.reduce((acc, node) => acc + node.runningPods, 0);

        return {
            totalNodes,
            readyNodes,
            totalPods,
            runningPods,
            messageCount: stats?.total ?? 0,
            broadcastCount: stats?.broadcast ?? 0,
            unicastCount: stats?.unicast ?? 0,
            multicastCount: stats?.multicast ?? 0,
            peerCount: stats?.peer_count ?? 0,
            lastUpdate: stats?.last_update ?? null,
        };
    }, [nodes, stats]);

    const fetchTopology = useCallback(async () => {
        try {
            setLoadingNodes(true);
            const topology = await api.getClusterTopology();
            const normalized: ClusterNode[] = (topology.nodes || []).map((node) => {
                const pods = node.pods || [];
                const runningPods = pods.filter((pod) => pod.status === 'Running').length;
                return {
                    name: node.name,
                    ip: (node as any).ip || 'unknown',
                    status: node.status || 'Unknown',
                    role: (node as any).role || 'worker',
                    podCount: pods.length,
                    runningPods,
                    kernelVersion: (node as any).kernel_version,
                    osImage: (node as any).os_image,
                };
            });
            normalized.sort((a, b) => a.name.localeCompare(b.name));
            setNodes(normalized);
            setTopologyError(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to load cluster topology';
            setTopologyError(message);
        } finally {
            setLoadingNodes(false);
        }
    }, []);

    const fetchStats = useCallback(async () => {
        try {
            const data = await api.getCommStats();
            setStats(data);
            setStatsError(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to load communication stats';
            setStatsError(message);
        }
    }, []);

    const fetchCommLogs = useCallback(async (options?: { silent?: boolean }) => {
        const silent = options?.silent ?? false;
        if (!silent) {
            setLogsLoading(true);
        }
        try {
            const entries = await api.getCommLogs('cluster', LOG_FETCH_LIMIT);
            setLogEntries(entries);
            setLogsError(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to load communication logs';
            setLogsError(message);
        } finally {
            if (!silent) {
                setLogsLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        fetchTopology();
        const interval = setInterval(fetchTopology, 15000);
        return () => clearInterval(interval);
    }, [fetchTopology]);

    useEffect(() => {
        fetchStats();
        const interval = setInterval(fetchStats, 8000);
        return () => clearInterval(interval);
    }, [fetchStats]);

    useEffect(() => {
        fetchCommLogs();
    }, [fetchCommLogs]);

    useEffect(() => {
        if (!autoRefreshLogs) {
            return;
        }
        const interval = setInterval(() => {
            fetchCommLogs({ silent: true });
        }, LOG_REFRESH_INTERVAL);
        return () => clearInterval(interval);
    }, [autoRefreshLogs, fetchCommLogs]);

    const formatList = (values: string[]) => Array.from(new Set(values.filter(Boolean))).join(', ');

    const getNodeLabel = useCallback(
        (name?: string, ip?: string) => {
            if (!name && !ip) {
                return 'Unknown node';
            }
            const match = nodes.find((node) => (name && node.name === name) || (ip && node.ip === ip));
            if (match) {
                return `${match.name} (${match.ip})`;
            }
            if (name && ip) {
                return `${name} (${ip})`;
            }
            if (name) {
                return name;
            }
            return ip || 'Unknown node';
        },
        [nodes],
    );

    const logNodeOptions = useMemo(() => {
        const unique = new Map<string, string>();
        logEntries.forEach((entry) => {
            const key = entry.node || entry.node_ip;
            if (!key) {
                return;
            }
            unique.set(key, getNodeLabel(entry.node, entry.node_ip));
        });
        const options = Array.from(unique.entries())
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
        return [{ value: ALL_NODES_OPTION, label: 'All Nodes' }, ...options];
    }, [getNodeLabel, logEntries]);

    useEffect(() => {
        if (logNodeFilter === ALL_NODES_OPTION) {
            return;
        }
        const stillExists = logNodeOptions.some((option) => option.value === logNodeFilter);
        if (!stillExists) {
            setLogNodeFilter(ALL_NODES_OPTION);
        }
    }, [logNodeFilter, logNodeOptions]);

    const filteredLogEntries = useMemo(() => {
        if (logNodeFilter === ALL_NODES_OPTION) {
            return logEntries;
        }
        return logEntries.filter((entry) => entry.node === logNodeFilter || entry.node_ip === logNodeFilter);
    }, [logEntries, logNodeFilter]);

    const selectedNodeLabel = useMemo(() => {
        if (logNodeFilter === ALL_NODES_OPTION) {
            return 'All Nodes';
        }
        const match = logNodeOptions.find((option) => option.value === logNodeFilter);
        return match?.label || 'Selected Node';
    }, [logNodeFilter, logNodeOptions]);

    const handleModeChange = (mode: OutboundCommMode) => {
        setMessageType(mode);
        setSelectedNodes((prev) => {
            if (mode === 'BROADCAST') {
                return new Set<string>();
            }
            if (mode === 'UNICAST') {
                const [first] = Array.from(prev);
                return first ? new Set<string>([first]) : new Set<string>();
            }
            return new Set(prev);
        });
    };

    const handleToggleNode = (ip: string) => {
        if (messageType === 'BROADCAST') {
            return;
        }
        setSelectedNodes((prev) => {
            const next = new Set(prev);
            if (next.has(ip)) {
                next.delete(ip);
            } else {
                if (messageType === 'UNICAST') {
                    next.clear();
                }
                next.add(ip);
            }
            return next;
        });
    };

    const canSend = messageType === 'BROADCAST' || selectedNodes.size > 0;

    const handleSendMessage = async () => {
        if (!canSend || sending) {
            return;
        }
        setSending(true);
        setConsoleError(null);

        const targetIps = Array.from(selectedNodes);
        const targetLabels =
            messageType === 'BROADCAST'
                ? ['All nodes']
                : targetIps.map((ip) => nodeMap.get(ip)?.name || ip);
        const payload = parseMessagePayload(messagePayload);

        const messageBody: Record<string, unknown> = {
            event: eventType,
            payload,
            action: 'NONE',
        };
        if (messageType !== 'BROADCAST' && targetLabels.length > 0) {
            messageBody.target_nodes = targetLabels;
        }

        try {
            if (messageType === 'BROADCAST') {
                await api.sendBroadcast(messageBody);
            } else if (messageType === 'UNICAST') {
                if (targetIps.length === 0) {
                    throw new Error('Select a single node to send a unicast message.');
                }
                await api.sendUnicast(targetIps[0], messageBody);
            } else {
                await api.sendMulticast(targetIps, messageBody);
            }
            await fetchStats();
            if (messageType === 'UNICAST') {
                setSelectedNodes(new Set());
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            setConsoleError(message);
        } finally {
            setSending(false);
            await fetchCommLogs({ silent: true });
        }
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <div className="page-title-section">
                    <h1 className="page-title">Node Federation Control</h1>
                    <p className="page-subtitle">
                        Coordinate runtime-aware messaging between daemon instances and monitor Component 4 activity.
                    </p>
                </div>
            </div>

            <div className="page-content">
                <section className="feature-card">
                    <div className="section-header">
                        <h2>Cluster Snapshot</h2>
                        <div className="section-actions">
                            <span className={`status-pill ${loadingNodes ? 'is-syncing' : ''}`}>
                                {loadingNodes ? 'Refreshing' : 'Live'}
                            </span>
                            <button className="action-button" onClick={fetchTopology} disabled={loadingNodes}>
                                Refresh Nodes
                            </button>
                        </div>
                    </div>
                    <div className="federation-summary">
                        <div className="summary-card">
                            <span className="summary-card__label">Cluster Nodes</span>
                            <span className="summary-card__value">{summary.totalNodes}</span>
                            <span className="summary-card__detail">{summary.readyNodes} reporting ready</span>
                        </div>
                        <div className="summary-card">
                            <span className="summary-card__label">Workload Pods</span>
                            <span className="summary-card__value">{summary.runningPods}</span>
                            <span className="summary-card__detail">{summary.totalPods} total scheduled</span>
                        </div>
                        <div className="summary-card">
                            <span className="summary-card__label">Comm. Activity</span>
                            <span className="summary-card__value">{summary.messageCount}</span>
                            <span className="summary-card__detail">
                                {summary.broadcastCount} broadcast · {summary.unicastCount} unicast · {summary.multicastCount} multicast
                            </span>
                        </div>
                        <div className="summary-card">
                            <span className="summary-card__label">Peers Discovered</span>
                            <span className="summary-card__value">{summary.peerCount}</span>
                            <span className="summary-card__detail">
                                {summary.lastUpdate ? `Updated ${formatTime(summary.lastUpdate)}` : 'Awaiting activity'}
                            </span>
                        </div>
                    </div>
                </section>

                <section className="feature-card">
                    <div className="section-header">
                        <h2>Cluster Nodes</h2>
                        <div className="section-actions">
                            {messageType !== 'BROADCAST' && (
                                <span className="status-pill">
                                    Targets · {selectedNodes.size}
                                </span>
                            )}
                        </div>
                    </div>
                    {topologyError && <div className="error-banner">{topologyError}</div>}
                    {!nodes.length && !loadingNodes ? (
                        <div className="empty-state">No nodes reported yet. Ensure the daemonset is running.</div>
                    ) : (
                        <div className="node-grid">
                            {nodes.map((node) => {
                                const isSelected = selectedNodes.has(node.ip);
                                const statusClass = node.status === 'Ready' ? 'is-ready' : 'is-warning';
                                const selectable = messageType !== 'BROADCAST';
                                return (
                                    <button
                                        type="button"
                                        key={node.name}
                                        onClick={() => handleToggleNode(node.ip)}
                                        className={`node-card${selectable ? ' is-selectable' : ''}${isSelected ? ' is-selected' : ''}`}
                                    >
                                        <div className="node-card__header">
                                            <div className="node-card__identity">
                                                <div className="node-card__icon">🖥️</div>
                                                <div>
                                                    <div className="node-card__name">{node.name}</div>
                                                    <div className="node-card__meta">{node.role}</div>
                                                </div>
                                            </div>
                                            <span className={`node-card__status ${statusClass}`}>
                                                {node.status}
                                            </span>
                                        </div>
                                        <div className="node-card__kv">
                                            <div className="node-card__kv-row">
                                                <span className="node-card__kv-label">IP</span>
                                                <span className="node-card__kv-value">{node.ip}</span>
                                            </div>
                                            <div className="node-card__kv-row">
                                                <span className="node-card__kv-label">Pods</span>
                                                <span className="node-card__kv-value">{node.runningPods}/{node.podCount} running</span>
                                            </div>
                                            {node.kernelVersion && (
                                                <div className="node-card__kv-row">
                                                    <span className="node-card__kv-label">Kernel</span>
                                                    <span className="node-card__kv-value">{node.kernelVersion}</span>
                                                </div>
                                            )}
                                            {node.osImage && (
                                                <div className="node-card__kv-row">
                                                    <span className="node-card__kv-label">OS</span>
                                                    <span className="node-card__kv-value">{node.osImage}</span>
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </section>

                <section className="feature-card">
                    <div className="section-header">
                        <h2>Communication Console</h2>
                        <div className="section-actions">
                            <button className="action-button" onClick={fetchStats}>
                                Refresh Stats
                            </button>
                        </div>
                    </div>
                    {statsError && <div className="error-banner">{statsError}</div>}
                    <div className="mode-selector">
                        {COMMUNICATION_MODES.map((mode) => (
                            <button
                                key={mode.value}
                                type="button"
                                className={`mode-card${messageType === mode.value ? ' is-active' : ''}`}
                                onClick={() => handleModeChange(mode.value)}
                            >
                                <span className="mode-card__icon">{mode.icon}</span>
                                <span className="mode-card__title">{mode.title}</span>
                                <span className="mode-card__help">{mode.description}</span>
                            </button>
                        ))}
                    </div>

                    <div style={{ marginTop: '1.5rem' }}>
                        <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#cbd5ff' }}>
                            Event Type
                        </h3>
                        <div className="event-selector">
                            {EVENT_OPTIONS.map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    className={`event-chip${eventType === option ? ' is-active' : ''}`}
                                    onClick={() => setEventType(option)}
                                >
                                    {option}
                                </button>
                            ))}
                        </div>
                    </div>

                    {messageType !== 'BROADCAST' && (
                        <div className="selected-targets" style={{ marginTop: '1.5rem' }}>
                            <span className="selected-targets__label">
                                {messageType === 'UNICAST' ? 'Single target required' : 'Multicast targets'}
                            </span>
                            <span className="selected-targets__value">
                                {selectedNodes.size === 0
                                    ? 'Select nodes from the grid above to build the target list.'
                                    : Array.from(selectedNodes)
                                          .map((ip) => nodeMap.get(ip)?.name || ip)
                                          .join(', ')}
                            </span>
                        </div>
                    )}

                    <div style={{ marginTop: '1.5rem' }}>
                        <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#cbd5ff' }}>
                            Message Payload
                        </h3>
                        <textarea
                            className="payload-textarea"
                            value={messagePayload}
                            onChange={(event) => setMessagePayload(event.target.value)}
                            placeholder='{"message": "Hello nodes!", "priority": "high"}'
                        />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                        <button
                            type="button"
                            className="send-button"
                            onClick={handleSendMessage}
                            disabled={!canSend || sending}
                        >
                            {sending ? 'Sending…' : `Send ${messageType}`}
                        </button>
                    </div>

                    {consoleError && (
                        <div className="error-banner" style={{ marginTop: '1rem' }}>
                            {consoleError}
                        </div>
                    )}

                    {stats && (
                        <div className="stats-grid">
                            <div className="stats-card">
                                <span className="stats-card__label">Broadcast</span>
                                <span className="stats-card__value">{stats.broadcast}</span>
                                <span className="stats-card__hint">Messages fan-out to all peers</span>
                            </div>
                            <div className="stats-card">
                                <span className="stats-card__label">Unicast</span>
                                <span className="stats-card__value">{stats.unicast}</span>
                                <span className="stats-card__hint">Direct node-to-node deliveries</span>
                            </div>
                            <div className="stats-card">
                                <span className="stats-card__label">Multicast</span>
                                <span className="stats-card__value">{stats.multicast}</span>
                                <span className="stats-card__hint">Targeted cohort messaging</span>
                            </div>
                            <div className="stats-card">
                                <span className="stats-card__label">Received</span>
                                <span className="stats-card__value">{stats.received}</span>
                                <span className="stats-card__hint">Inbound messages processed</span>
                            </div>
                        </div>
                    )}
                </section>

                <section className="feature-card">
                    <div className="section-header">
                        <h2>Realtime Communication Logs</h2>
                        <div className="section-actions log-controls">
                            <span className={`status-pill ${logsLoading ? 'is-syncing' : ''}`}>
                                {logsLoading ? 'Refreshing' : 'Live'}
                            </span>
                            <label className="log-node-picker">
                                <span>Node</span>
                                <select
                                    className="log-node-select"
                                    value={logNodeFilter}
                                    onChange={(event) => setLogNodeFilter(event.target.value)}
                                >
                                    {logNodeOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <button
                                type="button"
                                className={`action-button${autoRefreshLogs ? ' is-active' : ''}`}
                                onClick={() => setAutoRefreshLogs((prev) => !prev)}
                            >
                                Auto Refresh {autoRefreshLogs ? 'On' : 'Off'}
                            </button>
                            <button
                                type="button"
                                className="action-button"
                                onClick={() => fetchCommLogs()}
                                disabled={logsLoading}
                            >
                                {logsLoading ? 'Refreshing…' : 'Refresh Logs'}
                            </button>
                        </div>
                    </div>
                    {logsError && <div className="error-banner">{logsError}</div>}
                    <div className="log-summary">
                        <span>{filteredLogEntries.length} entries</span>
                        <span>{`Source: ${selectedNodeLabel}`}</span>
                    </div>
                    {!filteredLogEntries.length && !logsLoading ? (
                        <div className="empty-state">
                            No communication activity captured yet for this node. Send a message or wait for incoming traffic.
                        </div>
                    ) : (
                        <div className="log-feed">
                            {filteredLogEntries.map((entry, index) => {
                                const key = entry.id || `${entry.timestamp}-${index}`;
                                const targets = (entry.targets && entry.targets.length > 0
                                    ? entry.targets
                                    : entry.target_ips) || [];
                                const delivered = (entry.delivered && entry.delivered.length > 0
                                    ? entry.delivered
                                    : entry.delivered_ips) || [];
                                const failed = (entry.failed && entry.failed.length > 0
                                    ? entry.failed
                                    : entry.failed_ips) || [];
                                const isFailure = entry.result ? FAILURE_RESULTS.has(entry.result) : false;
                                const resultLabel = entry.result ? entry.result.replace(/_/g, ' ') : null;
                                const nodeLabel = getNodeLabel(entry.node, entry.node_ip);
                                return (
                                    <div key={key} className={`log-feed__item${isFailure ? ' is-error' : ''}`}>
                                        <div className="log-feed__meta">
                                            <span className="log-feed__title">{entry.event}</span>
                                            <span>{formatTime(entry.timestamp)}</span>
                                        </div>
                                        <div className="log-feed__badges">
                                            <span className={`badge badge-${entry.direction.toLowerCase()}`}>
                                                {entry.direction}
                                            </span>
                                            <span className="badge">{entry.mode}</span>
                                            {resultLabel && (
                                                <span className={`badge badge-result-${entry.result}`}>
                                                    {resultLabel}
                                                </span>
                                            )}
                                        </div>
                                        <div className="log-feed__line">
                                            <strong>{nodeLabel}</strong>{' '}
                                            {entry.direction === 'SENT' ? 'sent' : 'processed'} a {entry.mode.toLowerCase()} message
                                            {entry.direction === 'RECEIVED' && (entry.source || entry.source_ip) && (
                                                <> from <strong>{entry.source || entry.source_ip}</strong></>
                                            )}
                                            .
                                        </div>
                                        <div className="log-feed__line log-feed__line--meta">
                                            <span>Node IP: {entry.node_ip}</span>
                                            {entry.direction === 'RECEIVED' && entry.source_ip && (
                                                <span>Source IP: {entry.source_ip}</span>
                                            )}
                                            {entry.direction === 'SENT' && delivered.length > 0 && (
                                                <span>Delivered: {delivered.length}</span>
                                            )}
                                        </div>
                                        {targets.length > 0 && (
                                            <div className="log-feed__line">
                                                <span className="log-label">Targets:</span>
                                                <span>{formatList(targets)}</span>
                                            </div>
                                        )}
                                        {delivered.length > 0 && (
                                            <div className="log-feed__line">
                                                <span className="log-label success">Delivered:</span>
                                                <span>{formatList(delivered)}</span>
                                            </div>
                                        )}
                                        {failed.length > 0 && (
                                            <div className="log-feed__line">
                                                <span className="log-label error">Failed:</span>
                                                <span>{formatList(failed)}</span>
                                            </div>
                                        )}
                                        {entry.payload && Object.keys(entry.payload).length > 0 && (
                                            <pre className="log-feed__payload">
                                                {JSON.stringify(entry.payload, null, 2)}
                                            </pre>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
