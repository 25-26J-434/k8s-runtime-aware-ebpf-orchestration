import { useMetrics } from '../hooks/useMetrics';
import './TopPerformers.css';

export function TopPerformers() {
    const { metrics } = useMetrics(3000);

    if (!metrics || !metrics.dns.pods) return null;

    const pods = Object.entries(metrics.dns.pods)
        .map(([key, stats]) => ({
            key,
            name: key.split('/')[1],
            namespace: key.split('/')[0],
            ...stats
        }))
        .sort((a, b) => a.avg_latency_us - b.avg_latency_us);

    const topPerformers = pods.slice(0, 5);
    const worstPerformers = [...pods].reverse().slice(0, 5);

    return (
        <div className="top-performers">
            <div className="performers-section">
                <h3>Top Performers</h3>
                <div className="performers-list">
                    {topPerformers.map((pod, index) => (
                        <div key={pod.key} className="performer-item best">
                            <div className="performer-rank">{index + 1}</div>
                            <div className="performer-info">
                                <div className="performer-name">{pod.name}</div>
                                <div className="performer-namespace">{pod.namespace}</div>
                            </div>
                            <div className="performer-metric">
                                <span className="performer-value">{pod.avg_latency_us.toFixed(2)}</span>
                                <span className="performer-unit">μs</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="performers-section">
                <h3>Needs Attention</h3>
                <div className="performers-list">
                    {worstPerformers.map((pod, index) => (
                        <div key={pod.key} className="performer-item worst">
                            <div className="performer-rank">{index + 1}</div>
                            <div className="performer-info">
                                <div className="performer-name">{pod.name}</div>
                                <div className="performer-namespace">{pod.namespace}</div>
                            </div>
                            <div className="performer-metric">
                                <span className="performer-value">{pod.avg_latency_us.toFixed(2)}</span>
                                <span className="performer-unit">μs</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

