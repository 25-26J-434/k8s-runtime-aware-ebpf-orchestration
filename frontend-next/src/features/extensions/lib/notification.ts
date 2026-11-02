import type { NotificationConfig, ThresholdRow, WebhookRow, WebhookType } from "@/types/extensions";

export const genId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export const WEBHOOK_LABEL: Record<WebhookType, string> = { teams: "Microsoft Teams", discord: "Discord", slack: "Slack" };

/** Metric choices for alert rules, as the daemon's notification extension accepts them. */
export const RULE_METRICS = [
  { value: "dns_latency", label: "DNS latency (avg µs)" },
  { value: "rtt", label: "RTT, round-trip time (avg µs)" },
  { value: "node_system", label: "Node CPU / memory %" },
  { value: "sched_latency", label: "Scheduling latency (µs)" },
  { value: "disk_io", label: "Disk I/O (bytes)" },
  { value: "tcp_metrics", label: "TCP packet loss / retransmissions" },
  { value: "service_health", label: "Service health" },
  { value: "nat_metadata", label: "NAT metadata" },
  { value: "packet_distribution", label: "Packet distribution" },
];

export const RULE_LEVELS = [
  { value: "node", label: "Node (entire host)" },
  { value: "pod", label: "Pod (per workload)" },
  { value: "container", label: "Container" },
];

export const metricLabel = (v: string) => RULE_METRICS.find((m) => m.value === v)?.label ?? v;

export const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export const DEFAULT_NOTIFICATION: NotificationConfig = {
  enabled: true,
  interval_seconds: 15,
  webhooks: [],
  thresholds: [],
  email_enabled: false,
  smtp_host: "",
  smtp_port: 587,
  smtp_use_tls: true,
  smtp_username: "",
  smtp_password: "",
  email_from: "",
  email_to: "",
};

/**
 * Normalises whatever the daemon stored. Older configs kept a single flat webhook/threshold;
 * those are lifted into the webhooks[] / thresholds[] arrays with ids, as the legacy console did.
 */
export function normalizeNotification(raw: Record<string, unknown>): NotificationConfig {
  const str = (v: unknown) => (v == null ? "" : String(v));

  let webhooks: WebhookRow[];
  if (Array.isArray(raw.webhooks)) {
    webhooks = (raw.webhooks as Partial<WebhookRow>[]).map((w) => ({ id: w.id || genId(), type: (w.type ?? "discord") as WebhookType, url: str(w.url), enabled: w.enabled !== false }));
  } else {
    const type = str(raw.webhook_type || "discord").toLowerCase() as WebhookType;
    const url = (type === "teams" ? str(raw.webhook_url_teams) : type === "slack" ? str(raw.webhook_url_slack) : str(raw.webhook_url)).trim();
    webhooks = url ? [{ id: genId(), type, url, enabled: true }] : [];
  }

  let thresholds: ThresholdRow[];
  if (Array.isArray(raw.thresholds)) {
    thresholds = (raw.thresholds as Partial<ThresholdRow>[]).map((t) => ({
      id: t.id || genId(),
      metric_type: str(t.metric_type || "dns_latency"),
      level: str(t.level || "pod"),
      threshold_value: Number(t.threshold_value) || 0,
      node_name: str(t.node_name),
      pod_name: str(t.pod_name),
    }));
  } else if (raw.metric_type != null || raw.threshold_value != null) {
    thresholds = [{ id: genId(), metric_type: str(raw.metric_type || "dns_latency"), level: str(raw.level || "pod"), threshold_value: Number(raw.threshold_value) || 100, node_name: str(raw.node_name), pod_name: str(raw.pod_name) }];
  } else {
    thresholds = [];
  }

  return {
    enabled: raw.enabled !== false,
    interval_seconds: Number(raw.interval_seconds) || 15,
    webhooks,
    thresholds,
    email_enabled: raw.email_enabled === true,
    smtp_host: str(raw.smtp_host).trim(),
    smtp_port: Number(raw.smtp_port) || 587,
    smtp_use_tls: raw.smtp_use_tls !== false,
    smtp_username: str(raw.smtp_username).trim(),
    smtp_password: str(raw.smtp_password),
    email_from: str(raw.email_from).trim(),
    email_to: str(raw.email_to).trim(),
  };
}

export const emailList = (to: string) => to.split(/[,;]/).map((s) => s.trim()).filter(Boolean);

/** Why a "run check now" cannot work yet, or null when it can. */
export function checkBlocker(c: NotificationConfig): string | null {
  const channel = c.webhooks.some((w) => w.enabled && w.url) || c.email_enabled;
  if (!channel) return "Add at least one enabled alert channel (webhook or email) before running a check.";
  if (!c.thresholds.some((t) => t.threshold_value > 0)) return "Add at least one alert rule with a threshold above 0 before running a check.";
  return null;
}
