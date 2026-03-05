import { ClusterHealthResponse, HealthAlert, HealthStats, NodeHealthUpdate } from '../types/health';

class HealthService {
    private ws: WebSocket | null = null;
    private reconnectTimer: number | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectInterval = 3000;
    private isIntentionallyClosed = false;

    // Event handlers
    private onHealthUpdate: ((data: ClusterHealthResponse) => void) | null = null;
    private onHealthAlert: ((alert: HealthAlert) => void) | null = null;
    private onConnectHandler: (() => void) | null = null;
    private onDisconnectHandler: (() => void) | null = null;

    connect() {
        if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
            return;
        }

        this.isIntentionallyClosed = false;

        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            const wsUrl = `${protocol}//${host}/ws/node-health`;

            console.log(`[HealthService] Connecting to ${wsUrl}`);
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('[HealthService] Connected to health monitoring');
                this.reconnectAttempts = 0;
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
                this.onConnectHandler?.();
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('[HealthService] Failed to parse message:', error);
                }
            };

            this.ws.onclose = () => {
                console.log('[HealthService] Disconnected from health monitoring');
                this.onDisconnectHandler?.();
                
                if (!this.isIntentionallyClosed) {
                    this.scheduleReconnect();
                }
            };

            this.ws.onerror = (error) => {
                console.error('[HealthService] WebSocket error:', error);
            };

        } catch (error) {
            console.error('[HealthService] Failed to connect:', error);
            this.scheduleReconnect();
        }
    }

    private handleMessage(message: any) {
        const { type, data } = message;

        switch (type) {
            case 'node_health':
                if (this.onHealthUpdate && data) {
                    this.onHealthUpdate(data as ClusterHealthResponse);
                }
                break;

            case 'node_health_alert':
                if (this.onHealthAlert && data) {
                    this.onHealthAlert(data as HealthAlert);
                }
                break;

            default:
                console.log('[HealthService] Unknown message type:', type);
        }
    }

    private scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts || this.isIntentionallyClosed) {
            console.error('[HealthService] Max reconnection attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);

        console.log(`[HealthService] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        
        this.reconnectTimer = window.setTimeout(() => {
            this.connect();
        }, delay);
    }

    disconnect() {
        this.isIntentionallyClosed = true;
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    // Event handler setters
    onConnect(handler: () => void) {
        this.onConnectHandler = handler;
    }

    onDisconnect(handler: () => void) {
        this.onDisconnectHandler = handler;
    }

    onClusterHealthUpdate(handler: (data: ClusterHealthResponse) => void) {
        this.onHealthUpdate = handler;
    }

    onAlert(handler: (alert: HealthAlert) => void) {
        this.onHealthAlert = handler;
    }

    // REST API methods for health data
    async getClusterHealth(): Promise<ClusterHealthResponse> {
        const response = await fetch('/api/cluster/node-health');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getUnifiedMetrics(): Promise<any> {
        const response = await fetch('/api/metrics/unified');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    // Utility methods
    calculateHealthStats(healthData: ClusterHealthResponse): HealthStats {
        const stats: HealthStats = {
            totalNodes: 0,
            healthyNodes: 0,
            degradedNodes: 0,
            unhealthyNodes: 0,
            totalPods: 0,
            healthyPods: 0,
            unhealthyPods: 0,
            unknownPods: 0,
            criticalAlerts: 0,
            warningAlerts: 0
        };

        // Calculate node stats
        Object.values(healthData.nodes).forEach(node => {
            stats.totalNodes++;
            
            switch (node.health_level) {
                case 'healthy':
                    stats.healthyNodes++;
                    break;
                case 'degraded':
                    stats.degradedNodes++;
                    break;
                case 'unhealthy':
                    stats.unhealthyNodes++;
                    break;
            }

            // Calculate pod stats
            stats.totalPods += node.total_pods;
            stats.healthyPods += node.healthy_pods;
            stats.unhealthyPods += node.unhealthy_pods;
            stats.unknownPods += node.unknown_pods;
        });

        // Calculate alert stats
        if (healthData.alerts) {
            healthData.alerts.forEach(alert => {
                if (alert.severity === 'critical') {
                    stats.criticalAlerts++;
                } else if (alert.severity === 'warning') {
                    stats.warningAlerts++;
                }
            });
        }

        return stats;
    }

    getHealthLevelColor(level?: string): string {
        switch (level) {
            case 'healthy':
                return '#22c55e'; // green-500
            case 'degraded':
                return '#f59e0b'; // amber-500
            case 'unhealthy':
                return '#ef4444'; // red-500
            default:
                return '#6b7280'; // gray-500
        }
    }

    getHealthLevelIcon(level?: string): string {
        switch (level) {
            case 'healthy':
                return '🟢';
            case 'degraded':
                return '🟡';
            case 'unhealthy':
                return '🔴';
            default:
                return '⚪';
        }
    }

    getSeverityIcon(severity: string): string {
        switch (severity) {
            case 'critical':
                return '🔴';
            case 'warning':
                return '🟡';
            case 'info':
                return '🔵';
            default:
                return '⚪';
        }
    }
}

export const healthService = new HealthService();