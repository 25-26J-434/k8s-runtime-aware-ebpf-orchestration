import { useMemo } from 'react';
import './Page.css';
import './ClusterHealth.css';
import { useClusterHealth } from '../hooks/useClusterHealth';
import { ScoreRing } from '../components/health/ScoreRing';
import { NodeHealthCard } from '../components/health/NodeHealthCard';
import { HealthTrend } from '../components/health/HealthTrend';
import { AlertFeed } from '../components/health/AlertFeed';
import { PeerTable } from '../components/health/PeerTable';
import { ThresholdEditor } from '../components/health/ThresholdEditor';
import { LEVEL_COLORS, LEVEL_LABELS, formatTimeShort } from '../components/health/levels';
import type { HealthLevel } from '../types/health';

const LEVEL_ORDER: HealthLevel[] = ['excellent', 'good', 'warning', 'critical', 'unknown'];

export function ClusterHealth() {
    const { cluster, history, alerts, thresholds, loading, error, lastUpdated, refresh, setThresholds } = useClusterHealth(5000);

    const nodes = cluster?.cluster.nodes ?? [];
    const peers = cluster?.peers ?? [];
    const counts = cluster?.cluster.counts ?? {};
    const peersUp = peers.filter((p) => p.status === 'up').length;
    const level: HealthLevel = cluster?.cluster.level ?? 'unknown';

    const sortedNodes = useMemo(
        () => [...nodes].sort((a, b) => a.score - b.score || a.node.localeCompare(b.node)),
        [nodes],
    );

    return (
        <div className="page-container ch-page">
            <header className="page-header">
                <div className="page-title-section">
                    <h1 className="page-title">Cluster Health</h1>
                    <p className="page-subtitle">
                        Live health scoring for every node, with alerts, peer connectivity and tunable thresholds.
                    </p>
                </div>
            </header>

            <div className="ch-status-bar">
                <span className={`ch-live ${error ? 'is-error' : ''}`}>
                    <span className="ch-live__dot" aria-hidden />
                    {error ? 'Disconnected' : loading ? 'Connecting…' : 'Live'}
                </span>
                {lastUpdated && <span className="ch-muted">Updated {formatTimeShort(lastUpdated.toISOString())}</span>}
                <button className="ch-btn" onClick={refresh}>Refresh</button>
            </div>

            {error && (
                <div className="ch-note is-error" role="alert">
                    Could not reach the daemon API: {error}
                    {cluster && ' Showing the last data received.'}
                </div>
            )}

            <div className="page-content">
                <section className="feature-card" aria-labelledby="ch-overview">
                    <h2 id="ch-overview">Overview</h2>
                    {!cluster ? (
                        <div className="ch-empty">{loading ? 'Loading cluster health…' : 'No data yet.'}</div>
                    ) : (
                        <div className="ch-overview">
                            <div className="ch-overview__score">
                                <ScoreRing score={cluster.cluster.score} level={level} size={150} label="Cluster" />
                                <div>
                                    <div className="ch-overview__level" style={{ color: LEVEL_COLORS[level] }}>
                                        {LEVEL_LABELS[level]}
                                    </div>
                                    <div className="ch-muted">Mean of {nodes.length} node score{nodes.length === 1 ? '' : 's'}</div>
                                </div>
                            </div>

                            <div className="ch-stats">
                                <div className="ch-stat">
                                    <span className="ch-stat__label">Nodes</span>
                                    <span className="ch-stat__value">{nodes.length}</span>
                                    <span className="ch-stat__detail">
                                        {LEVEL_ORDER.filter((l) => counts[l]).map((l) => `${counts[l]} ${l}`).join(' · ') || '-'}
                                    </span>
                                </div>
                                <div className="ch-stat">
                                    <span className="ch-stat__label">Firing alerts</span>
                                    <span className="ch-stat__value" style={{ color: cluster.firing_alerts > 0 ? LEVEL_COLORS.critical : LEVEL_COLORS.excellent }}>
                                        {cluster.firing_alerts}
                                    </span>
                                    <span className="ch-stat__detail">{cluster.firing_alerts === 0 ? 'All clear' : 'Needs attention'}</span>
                                </div>
                                <div className="ch-stat">
                                    <span className="ch-stat__label">Peers reachable</span>
                                    <span className="ch-stat__value" style={{ color: peers.length > 0 && peersUp < peers.length ? LEVEL_COLORS.warning : undefined }}>
                                        {peers.length === 0 ? '-' : `${peersUp}/${peers.length}`}
                                    </span>
                                    <span className="ch-stat__detail">Heartbeat every few seconds</span>
                                </div>
                            </div>
                        </div>
                    )}
                </section>

                <section className="feature-card" aria-labelledby="ch-nodes">
                    <h2 id="ch-nodes">Nodes</h2>
                    {sortedNodes.length === 0 ? (
                        <div className="ch-empty">No nodes have reported metrics yet. Make sure the daemon DaemonSet is running.</div>
                    ) : (
                        <div className="ch-node-grid">
                            {sortedNodes.map((n) => <NodeHealthCard key={n.node} node={n} />)}
                        </div>
                    )}
                </section>

                <section className="feature-card" aria-labelledby="ch-trend">
                    <h2 id="ch-trend">Health Trend</h2>
                    <HealthTrend history={history} />
                </section>

                <section className="feature-card" aria-labelledby="ch-alerts">
                    <h2 id="ch-alerts">Alerts</h2>
                    <AlertFeed alerts={alerts} />
                </section>

                <section className="feature-card" aria-labelledby="ch-peers">
                    <h2 id="ch-peers">Peer Connectivity</h2>
                    <PeerTable peers={peers} />
                </section>

                <section className="feature-card" aria-labelledby="ch-thresholds">
                    <h2 id="ch-thresholds">Health Thresholds</h2>
                    <ThresholdEditor thresholds={thresholds} onChange={setThresholds} />
                </section>
            </div>
        </div>
    );
}
