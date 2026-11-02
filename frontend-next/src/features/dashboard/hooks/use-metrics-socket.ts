"use client";

import { useEffect } from "react";
import { ManagedSocket } from "@/lib/websocket/managed-socket";
import { useMetricsStore } from "./metrics-store";
import type { MetricsFrame } from "@/types/metrics";

function isFrame(v: unknown): v is MetricsFrame {
  if (typeof v !== "object" || v === null) return false;
  const f = v as Record<string, unknown>;
  if (f.type === "snapshot") return typeof f.nodes === "object" && f.nodes !== null;
  if (f.type === "node_update") return typeof f.node === "string" && typeof f.metrics === "object" && f.metrics !== null;
  return false;
}

/**
 * Mount once (in the app shell). Opens a single /api/metrics/ws connection shared by every
 * chart and widget through the metrics store, so widgets never open sockets of their own.
 */
export function useMetricsSocket() {
  useEffect(() => {
    const { apply, setStatus } = useMetricsStore.getState();
    const socket = new ManagedSocket({
      path: "/ws/cluster-metrics",
      onStatus: setStatus,
      onMessage: (m) => isFrame(m) && apply(m),
    });
    socket.start();
    return () => socket.stop();
  }, []);
}
