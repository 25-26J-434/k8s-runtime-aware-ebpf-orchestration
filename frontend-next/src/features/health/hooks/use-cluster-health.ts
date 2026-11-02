"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ManagedSocket, type SocketStatus } from "@/lib/websocket/managed-socket";
import { healthApi } from "../services/health.api";
import { healthKeys } from "./health.keys";
import type { ClusterHealth, HealthAlert } from "@/types/health";

// The daemon sends a snapshot at least every 10s; longer silence means a dead socket.
const SILENCE_MS = 25_000;

// Alerts already relayed to the federation, so reconnects and extra tabs do not repeat them.
const relayed = new Set<string>();

function relayOnce(alert: HealthAlert) {
  const key = `${alert.id ?? alert.message}|${alert.severity}|${alert.timestamp}`;
  if (relayed.has(key)) return;
  relayed.add(key);
  if (relayed.size > 500) relayed.delete(relayed.values().next().value as string);
  healthApi.relayAlert(alert).catch(() => {});
}

function isEnvelope(v: unknown): v is { type: string; data: unknown } {
  return typeof v === "object" && v !== null && "type" in v && "data" in v;
}

/**
 * Cluster health as a TanStack Query resource kept fresh by the /ws/node-health stream.
 * REST supplies first paint and polls every 5s while the socket is not live.
 */
export function useClusterHealth() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SocketStatus>("connecting");

  const query = useQuery({
    queryKey: healthKeys.cluster,
    queryFn: ({ signal }) => healthApi.cluster(signal),
    refetchInterval: status === "live" ? false : 5_000,
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    const socket = new ManagedSocket({
      path: "/ws/node-health",
      silenceMs: SILENCE_MS,
      onStatus: setStatus,
      onMessage: (msg) => {
        if (!isEnvelope(msg) || !msg.data) return;
        if (msg.type === "node_health") {
          const next = msg.data as ClusterHealth;
          // Never let an older snapshot overwrite a newer one.
          queryClient.setQueryData<ClusterHealth>(healthKeys.cluster, (prev) =>
            prev?.seq !== undefined && next.seq !== undefined && next.seq < prev.seq ? prev : next,
          );
        } else if (msg.type === "node_health_alert") {
          relayOnce(msg.data as HealthAlert);
          queryClient.invalidateQueries({ queryKey: healthKeys.alerts });
        }
      },
    });
    socket.start();
    return () => socket.stop();
  }, [queryClient]);

  return {
    ...query,
    streamStatus: status,
    updatedAt: query.dataUpdatedAt,
  };
}
