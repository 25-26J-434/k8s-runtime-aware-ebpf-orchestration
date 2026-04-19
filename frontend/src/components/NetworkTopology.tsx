import { useState, useEffect, useRef, useMemo } from 'react';
import { useMetrics } from '../hooks/useMetrics';
import { api, API_BASE } from '../services/api';
import { topologyWebSocket } from '../services/websocket';
import { 
    FiRefreshCw, FiTrash2, FiX, FiCheckCircle, 
    FiAlertCircle, FiTerminal, FiRotateCw, FiZap,
    FiServer, FiGlobe
} from 'react-icons/fi';
import './NetworkTopology.css';

const NODE_ZONE_COLORS = [
    { fill: 'rgba(30,58,138,0.10)',  stroke: 'rgba(96,165,250,0.55)',  label: 'rgba(147,197,253,0.95)' },
    { fill: 'rgba(22,78,99,0.10)',   stroke: 'rgba(34,211,238,0.55)',  label: 'rgba(103,232,249,0.95)' },
    { fill: 'rgba(20,83,45,0.10)',   stroke: 'rgba(74,222,128,0.55)',  label: 'rgba(134,239,172,0.95)' },
    { fill: 'rgba(88,28,135,0.10)',  stroke: 'rgba(192,132,252,0.55)', label: 'rgba(216,180,254,0.95)' },
    { fill: 'rgba(120,53,15,0.10)',  stroke: 'rgba(251,146,60,0.55)',  label: 'rgba(253,186,116,0.95)'  },
];

const NS_PALETTE = [
    { fill: 'rgba(99,102,241,0.07)',  stroke: 'rgba(99,102,241,0.30)',  label: 'rgba(165,168,255,0.75)' },
    { fill: 'rgba(6,182,212,0.07)',   stroke: 'rgba(6,182,212,0.30)',   label: 'rgba(103,232,249,0.75)' },
    { fill: 'rgba(16,185,129,0.07)',  stroke: 'rgba(16,185,129,0.30)',  label: 'rgba(52,211,153,0.75)'  },
    { fill: 'rgba(245,158,11,0.07)',  stroke: 'rgba(245,158,11,0.30)',  label: 'rgba(252,211,77,0.75)'  },
    { fill: 'rgba(236,72,153,0.07)', stroke: 'rgba(236,72,153,0.30)', label: 'rgba(249,168,212,0.75)' },
];

interface PodNode {
    id: string;
    name: string;
    namespace: string;
    node?: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    health: 'good' | 'warning' | 'critical';
    connections: number;
    isDragging?: boolean;
    metrics: {
        dns_latency?: number;
        tcp_retransmissions?: number;
        packet_loss?: number;
        events?: number;
    };
}

interface Connection {
    source: string;
    target: string;
    latency: number;
    packets: number;
}

interface MigrationSuggestion {
    pod: string;
    namespace: string;
    reason: string;
    severity: 'high' | 'medium' | 'low';
    action: string;
    aiSuggestion: string;
    metrics: {
        tcp_issues: number;
        dns_latency: number;
        packet_loss: number;
        cpu_latency: number;
    };
    logs?: string;
}

