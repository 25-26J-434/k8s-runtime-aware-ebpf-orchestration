import { useMemo } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { HealthPoint } from '../../types/health';
import { formatTimeShort } from './levels';

const SERIES_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#fb923c'];

interface HealthTrendProps {
    history: Record<string, HealthPoint[] | null>;
}

/** Score-over-time chart, one line per node. */
export function HealthTrend({ history }: HealthTrendProps) {
    const { rows, nodes } = useMemo(() => {
        const nodeNames = Object.keys(history).sort();
        const byTime = new Map<string, Record<string, number | string>>();
        nodeNames.forEach((name) => {
            (history[name] ?? []).forEach((p) => {
                const row = byTime.get(p.time) ?? { time: p.time };
                row[name] = p.score;
                byTime.set(p.time, row);
            });
        });
        const sorted = Array.from(byTime.values()).sort(
            (a, b) => new Date(a.time as string).getTime() - new Date(b.time as string).getTime(),
        );
        return { rows: sorted, nodes: nodeNames };
    }, [history]);

    if (rows.length < 2) {
        return <div className="ch-empty">Collecting history… the trend appears after a few evaluation cycles.</div>;
    }

    return (
        <ResponsiveContainer width="100%" height={260}>
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.15)" strokeDasharray="3 3" />
                <XAxis dataKey="time" tickFormatter={formatTimeShort} stroke="#94a3b8" fontSize={12} minTickGap={48} />
                <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={12} />
                <Tooltip
                    labelFormatter={(v) => formatTimeShort(String(v))}
                    contentStyle={{ background: '#0f172a', border: '1px solid rgba(59,130,246,0.4)', borderRadius: 8 }}
                    formatter={(v) => (typeof v === 'number' ? v.toFixed(1) : String(v))}
                />
                <Legend />
                {nodes.map((name, i) => (
                    <Line
                        key={name}
                        type="monotone"
                        dataKey={name}
                        stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                    />
                ))}
            </LineChart>
        </ResponsiveContainer>
    );
}
