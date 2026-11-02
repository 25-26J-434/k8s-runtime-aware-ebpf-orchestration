"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notify } from "@/lib/notify";
import { errorMessage } from "@/lib/api/errors";
import { federationApi } from "../services/federation.api";
import type { OutgoingMessage } from "@/types/federation";

export const federationKeys = {
  stats: ["federation", "stats"] as const,
  logs: ["federation", "logs"] as const,
  topology: ["federation", "topology"] as const,
};

export const useCommStats = () =>
  useQuery({ queryKey: federationKeys.stats, queryFn: ({ signal }) => federationApi.stats(signal), refetchInterval: 5_000 });

export const useCommLogs = (limit = 100) =>
  useQuery({
    queryKey: [...federationKeys.logs, limit],
    queryFn: ({ signal }) => federationApi.logs("cluster", limit, signal),
    refetchInterval: 5_000,
  });

export const useClusterTopology = () =>
  useQuery({ queryKey: federationKeys.topology, queryFn: ({ signal }) => federationApi.topology(signal), refetchInterval: 15_000 });

export type SendMode = "broadcast" | "unicast" | "multicast";

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mode, targets, message }: { mode: SendMode; targets: string[]; message: OutgoingMessage }) => {
      if (mode === "broadcast") return federationApi.broadcast(message);
      if (mode === "unicast") return federationApi.unicast(targets[0] ?? "", message);
      return federationApi.multicast(targets, message);
    },
    onSuccess: (_d, v) => {
      notify.success(`${v.mode[0]?.toUpperCase()}${v.mode.slice(1)} sent`);
      qc.invalidateQueries({ queryKey: federationKeys.logs });
      qc.invalidateQueries({ queryKey: federationKeys.stats });
    },
    onError: (e) => notify.error(errorMessage(e, "Message failed to send")),
  });
}
