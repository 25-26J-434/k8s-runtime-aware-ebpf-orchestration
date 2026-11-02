import { apiRequest } from "@/lib/api/client";
import type { ApplyResult, ClusterSummary, PolicyRecord, RedirectionEvent } from "@/types/routing";

const enc = encodeURIComponent;

/** All of these are served by the routing service (ROUTING_API_URL on the BFF). */
export const routingApi = {
  policies: async (signal?: AbortSignal) => {
    const res = await apiRequest<PolicyRecord[] | { policies?: PolicyRecord[] }>("policies", { signal });
    return Array.isArray(res) ? res : (res?.policies ?? []);
  },
  createPolicy: (body: unknown) => apiRequest<PolicyRecord>("policies", { method: "POST", body }),
  updatePolicy: (name: string, body: unknown) => apiRequest<PolicyRecord>(`policies/${enc(name)}`, { method: "PUT", body }),
  deletePolicy: (name: string) => apiRequest<void>(`policies/${enc(name)}`, { method: "DELETE" }),
  /** Evaluates the policy against live telemetry and applies the redirect if it is violated. */
  applyPolicy: (name: string) => apiRequest<ApplyResult>(`policies/${enc(name)}/evaluate`, { method: "POST" }),
  clusterSummary: (signal?: AbortSignal) => apiRequest<ClusterSummary>("cluster/summary", { signal }),
  redirections: (signal?: AbortSignal) => apiRequest<RedirectionEvent[]>("redirections", { signal }),
  probe: (service: string, namespace: string, port: string | number, path = "/whoami") =>
    apiRequest<string>(`probe/${enc(service)}`, { query: { namespace, port, path }, text: true }),
};
