"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import { notify } from "@/lib/notify";
import { ManagedSocket, type SocketStatus } from "@/lib/websocket/managed-socket";
import type { ClusterTopology } from "@/types/cluster";

const KEY = ["topology"] as const;

/** Topology via REST (first paint + fallback poll) kept fresh by /ws/topology. */
export function useTopology() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SocketStatus>("connecting");

  const query = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => apiRequest<ClusterTopology>(endpoints.topology, { signal }),
    refetchInterval: status === "live" ? false : 10_000,
    placeholderData: (p) => p,
  });

  useEffect(() => {
    const socket = new ManagedSocket({
      path: "/ws/topology",
      onStatus: setStatus,
      onMessage: (msg) => {
        if (typeof msg !== "object" || msg === null) return;
        const m = msg as { type?: string; data?: ClusterTopology };
        if (m.type === "topology" && m.data && Array.isArray(m.data.nodes)) qc.setQueryData(KEY, m.data);
      },
    });
    socket.start();
    return () => socket.stop();
  }, [qc]);

  return { ...query, streamStatus: status };
}

export interface PodLogs {
  success: boolean;
  logs?: string;
  error?: string;
}

export const fetchPodLogs = (namespace: string, pod: string, signal?: AbortSignal) =>
  apiRequest<PodLogs>(endpoints.podLogs, { query: { namespace, pod, lines: 100 }, signal });

/** Deletes a pod. Controllers recreate managed pods; unmanaged ones are gone for good. */
export function useDeletePod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (t: { namespace: string; name: string }) =>
      apiRequest<{ success: boolean; message?: string; error?: string }>(endpoints.podAction, {
        method: "POST",
        body: { action: "delete", namespace: t.namespace, pod_name: t.name },
      }),
    onSuccess: (result, t) => {
      // The daemon answers 200 with success:false; the real reason is in `error`.
      if (!result.success) {
        notify.error([result.message, result.error].filter(Boolean).join(": ") || "Delete failed");
        return;
      }
      notify.success(result.message || `Deleted ${t.name}`);
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => notify.error(errorMessage(e, "Delete failed")),
  });
}
