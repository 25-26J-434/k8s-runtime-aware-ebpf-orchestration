import { apiRequest } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { ExtensionInfo } from "@/types/extensions";

const enc = encodeURIComponent;

export const extensionsApi = {
  list: async (signal?: AbortSignal) => {
    const res = await apiRequest<{ extensions?: ExtensionInfo[] }>("extensions", { signal });
    return res?.extensions ?? [];
  },
  /** A missing config is a normal first-run state, not an error. */
  getConfig: async (name: string, signal?: AbortSignal): Promise<Record<string, unknown>> => {
    try {
      return (await apiRequest<Record<string, unknown>>(`extensions/${enc(name)}/config`, { signal })) ?? {};
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return {};
      throw e;
    }
  },
  setConfig: (name: string, config: Record<string, unknown>) => apiRequest<void>(`extensions/${enc(name)}/config`, { method: "POST", body: config }),
  triggerNotification: () => apiRequest<void>("extensions/notification/trigger", { method: "POST" }),
};
