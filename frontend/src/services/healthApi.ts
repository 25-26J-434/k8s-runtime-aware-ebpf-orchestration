import { API_BASE } from './api';
import type {
    ClusterHealthResponse,
    HealthAlert,
    HealthBand,
    HealthHistoryResponse,
    ThresholdsResponse,
} from '../types/health';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
        cache: 'no-cache',
        headers: { 'Content-Type': 'application/json' },
        ...init,
    });
    if (!response.ok) {
        // The backend returns {"error": "..."} for validation problems.
        let detail = `${response.status} ${response.statusText}`;
        try {
            const body = await response.json();
            if (body?.error) detail = body.error;
        } catch {
            /* non-JSON error body */
        }
        throw new Error(detail);
    }
    return response.json();
}

export const healthApi = {
    getCluster: () => request<ClusterHealthResponse>('/api/health/cluster'),

    getHistory: (limit = 120) =>
        request<HealthHistoryResponse>(`/api/health/history?limit=${limit}`),

    async getAlerts(status?: 'firing' | 'resolved'): Promise<HealthAlert[]> {
        const query = status ? `?status=${status}` : '';
        const data = await request<{ alerts: HealthAlert[] }>(`/api/health/alerts${query}`);
        return data.alerts;
    },

    getThresholds: () => request<ThresholdsResponse>('/api/health/thresholds'),

    setThresholds: (thresholds: Record<string, HealthBand>) =>
        request<ThresholdsResponse>('/api/health/thresholds', {
            method: 'PUT',
            body: JSON.stringify({ thresholds }),
        }),

    /** Reset one metric to the standard value, or all when metric is omitted. */
    resetThresholds: (metric?: string) =>
        request<ThresholdsResponse>(
            `/api/health/thresholds${metric ? `?metric=${encodeURIComponent(metric)}` : ''}`,
            { method: 'DELETE' },
        ),
};
