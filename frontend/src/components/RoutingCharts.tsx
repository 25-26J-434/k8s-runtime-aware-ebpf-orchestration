import { useEffect, useMemo, useState } from 'react';
import {
    Bar,
    Chart as ReactChart,
} from 'react-chartjs-2';
import {
    BarElement,
    CategoryScale,
    Chart as ChartJS,
    Legend,
    LinearScale,
    Title,
    Tooltip,
} from 'chart.js';
import { api } from '../services/api';
import type { MetricsResponse, PodStats } from '../types/api';
import './RoutingCharts.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

type PodRow = {
    key: string;
    avgLatency: number;
    lastLatency: number;
    maxLatency: number;
};

const TARGET_NAMESPACE = 'test-services';

export function RoutingCharts() {
    const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let ignore = false;
        const fetchMetrics = async () => {
            try {
                const m = await api.getMetrics();
                if (!ignore) {
                    setMetrics(m);
                    setError(null);
                }
            } catch (err) {
                if (!ignore) setError((err as Error).message);
            }
        };

        fetchMetrics();
        const id = setInterval(fetchMetrics, 5000);
        return () => {
            ignore = true;
            clearInterval(id);
        };
    }, []);

    const podRows: PodRow[] = useMemo(() => {
        if (!metrics?.dns?.pods) return [];
        const rows: PodRow[] = [];
        Object.entries(metrics.dns.pods).forEach(([key, value]) => {
            if (!key.startsWith(`${TARGET_NAMESPACE}/`)) return;
            const stats = value as PodStats;
            rows.push({
                key,
                avgLatency: stats.avg_latency_us ?? 0,
                lastLatency: stats.last_latency_us ?? 0,
                maxLatency: stats.max_latency_us ?? 0,
            });
        });
        return rows.sort((a, b) => a.avgLatency - b.avgLatency);
    }, [metrics]);

    const chartData = useMemo(() => {
        const labels = podRows.map(r => r.key.split('/')[1]);
        return {
            labels,
            datasets: [
                {
                    label: 'Avg latency (µs)',
                    data: podRows.map(r => r.avgLatency),
                    backgroundColor: 'rgba(59, 130, 246, 0.6)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1,
                    borderRadius: 8,
                },
                {
                    label: 'Last latency (µs)',
                    data: podRows.map(r => r.lastLatency),
                    backgroundColor: 'rgba(14, 165, 233, 0.45)',
                    borderColor: 'rgba(14, 165, 233, 1)',
                    borderWidth: 1,
                    borderRadius: 8,
                },
                {
                    label: 'Max latency (µs)',
                    data: podRows.map(r => r.maxLatency),
                    backgroundColor: 'rgba(236, 72, 153, 0.35)',
                    borderColor: 'rgba(236, 72, 153, 1)',
                    borderWidth: 1,
                    borderRadius: 8,
                },
            ],
        };
    }, [podRows]);

    return (
        <div className="routing-charts">
            <div className="charts-header">
                <div>
                    <h2>Routing Telemetry Snapshot</h2>
                    <p>Compare per-pod DNS latency to pick the best target.</p>
                </div>
            </div>

            {error && <div className="charts-error">Error loading metrics: {error}</div>}

            {podRows.length === 0 ? (
                <div className="charts-empty">No pod metrics yet for namespace "{TARGET_NAMESPACE}".</div>
            ) : (
                <div className="chart-wrapper">
                    <ReactChart type="bar" data={chartData} options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                labels: { color: '#cbd5e1' },
                            },
                            title: {
                                display: false,
                                text: 'Pod Latency',
                            },
                        },
                        scales: {
                            x: {
                                ticks: { color: '#cbd5e1' },
                                grid: { color: 'rgba(255,255,255,0.05)' },
                            },
                            y: {
                                ticks: { color: '#cbd5e1' },
                                grid: { color: 'rgba(255,255,255,0.05)' },
                                beginAtZero: true,
                            },
                        },
                    }} />
                </div>
            )}
        </div>
    );
}
