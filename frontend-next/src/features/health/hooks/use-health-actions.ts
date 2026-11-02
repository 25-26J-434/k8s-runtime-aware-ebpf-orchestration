"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notify } from "@/lib/notify";
import { errorMessage } from "@/lib/api/errors";
import { healthApi } from "../services/health.api";
import { healthKeys } from "./health.keys";
import type { MetricsConfig } from "@/types/health";

export function useHealthAlerts() {
  return useQuery({
    queryKey: healthKeys.alerts,
    queryFn: ({ signal }) => healthApi.alertHistory(signal),
    refetchInterval: 30_000,
  });
}

export function useMetricsConfig(enabled = true) {
  return useQuery({
    queryKey: healthKeys.config,
    queryFn: ({ signal }) => healthApi.getConfig(signal),
    enabled,
  });
}

export function useSaveMetricsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: MetricsConfig) => healthApi.saveConfig(config),
    onSuccess: (_d, config) => {
      qc.setQueryData(healthKeys.config, config);
      qc.invalidateQueries({ queryKey: healthKeys.cluster });
      notify.success("Thresholds saved");
    },
    onError: (e) => notify.error(errorMessage(e, "Could not save thresholds")),
  });
}

const RECHECK_MS = 3_000;
const RECHECKS = 5;

/** Restarts a pod, then re-polls health while Kubernetes recreates it. */
export function useRestartPod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (t: { namespace: string; name: string }) => healthApi.restartPod(t.namespace, t.name),
    onSuccess: (result, t) => {
      // The daemon answers 200 with success:false; the real reason is in `error`.
      if (!result.success) {
        notify.error([result.message, result.error].filter(Boolean).join(": ") || "Restart failed");
        return;
      }
      notify.success(result.message || `Restart requested for ${t.name}`);
      for (let i = 1; i <= RECHECKS; i++) {
        setTimeout(() => qc.invalidateQueries({ queryKey: healthKeys.cluster }), i * RECHECK_MS);
      }
    },
    onError: (e) => notify.error(errorMessage(e, "Restart failed")),
  });
}
