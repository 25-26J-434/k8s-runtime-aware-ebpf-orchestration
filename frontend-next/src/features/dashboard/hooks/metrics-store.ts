"use client";

import { create } from "zustand";
import type { SocketStatus } from "@/lib/websocket/managed-socket";
import type { MetricsFrame, UnifiedMetrics } from "@/types/metrics";

export interface HistoryPoint {
  t: number;
  dnsUs: number;
  rttUs: number;
  srttUs: number;
  retrans: number;
  packetLoss: number;
  cpu?: number;
  mem?: number;
}

const HISTORY_LIMIT = 120;

interface MetricsState {
  nodes: Record<string, UnifiedMetrics>;
  status: SocketStatus;
  receivedAt: number;
  /** Rolling client-side samples taken as frames arrive. Not server-side history. */
  history: Record<string, HistoryPoint[]>;
  setStatus: (s: SocketStatus) => void;
  apply: (frame: MetricsFrame) => void;
}

function sample(m: UnifiedMetrics): HistoryPoint {
  const n = m.node ?? {};
  return {
    t: Date.now(),
    dnsUs: (n.dns_latency?.avg_latency_ns ?? 0) / 1000,
    rttUs: (n.rtt?.avg_rtt_ns ?? 0) / 1000,
    srttUs: n.tcp_metrics?.last_srtt_us ?? 0,
    retrans: n.tcp_metrics?.retransmissions ?? 0,
    packetLoss: n.tcp_metrics?.packet_loss ?? 0,
    cpu: n.node_system?.cpu_usage_percent,
    mem: n.node_system?.memory_usage_percent,
  };
}

const push = (list: HistoryPoint[] | undefined, p: HistoryPoint) =>
  [...(list ?? []), p].slice(-HISTORY_LIMIT);

export const useMetricsStore = create<MetricsState>((set) => ({
  nodes: {},
  status: "connecting",
  receivedAt: 0,
  history: {},
  setStatus: (status) => set({ status }),
  apply: (frame) =>
    set((s) => {
      if (frame.type === "snapshot") {
        const history = { ...s.history };
        for (const [k, m] of Object.entries(frame.nodes)) history[k] = push(history[k], sample(m));
        return { nodes: frame.nodes, history, receivedAt: Date.now() };
      }
      return {
        nodes: { ...s.nodes, [frame.node]: frame.metrics },
        history: { ...s.history, [frame.node]: push(s.history[frame.node], sample(frame.metrics)) },
        receivedAt: Date.now(),
      };
    }),
}));
