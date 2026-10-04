import { useMemo, useState } from 'react';
import type { HealthAlert } from '../../types/health';
import { LEVEL_COLORS, formatAge, formatTimeShort } from './levels';

type Filter = 'firing' | 'all';

export function AlertFeed({ alerts }: { alerts: HealthAlert[] }) {
    const [filter, setFilter] = useState<Filter>('firing');

    const visible = useMemo(
        () => (filter === 'firing' ? alerts.filter((a) => a.status === 'firing') : alerts),
        [alerts, filter],
    );
    const firing = alerts.filter((a) => a.status === 'firing').length;

    return (
        <div>
            <div className="ch-toolbar">
                <div className="ch-segmented" role="group" aria-label="Alert filter">
                    <button className={filter === 'firing' ? 'is-active' : ''} onClick={() => setFilter('firing')}>
                        Firing ({firing})
                    </button>
                    <button className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>
                        History
                    </button>
                </div>
            </div>

            {visible.length === 0 ? (
                <div className="ch-empty">
                    {filter === 'firing' ? 'No active alerts. The cluster is within all thresholds.' : 'No alerts recorded yet.'}
                </div>
            ) : (
                <ul className="ch-alerts">
                    {visible.map((a) => {
                        const resolved = a.status === 'resolved';
                        const color = resolved ? '#64748b' : LEVEL_COLORS[a.severity];
                        return (
                            <li key={a.id} className={`ch-alert${resolved ? ' is-resolved' : ''}`} style={{ borderLeftColor: color }}>
                                <div className="ch-alert__top">
                                    <span className="ch-badge" style={{ color, borderColor: color, background: `${color}1f` }}>
                                        {resolved ? 'Resolved' : a.severity}
                                    </span>
                                    <span className="ch-alert__node">{a.node}</span>
                                    <span className="ch-alert__time" title={a.fired_at}>
                                        {formatAge(resolved ? a.resolved_at : a.fired_at)}
                                    </span>
                                </div>
                                <div className="ch-alert__msg">{a.message}</div>
                                {resolved && a.resolved_at && (
                                    <div className="ch-alert__meta">
                                        Fired {formatTimeShort(a.fired_at)} · resolved {formatTimeShort(a.resolved_at)}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
