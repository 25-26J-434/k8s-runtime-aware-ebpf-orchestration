export interface CommStats {
  broadcast: number;
  unicast: number;
  multicast: number;
  received: number;
  total: number;
  last_update: string;
  node: string;
  node_ip: string;
  peer_count: number;
  peers: string[];
}

export type CommDirection = "SENT" | "RECEIVED";
export type CommMode = "BROADCAST" | "UNICAST" | "MULTICAST" | "RECEIVED";

export interface CommLogEntry {
  id: string;
  timestamp: string;
  node: string;
  node_ip: string;
  direction: CommDirection;
  mode: CommMode;
  event: string;
  action?: string;
  source?: string;
  source_ip?: string;
  targets?: string[];
  target_ips?: string[];
  delivered?: string[];
  delivered_ips?: string[];
  failed?: string[];
  failed_ips?: string[];
  result?: string;
  payload?: Record<string, unknown>;
}

export const EVENT_TYPES = [
  "HANDSHAKE",
  "HEALTH_ALERT",
  "SCHEDULING",
  "STATE_UPDATE",
  "METRIC_UPDATE",
  "DISCOVERY",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface OutgoingMessage {
  event: EventType;
  payload: Record<string, unknown>;
  action: "NONE";
  targets?: string[];
}
