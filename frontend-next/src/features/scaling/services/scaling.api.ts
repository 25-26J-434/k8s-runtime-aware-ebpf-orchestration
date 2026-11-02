import { apiRequest } from "@/lib/api/client";
import type { DeploymentInfo, LatestMetric } from "@/types/cluster";
import type { Placement, RuleInput, ScalingRule } from "@/types/scaling";

/** `node` scopes results to the node whose telemetry triggers scaling (same as the legacy console). */
export const scalingApi = {
  rules: (node: string | undefined, signal?: AbortSignal) =>
    apiRequest<ScalingRule[]>("scaling/rules", { query: { node }, signal }),
  createRule: (rule: RuleInput) => apiRequest<ScalingRule>("scaling/rules", { method: "POST", body: rule }),
  updateRule: (id: string, rule: Partial<RuleInput>) =>
    apiRequest<ScalingRule>(`scaling/rules/${encodeURIComponent(id)}`, { method: "PUT", body: rule }),
  deleteRule: (id: string) => apiRequest<void>(`scaling/rules/${encodeURIComponent(id)}`, { method: "DELETE" }),
  namespaces: (node: string | undefined, signal?: AbortSignal) =>
    apiRequest<string[]>("scaling/namespaces", { query: { node }, signal }),
  deployments: (namespace: string | undefined, node: string | undefined, signal?: AbortSignal) =>
    apiRequest<DeploymentInfo[]>("scaling/deployments", { query: { namespace, node }, signal }),
  latestMetrics: (node: string | undefined, signal?: AbortSignal) =>
    apiRequest<LatestMetric[]>("scaling/metrics/latest", { query: { node }, signal }),
  placement: (namespace: string, deployment: string, signal?: AbortSignal) =>
    apiRequest<Placement>("scaling/pods", { query: { namespace, deployment }, signal }),
};
