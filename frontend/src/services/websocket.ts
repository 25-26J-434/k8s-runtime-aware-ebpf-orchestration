import { getBackendWsUrl } from './api';

type MessageHandler = (data: any) => void;

class WebSocketService {
    private ws: WebSocket | null = null;
    private reconnectTimer: number | null = null;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectInterval = 3000;
    private messageHandlers: Map<string, Set<MessageHandler>> = new Map();
    private url: string;
    private isIntentionallyClosed = false;

    constructor(url: string) {
        this.url = url;
    }

    connect() {
        if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
            return;
        }

        this.isIntentionallyClosed = false;

        try {
            const wsUrl = getBackendWsUrl(this.url);

            console.log(`[WebSocket] Connecting to ${wsUrl}`);
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log(`[WebSocket] Connected to ${this.url}`);
                this.reconnectAttempts = 0;
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    const { type, data } = message;

                    const handlers = this.messageHandlers.get(type);
                    if (handlers) {
                        handlers.forEach(handler => handler(data));
                    }
                } catch (error) {
                    console.error('[WebSocket] Error parsing message:', error);
                }
            };

            this.ws.onerror = (error) => {
                console.error('[WebSocket] Error:', error);
            };

            this.ws.onclose = () => {
                console.log('[WebSocket] Disconnected');
                this.ws = null;

                if (!this.isIntentionallyClosed) {
                    this.scheduleReconnect();
                }
            };
        } catch (error) {
            console.error('[WebSocket] Connection error:', error);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WebSocket] Max reconnect attempts reached');
            return;
        }

        if (this.reconnectTimer) {
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1);
        
        console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
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

        this.reconnectAttempts = 0;
    }

    subscribe(messageType: string, handler: MessageHandler) {
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, new Set());
        }
        this.messageHandlers.get(messageType)!.add(handler);
    }

    unsubscribe(messageType: string, handler: MessageHandler) {
        const handlers = this.messageHandlers.get(messageType);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.messageHandlers.delete(messageType);
            }
        }
    }

    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}

// Create singleton instances for different endpoints
export const metricsWebSocket = new WebSocketService('/ws/metrics');
export const topologyWebSocket = new WebSocketService('/ws/topology');
export const podDetailsWebSocket = new WebSocketService('/ws/pod-details');

// Helper hook for managing WebSocket subscriptions
export function useWebSocketSubscription(
    webSocket: WebSocketService,
    messageType: string,
    handler: MessageHandler,
    enabled = true
) {
    const connect = () => {
        if (enabled) {
            webSocket.connect();
            webSocket.subscribe(messageType, handler);
        }
    };

    const disconnect = () => {
        webSocket.unsubscribe(messageType, handler);
        // Only disconnect if no more handlers
        if (webSocket['messageHandlers'].size === 0) {
            webSocket.disconnect();
        }
    };

    return { connect, disconnect };
}

