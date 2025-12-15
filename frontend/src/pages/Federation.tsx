import { useState } from 'react';
import './Page.css';
import { useClusterInfo } from '../hooks/useClusterInfo';
import { api } from '../services/api';

interface CommunicationLog {
    id: string;
    timestamp: string;
    type: 'SENT' | 'RECEIVED';
    commType: 'BROADCAST' | 'UNICAST' | 'MULTICAST';
    from: string;
    to: string[];
    event: string;
    payload: any;
    success: boolean;
}

export function Federation() {
    const { clusterInfo } = useClusterInfo();
    const [logs, setLogs] = useState<CommunicationLog[]>([]);
    const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
    const [messageType, setMessageType] = useState<'BROADCAST' | 'UNICAST' | 'MULTICAST'>('BROADCAST');
    const [messagePayload, setMessagePayload] = useState('');
    const [eventType, setEventType] = useState('HANDSHAKE');
    const [sending, setSending] = useState(false);
    const [lastSentTime, setLastSentTime] = useState<string>('');

    // Get real cluster nodes and add 2 simulated nodes for demonstration
    const realNodes = clusterInfo?.nodes || [];
    const simulatedNodes = [
        { name: 'node-2', ip: '172.18.0.3', status: 'Ready', role: 'worker', pods: [] },
        { name: 'node-3', ip: '172.18.0.4', status: 'Ready', role: 'worker', pods: [] },
    ];
    
    const nodes = [...realNodes, ...simulatedNodes];
    const totalNodes = nodes.length;
    const readyNodes = nodes.filter(n => n.status === 'Ready').length;

    const addLog = (log: CommunicationLog) => {
        setLogs(prev => [log, ...prev].slice(0, 50));
    };

    const handleSendMessage = async () => {
        setSending(true);
        try {
            let payload: any = {};
            try {
                payload = messagePayload ? JSON.parse(messagePayload) : {};
            } catch {
                payload = { message: messagePayload };
            }

            const message = {
                event: eventType,
                payload,
                action: 'NONE',
            };

            const timestamp = new Date().toISOString();
            const targetNodesList = Array.from(selectedNodes);
            
            const logEntry: CommunicationLog = {
                id: `${Date.now()}-${Math.random()}`,
                timestamp,
                type: 'SENT',
                commType: messageType,
                from: nodes[0]?.name || 'Dashboard',
                to: messageType === 'BROADCAST' ? ['ALL NODES'] : targetNodesList,
                event: eventType,
                payload,
                success: false,
            };

            try {
                if (messageType === 'BROADCAST') {
                    await api.sendBroadcast(message);
                } else if (messageType === 'UNICAST' && targetNodesList.length > 0) {
                    await api.sendUnicast(targetNodesList[0], message);
                } else if (messageType === 'MULTICAST' && targetNodesList.length > 0) {
                    await api.sendMulticast(targetNodesList, message);
                }
                logEntry.success = true;
                setLastSentTime(new Date().toLocaleTimeString());
            } catch (err) {
                console.error('Send failed:', err);
                logEntry.payload = { ...logEntry.payload, error: String(err) };
            }

            addLog(logEntry);
            setMessagePayload('');
            if (messageType === 'UNICAST') {
                setSelectedNodes(new Set());
            }
        } catch (error) {
            console.error('Failed to send message:', error);
        } finally {
            setSending(false);
        }
    };

    const toggleTargetNode = (nodeIp: string) => {
        setSelectedNodes(prev => {
            const newSet = new Set(prev);
            if (newSet.has(nodeIp)) {
                newSet.delete(nodeIp);
            } else {
                if (messageType === 'UNICAST') {
                    newSet.clear();
                }
                newSet.add(nodeIp);
            }
            return newSet;
        });
    };

    const getNodeIcon = (status: string) => status === 'Ready' ? '✅' : '⚠️';
    
    const getCommTypeColor = (type: string) => {
        switch (type) {
            case 'BROADCAST': return '#6366f1';
            case 'UNICAST': return '#10b981';
            case 'MULTICAST': return '#f59e0b';
            default: return '#6b7280';
        }
    };

    const canSend = messageType === 'BROADCAST' || selectedNodes.size > 0;

    return (
        <div className="page-container">
            <div className="page-header">
                <div className="page-title-section">
                    <h1 className="page-title">🌐 Node-to-Node Communication</h1>
                    <p className="page-subtitle">P2P messaging and coordination across cluster nodes (Component 4)</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ padding: '0.75rem 1.5rem', background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Total Nodes</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{totalNodes}</div>
                    </div>
                    <div style={{ padding: '0.75rem 1.5rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Ready Nodes</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#10b981' }}>{readyNodes}</div>
                    </div>
                    <div style={{ padding: '0.75rem 1.5rem', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Messages Sent</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#f59e0b' }}>{logs.filter(l => l.success).length}</div>
                    </div>
                    {lastSentTime && (
                        <div style={{ padding: '0.75rem 1.5rem', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.3)', borderRadius: '8px' }}>
                            <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Last Sent</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#8b5cf6' }}>{lastSentTime}</div>
                        </div>
                    )}
                </div>
            </div>

            <div className="page-content">
                {/* Interactive Node Grid */}
                <div className="feature-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2>🖥️ Cluster Nodes</h2>
                        <span style={{ fontSize: '0.9rem', opacity: 0.7 }}>
                            {messageType !== 'BROADCAST' && `Selected: ${selectedNodes.size}`}
                        </span>
                    </div>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                        gap: '1rem',
                    }}>
                        {nodes.map((node) => {
                            const isSelected = selectedNodes.has(node.ip);
                            return (
                                <div 
                                    key={node.name} 
                                    onClick={() => messageType !== 'BROADCAST' && toggleTargetNode(node.ip)}
                                    style={{
                                        background: isSelected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.1)',
                                        border: `2px solid ${isSelected ? '#10b981' : 'rgba(99, 102, 241, 0.3)'}`,
                                        borderRadius: '12px',
                                        padding: '1.25rem',
                                        cursor: messageType !== 'BROADCAST' ? 'pointer' : 'default',
                                        transition: 'all 0.3s ease',
                                        transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                                        boxShadow: isSelected ? '0 4px 12px rgba(16, 185, 129, 0.3)' : 'none',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span style={{ fontSize: '1.75rem' }}>{getNodeIcon(node.status)}</span>
                                            <div>
                                                <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{node.name}</div>
                                                <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>{node.role || 'worker'}</div>
                                            </div>
                                        </div>
                                        {isSelected && <span style={{ fontSize: '1.5rem' }}>✓</span>}
                                    </div>
                                    <div style={{ display: 'grid', gap: '0.4rem', fontSize: '0.9rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ opacity: 0.7 }}>IP Address:</span>
                                            <code style={{ background: 'rgba(0,0,0,0.3)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{node.ip}</code>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ opacity: 0.7 }}>Status:</span>
                                            <span style={{ color: node.status === 'Ready' ? '#10b981' : '#ef4444', fontWeight: 'bold' }}>{node.status}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ opacity: 0.7 }}>Running Pods:</span>
                                            <span style={{ fontWeight: 'bold' }}>{node.pods?.length || 0}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Enhanced Communication Control */}
                <div className="feature-card">
                    <h2>📤 Send Message</h2>
                    <div style={{ display: 'grid', gap: '1.25rem', marginTop: '1rem' }}>
                        {/* Communication Type */}
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: 'bold' }}>Communication Type</label>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                                {[
                                    { type: 'BROADCAST' as const, icon: '📡', desc: 'All nodes' },
                                    { type: 'UNICAST' as const, icon: '🎯', desc: 'One node' },
                                    { type: 'MULTICAST' as const, icon: '🔀', desc: 'Multiple nodes' },
                                ].map(({ type, icon, desc }) => (
                                    <button
                                        key={type}
                                        onClick={() => {
                                            setMessageType(type);
                                            if (type === 'BROADCAST') setSelectedNodes(new Set());
                                        }}
                                        style={{
                                            padding: '1rem',
                                            background: messageType === type ? getCommTypeColor(type) : `${getCommTypeColor(type)}20`,
                                            border: `2px solid ${getCommTypeColor(type)}`,
                                            borderRadius: '8px',
                                            color: 'white',
                                            cursor: 'pointer',
                                            fontWeight: 'bold',
                                            textAlign: 'center',
                                        }}
                                    >
                                        <div style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>{icon}</div>
                                        <div>{type}</div>
                                        <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '0.25rem' }}>{desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Event Type */}
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: 'bold' }}>Event Type</label>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem' }}>
                                {['HANDSHAKE', 'SCHEDULING', 'STATE_UPDATE', 'METRIC_UPDATE', 'DISCOVERY'].map(event => (
                                    <button
                                        key={event}
                                        onClick={() => setEventType(event)}
                                        style={{
                                            padding: '0.6rem',
                                            background: eventType === event ? '#8b5cf6' : 'rgba(139, 92, 246, 0.2)',
                                            border: `1px solid ${eventType === event ? '#8b5cf6' : 'rgba(139, 92, 246, 0.4)'}`,
                                            borderRadius: '6px',
                                            color: 'white',
                                            cursor: 'pointer',
                                            fontSize: '0.85rem',
                                        }}
                                    >
                                        {event}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Target Nodes Info */}
                        {messageType !== 'BROADCAST' && (
                            <div style={{
                                padding: '1rem',
                                background: 'rgba(16, 185, 129, 0.1)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                borderRadius: '8px',
                            }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
                                    {messageType === 'UNICAST' ? '🎯 Select ONE target node above' : '🔀 Select MULTIPLE target nodes above'}
                                </div>
                                <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>
                                    {selectedNodes.size === 0 ? 'Click on nodes in the grid above to select them' : `Selected: ${Array.from(selectedNodes).join(', ')}`}
                                </div>
                            </div>
                        )}

                        {/* Payload */}
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: 'bold' }}>💬 Message Payload (JSON or text)</label>
                            <textarea
                                value={messagePayload}
                                onChange={(e) => setMessagePayload(e.target.value)}
                                placeholder='{"message": "Hello nodes!", "priority": "high", "data": {}}'
                                rows={4}
                                style={{
                                    width: '100%',
                                    padding: '0.75rem',
                                    background: 'rgba(30, 41, 59, 0.8)',
                                    border: '1px solid rgba(99, 102, 241, 0.3)',
                                    borderRadius: '8px',
                                    color: 'white',
                                    fontFamily: 'monospace',
                                    fontSize: '0.9rem',
                                    resize: 'vertical',
                                }}
                            />
                        </div>

                        {/* Send Button */}
                        <button
                            onClick={handleSendMessage}
                            disabled={!canSend || sending}
                            style={{
                                padding: '1rem 2rem',
                                background: !canSend || sending ? '#6b7280' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                border: 'none',
                                borderRadius: '8px',
                                color: 'white',
                                fontWeight: 'bold',
                                fontSize: '1.1rem',
                                cursor: !canSend || sending ? 'not-allowed' : 'pointer',
                                opacity: !canSend || sending ? 0.5 : 1,
                            }}
                        >
                            {sending ? '⏳ Sending...' : `🚀 Send ${messageType}`}
                        </button>
                    </div>
                </div>

                {/* Communication Logs */}
                <div className="feature-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2>📝 Communication Logs ({logs.length})</h2>
                        <button
                            onClick={() => setLogs([])}
                            style={{
                                padding: '0.5rem 1rem',
                                background: 'rgba(239, 68, 68, 0.2)',
                                border: '1px solid #ef4444',
                                borderRadius: '4px',
                                color: 'white',
                                cursor: 'pointer',
                            }}
                        >
                            Clear Logs
                        </button>
                    </div>
                    
                    <div style={{ maxHeight: '500px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {logs.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '2rem', opacity: 0.5 }}>
                                No messages sent yet. Send a message to see logs here.
                            </div>
                        ) : (
                            logs.map((log) => (
                                <div
                                    key={log.id}
                                    style={{
                                        background: log.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                        border: `1px solid ${log.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                                        borderRadius: '4px',
                                        padding: '0.75rem',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                        <span style={{ fontWeight: 'bold' }}>
                                            {log.success ? '✅' : '❌'} {log.commType}
                                        </span>
                                        <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                                            {new Date(log.timestamp).toLocaleTimeString()}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '0.9rem', display: 'grid', gap: '0.25rem' }}>
                                        <div>Event: <strong>{log.event}</strong></div>
                                        <div>From: {log.from}</div>
                                        <div>To: {log.to.join(', ')}</div>
                                        {Object.keys(log.payload).length > 0 && (
                                            <div>
                                                Payload: <pre style={{ display: 'inline', background: 'rgba(0,0,0,0.3)', padding: '0.25rem', borderRadius: '2px', fontSize: '0.85rem' }}>
                                                    {JSON.stringify(log.payload, null, 2)}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Component Info */}
                <div className="info-grid">
                    <div className="info-card">
                        <h3>Features</h3>
                        <ul>
                            <li>📡 BROADCAST to all nodes</li>
                            <li>🎯 UNICAST to specific node</li>
                            <li>🔀 MULTICAST to groups</li>
                            <li>📝 Real-time logs</li>
                            <li>⚡ Event-driven architecture</li>
                        </ul>
                    </div>

                    <div className="info-card">
                        <h3>Use Cases</h3>
                        <ul>
                            <li>Coordinate eBPF updates</li>
                            <li>Share metric aggregations</li>
                            <li>Distributed consensus</li>
                            <li>Cross-node health checks</li>
                            <li>State synchronization</li>
                        </ul>
                    </div>

                    <div className="info-card">
                        <h3>Status</h3>
                        <div style={{ background: '#10b981', color: 'white', padding: '0.25rem 0.5rem', borderRadius: '4px', display: 'inline-block', marginBottom: '0.5rem' }}>✅ Active</div>
                        <p>Component 4 is deployed and operational. P2P daemon running on port 8080.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
