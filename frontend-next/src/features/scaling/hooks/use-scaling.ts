"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type { ClusterTopology } from "@/types/cluster";
import { notify } from "@/lib/notify";
import { scalingApi } from "../services/scaling.api";
import type { RuleInput } from "@/types/scaling";

export const scalingKeys = {
  all: ["scaling"] as const,
  rules: (node?: string) => ["scaling", "rules", node ?? ""] as const,
  deployments: (node?: string, ns?: string) => ["scaling", "deployments", node ?? "", ns ?? ""] as const,
  namespaces: (node?: string) => ["scaling", "namespaces", node ?? ""] as const,
  metrics: (node?: string) => ["scaling", "metrics", node ?? ""] as const,
  placement: (ns?: string, dep?: string) => ["scaling", "placement", ns ?? "", dep ?? ""] as const,
};

const POLL_MS = 15_000;

export const useRules = (node?: string) =>
  useQuery({ queryKey: scalingKeys.rules(node), queryFn: ({ signal }) => scalingApi.rules(node, signal), refetchInterval: POLL_MS });

export const useRuleDeployments = (node?: string, namespace?: string, enabled = true) =>
  useQuery({
    queryKey: scalingKeys.deployments(node, namespace),
    queryFn: ({ signal }) => scalingApi.deployments(namespace, node, signal),
    refetchInterval: POLL_MS,
    enabled,
  });

export const useRuleNamespaces = (node?: string, enabled = true) =>
  useQuery({ queryKey: scalingKeys.namespaces(node), queryFn: ({ signal }) => scalingApi.namespaces(node, signal), enabled });

export const useLatestRuleMetrics = (node?: string) =>
  useQuery({ queryKey: scalingKeys.metrics(node), queryFn: ({ signal }) => scalingApi.latestMetrics(node, signal), refetchInterval: POLL_MS });

export const usePlacement = (namespace?: string, deployment?: string) =>
  useQuery({
    queryKey: scalingKeys.placement(namespace, deployment),
    queryFn: ({ signal }) => scalingApi.placement(namespace as string, deployment as string, signal),
    enabled: Boolean(namespace && deployment),
    staleTime: 15_000,
  });

export function useRuleMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: scalingKeys.all });
  const fail = (fallback: string) => (e: unknown) => notify.error(errorMessage(e, fallback));

  return {
    create: useMutation({
      mutationFn: (rule: RuleInput) => scalingApi.createRule(rule),
      onSuccess: () => { notify.success("Rule created"); refresh(); },
      onError: fail("Could not create rule"),
    }),
    update: useMutation({
      mutationFn: ({ id, rule }: { id: string; rule: Partial<RuleInput> }) => scalingApi.updateRule(id, rule),
      onSuccess: () => { notify.success("Rule updated"); refresh(); },
      onError: fail("Could not update rule"),
    }),
    toggle: useMutation({
      mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => scalingApi.updateRule(id, { enabled }),
      onSuccess: refresh,
      onError: fail("Could not change rule state"),
    }),
    remove: useMutation({
      mutationFn: (id: string) => scalingApi.deleteRule(id),
      onSuccess: () => { notify.success("Rule deleted"); refresh(); },
      onError: fail("Could not delete rule"),
    }),
  };
}

/** Cluster nodes, used to pick the node whose telemetry triggers scaling. */
export const useTriggerNodes = () =>
  useQuery({
    queryKey: ["scaling", "nodes"],
    queryFn: async ({ signal }) => {
      const topo = await apiRequest<ClusterTopology>(endpoints.topology, { signal });
      return (topo.nodes ?? []).map((n) => ({ name: n.name, ip: n.ip ?? "" }));
    },
    staleTime: 30_000,
  });
