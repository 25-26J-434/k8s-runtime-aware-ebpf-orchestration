import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
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
    title: string;
    description: string;
}> = [
    { value: 'BROADCAST', title: 'Broadcast', description: 'Notify every node simultaneously.' },
    { value: 'UNICAST', title: 'Unicast', description: 'Deliver to a single targeted peer.' },
    { value: 'MULTICAST', title: 'Multicast', description: 'Fan out to a selected group of peers.' },
];

const EVENT_OPTIONS = ['HANDSHAKE', 'HEALTH_ALERT', 'SCHEDULING', 'STATE_UPDATE', 'METRIC_UPDATE', 'DISCOVERY'] as const;
const VISIBLE_LOG_LIMIT = 60;
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
    const [logSearch, setLogSearch] = useState('');
    const [logEventFilter, setLogEventFilter] = useState('');
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

    type Summary = {
        totalNodes: number;
        readyNodes: number;
        totalPods: number;
        runningPods: number;
        messageCount: number;
        broadcastCount: number;
        unicastCount: number;
        multicastCount: number;
        peerCount: number;
        lastUpdate: string | null;
    };

    const summary: Summary = useMemo(() => {
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
            setLogEntries((prev) => {
                const oldKey = prev.map((e) => `${e.timestamp}-${e.event}-${e.node_ip}`).join('|');
                const newKey = entries.map((e) => `${e.timestamp}-${e.event}-${e.node_ip}`).join('|');
                return oldKey === newKey ? prev : entries;
            });
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

    const refreshAll = useCallback(async () => {
        await Promise.all([fetchTopology(), fetchStats(), fetchCommLogs()]);
    }, [fetchTopology, fetchStats, fetchCommLogs]);

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

    const logEventOptions = useMemo(() => {
        return Array.from(
            new Set(logEntries.map((entry) => entry.event).filter((event): event is string => Boolean(event))),
        ).sort();
    }, [logEntries]);

    useEffect(() => {
        if (logNodeFilter === ALL_NODES_OPTION) {
            return;
        }
        const stillExists = logNodeOptions.some((option) => option.value === logNodeFilter);
        if (!stillExists) {
            setLogNodeFilter(ALL_NODES_OPTION);
        }
    }, [logNodeFilter, logNodeOptions]);

    const deferredLogSearch = useDeferredValue(logSearch);

    const filteredLogEntries = useMemo(() => {
        const search = deferredLogSearch.trim().toLowerCase();

        return logEntries
            .filter((entry) => {
                if (logNodeFilter !== ALL_NODES_OPTION) {
                    const matchesNode = entry.node === logNodeFilter || entry.node_ip === logNodeFilter;
                    if (!matchesNode) {
                        return false;
                    }
                }

                if (logEventFilter && entry.event !== logEventFilter) {
                    return false;
                }

                if (!search) {
                    return true;
                }

                const searchableText = [
                    entry.event,
                    entry.node,
                    entry.node_ip,
                    entry.mode,
                    entry.direction,
                    entry.result,
                    entry.payload ? JSON.stringify(entry.payload) : '',
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();

                return searchableText.includes(search);
            })
            .slice(0, VISIBLE_LOG_LIMIT);
    }, [logEntries, logNodeFilter, logEventFilter, deferredLogSearch]);

    const selectedNodeLabel = useMemo(() => {
        if (logNodeFilter === ALL_NODES_OPTION) {
            return 'All Nodes';
        }
        const match = logNodeOptions.find((option) => option.value === logNodeFilter);
        return match?.label || 'Selected Node';
    }, [logNodeFilter, logNodeOptions]);

    const selectedTargetLabels = useMemo(() => {
        return Array.from(selectedNodes).map((ip) => nodeMap.get(ip)?.name || ip);
    }, [selectedNodes, nodeMap]);

    const clusterHealth = useMemo(() => {
        if (summary.totalNodes === 0) {
            return 'Unknown';
        }
        return summary.readyNodes === summary.totalNodes ? 'Healthy' : 'Degraded';
    }, [summary.readyNodes, summary.totalNodes]);

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
        const targetLabels = messageType === 'BROADCAST' ? ['All nodes'] : targetIps.map((ip) => nodeMap.get(ip)?.name || ip);
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
        <div className="page-container federation-page">
            <div className="page-header federation-header">
                <div className="page-title-section">
                    <h1 className="page-title">Federation Control Plane</h1>
                    <p className="page-subtitle">Monitor node health, send cross-node messages, and inspect communication flow in real time.</p>
                </div>
                <div className="federation-header-actions">
                    <span className={`status-pill ${loadingNodes || logsLoading ? 'is-syncing' : ''}`}>
                        {loadingNodes || logsLoading ? 'Syncing' : 'Live'}
                    </span>
                    <button type="button" className="action-button" onClick={refreshAll}>
                        Refresh All
                    </button>
                </div>
            </div>

            <div className="page-content federation-content">
                <section className="feature-card">
                    <div className="section-header">
                        <h2>Cluster Snapshot</h2>
                        <div className="section-actions">
                            <button type="button" className="action-button" onClick={fetchTopology} disabled={loadingNodes}>
                                {loadingNodes ? 'Refreshing...' : 'Refresh Nodes'}
                            </button>
                        </div>
                    </div>
                    {topologyError && <div className="error-banner">{topologyError}</div>}

                    <div className="federation-summary">
                        <div className="summary-card">
                            <span className="summary-card__label">Cluster Nodes</span>
                            <span className="summary-card__value">{summary.totalNodes}</span>
                            <span className="summary-card__detail">{summary.readyNodes} ready</span>
                        </div>
                        <div className="summary-card">
                            <span className="summary-card__label">Health</span>
                            <span className={`summary-card__value ${clusterHealth === 'Healthy' ? 'is-ok' : 'is-warn'}`}>{clusterHealth}</span>
                            <span className="summary-card__detail">{summary.readyNodes} / {summary.totalNodes} nodes healthy</span>
                        </div>
                        <div className="summary-card">
                            <span className="summary-card__label">Workload Pods</span>
                            <span className="summary-card__value">{summary.runningPods}</span>
                            <span className="summary-card__detail">{summary.totalPods} total scheduled</span>
                        </div>
                        <div className="summary-card">
                            <span className="summary-card__label">Messages</span>
                            <span className="summary-card__value">{summary.messageCount}</span>
                            <span className="summary-card__detail">{summary.peerCount} peers discovered</span>
                        </div>
                        <div className="summary-card">
                            <span className="summary-card__label">Traffic Mix</span>
                            <span className="summary-card__value">{summary.broadcastCount + summary.unicastCount + summary.multicastCount}</span>
                            <span className="summary-card__detail">
                                B: {summary.broadcastCount} · U: {summary.unicastCount} · M: {summary.multicastCount}
                            </span>
                        </div>
                        <div className="summary-card">
                            <span className="summary-card__label">Last Activity</span>
                            <span className="summary-card__value small">{summary.lastUpdate ? formatTime(summary.lastUpdate) : '--:--:--'}</span>
                            <span className="summary-card__detail">Communication stats update</span>
                        </div>
                    </div>
                </section>

                <section className="feature-card">
                    <div className="section-header">
                        <h2>Communication Console</h2>
                        <div className="section-actions">
                            <button type="button" className="action-button" onClick={fetchStats}>
                                Refresh Stats
                            </button>
                        </div>
                    </div>

                    {statsError && <div className="error-banner">{statsError}</div>}
                    <div className="federation-console-meta">Mode: Full Mesh · Heartbeat: 5s · Target Scope: Cluster</div>

                    <div className="federation-console-grid">
                        <div className="federation-console-panel">
                            <div className="mode-selector">
                                {COMMUNICATION_MODES.map((mode) => (
                                    <button
                                        key={mode.value}
                                        type="button"
                                        className={`mode-card${messageType === mode.value ? ' is-active' : ''}`}
                                        onClick={() => handleModeChange(mode.value)}
                                    >
                                        <span className="mode-card__title">{mode.title}</span>
                                        <span className="mode-card__help">{mode.description}</span>
                                    </button>
                                ))}
                            </div>

                            <div className="federation-form-group">
                                <h3 className="event-type-label">Event Type</h3>
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
                                <div className="selected-targets">
                                    <span className="selected-targets__label">Selected Targets</span>
                                    <span className="selected-targets__value">
                                        {selectedTargetLabels.length === 0
                                            ? messageType === 'UNICAST'
                                                ? 'Choose one node from the right panel.'
                                                : 'Choose one or more nodes from the right panel.'
                                            : selectedTargetLabels.join(', ')}
                                    </span>
                                </div>
                            )}

                            <div className="federation-form-group">
                                <h3 className="payload-label">Message Payload</h3>
                                <textarea
                                    className="payload-textarea"
                                    value={messagePayload}
                                    onChange={(event) => setMessagePayload(event.target.value)}
                                    placeholder='{"message": "Hello nodes", "priority": "high"}'
                                />
                            </div>

                            <div className="console-actions">
                                <button
                                    type="button"
                                    className="action-button"
                                    onClick={handleSendMessage}
                                    disabled={!canSend || sending}
                                    title={`Send ${messageType} message`}
                                >
                                    {sending ? 'Sending...' : `Send ${messageType}`}
                                </button>
                            </div>

                            {consoleError && <div className="error-banner">{consoleError}</div>}

                            {stats && (
                                <div className="stats-grid federation-stats-grid">
                                    <div className="stats-card">
                                        <span className="stats-card__label">Broadcast</span>
                                        <span className="stats-card__value">{stats.broadcast}</span>
                                        <span className="stats-card__hint">Fan-out messages</span>
                                    </div>
                                    <div className="stats-card">
                                        <span className="stats-card__label">Unicast</span>
                                        <span className="stats-card__value">{stats.unicast}</span>
                                        <span className="stats-card__hint">Direct node delivery</span>
                                    </div>
                                    <div className="stats-card">
                                        <span className="stats-card__label">Multicast</span>
                                        <span className="stats-card__value">{stats.multicast}</span>
                                        <span className="stats-card__hint">Group-targeted messages</span>
                                    </div>
                                    <div className="stats-card">
                                        <span className="stats-card__label">Received</span>
                                        <span className="stats-card__value">{stats.received}</span>
                                        <span className="stats-card__hint">Inbound processed</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="federation-console-panel">
                            <div className="section-header compact">
                                <h3>Target Nodes</h3>
                                <span className="node-selection-hint">
                                    {messageType === 'BROADCAST'
                                        ? 'Broadcast uses all healthy nodes.'
                                        : messageType === 'UNICAST'
                                          ? 'Select exactly one node.'
                                          : 'Select one or more nodes.'}
                                </span>
                            </div>

                            {!nodes.length && !loadingNodes ? (
                                <div className="empty-state">No nodes available. Ensure federation agents are running.</div>
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
                                                    <div>
                                                        <div className="node-card__name">{node.name}</div>
                                                        <div className="node-card__meta">{node.role || 'worker'} · {node.ip}</div>
                                                    </div>
                                                    <span className={`node-card__status ${statusClass}`}>{node.status}</span>
                                                </div>
                                                <div className="node-card__kv">
                                                    <div className="node-card__kv-row">
                                                        <span className="node-card__kv-label">Pods</span>
                                                        <span className="node-card__kv-value">{node.runningPods}/{node.podCount}</span>
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
                        </div>
                    </div>
                </section>

                <section className="feature-card">
                    <div className="section-header">
                        <h2>Realtime Communication Logs</h2>
                        <div className="section-actions log-controls">
                            <span className={`status-pill ${logsLoading ? 'is-syncing' : ''}`}>
                                {logsLoading ? 'Refreshing' : 'Live'}
                            </span>
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
                                {logsLoading ? 'Refreshing...' : 'Refresh Logs'}
                            </button>
                        </div>
                    </div>

                    {logsError && <div className="error-banner">{logsError}</div>}

                    <div className="logs-controls">
                        <input
                            type="text"
                            placeholder="Search event, node, mode, result..."
                            className="log-search"
                            value={logSearch}
                            onChange={(e) => setLogSearch(e.target.value)}
                        />
                        <select className="log-filter-select" value={logEventFilter} onChange={(e) => setLogEventFilter(e.target.value)}>
                            <option value="">All Events</option>
                            {logEventOptions.map((ev) => (
                                <option key={ev} value={ev}>
                                    {ev}
                                </option>
                            ))}
                        </select>
                        <label className="log-node-picker">
                            <span>Node</span>
                            <select className="log-node-select" value={logNodeFilter} onChange={(event) => setLogNodeFilter(event.target.value)}>
                                {logNodeOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className="log-summary">
                        <span>{filteredLogEntries.length} entries shown</span>
                        <span>{`Source: ${selectedNodeLabel}`}</span>
                    </div>

                    {!filteredLogEntries.length && !logsLoading ? (
                        <div className="empty-state">No communication activity for the selected filters.</div>
                    ) : (
                        <div className="log-feed">
                            {filteredLogEntries.map((entry, index) => {
                                const key = entry.id || `${entry.timestamp}-${index}`;
                                const targets = (entry.targets && entry.targets.length > 0 ? entry.targets : entry.target_ips) || [];
                                const delivered = (entry.delivered && entry.delivered.length > 0 ? entry.delivered : entry.delivered_ips) || [];
                                const failed = (entry.failed && entry.failed.length > 0 ? entry.failed : entry.failed_ips) || [];
                                const isFailure = entry.result ? FAILURE_RESULTS.has(entry.result) : false;
                                const resultLabel = entry.result ? entry.result.replace(/_/g, ' ') : null;
                                const nodeLabel = getNodeLabel(entry.node, entry.node_ip);
                                const direction = entry.direction ?? 'UNKNOWN';
                                const mode = entry.mode ?? 'UNKNOWN';

                                // Support both flat payload { message, priority } and nested { event, payload: { message, priority }, action }
                                const innerPayload = (entry.payload?.payload && typeof entry.payload.payload === 'object')
                                    ? (entry.payload.payload as Record<string, unknown>)
                                    : entry.payload;
                                const effectiveEvent = entry.event
                                    || (entry.payload?.event && typeof entry.payload.event === 'string' ? entry.payload.event : null)
                                    || 'Unknown';
                                const payloadMessage = innerPayload && typeof innerPayload.message === 'string' ? innerPayload.message : null;
                                const payloadPriority = innerPayload && typeof innerPayload.priority === 'string' ? (innerPayload.priority as string) : null;

                                return (
                                    <div key={key} className={`log-feed__item${isFailure ? ' is-error' : ''}`}>
                                        <div className="log-feed__meta">
                                            <span className="log-feed__title">{effectiveEvent}</span>
                                            <span>{formatTime(entry.timestamp)}</span>
                                        </div>
                                        <div className="log-feed__badges">
                                            <span className={`badge badge-${direction.toLowerCase()}`}>{direction}</span>
                                            <span className="badge">{mode}</span>
                                            {payloadPriority && (
                                                <span className={`badge badge-priority-${payloadPriority.toLowerCase()}`}>
                                                    {payloadPriority.toUpperCase()}
                                                </span>
                                            )}
                                            {resultLabel && <span className={`badge badge-result-${entry.result}`}>{resultLabel}</span>}
                                        </div>
                                        <div className="log-feed__line">
                                            <strong>{nodeLabel}</strong> {direction === 'SENT' ? 'sent' : 'processed'} a{' '}
                                            {mode.toLowerCase()} message
                                            {direction === 'RECEIVED' && (entry.source || entry.source_ip) && (
                                                <>
                                                    {' '}
                                                    from <strong>{entry.source || entry.source_ip}</strong>
                                                </>
                                            )}
                                            .
                                        </div>
                                        {payloadMessage && (
                                            <div className="log-feed__line log-feed__message">
                                                {payloadMessage}
                                            </div>
                                        )}
                                        <div className="log-feed__line log-feed__line--meta">
                                            <span>Node IP: {entry.node_ip}</span>
                                            {direction === 'RECEIVED' && entry.source_ip && <span>Source IP: {entry.source_ip}</span>}
                                            {direction === 'SENT' && delivered.length > 0 && <span>Delivered: {delivered.length}</span>}
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
                                        {innerPayload && Object.keys(innerPayload).length > 0 && (
                                            <pre className="log-feed__payload">{JSON.stringify(innerPayload, null, 2)}</pre>
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
