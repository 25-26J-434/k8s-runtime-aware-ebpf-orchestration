import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { ClusterTopology } from "@/types/cluster";
import type { CommLogEntry, CommStats, OutgoingMessage } from "@/types/federation";

export const federationApi = {
  stats: (signal?: AbortSignal) => apiRequest<CommStats>(endpoints.commStats, { signal }),
  logs: async (scope: "local" | "cluster", limit: number, signal?: AbortSignal) => {
    const data = await apiRequest<{ logs?: CommLogEntry[] }>(endpoints.commLogs, { query: { scope, limit }, signal });
    return Array.isArray(data?.logs) ? data.logs : [];
  },
  topology: (signal?: AbortSignal) => apiRequest<ClusterTopology>(endpoints.topology, { signal }),
  broadcast: (msg: OutgoingMessage) => apiRequest<void>(endpoints.commBroadcast, { method: "POST", body: msg }),
  unicast: (target: string, msg: OutgoingMessage) =>
    apiRequest<void>(endpoints.commUnicast, { method: "POST", body: { ...msg, targets: [target] } }),
  multicast: (targets: string[], msg: OutgoingMessage) =>
    apiRequest<void>(endpoints.commMulticast, { method: "POST", body: { ...msg, targets } }),
};
