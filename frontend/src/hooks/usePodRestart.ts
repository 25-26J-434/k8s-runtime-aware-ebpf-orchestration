import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { healthKeys } from "./useClusterHealth";

export interface RestartTarget {
  namespace: string;
  name: string;
  node: string;
}

export const podKey = (namespace: string, name: string) => `${namespace}/${name}`;

// Kubernetes needs a few seconds to recreate the pod; refresh until the new one reports.
const RECHECK_MS = 3000;
const RECHECKS = 5;

export interface RestartNotice {
  ok: boolean;
  message: string;
}

export function usePodRestart() {
  const queryClient = useQueryClient();
  const [restarting, setRestarting] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<RestartNotice | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const setBusy = (key: string, busy: boolean) =>
    setRestarting((prev) => {
      const next = new Set(prev);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });

  const mutation = useMutation({
    mutationFn: (t: RestartTarget) => api.podAction("restart", t.namespace, t.name),
    onMutate: (t) => setBusy(podKey(t.namespace, t.name), true),
    onSuccess: (result, t) => {
      setNotice({ ok: result.success, message: result.message || `Restart requested for ${t.name}` });
      api
        .sendBroadcast({
          event: "HEALTH_ALERT",
          payload: { message: `Pod ${t.name} (ns: ${t.namespace}) is being restarted by Kubernetes`, priority: "HIGH" },
          action: "NONE",
        })
        .catch(() => {});
      for (let i = 1; i <= RECHECKS; i++) {
        timers.current.push(
          window.setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: healthKeys.cluster });
            if (i === RECHECKS) setBusy(podKey(t.namespace, t.name), false);
          }, i * RECHECK_MS),
        );
      }
    },
    onError: (err, t) => {
      setBusy(podKey(t.namespace, t.name), false);
      setNotice({ ok: false, message: err instanceof Error ? err.message : "Restart failed" });
    },
  });

  const { mutate } = mutation;
  const restart = useCallback((t: RestartTarget) => mutate(t), [mutate]);
  return { restart, restarting, notice, dismissNotice: () => setNotice(null) };
}
