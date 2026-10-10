import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE, api, getBackendWsUrl } from "../services/api";
import type { ClusterHealthResponse, HealthAlert, HealthAlertHistoryResponse } from "../types/health";

export const healthKeys = {
  cluster: ["cluster-health"] as const,
  alertHistory: ["cluster-health-alerts"] as const,
  config: ["metrics-config"] as const,
};

export type StreamStatus = "connecting" | "live" | "offline";

// The daemon sends a snapshot at least every 10s; longer silence means a dead socket.
const SILENCE_LIMIT_MS = 25000;
const MAX_BACKOFF_MS = 15000;

async function fetchClusterHealth(): Promise<ClusterHealthResponse> {
  const res = await fetch(`${API_BASE}/api/cluster/node-health`);
  if (!res.ok) throw new Error(`Health request failed (${res.status})`);
  return res.json();
}

export async function fetchAlertHistory(): Promise<HealthAlertHistoryResponse> {
  const res = await fetch(`${API_BASE}/api/cluster/health-alerts`);
  if (!res.ok) throw new Error(`Alert history request failed (${res.status})`);
  return res.json();
}

// Alerts already relayed to the federation, so reconnects and extra tabs do not repeat them.
const relayed = new Set<string>();

function relayAlertToFederation(alert: HealthAlert) {
  const key = `${alert.id ?? alert.message}|${alert.severity}|${alert.timestamp}`;
  if (relayed.has(key)) return;
  relayed.add(key);
  if (relayed.size > 500) relayed.delete(relayed.values().next().value as string);

  const priority = alert.severity === "critical" ? "HIGH" : alert.severity === "warning" ? "MEDIUM" : "LOW";
  api
    .sendBroadcast({
      event: "HEALTH_ALERT",
      payload: {
        message: alert.message,
        priority,
        severity: alert.severity,
        source: alert.source,
        node: alert.node_name,
        ...(alert.pod_name && { pod: alert.pod_name }),
        ...(alert.namespace && { namespace: alert.namespace }),
      },
      action: "NONE",
    })
    .catch(() => {});
}

/**
 * Cluster health as a TanStack Query resource, kept fresh by the WebSocket stream.
 * REST gives the first paint and acts as a fallback poll while the socket is down.
 */
export function useClusterHealth() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const statusRef = useRef(status);
  statusRef.current = status;

  const query = useQuery({
    queryKey: healthKeys.cluster,
    queryFn: fetchClusterHealth,
    refetchInterval: () => (statusRef.current === "live" ? false : 5000),
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let attempts = 0;
    let retryTimer: number | undefined;
    let watchdog: number | undefined;

    const armWatchdog = () => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => ws?.close(), SILENCE_LIMIT_MS);
    };

    const connect = () => {
      setStatus("connecting");
      ws = new WebSocket(getBackendWsUrl("/ws/node-health"));

      ws.onopen = () => {
        attempts = 0;
        setStatus("live");
        armWatchdog();
      };

      ws.onmessage = (event) => {
        armWatchdog();
        let msg: { type?: string; data?: unknown };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === "node_health" && msg.data) {
          const next = msg.data as ClusterHealthResponse;
          queryClient.setQueryData<ClusterHealthResponse>(healthKeys.cluster, (prev) =>
            prev?.seq !== undefined && next.seq !== undefined && next.seq < prev.seq ? prev : next,
          );
        } else if (msg.type === "node_health_alert" && msg.data) {
          relayAlertToFederation(msg.data as HealthAlert);
          queryClient.invalidateQueries({ queryKey: healthKeys.alertHistory });
        }
      };

      ws.onclose = () => {
        window.clearTimeout(watchdog);
        if (closed) return;
        setStatus("offline");
        const delay = Math.min(1000 * 2 ** attempts++, MAX_BACKOFF_MS);
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(watchdog);
      ws?.close();
    };
  }, [queryClient]);

  const { refetch } = query;
  const refresh = useCallback(() => refetch(), [refetch]);

  return {
    data: query.data,
    status,
    isLoading: query.isLoading,
    isError: query.isError && !query.data,
    error: query.error as Error | null,
    isRefreshing: query.isFetching,
    refresh,
    updatedAt: query.dataUpdatedAt,
  };
}
