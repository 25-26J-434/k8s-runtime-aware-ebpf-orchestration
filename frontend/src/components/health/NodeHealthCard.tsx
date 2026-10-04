import type { NodeHealth } from '../../types/health';
import { ScoreRing } from './ScoreRing';
import { LEVEL_COLORS, LEVEL_LABELS, formatValue } from './levels';

export function NodeHealthCard({ node }: { node: NodeHealth }) {
    const components = node.components ?? [];
    const color = LEVEL_COLORS[node.level];

    return (
        <div className="ch-node-card" style={{ borderColor: `${color}55` }}>
            <div className="ch-node-card__head">
                <ScoreRing score={node.score} level={node.level} size={84} label={node.node} />
                <div className="ch-node-card__id">
                    <div className="ch-node-card__name" title={node.node}>{node.node}</div>
                    {node.ip && <div className="ch-node-card__ip">{node.ip}</div>}
                    <div className="ch-badges">
                        <span className="ch-badge" style={{ color, borderColor: color, background: `${color}1f` }}>
                            {LEVEL_LABELS[node.level]}
                        </span>
                        {node.stale && <span className="ch-badge ch-badge--stale">Stale</span>}
                    </div>
                </div>
            </div>

            {components.length === 0 ? (
                <div className="ch-empty ch-empty--small">No telemetry yet. Waiting for events on this node.</div>
            ) : (
                <ul className="ch-components">
                    {components.map((c) => (
                        <li key={c.id} className="ch-component">
                            <span className="ch-dot" style={{ background: LEVEL_COLORS[c.level] }} aria-hidden />
                            <span className="ch-component__label">{c.label}</span>
                            <span className="ch-component__value" style={{ color: LEVEL_COLORS[c.level] }}>
                                {formatValue(c.value, c.unit)}
                            </span>
                            <span className="sr-only">{LEVEL_LABELS[c.level]}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
