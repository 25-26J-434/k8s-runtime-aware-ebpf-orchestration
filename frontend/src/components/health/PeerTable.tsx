import type { PeerStatus } from '../../types/health';
import { PEER_COLORS, formatAge } from './levels';

export function PeerTable({ peers }: { peers: PeerStatus[] }) {
    if (peers.length === 0) {
        return <div className="ch-empty">No peers discovered. This looks like a single-node cluster.</div>;
    }
    return (
        <div className="ch-table-wrap">
            <table className="ch-table">
                <thead>
                    <tr>
                        <th>Peer</th>
                        <th>Status</th>
                        <th>Latency</th>
                        <th>Last seen</th>
                        <th>Last error</th>
                    </tr>
                </thead>
                <tbody>
                    {peers.map((p) => (
                        <tr key={p.ip}>
                            <td>
                                <strong>{p.name || p.ip}</strong>
                                {p.name && <div className="ch-muted">{p.ip}</div>}
                            </td>
                            <td>
                                <span className="ch-dot" style={{ background: PEER_COLORS[p.status] }} aria-hidden />{' '}
                                {p.status}
                            </td>
                            <td>{p.status === 'up' ? `${p.latency_ms.toFixed(1)} ms` : '-'}</td>
                            <td>{formatAge(p.last_seen)}</td>
                            <td className="ch-muted">{p.last_error || '-'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
