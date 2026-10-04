import { useState } from 'react';
import { healthApi } from '../../services/healthApi';
import type { HealthBand, ThresholdMetric, ThresholdsResponse } from '../../types/health';
import { LEVEL_COLORS } from './levels';

type Draft = Record<keyof HealthBand, string>;

const FIELDS: Array<{ key: keyof HealthBand; label: string; color: string }> = [
    { key: 'excellent', label: 'Excellent <', color: LEVEL_COLORS.excellent },
    { key: 'good', label: 'Good <', color: LEVEL_COLORS.good },
    { key: 'warning', label: 'Warning <', color: LEVEL_COLORS.warning },
];

const toDraft = (b: HealthBand): Draft => ({
    excellent: String(b.excellent),
    good: String(b.good),
    warning: String(b.warning),
});

function parseDraft(d: Draft): HealthBand | string {
    const band = {
        excellent: Number(d.excellent),
        good: Number(d.good),
        warning: Number(d.warning),
    };
    if (Object.values(band).some((n) => d.excellent === '' || d.good === '' || d.warning === '' || !Number.isFinite(n) || n < 0)) {
        return 'Enter non-negative numbers in every field.';
    }
    if (band.excellent > band.good || band.good > band.warning) {
        return 'Values must satisfy excellent ≤ good ≤ warning.';
    }
    if (band.warning === 0) return 'Warning threshold must be greater than zero.';
    return band;
}

const sameBand = (a: HealthBand, b: HealthBand) =>
    a.excellent === b.excellent && a.good === b.good && a.warning === b.warning;

interface ThresholdEditorProps {
    thresholds: ThresholdsResponse | null;
    onChange: (t: ThresholdsResponse) => void;
}

export function ThresholdEditor({ thresholds, onChange }: ThresholdEditorProps) {
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<{ id: string; text: string; ok: boolean } | null>(null);

    if (!thresholds) return <div className="ch-empty">Loading thresholds…</div>;

    const clearDraft = (id: string) =>
        setDrafts((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
        });

    const run = async (id: string, action: () => Promise<ThresholdsResponse>, okText: string) => {
        setBusy(id);
        setMessage(null);
        try {
            const updated = await action();
            onChange(updated);
            if (id === '*') setDrafts({});
            else clearDraft(id);
            setMessage({ id, text: okText, ok: true });
        } catch (e) {
            setMessage({ id, text: e instanceof Error ? e.message : 'Request failed', ok: false });
        } finally {
            setBusy(null);
        }
    };

    const save = (m: ThresholdMetric) => {
        const draft = drafts[m.id];
        if (!draft) return;
        const parsed = parseDraft(draft);
        if (typeof parsed === 'string') {
            setMessage({ id: m.id, text: parsed, ok: false });
            return;
        }
        run(m.id, () => healthApi.setThresholds({ [m.id]: parsed }), 'Saved');
    };

    const anyCustom = thresholds.metrics.some((m) => m.is_custom);

    return (
        <div>
            <div className="ch-toolbar">
                <p className="ch-muted ch-toolbar__hint">
                    Standard thresholds are always available. Override any metric with your own values, or revert it to the standard.
                </p>
                <button
                    className="ch-btn"
                    disabled={!anyCustom || busy !== null}
                    onClick={() => run('*', () => healthApi.resetThresholds(), 'All thresholds reset to standard')}
                >
                    Reset all to standard
                </button>
            </div>
            {message?.id === '*' && <div className={`ch-note ${message.ok ? 'is-ok' : 'is-error'}`}>{message.text}</div>}

            <div className="ch-table-wrap">
                <table className="ch-table ch-table--thresholds">
                    <thead>
                        <tr>
                            <th>Metric</th>
                            <th>Standard</th>
                            {FIELDS.map((f) => (
                                <th key={f.key}>
                                    <span className="ch-dot" style={{ background: f.color }} aria-hidden /> {f.label}
                                </th>
                            ))}
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {thresholds.metrics.map((m) => {
                            const draft = drafts[m.id];
                            const shown = draft ?? toDraft(m.active);
                            const parsed = draft ? parseDraft(draft) : null;
                            const dirty = !!draft && (typeof parsed === 'string' || !sameBand(parsed as HealthBand, m.active));
                            return (
                                <tr key={m.id}>
                                    <td>
                                        <strong>{m.label}</strong>
                                        <div className="ch-muted">
                                            {m.unit}
                                            {m.is_custom && <span className="ch-badge ch-badge--custom">Custom</span>}
                                        </div>
                                    </td>
                                    <td className="ch-muted">
                                        {m.standard.excellent} / {m.standard.good} / {m.standard.warning}
                                    </td>
                                    {FIELDS.map((f) => (
                                        <td key={f.key}>
                                            <input
                                                type="number"
                                                min={0}
                                                step="any"
                                                className="ch-input"
                                                aria-label={`${m.label} ${f.label}`}
                                                value={shown[f.key]}
                                                onChange={(e) =>
                                                    setDrafts((prev) => ({ ...prev, [m.id]: { ...(prev[m.id] ?? toDraft(m.active)), [f.key]: e.target.value } }))
                                                }
                                            />
                                        </td>
                                    ))}
                                    <td className="ch-actions">
                                        <button className="ch-btn ch-btn--primary" disabled={!dirty || busy !== null} onClick={() => save(m)}>
                                            Save
                                        </button>
                                        {dirty && (
                                            <button className="ch-btn" disabled={busy !== null} onClick={() => clearDraft(m.id)}>
                                                Cancel
                                            </button>
                                        )}
                                        {m.is_custom && !dirty && (
                                            <button
                                                className="ch-btn"
                                                disabled={busy !== null}
                                                onClick={() => run(m.id, () => healthApi.resetThresholds(m.id), 'Reverted to standard')}
                                            >
                                                Use standard
                                            </button>
                                        )}
                                        {message?.id === m.id && (
                                            <div className={`ch-note ch-note--inline ${message.ok ? 'is-ok' : 'is-error'}`}>{message.text}</div>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <p className="ch-muted ch-footnote">
                A value below “Excellent” is excellent, below “Good” is good, below “Warning” is warning, and at or above “Warning” is critical.
            </p>
        </div>
    );
}
