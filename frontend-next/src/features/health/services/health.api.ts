import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  ClusterHealth,
  HealthAlert,
  HealthAlertHistory,
  MetricsConfig,
  PodActionResult,
} from "@/types/health";
import type { OutgoingMessage } from "@/types/federation";

export const healthApi = {
  cluster: (signal?: AbortSignal) => apiRequest<ClusterHealth>(endpoints.nodeHealth, { signal }),
  alertHistory: (signal?: AbortSignal) =>
    apiRequest<HealthAlertHistory>(endpoints.healthAlerts, { signal }),
  getConfig: (signal?: AbortSignal) => apiRequest<MetricsConfig>(endpoints.metricsConfig, { signal }),
  saveConfig: (config: MetricsConfig) =>
    apiRequest<void>(endpoints.metricsConfig, { method: "POST", body: config }),
  restartPod: (namespace: string, podName: string) =>
    apiRequest<PodActionResult>(endpoints.podAction, {
      method: "POST",
      body: { action: "restart", namespace, pod_name: podName },
    }),
  /** Relays a health alert to the federation (same payload the legacy console sent). */
  relayAlert: (alert: HealthAlert) => {
    const priority =
      alert.severity === "critical" ? "HIGH" : alert.severity === "warning" ? "MEDIUM" : "LOW";
    const body: OutgoingMessage = {
      event: "HEALTH_ALERT",
      payload: {
        message: alert.message,
        priority,
        severity: alert.severity,
        source: alert.source,
        node: alert.node_name,
        ...(alert.pod_name && { pod: alert.pod_name }),
        ...(alert.namespace && { namespace: alert.namespace }),
      },
      action: "NONE",
    };
    return apiRequest<void>(endpoints.commBroadcast, { method: "POST", body });
  },
};
