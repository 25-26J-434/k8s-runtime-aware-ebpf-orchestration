import type { HealthLevel, PeerState } from '../../types/health';

export const LEVEL_COLORS: Record<HealthLevel, string> = {
    excellent: '#10b981',
    good: '#3b82f6',
    warning: '#f59e0b',
    critical: '#ef4444',
    unknown: '#94a3b8',
};

export const LEVEL_LABELS: Record<HealthLevel, string> = {
    excellent: 'Excellent',
    good: 'Good',
    warning: 'Warning',
    critical: 'Critical',
    unknown: 'No Data',
};

export const PEER_COLORS: Record<PeerState, string> = {
    up: '#10b981',
    degraded: '#f59e0b',
    down: '#ef4444',
    unknown: '#94a3b8',
};

export function formatValue(value: number, unit: string): string {
    const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${unit}`;
}

export function formatTimeShort(iso?: string): string {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatAge(iso?: string, now: number = Date.now()): string {
    if (!iso) return '-';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '-';
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
}
