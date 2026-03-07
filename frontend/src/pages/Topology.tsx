import { NetworkTopology } from '../components/NetworkTopology';

export function Topology() {
    return (
        <div style={{
            width: '100%',
            height: '100vh',
            padding: '14px',
            boxSizing: 'border-box',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
        }}>
            <NetworkTopology />
        </div>
    );
}

