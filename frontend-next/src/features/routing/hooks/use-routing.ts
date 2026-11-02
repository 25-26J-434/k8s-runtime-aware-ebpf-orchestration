"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@/lib/api/errors";
import { notify } from "@/lib/notify";
import { routingApi } from "../services/routing.api";
import { interpretProbe, resolveFrontend } from "../lib/policy";
import type { ClusterSummary, PolicyRecord, ProbeResult } from "@/types/routing";

export const routingKeys = {
  policies: ["routing", "policies"] as const,
  summary: ["routing", "summary"] as const,
  redirections: ["routing", "redirections"] as const,
};

export const usePolicies = () =>
  useQuery({ queryKey: routingKeys.policies, queryFn: ({ signal }) => routingApi.policies(signal), refetchInterval: 20_000 });

/** Cluster summary feeds the form's namespace/service/selector choices; fetched on demand. */
export const useClusterSummary = (enabled: boolean) =>
  useQuery({ queryKey: routingKeys.summary, queryFn: ({ signal }) => routingApi.clusterSummary(signal), enabled, staleTime: 30_000 });

export const useRedirections = () =>
  useQuery({ queryKey: routingKeys.redirections, queryFn: ({ signal }) => routingApi.redirections(signal), refetchInterval: 15_000 });

export function usePolicyMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["routing"] });
  return {
    create: useMutation({
      mutationFn: (body: unknown) => routingApi.createPolicy(body),
      onSuccess: () => { notify.success("Policy created"); refresh(); },
      onError: (e) => notify.error(errorMessage(e, "Could not create policy")),
    }),
    update: useMutation({
      mutationFn: ({ name, body }: { name: string; body: unknown }) => routingApi.updatePolicy(name, body),
      onSuccess: () => { notify.success("Policy updated"); refresh(); },
      onError: (e) => notify.error(errorMessage(e, "Could not update policy")),
    }),
    remove: useMutation({
      mutationFn: (name: string) => routingApi.deletePolicy(name),
      onSuccess: () => { notify.success("Policy deleted"); refresh(); },
      onError: (e) => notify.error(errorMessage(e, "Could not delete policy")),
    }),
  };
}

/** Evaluate a policy; when it applies a redirect, probe the frontend to show which pod answers. */
export function useApplyPolicy() {
  const qc = useQueryClient();
  const [probe, setProbe] = useState<{ policy: string; result: ProbeResult } | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  const runProbe = async (policy: PolicyRecord) => {
    const { service, port, namespace } = resolveFrontend(policy);
    if (!service) {
      setProbeError("This policy has no frontend service to probe.");
      return;
    }
    try {
      const summary: ClusterSummary | null = await qc.fetchQuery({ queryKey: routingKeys.summary, queryFn: ({ signal }) => routingApi.clusterSummary(signal), staleTime: 30_000 }).catch(() => null);
      const raw = await routingApi.probe(service, namespace, port);
      setProbe({ policy: policy.policy_name ?? service, result: interpretProbe(raw, policy, summary) });
      setProbeError(null);
    } catch (e) {
      setProbeError(errorMessage(e, "Probe failed"));
    }
  };

  const apply = useMutation({
    mutationFn: (policy: PolicyRecord) => routingApi.applyPolicy(policy.policy_name as string),
    onSuccess: async (res, policy) => {
      notify.success(res.message || (res.applied ? "Redirect applied" : "Policy evaluated"));
      qc.invalidateQueries({ queryKey: ["routing"] });
      if (res.applied) await runProbe(policy);
    },
    onError: (e) => notify.error(errorMessage(e, "Could not apply policy")),
  });

  return { apply, lastResult: apply.data, probe, probeError, runProbe, clearProbe: () => setProbe(null) };
}
