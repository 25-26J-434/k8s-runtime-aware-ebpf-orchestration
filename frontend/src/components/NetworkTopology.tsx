import { useState, useEffect, useRef } from 'react';
import { useMetrics } from '../hooks/useMetrics';
import { api } from '../services/api';
import { FiAlertCircle, FiCheckCircle, FiRefreshCw, FiDownload, FiMaximize2, FiPause, FiPlay, FiFilter, FiSettings } from 'react-icons/fi';
import './NetworkTopology.css';

interface Node {
    id: string;
    name: string;
    namespace: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    health: 'good' | 'warning' | 'critical';
    latency: number;
    connections: number;
    selected: boolean;
    metrics?: {
        dns_latency?: number;
        tcp_retransmissions?: number;
        tcp_packet_loss?: number;
        events?: number;
    };
}

interface Connection {
    source: string;
    target: string;
    strength: number;
    latency: number;
    packets: number;
}

interface HealthThresholds {
    criticalLatency: number;      // μs
    warningLatency: number;       // μs
    criticalRetrans: number;      // count
    criticalPacketLoss: number;   // count
    warningRetrans: number;       // count
    warningPacketLoss: number;    // count
}

const DEFAULT_THRESHOLDS: HealthThresholds = {
    criticalLatency: 10000,
    warningLatency: 5000,
    criticalRetrans: 5,
    criticalPacketLoss: 3,
    warningRetrans: 1,
    warningPacketLoss: 1,
};