export function NetworkTopology() {
    // Find node key from selected node name using useMetrics to get availableNodes
    // We need to call useMetrics to get availableNodes, but we'll use a separate call for metrics
    const { availableNodes } = useMetrics(3000, null);
    
    // Get selected node key from localStorage (sync with Dashboard)
    const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(() => {
        const saved = localStorage.getItem('selectedNodeKey');
        return saved || null;
    });
    
    // Auto-select first node when nodes become available (if none selected)
    useEffect(() => {
        if (availableNodes.length > 0 && !selectedNodeKey) {
            setSelectedNodeKey(availableNodes[0].key);
        }
    }, [availableNodes, selectedNodeKey]);
    
    // Find selected node name from key
    const selectedNode = selectedNodeKey 
        ? availableNodes.find(node => node.key === selectedNodeKey)?.name || null
        : null;
    
    // Get metrics for selected node (or first node if none selected)
    const { metrics: displayMetrics } = useMetrics(3000, selectedNodeKey);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasDimsRef = useRef({ w: 1200, h: 700 });
    const [canvasDims, setCanvasDims] = useState({ w: 1200, h: 700 });
    const [pods, setPods] = useState<PodNode[]>([]);
    const [connections, setConnections] = useState<Connection[]>([]);
    const [realConnections] = useState<any[]>([]);
    const [selectedPod, setSelectedPod] = useState<PodNode | null>(null);
    const [draggedPod, setDraggedPod] = useState<PodNode | null>(null);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [isPaused, setIsPaused] = useState(false);
    const [showMigrationAdvisor, setShowMigrationAdvisor] = useState(false);
    const [showThresholdPanel, setShowThresholdPanel] = useState(false);
    const [viewMode, setViewMode] = useState<'node' | 'cluster'>('cluster');
    const [migrationSuggestions, setMigrationSuggestions] = useState<MigrationSuggestion[]>([]);
    const [podLogs, setPodLogs] = useState<{pod: string, logs: string} | null>(null);
    const [actionResult, setActionResult] = useState<{type: 'success' | 'error', message: string} | null>(null);
    const [selectedPodMetrics, setSelectedPodMetrics] = useState<any>(null);
    const [loadingLogs, setLoadingLogs] = useState<{[key: string]: boolean}>({});
    const [clusterTopology, setClusterTopology] = useState<any>(null);
    const animationRef = useRef<number>();

    // Resize canvas to fill its container responsively
    useEffect(() => {
        const frame = containerRef.current;
        const canvas = canvasRef.current;
        if (!frame || !canvas) return;

        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                const w = Math.max(400, Math.floor(width));
                const h = Math.max(300, Math.floor(height));
                canvas.width = w;
                canvas.height = h;
                canvasDimsRef.current = { w, h };
                setCanvasDims({ w, h });
            }
        });
        observer.observe(frame);
        return () => observer.disconnect();
    }, []);

    // Threshold configuration state
    interface ThresholdConfig {
        dns_latency_critical: number;
        dns_latency_high: number;
        dns_latency_medium: number;
        tcp_retrans_critical: number;
        tcp_retrans_high: number;
        tcp_retrans_medium: number;
        packet_loss_critical: number;
        packet_loss_high: number;
        packet_loss_medium: number;
        cpu_latency_critical: number;
        cpu_latency_high: number;
    }
    
    const [thresholds, setThresholds] = useState<ThresholdConfig>(() => {
        const saved = localStorage.getItem('migrationThresholds');
        return saved ? JSON.parse(saved) : {
            dns_latency_critical: 10000,
            dns_latency_high: 5000,
            dns_latency_medium: 2000,
            tcp_retrans_critical: 10,
            tcp_retrans_high: 3,
            tcp_retrans_medium: 1,
            packet_loss_critical: 5,
            packet_loss_high: 2,
            packet_loss_medium: 0,
            cpu_latency_critical: 20000,
            cpu_latency_high: 10000,
        };
    });
    
    const [editThresholds, setEditThresholds] = useState<ThresholdConfig>(thresholds);

    // Namespace → colour mapping (stable across renders)
    const namespaceColorMap = useMemo(() => {
        const nsSet = [...new Set(pods.map(p => p.namespace))];
        const map: Record<string, typeof NS_PALETTE[0]> = {};
        nsSet.forEach((ns, i) => { map[ns] = NS_PALETTE[i % NS_PALETTE.length]; });
        return map;
    }, [pods]);
    
    // Fetch cluster topology via websocket (includes all nodes)
    useEffect(() => {
        let mounted = true;

        const handleTopologyUpdate = (topologyData: any) => {
            if (mounted && topologyData) {
                setClusterTopology(topologyData);
            }
        };

        // Connect to topology websocket
        topologyWebSocket.connect();
        topologyWebSocket.subscribe('topology', handleTopologyUpdate);

        // Fallback to REST API if websocket fails
        const fetchTopologyFallback = async () => {
            if (!topologyWebSocket.isConnected() && mounted) {
                try {
                    const topology = await api.getClusterTopology();
                    if (mounted) {
                        setClusterTopology(topology);
                    }
                } catch (err) {
                    console.error('[Topology] Failed to fetch topology:', err);
                }
            }
        };

        // Initial fallback after delay
        setTimeout(fetchTopologyFallback, 2000);

        return () => {
            mounted = false;
            topologyWebSocket.unsubscribe('topology', handleTopologyUpdate);
        };
    }, []);

    // Note: Connection topology websocket support is not yet available in the backend
    // Connections would need to be added to the websocket broadcaster in the backend
    // For now, realConnections will remain empty until backend adds websocket support
    // TODO: Add connections to websocket broadcaster in backend (daemon/pkg/api/websocket.go)

    // Build cluster-wide pod nodes (cluster view)
    useEffect(() => {
        if (viewMode !== 'cluster') return;
        if (!clusterTopology?.nodes?.length) return;

        const nodes: any[] = clusterTopology.nodes;
        const cols = Math.ceil(Math.sqrt(nodes.length));
        const rows = Math.ceil(nodes.length / cols);
        const newPods: PodNode[] = [];
        const { w: cW, h: cH } = canvasDimsRef.current;
        const pad = 40;

        nodes.forEach((node: any, nodeIdx: number) => {
            const col = nodeIdx % cols;
            const row = Math.floor(nodeIdx / cols);
            const cellW = (cW - pad * 2) / cols;
            const cellH = (cH - pad * 2) / rows;
            const nodeCx = pad + cellW * col + cellW / 2;
            const nodeCy = pad + cellH * row + cellH / 2;

            const nodePods: any[] = node.pods || [];
            nodePods.forEach((pod: any, podIdx: number) => {
                const podAngle = (podIdx / Math.max(nodePods.length, 1)) * Math.PI * 2 - Math.PI / 2;
                const podR = Math.min(75, Math.max(35, nodePods.length * 6));
                const podKey = `${pod.namespace || 'default'}/${pod.name}`;
                const existingPod = pods.find(p => p.id === podKey);

                newPods.push({
                    id: podKey,
                    name: pod.name,
                    namespace: pod.namespace || 'default',
                    node: node.name,
                    x: existingPod?.x ?? (nodeCx + podR * Math.cos(podAngle)),
                    y: existingPod?.y ?? (nodeCy + podR * Math.sin(podAngle)),
                    vx: 0, vy: 0,
                    health: 'good',
                    connections: 0,
                    metrics: { dns_latency: 0, tcp_retransmissions: 0, packet_loss: 0, events: 0 },
                });
            });
        });

        setPods(newPods);
        setConnections([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewMode, clusterTopology, canvasDims]);

    // Build pod nodes (node view)
    useEffect(() => {
        if (viewMode !== 'node') return;
        if (!displayMetrics?.pods) return;

        const newPods: PodNode[] = [];
        const podEntries = Object.entries(displayMetrics.pods);

        podEntries.forEach(([podKey, podData]: [string, any], index) => {
            const [namespace, name] = podKey.split('/');
            const angle = (index / podEntries.length) * Math.PI * 2;
            const radius = 200;
            
            const dnsMetrics = podData.dns_latency;
            const tcpMetrics = podData.tcp_metrics;
            
            let health: 'good' | 'warning' | 'critical' = 'good';
            const latency = dnsMetrics?.avg_latency_us || 0;
            
            if (latency > 10000 || (tcpMetrics?.retransmissions || 0) > 5 || (tcpMetrics?.packet_loss || 0) > 3) {
                health = 'critical';
            } else if (latency > 5000 || (tcpMetrics?.retransmissions || 0) > 1 || (tcpMetrics?.packet_loss || 0) > 1) {
                health = 'warning';
            }

            // Check if pod already exists (preserve position)
            const existingPod = pods.find(p => p.id === podKey);
            
            newPods.push({
                id: podKey,
                name,
                namespace,
                x: existingPod?.x || (600 + Math.cos(angle) * radius),
                y: existingPod?.y || (350 + Math.sin(angle) * radius),
                vx: 0,
                vy: 0,
                health,
                connections: 0,
                metrics: {
                    dns_latency: latency,
                    tcp_retransmissions: tcpMetrics?.retransmissions || 0,
                    packet_loss: tcpMetrics?.packet_loss || 0,
                    events: (dnsMetrics?.total_events || 0) + (tcpMetrics?.total_events || 0)
                }
            });
        });

        // Build connections
        const newConnections: Connection[] = [];
        const podMap = new Map<string, PodNode>();
        const connectionSet = new Set<string>(); // Track unique connections
        newPods.forEach(pod => podMap.set(pod.id, pod));
        
        realConnections.forEach((conn: any) => {
            // Skip self-connections
            if (!conn.source_pod || !conn.dest_pod || conn.source_pod === conn.dest_pod) {
                return;
            }
            
            const sourcePod = podMap.get(conn.source_pod);
            const destPod = podMap.get(conn.dest_pod);
            
            if (sourcePod && destPod) {
                // Create unique key for bidirectional connections
                const connKey = [conn.source_pod, conn.dest_pod].sort().join('->');
                
                if (!connectionSet.has(connKey)) {
                    connectionSet.add(connKey);
                    newConnections.push({
                        source: conn.source_pod,
                        target: conn.dest_pod,
                        latency: conn.last_srtt_us || 0,
                        packets: conn.event_count || 0
                    });
                    
                    sourcePod.connections++;
                    destPod.connections++;
                }
            }
        });

        setPods(newPods);
        setConnections(newConnections);

    }, [viewMode, displayMetrics, realConnections]);

    // Analyze metrics for pod recommendations
    useEffect(() => {
        if (!displayMetrics?.pods) {
            return;
        }

        const suggestions: MigrationSuggestion[] = [];
        
        Object.entries(displayMetrics.pods).forEach(([podKey, podData]: [string, any]) => {
            const [namespace, name] = podKey.split('/');
            const dnsMetrics = podData.dns_latency;
            const tcpMetrics = podData.tcp_metrics;
            const schedMetrics = podData.sched_latency;
            
            let issues: string[] = [];
            let severity: 'high' | 'medium' | 'low' = 'low';
            let aiSuggestion = '';
            let action = '';

            const dnsLatency = dnsMetrics?.avg_latency_us || 0;
            const tcpRetrans = tcpMetrics?.retransmissions || 0;
            const packetLoss = tcpMetrics?.packet_loss || 0;
            const cpuLatency = schedMetrics?.avg_runqueue_latency_us || 0;

            // AI-powered analysis using user-defined thresholds
            if (dnsLatency > thresholds.dns_latency_critical) {
                issues.push('Critical DNS latency');
                severity = 'high';
                action = 'Restart Pod';
                aiSuggestion = 'DNS resolver is severely degraded. Recommend immediate pod restart to re-establish DNS connections.';
            } else if (dnsLatency > thresholds.dns_latency_high) {
                issues.push('High DNS latency');
                severity = 'high';
                action = 'Investigate DNS';
                aiSuggestion = 'DNS queries are slow. Check DNS server health or consider using a local DNS cache.';
            } else if (dnsLatency > thresholds.dns_latency_medium) {
                issues.push('Elevated DNS latency');
                severity = 'medium';
                action = 'Monitor DNS';
                aiSuggestion = 'DNS latency is higher than optimal. Monitor DNS performance and consider optimization.';
            }

            if (tcpRetrans > thresholds.tcp_retrans_critical) {
                issues.push('Excessive TCP retransmissions');
                severity = 'high';
                action = 'Migrate Pod';
                aiSuggestion = 'Network path is unreliable. Recommend migrating pod to a different node with better network connectivity.';
            } else if (tcpRetrans > thresholds.tcp_retrans_high) {
                issues.push('TCP retransmissions detected');
                severity = severity === 'high' ? 'high' : 'medium';
                action = 'Monitor Network';
                aiSuggestion = 'TCP retransmissions indicate network congestion. Monitor node network metrics and consider QoS policies.';
            } else if (tcpRetrans > thresholds.tcp_retrans_medium) {
                issues.push('Minor TCP retransmissions');
                severity = severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low';
                action = 'Monitor';
                aiSuggestion = 'Some TCP retransmissions detected. This is normal but worth monitoring if it increases.';
            }

            if (packetLoss > thresholds.packet_loss_critical) {
                issues.push('Critical packet loss');
                severity = 'high';
                action = 'Urgent: Migrate Pod';
                aiSuggestion = 'Severe packet loss detected. Network interface may be failing. Immediate pod migration recommended.';
            } else if (packetLoss > thresholds.packet_loss_high) {
                issues.push('Packet loss detected');
                severity = 'high';
                action = 'Check Network';
                aiSuggestion = 'Packet loss is affecting performance. Verify network interface health and check for network saturation.';
            } else if (packetLoss > thresholds.packet_loss_medium) {
                issues.push('Minor packet loss');
                severity = severity === 'high' ? 'high' : 'medium';
                action = 'Monitor Network';
                aiSuggestion = 'Packet loss detected. Monitor network health to ensure it doesn\'t worsen.';
            }

            if (cpuLatency > thresholds.cpu_latency_critical) {
                issues.push('High CPU scheduling latency');
                severity = severity === 'high' ? 'high' : 'medium';
                action = 'Reduce CPU Load';
                aiSuggestion = 'Pod is experiencing CPU starvation. Consider increasing CPU limits or moving to a less loaded node.';
            } else if (cpuLatency > thresholds.cpu_latency_high) {
                issues.push('Moderate CPU scheduling latency');
                severity = severity === 'high' ? 'high' : 'medium';
                action = 'Monitor CPU';
                aiSuggestion = 'CPU scheduling latency is elevated. Monitor CPU usage and consider adjusting resource limits.';
            }

            if (issues.length > 0) {
                suggestions.push({
                    pod: name,
                    namespace,
                    reason: issues.join(', '),
                    severity,
                    action: action || 'Monitor',
                    aiSuggestion: aiSuggestion || 'No immediate action required. Continue monitoring pod metrics.',
                    metrics: {
                        tcp_issues: tcpRetrans + packetLoss,
                        dns_latency: dnsLatency,
                        packet_loss: packetLoss,
                        cpu_latency: cpuLatency
                    }
                });
            }
        });

        setMigrationSuggestions(suggestions.sort((a, b) => {
            const severityOrder = { high: 3, medium: 2, low: 1 };
            return severityOrder[b.severity] - severityOrder[a.severity];
        }));

    }, [displayMetrics, thresholds]);

    // Physics simulation for force-directed layout
    useEffect(() => {
        if (isPaused || draggedPod) return;

        const animate = () => {
            setPods(prevPods => {
                const updatedPods = [...prevPods];

                updatedPods.forEach(pod => {
                    // Center attraction force (reduced)
                    const centerX = canvasDimsRef.current.w / 2;
                    const centerY = canvasDimsRef.current.h / 2;
                    const dx = centerX - pod.x;
                    const dy = centerY - pod.y;
                    pod.vx += dx * 0.00005; // Reduced from 0.0002
                    pod.vy += dy * 0.00005;

                    // Repulsion between pods
                    updatedPods.forEach(other => {
                        if (pod.id === other.id) return;
                        const dx = other.x - pod.x;
                        const dy = other.y - pod.y;
                        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                        if (dist < 90) {
                            const force = (90 - dist) / dist * 0.18;
                            pod.vx -= dx * force;
                            pod.vy -= dy * force;
                        }
                    });

                    // Connection spring forces (reduced)
                    connections.forEach(conn => {
                        if (conn.source === pod.id) {
                            const target = updatedPods.find(p => p.id === conn.target);
                            if (target) {
                                const dx = target.x - pod.x;
                                const dy = target.y - pod.y;
                                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                                const optimalDist = 200; // Increased from 180
                                const force = (dist - optimalDist) / dist * 0.003; // Reduced from 0.01
                                pod.vx += dx * force;
                                pod.vy += dy * force;
                            }
                        }
                    });

                    // Apply velocity with stronger damping (slower movement)
                    pod.x += pod.vx;
                    pod.y += pod.vy;
                    pod.vx *= 0.92; // Increased damping from 0.85
                    pod.vy *= 0.92;

                    // Keep in bounds
                    const { w: bW, h: bH } = canvasDimsRef.current;
                    pod.x = Math.max(40, Math.min(bW - 40, pod.x));
                    pod.y = Math.max(40, Math.min(bH - 40, pod.y));
                });

                return updatedPods;
            });

            animationRef.current = requestAnimationFrame(animate);
        };

        animationRef.current = requestAnimationFrame(animate);
        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        };
    }, [isPaused, draggedPod, connections]);

    // Canvas drawing
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const draw = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // ── 0. Node zone backgrounds (cluster view) ─────────────────────
            if (viewMode === 'cluster' && clusterTopology?.nodes) {
                (clusterTopology.nodes as any[]).forEach((node: any, nodeIdx: number) => {
                    const podKeys = new Set(
                        (node.pods || []).map((p: any) => `${p.namespace || 'default'}/${p.name}`)
                    );
                    const zonePods = pods.filter(p => podKeys.has(p.id));
                    if (zonePods.length === 0) return;

                    const cx = zonePods.reduce((s, p) => s + p.x, 0) / zonePods.length;
                    const cy = zonePods.reduce((s, p) => s + p.y, 0) / zonePods.length;
                    const maxR = Math.max(50, ...zonePods.map(p => Math.hypot(p.x - cx, p.y - cy))) + 52;
                    const c = NODE_ZONE_COLORS[nodeIdx % NODE_ZONE_COLORS.length];

                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
                    ctx.fillStyle = c.fill;
                    ctx.fill();
                    ctx.strokeStyle = c.stroke;
                    ctx.lineWidth = 2.5;
                    ctx.stroke();

                    // Node name
                    ctx.font = 'bold 11px system-ui, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillStyle = c.label;
                    ctx.fillText(node.name || `Node ${nodeIdx + 1}`, cx, cy - maxR + 14);
                    // IP
                    if (node.ip) {
                        ctx.font = '9px system-ui, sans-serif';
                        ctx.fillStyle = c.label.replace('0.95)', '0.6)');
                        ctx.fillText(node.ip, cx, cy - maxR + 25);
                    }
                    ctx.restore();
                });
            }

            // ── 1. Namespace group backgrounds ──────────────────────────────
            const nsSet = [...new Set(pods.map(p => p.namespace))];
            nsSet.forEach(ns => {
                const nsPods = pods.filter(p => p.namespace === ns);
                if (nsPods.length === 0) return;
                const colors = namespaceColorMap[ns];
                if (!colors) return;

                const cx = nsPods.reduce((s, p) => s + p.x, 0) / nsPods.length;
                const cy = nsPods.reduce((s, p) => s + p.y, 0) / nsPods.length;
                const maxR = Math.max(40, ...nsPods.map(p => Math.hypot(p.x - cx, p.y - cy))) + 44;

                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
                ctx.fillStyle = colors.fill;
                ctx.fill();
                ctx.strokeStyle = colors.stroke;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([6, 4]);
                ctx.stroke();
                ctx.setLineDash([]);

                // Namespace label pinned to top of circle
                ctx.font = 'bold 10px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = colors.label;
                ctx.fillText(ns, cx, cy - maxR + 13);
                ctx.restore();
            });

            // ── 2. Inferred connections – same namespace, dashed ────────────
            pods.forEach((pod, i) => {
                pods.slice(i + 1).forEach(other => {
                    if (pod.namespace !== other.namespace) return;
                    const colors = namespaceColorMap[pod.namespace];
                    if (!colors) return;

                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(pod.x, pod.y);
                    ctx.lineTo(other.x, other.y);
                    ctx.strokeStyle = colors.stroke.replace('0.30)', '0.18)');
                    ctx.lineWidth = 2;
                    ctx.setLineDash([4, 7]);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.restore();
                });
            });

            // ── 3. Real connections – curved line + arrow + latency label ───
            connections.forEach(conn => {
                const source = pods.find(p => p.id === conn.source);
                const target = pods.find(p => p.id === conn.target);
                if (!source || !target) return;

                const color = conn.latency > 10000 ? '#ef4444' : conn.latency > 5000 ? '#f59e0b' : '#3b82f6';
                const midX = (source.x + target.x) / 2;
                const midY = (source.y + target.y) / 2;
                const dx = target.x - source.x;
                const dy = target.y - source.y;
                const angle = Math.atan2(dy, dx);
                const offset = 30;
                const controlX = midX + offset * Math.cos(angle + Math.PI / 2);
                const controlY = midY + offset * Math.sin(angle + Math.PI / 2);

                // Curved line
                ctx.beginPath();
                ctx.moveTo(source.x, source.y);
                ctx.quadraticCurveTo(controlX, controlY, target.x, target.y);
                ctx.strokeStyle = `${color}90`;
                ctx.lineWidth = 3.5;
                ctx.stroke();

                // Arrowhead at target (along bezier tangent at t=1)
                const tDirX = target.x - controlX;
                const tDirY = target.y - controlY;
                const tLen = Math.hypot(tDirX, tDirY) || 1;
                const nx = tDirX / tLen;
                const ny = tDirY / tLen;
                const podR = 24;
                const arrowTipX = target.x - nx * podR;
                const arrowTipY = target.y - ny * podR;
                const arrowLen = 11;
                const arrowSpread = Math.PI / 5;
                const arrowA = Math.atan2(ny, nx);
                ctx.beginPath();
                ctx.moveTo(arrowTipX, arrowTipY);
                ctx.lineTo(arrowTipX - arrowLen * Math.cos(arrowA - arrowSpread),
                           arrowTipY - arrowLen * Math.sin(arrowA - arrowSpread));
                ctx.lineTo(arrowTipX - arrowLen * Math.cos(arrowA + arrowSpread),
                           arrowTipY - arrowLen * Math.sin(arrowA + arrowSpread));
                ctx.closePath();
                ctx.fillStyle = `${color}cc`;
                ctx.fill();

                // Latency label at bezier midpoint
                if (conn.latency > 0) {
                    const t = 0.5;
                    const lx = (1-t)*(1-t)*source.x + 2*(1-t)*t*controlX + t*t*target.x;
                    const ly = (1-t)*(1-t)*source.y + 2*(1-t)*t*controlY + t*t*target.y - 13;
                    ctx.save();
                    ctx.font = 'bold 10px monospace';
                    ctx.textAlign = 'center';
                    ctx.fillStyle = color;
                    ctx.fillText(`${(conn.latency / 1000).toFixed(1)}ms`, lx, ly);
                    ctx.restore();
                }

                // Animated flow particles
                if (!isPaused) {
                    for (let i = 0; i < 2; i++) {
                        const progress = ((Date.now() / 1500 + i * 0.5) % 1);
                        const t = progress;
                        const x = Math.pow(1 - t, 2) * source.x + 
                                 2 * (1 - t) * t * controlX + 
                                 Math.pow(t, 2) * target.x;
                        const y = Math.pow(1 - t, 2) * source.y + 
                                 2 * (1 - t) * t * controlY + 
                                 Math.pow(t, 2) * target.y;
                        const gradient = ctx.createRadialGradient(x, y, 0, x, y, 8);
                        gradient.addColorStop(0, color);
                        gradient.addColorStop(0.5, `${color}80`);
                        gradient.addColorStop(1, `${color}00`);
                        ctx.beginPath();
                        ctx.arc(x, y, 8, 0, Math.PI * 2);
                        ctx.fillStyle = gradient;
                        ctx.fill();
                    }
                }
            });

            // Draw pods
            const now = Date.now();
            pods.forEach(pod => {
                const isSelected = selectedPod?.id === pod.id;
                const isDragging = draggedPod?.id === pod.id;
                const radius = isSelected ? 28 : isDragging ? 30 : 24;

                // ── Pulsing rings for critical pods ──────────────────────────
                if (pod.health === 'critical' && !isPaused) {
                    for (let ring = 0; ring < 2; ring++) {
                        const phase = ((now + ring * 600) % 1200) / 1200;
                        const pulseR = radius + 5 + phase * 16;
                        const alpha = (1 - phase) * 0.55;
                        ctx.beginPath();
                        ctx.arc(pod.x, pod.y, pulseR, 0, Math.PI * 2);
                        ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
                        ctx.lineWidth = 1.5;
                        ctx.stroke();
                    }
                }

                // ── Dashed ring for warning pods ─────────────────────────────
                if (pod.health === 'warning') {
                    ctx.save();
                    ctx.setLineDash([4, 4]);
                    ctx.lineDashOffset = -(now / 60) % 16;
                    ctx.beginPath();
                    ctx.arc(pod.x, pod.y, radius + 5, 0, Math.PI * 2);
                    ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.restore();
                }

                // ── Selection glow ────────────────────────────────────────────
                if (isSelected || isDragging) {
                    ctx.beginPath();
                    ctx.arc(pod.x, pod.y, radius + 10, 0, Math.PI * 2);
                    const glowGradient = ctx.createRadialGradient(pod.x, pod.y, radius, pod.x, pod.y, radius + 10);
                    const glowColor = pod.health === 'critical' ? 'rgba(239, 68, 68, 0.35)' :
                                     pod.health === 'warning' ? 'rgba(245, 158, 11, 0.35)' : 'rgba(59, 130, 246, 0.35)';
                    glowGradient.addColorStop(0, glowColor);
                    glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    ctx.fillStyle = glowGradient;
                    ctx.fill();
                }

                // ── Pod circle ────────────────────────────────────────────────
                ctx.beginPath();
                ctx.arc(pod.x, pod.y, radius, 0, Math.PI * 2);
                const gradient = ctx.createRadialGradient(
                    pod.x - radius / 3, pod.y - radius / 3, 0,
                    pod.x, pod.y, radius
                );
                if (pod.health === 'critical') {
                    gradient.addColorStop(0, '#f87171');
                    gradient.addColorStop(0.6, '#ef4444');
                    gradient.addColorStop(1, '#991b1b');
                } else if (pod.health === 'warning') {
                    gradient.addColorStop(0, '#fde68a');
                    gradient.addColorStop(0.6, '#fbbf24');
                    gradient.addColorStop(1, '#b45309');
                } else {
                    gradient.addColorStop(0, '#93c5fd');
                    gradient.addColorStop(0.6, '#60a5fa');
                    gradient.addColorStop(1, '#1d4ed8');
                }
                ctx.fillStyle = gradient;
                ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
                ctx.shadowBlur = 15;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 5;
                ctx.fill();

                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.strokeStyle = isSelected ? '#fff' :
                    pod.health === 'critical' ? 'rgba(252, 165, 165, 0.7)' :
                    pod.health === 'warning'  ? 'rgba(253, 230, 138, 0.7)' :
                                               'rgba(147, 197, 253, 0.5)';
                ctx.lineWidth = isSelected ? 3 : 2;
                ctx.stroke();

                // ── Health arc (DNS latency progress ring) ────────────────────
                const dnsVal = pod.metrics.dns_latency || 0;
                const arcFraction = Math.min(dnsVal / 10000, 1);
                if (arcFraction > 0.04) {
                    const arcR = radius + 4;
                    const arcStart = -Math.PI / 2;
                    ctx.beginPath();
                    ctx.arc(pod.x, pod.y, arcR, 0, Math.PI * 2);
                    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    const arcColor = arcFraction > 0.8 ? '#ef4444' : arcFraction > 0.5 ? '#f59e0b' : '#22d3ee';
                    ctx.beginPath();
                    ctx.arc(pod.x, pod.y, arcR, arcStart, arcStart + arcFraction * Math.PI * 2);
                    ctx.strokeStyle = arcColor;
                    ctx.lineWidth = 2;
                    ctx.lineCap = 'round';
                    ctx.stroke();
                    ctx.lineCap = 'butt';
                }

                // ── Hexagon (Kubernetes) icon ─────────────────────────────────
                const hexSize = 8;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const a = (Math.PI / 3) * i - Math.PI / 2;
                    const hx = pod.x + hexSize * Math.cos(a);
                    const hy = pod.y + hexSize * Math.sin(a);
                    if (i === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
                }
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
                ctx.lineWidth = 1;
                ctx.stroke();

                // Inner health-colour dot
                ctx.beginPath();
                ctx.arc(pod.x, pod.y, hexSize * 0.38, 0, Math.PI * 2);
                ctx.fillStyle = pod.health === 'critical' ? '#dc2626' :
                               pod.health === 'warning'  ? '#d97706' : '#2563eb';
                ctx.fill();

                // ── Status dot (bottom-right corner) ─────────────────────────
                const dotX = pod.x + radius * 0.68;
                const dotY = pod.y + radius * 0.68;
                ctx.beginPath();
                ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
                ctx.fillStyle = pod.health === 'critical' ? '#ef4444' :
                               pod.health === 'warning'  ? '#f59e0b' : '#22c55e';
                ctx.fill();
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 1;
                ctx.stroke();

                // ── Connection count badge ────────────────────────────────────
                if (pod.connections > 0) {
                    ctx.beginPath();
                    ctx.arc(pod.x + radius - 6, pod.y - radius + 6, 8, 0, Math.PI * 2);
                    ctx.fillStyle = '#1e293b';
                    ctx.fill();
                    ctx.strokeStyle = '#3b82f6';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                    ctx.fillStyle = '#fff';
                    ctx.font = 'bold 8px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(pod.connections.toString(), pod.x + radius - 6, pod.y - radius + 6);
                }

                // ── Pod name ──────────────────────────────────────────────────
                ctx.fillStyle = '#f1f5f9';
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                const displayName = pod.name.length > 16 ? pod.name.substring(0, 14) + '..' : pod.name;
                ctx.fillText(displayName, pod.x, pod.y + radius + 6);

                // Namespace
                ctx.font = '9px sans-serif';
                ctx.fillStyle = 'rgba(203, 213, 225, 0.65)';
                ctx.fillText(pod.namespace, pod.x, pod.y + radius + 18);
            });

            requestAnimationFrame(draw);
        };

        draw();
    }, [pods, connections, selectedPod, draggedPod, isPaused, namespaceColorMap, viewMode, clusterTopology]);

    // Mouse handlers
    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const clickedPod = pods.find(pod => {
            const dx = pod.x - x;
            const dy = pod.y - y;
            return Math.sqrt(dx * dx + dy * dy) < 28;
        });

        if (clickedPod) {
            setDraggedPod(clickedPod);
            setDragOffset({ x: x - clickedPod.x, y: y - clickedPod.y });
            setSelectedPod(clickedPod);
            
            // Fetch full metrics for selected pod
            if (displayMetrics?.pods && displayMetrics.pods[clickedPod.id]) {
                setSelectedPodMetrics(displayMetrics.pods[clickedPod.id]);
            }
        } else {
            setSelectedPod(null);
            setSelectedPodMetrics(null);
        }
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas || !draggedPod) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setPods(prevPods => 
            prevPods.map(pod => 
                pod.id === draggedPod.id
                    ? { ...pod, x: x - dragOffset.x, y: y - dragOffset.y, vx: 0, vy: 0 }
                    : pod
            )
        );
    };

    const handleMouseUp = () => {
        setDraggedPod(null);
    };

    // Pod actions
    const handleDeletePod = async () => {
        if (!selectedPod) return;
        if (!window.confirm(`Delete pod ${selectedPod.name}?`)) return;
        
        try {
            const response = await fetch(`${API_BASE}/api/pod/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete',
                    namespace: selectedPod.namespace,
                    pod_name: selectedPod.name,
                })
            });
            
            const result = await response.json();
            if (result.success) {
                setActionResult({ type: 'success', message: `Pod deleted successfully` });
                setSelectedPod(null);
            } else {
                setActionResult({ type: 'error', message: result.error || 'Failed to delete pod' });
            }
        } catch (error) {
            setActionResult({ type: 'error', message: `Error: ${error}` });
        }
        
        setTimeout(() => setActionResult(null), 5000);
    };

    const handleRestartPod = async () => {
        if (!selectedPod) return;
        if (!window.confirm(`Restart pod ${selectedPod.name}?`)) return;
        
        try {
            const response = await fetch(`${API_BASE}/api/pod/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'restart',
                    namespace: selectedPod.namespace,
                    pod_name: selectedPod.name,
                })
            });
            
            const result = await response.json();
            if (result.success) {
                setActionResult({ type: 'success', message: `Pod restart initiated` });
            } else {
                setActionResult({ type: 'error', message: result.error || 'Failed to restart pod' });
            }
        } catch (error) {
            setActionResult({ type: 'error', message: `Error: ${error}` });
        }
        
        setTimeout(() => setActionResult(null), 5000);
    };

    const handleViewLogs = async () => {
        if (!selectedPod) return;
        
        try {
            const response = await fetch(`${API_BASE}/api/pod/logs?namespace=${selectedPod.namespace}&pod=${selectedPod.name}&lines=100`);
            const result = await response.json();
            if (result.success) {
                setPodLogs({ pod: selectedPod.name, logs: result.logs || 'No logs available' });
            } else {
                setPodLogs({ pod: selectedPod.name, logs: `Error: ${result.error}` });
            }
        } catch (error) {
            setPodLogs({ pod: selectedPod.name, logs: `Error fetching logs: ${error}` });
        }
    };

    // Note: fetchLogsForPod removed - automatic log fetching for migration suggestions was disabled
    // Logs can still be fetched manually when viewing suggestion details
    
    // Get pod count for selected node from cluster topology
    const selectedNodePodCount = selectedNode && clusterTopology?.nodes
        ? (() => {
            const selectedNodeData = clusterTopology.nodes.find((node: any) => node.name === selectedNode);
            return selectedNodeData?.pods?.length || 0;
          })()
        : pods.length;

    return (
        <div className="network-topology-pro">
            {/* Header */}
            <div className="topology-header-pro">
                <div>
                    <h2 className="page-title">Pod Network Topology</h2>
                    <span className="topology-stats">
                        {viewMode === 'cluster'
                            ? `${clusterTopology?.nodes?.length ?? 0} Nodes · ${pods.length} Pods`
                            : (selectedNode ? `${selectedNodePodCount} Pods on ${selectedNode}` : `${pods.length} Pods`)
                        }
                    </span>
                </div>
                <div className="topology-controls-pro">
                    {/* Unified view selector: Cluster View + per-node options */}
                    <div className="topology-view-select-wrap">
                        {viewMode === 'cluster' ? <FiGlobe className="topology-view-select-icon" /> : <FiServer className="topology-view-select-icon" />}
                        <select
                            className="topology-view-select"
                            value={viewMode === 'cluster' ? '__cluster__' : (selectedNodeKey || '')}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val === '__cluster__') {
                                    setViewMode('cluster');
                                } else {
                                    setViewMode('node');
                                    setSelectedNodeKey(val || null);
                                    if (val) localStorage.setItem('selectedNodeKey', val);
                                }
                            }}
                        >
                            <option value="__cluster__">Cluster View — All Nodes</option>
                            {availableNodes.length > 0 && (
                                <optgroup label="Single Node">
                                    {availableNodes.map((node) => (
                                        <option key={node.key} value={node.key}>
                                            {node.name}{node.ip ? ` (${node.ip})` : ''}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                    </div>

                    <button 
                        className={`control-btn-pro ${isPaused ? '' : 'active'}`}
                        onClick={() => setIsPaused(!isPaused)}
                    >
                        {isPaused ? <FiRefreshCw /> : ''}
                        {isPaused ? 'Resume' : 'Pause'}
                    </button>
                    <button 
                        className={`control-btn-pro ${showMigrationAdvisor ? 'active' : ''}`}
                        onClick={() => setShowMigrationAdvisor(!showMigrationAdvisor)}
                    >
                        <FiZap />
                        Pod Recommendations
                        {migrationSuggestions.length > 0 && (
                            <span className="badge">{migrationSuggestions.length}</span>
                        )}
                    </button>
                </div>
            </div>

            {/* Action notification */}
            {actionResult && (
                <div className={`action-notification ${actionResult.type}`}>
                    {actionResult.type === 'success' ? <FiCheckCircle /> : <FiAlertCircle />}
                    <span>{actionResult.message}</span>
                    <button onClick={() => setActionResult(null)}><FiX /></button>
                </div>
            )}

            {/* Namespace bar */}
            {Object.keys(namespaceColorMap).length > 0 && (
                <div className="topology-ns-bar">
                    <span className="topology-ns-bar-label">Namespaces</span>
                    {Object.entries(namespaceColorMap).map(([ns, colors]) => (
                        <span
                            key={ns}
                            className="topology-ns-tag"
                            style={{
                                color: colors.label,
                                borderColor: colors.stroke,
                                background: colors.fill,
                            }}
                        >
                            <span className="topology-ns-tag-dot" style={{ background: colors.stroke }} />
                            {ns}
                        </span>
                    ))}
                    <span
                        className="topology-ns-tag"
                        style={{ color: 'rgba(148,163,184,0.7)', borderColor: 'rgba(148,163,184,0.25)', background: 'transparent', borderStyle: 'dashed', marginLeft: 'auto' }}
                    >
                        ╌╌ same-namespace link
                    </span>
                </div>
            )}

            {/* Canvas */}
            <div className="topology-canvas-container">
                <div className="topology-canvas-frame" ref={containerRef}>
                    <canvas
                        ref={canvasRef}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        style={{ cursor: draggedPod ? 'grabbing' : 'grab', display: 'block', width: '100%', height: '100%' }}
                    />

                    {pods.length === 0 && (
                        <div className="topology-empty">
                            <p>No pods available</p>
                            <span>Deploy pods to see network topology</span>
                        </div>
                    )}
                </div>
            </div>


            {/* Selected pod panel with full eBPF metrics */}
            {selectedPod && (
                <div className="selected-pod-panel-expanded">
                    <div className="panel-header">
                        <div>
                            <h3>{selectedPod.name}</h3>
                            <span className="panel-namespace">{selectedPod.namespace}</span>
                        </div>
                        <button onClick={() => setSelectedPod(null)}><FiX /></button>
                    </div>
                    
                    <div className="panel-metrics-expanded">
                        <div className="metrics-section">
                            <h4>Health Status</h4>
                            <div className="panel-metric">
                                <span>Overall Health:</span>
                                <span className={`health-badge ${selectedPod.health}`}>
                                    {selectedPod.health.toUpperCase()}
                                </span>
                            </div>
                            <div className="panel-metric">
                                <span>Connections:</span>
                                <span>{selectedPod.connections}</span>
                            </div>
                        </div>

                        {selectedPodMetrics?.dns_latency && (
                            <div className="metrics-section">
                                <h4>DNS Metrics</h4>
                                <div className="panel-metric">
                                    <span>Avg Latency:</span>
                                    <span>{((selectedPodMetrics.dns_latency?.avg_latency_us || 0) / 1000).toFixed(2)} ms</span>
                                </div>
                                <div className="panel-metric">
                                    <span>Max Latency:</span>
                                    <span>{((selectedPodMetrics.dns_latency?.max_latency_us || 0) / 1000).toFixed(2)} ms</span>
                                </div>
                                <div className="panel-metric">
                                    <span>Total Queries:</span>
                                    <span>{selectedPodMetrics.dns_latency?.total_events || 0}</span>
                                </div>
                            </div>
                        )}

                        {selectedPodMetrics?.tcp_metrics && (
                            <div className="metrics-section">
                                <h4>TCP Metrics</h4>
                                <div className="panel-metric">
                                    <span>Avg SRTT:</span>
                                    <span>{((selectedPodMetrics.tcp_metrics?.avg_srtt_us || 0) / 1000).toFixed(2)} ms</span>
                                </div>
                                <div className="panel-metric">
                                    <span>Retransmissions:</span>
                                    <span className={(selectedPodMetrics.tcp_metrics?.retransmissions || 0) > 5 ? 'metric-warning' : ''}>
                                        {selectedPodMetrics.tcp_metrics?.retransmissions || 0}
                                    </span>
                                </div>
                                <div className="panel-metric">
                                    <span>Packet Loss:</span>
                                    <span className={(selectedPodMetrics.tcp_metrics?.packet_loss || 0) > 3 ? 'metric-critical' : ''}>
                                        {selectedPodMetrics.tcp_metrics?.packet_loss || 0}
                                    </span>
                                </div>
                                <div className="panel-metric">
                                    <span>Bad Handshakes:</span>
                                    <span>{selectedPodMetrics.tcp_metrics?.bad_handshakes || 0}</span>
                                </div>
                                <div className="panel-metric">
                                    <span>Total Events:</span>
                                    <span>{selectedPodMetrics.tcp_metrics?.total_events || 0}</span>
                                </div>
                            </div>
                        )}

                        {selectedPodMetrics?.sched_latency && (
                            <div className="metrics-section">
                                <h4>CPU Scheduling</h4>
                                <div className="panel-metric">
                                    <span>Avg Run Queue:</span>
                                    <span>{((selectedPodMetrics.sched_latency?.avg_runqueue_latency_us || 0) / 1000).toFixed(2)} ms</span>
                                </div>
                                <div className="panel-metric">
                                    <span>Max Latency:</span>
                                    <span>{((selectedPodMetrics.sched_latency?.max_runqueue_latency_us || 0) / 1000).toFixed(2)} ms</span>
                                </div>
                                <div className="panel-metric">
                                    <span>CPU Starvation:</span>
                                    <span className={(selectedPodMetrics.sched_latency?.cpu_starvation_count || 0) > 10 ? 'metric-warning' : ''}>
                                        {selectedPodMetrics.sched_latency?.cpu_starvation_count || 0}
                                    </span>
                                </div>
                                <div className="panel-metric">
                                    <span>Total Events:</span>
                                    <span>{selectedPodMetrics.sched_latency?.total_events || 0}</span>
                                </div>
                            </div>
                        )}

                        {!selectedPodMetrics && (
                            <div className="metrics-section">
                                <p className="no-metrics">No eBPF metrics available yet. Pod may be starting up.</p>
                            </div>
                        )}
                    </div>

                    <div className="panel-actions">
                        <button className="action-btn primary" onClick={handleViewLogs}>
                            <FiTerminal />
                            View Logs
                        </button>
                        <button className="action-btn warning" onClick={handleRestartPod}>
                            <FiRotateCw />
                            Restart Pod
                        </button>
                        <button className="action-btn danger" onClick={handleDeletePod}>
                            <FiTrash2 />
                            Delete Pod
                        </button>
                    </div>
                </div>
            )}

            {/* Pod logs modal */}
            {podLogs && (
                <div className="logs-modal">
                    <div className="logs-container">
                        <div className="logs-header">
                            <h3>Pod Logs: {podLogs.pod}</h3>
                            <button onClick={() => setPodLogs(null)}><FiX /></button>
                        </div>
                        <pre className="logs-content">{podLogs.logs}</pre>
                    </div>
                </div>
            )}

            {/* Pod Recommendations Panel */}
            {showMigrationAdvisor && (
                <div className="migration-advisor-panel">
                    <div className="advisor-header">
                        <div>
                            <h3>Pod Recommendations</h3>
                            <span className="advisor-subtitle">Real-time eBPF-based recommendations</span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button 
                                onClick={() => setShowThresholdPanel(!showThresholdPanel)}
                                style={{
                                    padding: '0.5rem 1rem',
                                    background: showThresholdPanel ? 'rgba(59, 130, 246, 0.2)' : 'rgba(71, 85, 105, 0.3)',
                                    border: '1px solid rgba(71, 85, 105, 0.5)',
                                    borderRadius: '6px',
                                    color: '#e2e8f0',
                                    cursor: 'pointer',
                                    fontSize: '0.875rem'
                                }}
                            >
                                Configure Thresholds
                            </button>
                            <button onClick={() => setShowMigrationAdvisor(false)}><FiX /></button>
                        </div>
                    </div>
                    
                    {/* Threshold Configuration Panel */}
                    {showThresholdPanel && (
                        <div style={{
                            padding: '1.5rem',
                            background: 'rgba(15, 23, 42, 0.8)',
                            borderBottom: '1px solid rgba(71, 85, 105, 0.3)',
                            borderTop: '1px solid rgba(71, 85, 105, 0.3)'
                        }}>
                            <h4 style={{ margin: '0 0 1rem 0', color: '#e2e8f0', fontSize: '1rem' }}>Metric Thresholds</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                                        DNS Latency - Critical (μs)
                                    </label>
                                    <input
                                        type="number"
                                        value={editThresholds.dns_latency_critical}
                                        onChange={(e) => setEditThresholds({...editThresholds, dns_latency_critical: Number(e.target.value)})}
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem',
                                            background: 'rgba(30, 41, 59, 0.8)',
                                            border: '1px solid rgba(71, 85, 105, 0.5)',
                                            borderRadius: '6px',
                                            color: '#e2e8f0'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                                        DNS Latency - High (μs)
                                    </label>
                                    <input
                                        type="number"
                                        value={editThresholds.dns_latency_high}
                                        onChange={(e) => setEditThresholds({...editThresholds, dns_latency_high: Number(e.target.value)})}
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem',
                                            background: 'rgba(30, 41, 59, 0.8)',
                                            border: '1px solid rgba(71, 85, 105, 0.5)',
                                            borderRadius: '6px',
                                            color: '#e2e8f0'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                                        DNS Latency - Medium (μs)
                                    </label>
                                    <input
                                        type="number"
                                        value={editThresholds.dns_latency_medium}
                                        onChange={(e) => setEditThresholds({...editThresholds, dns_latency_medium: Number(e.target.value)})}
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem',
                                            background: 'rgba(30, 41, 59, 0.8)',
                                            border: '1px solid rgba(71, 85, 105, 0.5)',
                                            borderRadius: '6px',
                                            color: '#e2e8f0'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                                        TCP Retransmissions - Critical
                                    </label>
                                    <input
                                        type="number"
                                        value={editThresholds.tcp_retrans_critical}
                                        onChange={(e) => setEditThresholds({...editThresholds, tcp_retrans_critical: Number(e.target.value)})}
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem',
                                            background: 'rgba(30, 41, 59, 0.8)',
                                            border: '1px solid rgba(71, 85, 105, 0.5)',
                                            borderRadius: '6px',
                                            color: '#e2e8f0'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                                        TCP Retransmissions - High
                                    </label>
                                    <input
                                        type="number"
                                        value={editThresholds.tcp_retrans_high}
                                        onChange={(e) => setEditThresholds({...editThresholds, tcp_retrans_high: Number(e.target.value)})}
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem',
                                            background: 'rgba(30, 41, 59, 0.8)',
                                            border: '1px solid rgba(71, 85, 105, 0.5)',
                                            borderRadius: '6px',
                                            color: '#e2e8f0'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                                        Packet Loss - Critical
                                    </label>
                                    <input
                                        type="number"
                                        value={editThresholds.packet_loss_critical}
                                        onChange={(e) => setEditThresholds({...editThresholds, packet_loss_critical: Number(e.target.value)})}
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem',
                                            background: 'rgba(30, 41, 59, 0.8)',
                                            border: '1px solid rgba(71, 85, 105, 0.5)',
                                            borderRadius: '6px',
                                            color: '#e2e8f0'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                                        Packet Loss - High
                                    </label>
                                    <input
                                        type="number"
                                        value={editThresholds.packet_loss_high}
                                        onChange={(e) => setEditThresholds({...editThresholds, packet_loss_high: Number(e.target.value)})}
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem',
                                            background: 'rgba(30, 41, 59, 0.8)',
                                            border: '1px solid rgba(71, 85, 105, 0.5)',
                                            borderRadius: '6px',
                                            color: '#e2e8f0'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                                        CPU Latency - Critical (μs)
                                    </label>
                                    <input
                                        type="number"
                                        value={editThresholds.cpu_latency_critical}
                                        onChange={(e) => setEditThresholds({...editThresholds, cpu_latency_critical: Number(e.target.value)})}
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem',
                                            background: 'rgba(30, 41, 59, 0.8)',
                                            border: '1px solid rgba(71, 85, 105, 0.5)',
                                            borderRadius: '6px',
                                            color: '#e2e8f0'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                                        CPU Latency - High (μs)
                                    </label>
                                    <input
                                        type="number"
                                        value={editThresholds.cpu_latency_high}
                                        onChange={(e) => setEditThresholds({...editThresholds, cpu_latency_high: Number(e.target.value)})}
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem',
                                            background: 'rgba(30, 41, 59, 0.8)',
                                            border: '1px solid rgba(71, 85, 105, 0.5)',
                                            borderRadius: '6px',
                                            color: '#e2e8f0'
                                        }}
                                    />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <button
                                    onClick={() => {
                                        setThresholds(editThresholds);
                                        localStorage.setItem('migrationThresholds', JSON.stringify(editThresholds));
                                        setShowThresholdPanel(false);
                                    }}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        background: 'rgba(34, 197, 94, 0.2)',
                                        border: '1px solid rgba(34, 197, 94, 0.4)',
                                        borderRadius: '6px',
                                        color: '#4ade80',
                                        cursor: 'pointer',
                                        fontSize: '0.875rem'
                                    }}
                                >
                                    Save
                                </button>
                                <button
                                    onClick={() => {
                                        setEditThresholds(thresholds);
                                        setShowThresholdPanel(false);
                                    }}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        background: 'rgba(71, 85, 105, 0.3)',
                                        border: '1px solid rgba(71, 85, 105, 0.5)',
                                        borderRadius: '6px',
                                        color: '#94a3b8',
                                        cursor: 'pointer',
                                        fontSize: '0.875rem'
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                    
                    <div className="advisor-content">
                        {migrationSuggestions.length === 0 ? (
                            <div className="advisor-empty">
                                <h4>All Pods Performing Optimally</h4>
                                <p>No migration recommendations at this time</p>
                            </div>
                        ) : (
                            <div className="suggestions-list">
                                {migrationSuggestions.map((suggestion, idx) => (
                                    <div key={idx} className={`suggestion-card ${suggestion.severity}`}>
                                        <div className="suggestion-header">
                                            <div>
                                                <h4>{suggestion.pod}</h4>
                                                <span className="suggestion-namespace">{suggestion.namespace}</span>
                                            </div>
                                            <span className={`severity-badge ${suggestion.severity}`}>
                                                {suggestion.severity.toUpperCase()}
                                            </span>
                                        </div>
                                        
                                        <div className="suggestion-reason">
                                            <span>{suggestion.reason}</span>
                                        </div>
                                        
                                        <div className="suggestion-content">
                                            <div className="notification-section">
                                                <div className="notification-header">
                                                    <span className="notification-badge">Notification</span>
                                                </div>
                                                <p className="notification-text">{suggestion.aiSuggestion}</p>
                                            </div>
                                            <div className="suggestion-section">
                                                <div className="suggestion-header-label">
                                                    <span>Suggestion</span>
                                                </div>
                                                <p className="suggestion-text">{suggestion.action}</p>
                                            </div>
                                        </div>
                                        
                                        <div className="suggestion-metrics">
                                            <div className="metric">
                                                <span>TCP Issues: {suggestion.metrics.tcp_issues}</span>
                                            </div>
                                            <div className="metric">
                                                <span>DNS: {(suggestion.metrics.dns_latency / 1000).toFixed(1)}ms</span>
                                            </div>
                                            <div className="metric">
                                                <span>Packet Loss: {suggestion.metrics.packet_loss}</span>
                                            </div>
                                            {suggestion.metrics.cpu_latency > 0 && (
                                                <div className="metric">
                                                    <span>CPU: {(suggestion.metrics.cpu_latency / 1000).toFixed(1)}ms</span>
                                                </div>
                                            )}
                                        </div>
                                        
                                        <div className="suggestion-action">
                                            <span className="migration-hint">
                                                Recommended Action: {suggestion.action}
                                            </span>
                                        </div>

                                        {suggestion.logs && (
                                            <details className="suggestion-logs">
                                                <summary>Recent Pod Logs</summary>
                                                <pre className="logs-preview">{suggestion.logs}</pre>
                                            </details>
                                        )}

                                        {loadingLogs[`${suggestion.namespace}/${suggestion.pod}`] && (
                                            <div className="logs-loading">Loading logs...</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Legend */}
            <div className="topology-legend">
                <div className="legend-item">
                    <div className="legend-circle good"></div>
                    <span>Healthy</span>
                </div>
                <div className="legend-item">
                    <div className="legend-circle warning"></div>
                    <span>Warning</span>
                </div>
                <div className="legend-item">
                    <div className="legend-circle critical"></div>
                    <span>Critical</span>
                </div>
                <div className="legend-separator"></div>
                <div className="legend-item">
                    <div className="legend-arrow blue"></div>
                    <span>Good (&lt;5s)</span>
                </div>
                <div className="legend-item">
                    <div className="legend-arrow orange"></div>
                    <span>Slow (5-10s)</span>
                </div>
                <div className="legend-item">
                    <div className="legend-arrow red"></div>
                    <span>Poor (&gt;10s)</span>
                </div>
                <div className="legend-separator"></div>
                {Object.entries(namespaceColorMap).map(([ns, colors]) => (
                    <div key={ns} className="legend-item">
                        <div className="legend-ns-dot" style={{ background: colors.stroke, border: `1px dashed ${colors.stroke}` }} />
                        <span style={{ color: colors.label }}>{ns}</span>
                    </div>
                ))}
                <div className="legend-item" style={{ opacity: 0.6 }}>
                    <div className="legend-ns-dashed" />
                    <span>Same-namespace link</span>
                </div>
            </div>
        </div>
    );
}
