import { NetworkTopology } from '../components/NetworkTopology';
import './Page.css';

export function Topology() {
    return (
        <div className="page-container" style={{ 
            background: 'transparent',
            padding: 0 
        }}>
            <NetworkTopology />
        </div>
    );
}