export function NetworkTopology() {
    const { metrics, loading, error } = useMetrics(3000);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [nodes, setNodes] = useState<Node[]>([]);
    const [connections, setConnections] = useState<Connection[]>([]);
    const [realConnections, setRealConnections] = useState<any[]>([]);
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);
    const [hoveredNode, setHoveredNode] = useState<Node | null>(null);
    const [isPaused, setIsPaused] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [showThresholdConfig, setShowThresholdConfig] = useState(false);
    const [namespaceFilter, setNamespaceFilter] = useState<string>('all');
    const [healthFilter, setHealthFilter] = useState<string>('all');
    const [connectionFilter, setConnectionFilter] = useState<string>('established');
    const [healthThresholds, setHealthThresholds] = useState<HealthThresholds>(() => {
        const saved = localStorage.getItem('topology-health-thresholds');
        return saved ? JSON.parse(saved) : DEFAULT_THRESHOLDS;
    });
    const animationRef = useRef<number>();
    
    // Save thresholds to localStorage when they change
    useEffect(() => {
        localStorage.setItem('topology-health-thresholds', JSON.stringify(healthThresholds));
    }, [healthThresholds]);

    // Fetch real connection data
    useEffect(() => {
        let mounted = true;
        
        const fetchConnections = async () => {
            try {
                const data = await api.getConnectionTopology(connectionFilter);
                if (mounted && data.connections) {
                    setRealConnections(data.connections);
                }
            } catch (err) {
                console.error('[Topology] Failed to fetch connections:', err);
            }
        };
        
        fetchConnections();
        const interval = setInterval(fetchConnections, 3000);
        
        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, [connectionFilter]);

    // Extract nodes from metrics
    useEffect(() => {
        if (!metrics || !metrics.pods) {
            console.log('[Topology] No metrics or pods:', { hasMetrics: !!metrics, hasPods: !!metrics?.pods });
            return;
        }

        console.log('[Topology] Processing pods:', Object.keys(metrics.pods));
        const newNodes: Node[] = [];
        const podEntries = Object.entries(metrics.pods);

        podEntries.forEach(([podKey, podData], index) => {
            const [namespace, podName] = podKey.split('/');
            const angle = (index / podEntries.length) * Math.PI * 2;
            const radius = 280;
            
            // Extract metrics from the pod data
            const dnsMetrics = podData.dns_latency;
            const tcpMetrics = podData.tcp_metrics;
            
            // Determine health based on latency and TCP metrics (using configurable thresholds)
            let health: 'good' | 'warning' | 'critical' = 'good';
            const latency = dnsMetrics?.avg_latency_us || 0;
            
            const hasCriticalIssues = tcpMetrics && (
                tcpMetrics.retransmissions > healthThresholds.criticalRetrans || 
                tcpMetrics.packet_loss > healthThresholds.criticalPacketLoss
            );
            
            const hasWarningIssues = tcpMetrics && (
                tcpMetrics.retransmissions >= healthThresholds.warningRetrans || 
                tcpMetrics.packet_loss >= healthThresholds.warningPacketLoss
            );
            
            if (latency > healthThresholds.criticalLatency || hasCriticalIssues) {
                health = 'critical';
            } else if (latency > healthThresholds.warningLatency || hasWarningIssues) {
                health = 'warning';
            }

            newNodes.push({
                id: podKey,
                name: podName,
                namespace,
                x: 600 + Math.cos(angle) * radius,
                y: 400 + Math.sin(angle) * radius,
                vx: 0,
                vy: 0,
                health,
                latency: latency,
                connections: 0,
                selected: selectedNode?.id === podKey,
                metrics: {
                    dns_latency: dnsMetrics?.avg_latency_us || 0,
                    tcp_retransmissions: tcpMetrics?.retransmissions || 0,
                    tcp_packet_loss: tcpMetrics?.packet_loss || 0,
                    events: (dnsMetrics?.total_events || 0) + (tcpMetrics?.total_events || 0)
                }
            });
        });

        // Create connections from real eBPF data
        const newConnections: Connection[] = [];
        const nodeMap = new Map<string, Node>();
        newNodes.forEach(node => nodeMap.set(node.id, node));
        
        // Process real connections
        realConnections.forEach((conn: any) => {
            if (!conn.source_pod || !conn.dest_pod) return;
            
            // Skip self-connections (same pod)
            if (conn.source_pod === conn.dest_pod) return;
            
            const sourceNode = nodeMap.get(conn.source_pod);
            const destNode = nodeMap.get(conn.dest_pod);
            
            if (sourceNode && destNode) {
                // Calculate strength based on event count (more events = stronger connection)
                const strength = Math.min(1.0, Math.log10(conn.event_count + 1) / 3);
                
                // Use actual RTT for latency
                const latency = conn.last_srtt_us || conn.last_min_rtt_us || 0;
                
                newConnections.push({
                    source: conn.source_pod,
                    target: conn.dest_pod,
                    strength: strength,
                    latency: latency,
                    packets: conn.event_count || 0
                });
                
                // Update node connection counts
                sourceNode.connections++;
                destNode.connections++;
            }
        });
        
        console.log(`[Topology] Created ${newConnections.length} real connections from ${realConnections.length} tracked connections`);

        setNodes(newNodes);
        setConnections(newConnections);
    }, [metrics, realConnections, healthThresholds]);

    // Physics simulation
    useEffect(() => {
        if (isPaused) return;

        const animate = () => {
            setNodes(prevNodes => {
                const updatedNodes = [...prevNodes];

                // Apply forces
                updatedNodes.forEach(node => {
                    // Center force
                    const centerX = 600;
                    const centerY = 400;
                    const dx = centerX - node.x;
                    const dy = centerY - node.y;
                    node.vx += dx * 0.0001;
                    node.vy += dy * 0.0001;

                    // Repulsion between nodes
                    updatedNodes.forEach(other => {
                        if (node.id === other.id) return;
                        const dx = other.x - node.x;
                        const dy = other.y - node.y;
                        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                        if (dist < 150) {
                            const force = (150 - dist) / dist * 0.5;
                            node.vx -= dx * force;
                            node.vy -= dy * force;
                        }
                    });

                    // Apply velocity with damping
                    node.x += node.vx;
                    node.y += node.vy;
                    node.vx *= 0.9;
                    node.vy *= 0.9;

                    // Keep in bounds
                    node.x = Math.max(80, Math.min(1120, node.x));
                    node.y = Math.max(80, Math.min(720, node.y));
                });

                return updatedNodes;
            });

            animationRef.current = requestAnimationFrame(animate);
        };

        animationRef.current = requestAnimationFrame(animate);
        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [isPaused]);

    // Canvas drawing
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Filter nodes
        const filteredNodes = nodes.filter(node => {
            if (namespaceFilter !== 'all' && node.namespace !== namespaceFilter) return false;
            if (healthFilter !== 'all' && node.health !== healthFilter) return false;
            return true;
        });

        // Draw connections
        connections.forEach(conn => {
            const sourceNode = filteredNodes.find(n => n.id === conn.source);
            const targetNode = filteredNodes.find(n => n.id === conn.target);
            if (!sourceNode || !targetNode) return;

            // Color based on latency
            const alpha = conn.latency > 10000 ? 0.7 : conn.latency > 5000 ? 0.5 : 0.4;
            const color = conn.latency > 10000 ? '239, 68, 68' : conn.latency > 5000 ? '245, 158, 11' : '59, 130, 246';
            
            // Draw main line with gradient
            const gradient = ctx.createLinearGradient(sourceNode.x, sourceNode.y, targetNode.x, targetNode.y);
            gradient.addColorStop(0, `rgba(${color}, ${alpha})`);
            gradient.addColorStop(0.5, `rgba(${color}, ${alpha * 0.6})`);
            gradient.addColorStop(1, `rgba(${color}, ${alpha})`);
            
            ctx.beginPath();
            ctx.moveTo(sourceNode.x, sourceNode.y);
            ctx.lineTo(targetNode.x, targetNode.y);
            ctx.strokeStyle = gradient;
            ctx.lineWidth = Math.max(2, conn.strength * 3);
            ctx.lineCap = 'round';
            ctx.stroke();

            // Draw direction arrow
            const angle = Math.atan2(targetNode.y - sourceNode.y, targetNode.x - sourceNode.x);
            const arrowSize = 8;
            const midX = (sourceNode.x + targetNode.x) / 2;
            const midY = (sourceNode.y + targetNode.y) / 2;

            ctx.save();
            ctx.translate(midX, midY);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-arrowSize, -arrowSize / 2);
            ctx.lineTo(-arrowSize, arrowSize / 2);
            ctx.closePath();
            ctx.fillStyle = `rgba(${color}, ${alpha + 0.2})`;
            ctx.fill();
            ctx.restore();

            // Animated particles (multiple for better effect)
            if (!isPaused) {
                for (let i = 0; i < 2; i++) {
                    const offset = i * 0.5;
                    const progress = ((Date.now() / 1500) + offset) % 1;
                    const x = sourceNode.x + (targetNode.x - sourceNode.x) * progress;
                    const y = sourceNode.y + (targetNode.y - sourceNode.y) * progress;
                    
                    // Glowing particle
                    const particleGradient = ctx.createRadialGradient(x, y, 0, x, y, 6);
                    particleGradient.addColorStop(0, `rgba(${color}, 1)`);
                    particleGradient.addColorStop(0.5, `rgba(${color}, 0.6)`);
                    particleGradient.addColorStop(1, `rgba(${color}, 0)`);
                    
                    ctx.beginPath();
                    ctx.arc(x, y, 6, 0, Math.PI * 2);
                    ctx.fillStyle = particleGradient;
                    ctx.fill();
                }
            }
        });

        // Draw help text at bottom
        if (filteredNodes.length === 0) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No test pods available', 600, 380);
            ctx.font = '13px sans-serif';
            ctx.fillText('Deploy pods to test-services namespace to see them here', 600, 405);
        } else {
            // Show clean interaction hints
            ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Click pods for details  •  Arrows show data flow', 600, 770);
        }

        // Draw nodes
        filteredNodes.forEach(node => {
            const isHovered = hoveredNode?.id === node.id;
            const isSelected = selectedNode?.id === node.id;
            const baseRadius = 25;
            const radius = isSelected ? baseRadius + 5 : isHovered ? baseRadius + 3 : baseRadius;

            // Glow effect for selected/hovered
            if (isSelected || isHovered) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius + 15, 0, Math.PI * 2);
                const gradient = ctx.createRadialGradient(node.x, node.y, radius, node.x, node.y, radius + 15);
                gradient.addColorStop(0, node.health === 'critical' ? 'rgba(239, 68, 68, 0.4)' : 
                                        node.health === 'warning' ? 'rgba(245, 158, 11, 0.4)' : 'rgba(16, 185, 129, 0.4)');
                gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = gradient;
                ctx.fill();
            }

            // Draw container-like pod shape (rounded rectangle)
            const podWidth = radius * 2.2;
            const podHeight = radius * 1.8;
            const cornerRadius = 8;
            const x = node.x - podWidth / 2;
            const y = node.y - podHeight / 2;

            // Shadow
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 15;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 4;

            // Pod container background
            ctx.beginPath();
            ctx.moveTo(x + cornerRadius, y);
            ctx.lineTo(x + podWidth - cornerRadius, y);
            ctx.quadraticCurveTo(x + podWidth, y, x + podWidth, y + cornerRadius);
            ctx.lineTo(x + podWidth, y + podHeight - cornerRadius);
            ctx.quadraticCurveTo(x + podWidth, y + podHeight, x + podWidth - cornerRadius, y + podHeight);
            ctx.lineTo(x + cornerRadius, y + podHeight);
            ctx.quadraticCurveTo(x, y + podHeight, x, y + podHeight - cornerRadius);
            ctx.lineTo(x, y + cornerRadius);
            ctx.quadraticCurveTo(x, y, x + cornerRadius, y);
            ctx.closePath();

            // Gradient fill
            const podGradient = ctx.createLinearGradient(x, y, x, y + podHeight);
            if (node.health === 'critical') {
                podGradient.addColorStop(0, '#ef4444');
                podGradient.addColorStop(1, '#dc2626');
            } else if (node.health === 'warning') {
                podGradient.addColorStop(0, '#f59e0b');
                podGradient.addColorStop(1, '#d97706');
            } else {
                podGradient.addColorStop(0, '#10b981');
                podGradient.addColorStop(1, '#059669');
            }
            ctx.fillStyle = podGradient;
            ctx.fill();

            // Border
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.strokeStyle = isSelected ? '#fff' : 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = isSelected ? 3 : 2;
            ctx.stroke();

            // Inner highlight
            ctx.beginPath();
            ctx.moveTo(x + cornerRadius + 2, y + 2);
            ctx.lineTo(x + podWidth - cornerRadius - 2, y + 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Professional pod icon - Kubernetes-style hexagon
            const hexSize = 12;
            const hexCenterX = node.x;
            const hexCenterY = node.y - 8;
            
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 3) * i - Math.PI / 2;
                const hx = hexCenterX + hexSize * Math.cos(angle);
                const hy = hexCenterY + hexSize * Math.sin(angle);
                if (i === 0) {
                    ctx.moveTo(hx, hy);
                } else {
                    ctx.lineTo(hx, hy);
                }
            }
            ctx.closePath();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Inner circle detail
            ctx.beginPath();
            ctx.arc(hexCenterX, hexCenterY, hexSize * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = node.health === 'critical' ? 'rgba(239, 68, 68, 0.8)' : 
                           node.health === 'warning' ? 'rgba(245, 158, 11, 0.8)' : 'rgba(16, 185, 129, 0.8)';
            ctx.fill();

            // Status indicator dots (3 horizontal dots)
            const dotY = node.y + 8;
            const dotSpacing = 6;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            for (let i = -1; i <= 1; i++) {
                ctx.beginPath();
                ctx.arc(node.x + (i * dotSpacing), dotY, 2, 0, Math.PI * 2);
                ctx.fill();
            }

            // Always show pod name - clean and simple
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const displayName = node.name.length > 16 ? node.name.substring(0, 14) + '..' : node.name;
            ctx.fillText(displayName, node.x, y + podHeight + 6);
        });

    }, [nodes, connections, selectedNode, hoveredNode, isPaused, namespaceFilter, healthFilter]);

    // Handle canvas click
    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const clickedNode = nodes.find(node => {
            const baseRadius = 25;
            const podWidth = baseRadius * 2.2;
            const podHeight = baseRadius * 1.8;
            return Math.abs(node.x - x) < podWidth / 2 && Math.abs(node.y - y) < podHeight / 2;
        });

        setSelectedNode(clickedNode || null);
    };

    // Handle canvas hover
    const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const hoveredNode = nodes.find(node => {
            const baseRadius = 25;
            const podWidth = baseRadius * 2.2;
            const podHeight = baseRadius * 1.8;
            return Math.abs(node.x - x) < podWidth / 2 && Math.abs(node.y - y) < podHeight / 2;
        });

        setHoveredNode(hoveredNode || null);
        canvas.style.cursor = hoveredNode ? 'pointer' : 'grab';
    };

    // Get unique namespaces
    const namespaces = ['all', ...new Set(nodes.map(n => n.namespace))];

    return (
        <div className="network-topology">
            <div className="topology-header">
                <div className="header-left">
                    <h2>Pod Network Topology</h2>
                    <span className="node-count">
                        {nodes.length} {nodes.length === 1 ? 'Pod' : 'Pods'} • {connections.length} {connections.length === 1 ? 'Connection' : 'Connections'}
                    </span>
                </div>
                <div className="header-controls">
                    <button className="control-btn" onClick={() => setIsPaused(!isPaused)}>
                        {isPaused ? <FiPlay /> : <FiPause />}
                        {isPaused ? 'Resume' : 'Pause'}
                    </button>
                    <button className="control-btn" onClick={() => setShowFilters(!showFilters)}>
                        <FiFilter />
                        Filters
                    </button>
                    <button 
                        className="control-btn" 
                        onClick={() => {
                            console.log('Toggling threshold config:', !showThresholdConfig);
                            setShowThresholdConfig(!showThresholdConfig);
                        }}
                        style={{ position: 'relative' }}
                    >
                        <FiSettings />
                        Health Thresholds
                        {showThresholdConfig && <span style={{ 
                            position: 'absolute', 
                            top: '4px', 
                            right: '4px', 
                            width: '6px', 
                            height: '6px', 
                            background: '#10b981', 
                            borderRadius: '50%' 
                        }}></span>}
                    </button>
                    <button className="control-btn">
                        <FiDownload />
                        Export
                    </button>
                    <button className="control-btn">
                        <FiMaximize2 />
                        Fullscreen
                    </button>
                </div>
            </div>

            {showFilters && (
                <div className="topology-filters" style={{ 
                    display: 'block',  /* Override CSS hiding */
                    background: 'rgba(15, 23, 42, 0.95)', 
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: '8px',
                    padding: '1rem',
                    marginBottom: '0.5rem'
                }}>
                    <div className="filter-group">
                        <label>Namespace:</label>
                        <select value={namespaceFilter} onChange={(e) => setNamespaceFilter(e.target.value)}>
                            {namespaces.map(ns => (
                                <option key={ns} value={ns}>{ns}</option>
                            ))}
                        </select>
                    </div>
                    <div className="filter-group">
                        <label>Health:</label>
                        <select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)}>
                            <option value="all">All</option>
                            <option value="good">Good</option>
                            <option value="warning">Warning</option>
                            <option value="critical">Critical</option>
                        </select>
                    </div>
                    <div className="filter-group">
                        <label>Connections:</label>
                        <select value={connectionFilter} onChange={(e) => setConnectionFilter(e.target.value)}>
                            <option value="established">Established Only</option>
                            <option value="pod-to-pod">Pod-to-Pod Only</option>
                            <option value="all">All Connections</option>
                        </select>
                    </div>
                </div>
            )}

            {showThresholdConfig && (
                <div className="topology-filters" style={{ 
                    display: 'block',  /* Override CSS hiding */
                    background: 'rgba(15, 23, 42, 0.95)', 
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: '8px',
                    padding: '1.5rem',
                    marginTop: '0.5rem',
                    marginBottom: '0.5rem'
                }}>
                    <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ fontSize: '1rem', color: '#60a5fa', margin: 0 }}>Configure Health Thresholds</h3>
                        <button 
                            onClick={() => setHealthThresholds(DEFAULT_THRESHOLDS)}
                            style={{
                                background: 'rgba(239, 68, 68, 0.2)',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                color: '#f87171',
                                padding: '0.4rem 0.8rem',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.8rem'
                            }}
                        >
                            Reset to Defaults
                        </button>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
                        {/* Critical Thresholds */}
                        <div style={{ borderLeft: '3px solid #ef4444', paddingLeft: '1rem' }}>
                            <h4 style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '0.75rem' }}>🔴 Critical Thresholds</h4>
                            <div className="filter-group" style={{ marginBottom: '0.75rem' }}>
                                <label style={{ fontSize: '0.75rem' }}>DNS Latency (μs):</label>
                                <input 
                                    type="number" 
                                    value={healthThresholds.criticalLatency}
                                    onChange={(e) => setHealthThresholds({...healthThresholds, criticalLatency: Number(e.target.value)})}
                                    style={{ 
                                        width: '100%', 
                                        padding: '0.4rem', 
                                        background: 'rgba(0,0,0,0.3)',
                                        border: '1px solid rgba(239, 68, 68, 0.3)',
                                        color: '#fff',
                                        borderRadius: '4px'
                                    }}
                                />
                            </div>
                            <div className="filter-group" style={{ marginBottom: '0.75rem' }}>
                                <label style={{ fontSize: '0.75rem' }}>Retransmissions:</label>
                                <input 
                                    type="number" 
                                    value={healthThresholds.criticalRetrans}
                                    onChange={(e) => setHealthThresholds({...healthThresholds, criticalRetrans: Number(e.target.value)})}
                                    style={{ 
                                        width: '100%', 
                                        padding: '0.4rem', 
                                        background: 'rgba(0,0,0,0.3)',
                                        border: '1px solid rgba(239, 68, 68, 0.3)',
                                        color: '#fff',
                                        borderRadius: '4px'
                                    }}
                                />
                            </div>
                            <div className="filter-group">
                                <label style={{ fontSize: '0.75rem' }}>Packet Loss:</label>
                                <input 
                                    type="number" 
                                    value={healthThresholds.criticalPacketLoss}
                                    onChange={(e) => setHealthThresholds({...healthThresholds, criticalPacketLoss: Number(e.target.value)})}
                                    style={{ 
                                        width: '100%', 
                                        padding: '0.4rem', 
                                        background: 'rgba(0,0,0,0.3)',
                                        border: '1px solid rgba(239, 68, 68, 0.3)',
                                        color: '#fff',
                                        borderRadius: '4px'
                                    }}
                                />
                            </div>
                        </div>

                        {/* Warning Thresholds */}
                        <div style={{ borderLeft: '3px solid #f59e0b', paddingLeft: '1rem' }}>
                            <h4 style={{ color: '#f59e0b', fontSize: '0.85rem', marginBottom: '0.75rem' }}>🟡 Warning Thresholds</h4>
                            <div className="filter-group" style={{ marginBottom: '0.75rem' }}>
                                <label style={{ fontSize: '0.75rem' }}>DNS Latency (μs):</label>
                                <input 
                                    type="number" 
                                    value={healthThresholds.warningLatency}
                                    onChange={(e) => setHealthThresholds({...healthThresholds, warningLatency: Number(e.target.value)})}
                                    style={{ 
                                        width: '100%', 
                                        padding: '0.4rem', 
                                        background: 'rgba(0,0,0,0.3)',
                                        border: '1px solid rgba(245, 158, 11, 0.3)',
                                        color: '#fff',
                                        borderRadius: '4px'
                                    }}
                                />
                            </div>
                            <div className="filter-group" style={{ marginBottom: '0.75rem' }}>
                                <label style={{ fontSize: '0.75rem' }}>Retransmissions:</label>
                                <input 
                                    type="number" 
                                    value={healthThresholds.warningRetrans}
                                    onChange={(e) => setHealthThresholds({...healthThresholds, warningRetrans: Number(e.target.value)})}
                                    style={{ 
                                        width: '100%', 
                                        padding: '0.4rem', 
                                        background: 'rgba(0,0,0,0.3)',
                                        border: '1px solid rgba(245, 158, 11, 0.3)',
                                        color: '#fff',
                                        borderRadius: '4px'
                                    }}
                                />
                            </div>
                            <div className="filter-group">
                                <label style={{ fontSize: '0.75rem' }}>Packet Loss:</label>
                                <input 
                                    type="number" 
                                    value={healthThresholds.warningPacketLoss}
                                    onChange={(e) => setHealthThresholds({...healthThresholds, warningPacketLoss: Number(e.target.value)})}
                                    style={{ 
                                        width: '100%', 
                                        padding: '0.4rem', 
                                        background: 'rgba(0,0,0,0.3)',
                                        border: '1px solid rgba(245, 158, 11, 0.3)',
                                        color: '#fff',
                                        borderRadius: '4px'
                                    }}
                                />
                            </div>
                        </div>

                        {/* Info */}
                        <div style={{ borderLeft: '3px solid #10b981', paddingLeft: '1rem' }}>
                            <h4 style={{ color: '#10b981', fontSize: '0.85rem', marginBottom: '0.75rem' }}>ℹ️ How it Works</h4>
                            <p style={{ fontSize: '0.7rem', color: '#94a3b8', lineHeight: '1.5', margin: 0 }}>
                                Pods are classified as:<br/><br/>
                                <strong style={{ color: '#ef4444' }}>Critical</strong> if DNS latency OR retransmissions OR packet loss exceeds critical threshold.<br/><br/>
                                <strong style={{ color: '#f59e0b' }}>Warning</strong> if metrics exceed warning threshold but below critical.<br/><br/>
                                <strong style={{ color: '#10b981' }}>Good</strong> if all metrics are below warning thresholds.<br/><br/>
                                Thresholds are saved in your browser.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <div className="topology-content">
                <div className="canvas-container">
                    <canvas
                        ref={canvasRef}
                        width={1200}
                        height={800}
                        onClick={handleCanvasClick}
                        onMouseMove={handleCanvasMove}
                        onMouseLeave={() => setHoveredNode(null)}
                    />
                    
                    <div className="topology-legend">
                        <div style={{ marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(16, 185, 129, 0.3)' }}>
                            <strong style={{ fontSize: '0.875rem', color: '#10b981' }}>
                                Real eBPF Connection Data
                            </strong>
                            <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.25rem', lineHeight: '1.3' }}>
                                Connections traced from kernel TCP events<br/>
                                Shows actual pod-to-pod network flows
                            </div>
                        </div>
                        <div style={{ marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(59, 130, 246, 0.2)' }}>
                            <strong style={{ fontSize: '0.875rem', color: '#cbd5e1' }}>Health Status</strong>
                        </div>
                        <div className="legend-item">
                            <div className="legend-color" style={{ background: '#10b981' }}></div>
                            <span>Healthy - Below warning thresholds</span>
                        </div>
                        <div className="legend-item">
                            <div className="legend-color" style={{ background: '#f59e0b' }}></div>
                            <span>Warning - Latency &gt; {healthThresholds.warningLatency}μs or issues detected</span>
                        </div>
                        <div className="legend-item">
                            <div className="legend-color" style={{ background: '#ef4444' }}></div>
                            <span>Critical - Latency &gt; {healthThresholds.criticalLatency}μs or serious issues</span>
                        </div>
                        <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(59, 130, 246, 0.2)', fontSize: '0.7rem', color: '#94a3b8' }}>
                            ▸ Click any pod to perform actions
                        </div>
                    </div>
                </div>

                {selectedNode && (
                    <NodeActionPanel 
                        node={selectedNode} 
                        onClose={() => setSelectedNode(null)}
                    />
                )}
            </div>
        </div>
    );
}

interface NodeActionPanelProps {
    node: Node;
    onClose: () => void;
}

function NodeActionPanel({ node, onClose }: NodeActionPanelProps) {
    const [actionLog, setActionLog] = useState<string[]>([]);
    const [isPerformingAction, setIsPerformingAction] = useState(false);
    const [showEBPFActions, setShowEBPFActions] = useState(false);

    const performAction = async (action: string, description: string) => {
        setIsPerformingAction(true);
        setActionLog(prev => [...prev, `[RUNNING] ${description}...`]);

        try {
            const response = await fetch('http://localhost:8080/api/pod/action', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: action,
                    namespace: node.namespace,
                    pod_name: node.name,
                    replicas: 2 // Default for scale action
                })
            });

            const result = await response.json();

            if (result.success) {
                setActionLog(prev => [...prev, `[SUCCESS] ${result.message}`]);
                if (result.data) {
                    setActionLog(prev => [...prev, `[DATA] ${JSON.stringify(result.data)}`]);
                }
            } else {
                setActionLog(prev => [...prev, `[ERROR] ${result.error || result.message}`]);
            }
        } catch (error) {
            setActionLog(prev => [...prev, `[FAILED] ${description}: ${error}`]);
        } finally {
            setIsPerformingAction(false);
        }
    };

    const performEBPFAction = async (action: string, description: string, params?: any) => {
        setIsPerformingAction(true);
        setActionLog(prev => [...prev, `[EBPF] ${description}...`]);

        try {
            const response = await fetch('http://localhost:8080/api/pod/ebpf-action', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: action,
                    namespace: node.namespace,
                    pod_name: node.name,
                    ...params
                })
            });

            const result = await response.json();

            if (result.success) {
                setActionLog(prev => [...prev, `[SUCCESS] ${result.message}`]);
                if (result.explanation) {
                    setActionLog(prev => [...prev, `[INFO] ${result.explanation}`]);
                }
                if (result.details) {
                    const details = JSON.stringify(result.details, null, 2);
                    setActionLog(prev => [...prev, `[DETAILS] ${details}`]);
                }
            } else {
                setActionLog(prev => [...prev, `[ERROR] ${result.error || result.message}`]);
            }
        } catch (error) {
            setActionLog(prev => [...prev, `[FAILED] ${description}: ${error}`]);
        } finally {
            setIsPerformingAction(false);
        }
    };

    return (
        <div className="node-action-panel">
            <div className="panel-header">
                <div>
                    <h3>{node.name}</h3>
                    <span className="panel-namespace">{node.namespace}</span>
                </div>
                <button className="close-btn" onClick={onClose}>×</button>
            </div>

            <div className="panel-metrics">
                <div className="panel-metric">
                    <span className="metric-label">Health</span>
                    <span className={`health-badge ${node.health}`}>
                        {node.health === 'good' && <FiCheckCircle />}
                        {node.health === 'warning' && <FiAlertCircle />}
                        {node.health === 'critical' && <FiAlertCircle />}
                        {node.health}
                    </span>
                </div>
                <div className="panel-metric">
                    <span className="metric-label">DNS Latency</span>
                    <span className="metric-value">
                        {node.metrics?.dns_latency ? `${node.metrics.dns_latency.toFixed(2)} μs` : 'N/A'}
                    </span>
                </div>
                <div className="panel-metric">
                    <span className="metric-label">Retransmissions</span>
                    <span className="metric-value">{node.metrics?.tcp_retransmissions || 0}</span>
                </div>
                <div className="panel-metric">
                    <span className="metric-label">Packet Loss</span>
                    <span className="metric-value">{node.metrics?.tcp_packet_loss || 0}</span>
                </div>
                <div className="panel-metric">
                    <span className="metric-label">Total Events</span>
                    <span className="metric-value">{node.metrics?.events || 0}</span>
                </div>
            </div>

            <div className="panel-actions">
                <h4>Quick Actions</h4>
                <button 
                    className="action-btn primary"
                    onClick={() => performAction('restart', 'Restarting pod')}
                    disabled={isPerformingAction}
                    title="Deletes the pod, triggering Kubernetes to create a new one with fresh state. Useful for clearing temporary issues or applying configuration changes."
                >
                    <FiRefreshCw />
                    Restart Pod
                </button>
                <button 
                    className="action-btn"
                    onClick={() => performAction('isolate', 'Applying network policy')}
                    disabled={isPerformingAction}
                    title="Applies a NetworkPolicy to isolate this pod from all other pods. Useful for security quarantine or testing in isolation."
                >
                    <FiAlertCircle />
                    Isolate Pod
                </button>
                <button 
                    className="action-btn"
                    onClick={() => performAction('health', 'Running health check')}
                    disabled={isPerformingAction}
                    title="Runs comprehensive health checks including readiness probe, liveness probe, and resource utilization to verify pod health."
                >
                    <FiCheckCircle />
                    Health Check
                </button>
                <button 
                    className="action-btn"
                    onClick={() => performAction('logs', 'Fetching logs')}
                    disabled={isPerformingAction}
                    title="Downloads the last 100 lines of container logs for debugging and analysis. Logs are streamed from the Kubernetes API."
                >
                    <FiDownload />
                    Download Logs
                </button>
            </div>

            <div className="panel-actions ebpf-section" style={{ borderTop: '1px solid rgba(59, 130, 246, 0.2)', paddingTop: '1.25rem', marginTop: '0.75rem' }}>
                <h4 style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    fontSize: '0.95rem',
                    marginBottom: '1rem'
                }}>
                    <span style={{ letterSpacing: '0.5px' }}>eBPF ACTIONS</span>
                    <button 
                        onClick={() => setShowEBPFActions(!showEBPFActions)}
                        style={{ 
                            background: 'rgba(59, 130, 246, 0.1)', 
                            border: '1px solid rgba(59, 130, 246, 0.3)', 
                            color: '#60a5fa', 
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                            padding: '0.375rem 0.75rem',
                            borderRadius: '6px',
                            fontWeight: '500',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'}
                    >
                        {showEBPFActions ? '▼ Hide' : '▶ Show'}
                    </button>
                </h4>
                
                {showEBPFActions && (
                    <>
                        <button 
                            className="action-btn ebpf-action"
                            onClick={() => performEBPFAction('priority_boost', 'Boosting network priority', { priority: 'high', duration_seconds: 300 })}
                            disabled={isPerformingAction}
                            title="Uses eBPF to mark packets with high priority DSCP values. Network switches will prioritize this traffic, resulting in lower latency and higher throughput."
                            style={{ 
                                background: 'rgba(16, 185, 129, 0.15)', 
                                borderColor: 'rgba(16, 185, 129, 0.4)', 
                                color: '#34d399',
                                padding: '1rem 1.25rem',
                                fontSize: '0.9rem',
                                fontWeight: '600'
                            }}
                        >
                            Priority Boost: High (5 minutes)
                        </button>
                        <button 
                            className="action-btn ebpf-action"
                            onClick={() => performEBPFAction('connection_reset', 'Resetting connections', { target_ips: [] })}
                            disabled={isPerformingAction}
                            title="Uses eBPF to inject TCP RST packets, forcefully terminating all active connections. Applications will automatically reconnect. Useful for breaking stale connections or testing retry logic."
                            style={{ 
                                background: 'rgba(245, 158, 11, 0.15)', 
                                borderColor: 'rgba(245, 158, 11, 0.4)', 
                                color: '#fbbf24',
                                padding: '1rem 1.25rem',
                                fontSize: '0.9rem',
                                fontWeight: '600'
                            }}
                        >
                            Reset All Connections
                        </button>
                        <button 
                            className="action-btn ebpf-action"
                            onClick={() => performEBPFAction('drain_connections', 'Draining connections', { duration_seconds: 30 })}
                            disabled={isPerformingAction}
                            title="Uses eBPF to gracefully drain connections by rejecting new incoming connections while allowing existing ones to complete. Ensures zero-downtime during pod restarts or migrations."
                            style={{ 
                                background: 'rgba(59, 130, 246, 0.15)', 
                                borderColor: 'rgba(59, 130, 246, 0.4)', 
                                color: '#60a5fa',
                                padding: '1rem 1.25rem',
                                fontSize: '0.9rem',
                                fontWeight: '600'
                            }}
                        >
                            Drain Connections (30 seconds)
                        </button>
                        <button 
                            className="action-btn ebpf-action"
                            onClick={() => performEBPFAction('trace_enable', 'Enabling deep tracing', { duration_seconds: 300 })}
                            disabled={isPerformingAction}
                            title="Attaches additional eBPF kprobes to capture detailed network events including every packet, connection, and syscall. Useful for debugging performance issues and analyzing traffic patterns."
                            style={{ 
                                background: 'rgba(236, 72, 153, 0.15)', 
                                borderColor: 'rgba(236, 72, 153, 0.4)', 
                                color: '#f472b6',
                                padding: '1rem 1.25rem',
                                fontSize: '0.9rem',
                                fontWeight: '600'
                            }}
                        >
                            Enable Deep Tracing (5 minutes)
                        </button>
                    </>
                )}
            </div>

            {actionLog.length > 0 && (
                <div className="action-log">
                    <h4>Action Log</h4>
                    <div className="log-content">
                        {actionLog.map((log, idx) => (
                            <div key={idx} className="log-entry">{log}</div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

