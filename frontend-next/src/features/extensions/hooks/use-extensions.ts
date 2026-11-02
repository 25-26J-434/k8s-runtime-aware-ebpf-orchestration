"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@/lib/api/errors";
import { notify } from "@/lib/notify";
import { extensionsApi } from "../services/extensions.api";
import { normalizeNotification } from "../lib/notification";
import type { NotificationConfig } from "@/types/extensions";

export const extensionKeys = {
  list: ["extensions", "list"] as const,
  config: (name: string) => ["extensions", "config", name] as const,
};

export const useExtensionList = () =>
  useQuery({ queryKey: extensionKeys.list, queryFn: ({ signal }) => extensionsApi.list(signal), staleTime: 60_000 });

export const useExtensionConfig = (name?: string) =>
  useQuery({
    queryKey: extensionKeys.config(name ?? ""),
    queryFn: ({ signal }) => extensionsApi.getConfig(name as string, signal),
    enabled: Boolean(name),
  });

export const useNotificationConfig = () => {
  const q = useExtensionConfig("notification");
  // Stable identity per fetched payload: forms reset when `config` changes, so it must not change per render.
  const config = useMemo(() => (q.data ? normalizeNotification(q.data) : undefined), [q.data]);
  return { ...q, config };
};

/** Saves an extension's full config. `message` is shown on success. */
export function useSaveConfig(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ config }: { config: Record<string, unknown>; message?: string }) => extensionsApi.setConfig(name, config),
    onSuccess: (_d, v) => {
      qc.setQueryData(extensionKeys.config(name), v.config);
      notify.success(v.message ?? "Saved");
    },
    onError: (e) => notify.error(errorMessage(e, "Could not save configuration")),
  });
}

export function useRunNotificationCheck() {
  const save = useSaveConfig("notification");
  const trigger = useMutation({
    mutationFn: () => extensionsApi.triggerNotification(),
    onSuccess: () => notify.success("Check started. Alerts go to your enabled channels."),
    onError: (e) => notify.error(errorMessage(e, "Could not start the check")),
  });
  return {
    pending: save.isPending || trigger.isPending,
    /** Persist the config first so the check runs against exactly what is shown. */
    run: (config: NotificationConfig) => save.mutate({ config: { ...config }, message: "Configuration saved" }, { onSuccess: () => trigger.mutate() }),
  };
}
