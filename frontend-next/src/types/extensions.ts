export interface ExtensionInput {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  default?: unknown;
  options?: { value: string; label: string }[];
}

export interface ExtensionInfo {
  name: string;
  label?: string;
  description?: string;
  inputs?: ExtensionInput[];
  summary_keys?: string[];
}

export type WebhookType = "teams" | "discord" | "slack";

export interface WebhookRow {
  id: string;
  type: WebhookType;
  url: string;
  enabled: boolean;
}

export type RuleLevel = "node" | "pod" | "container";

export interface ThresholdRow {
  id: string;
  metric_type: string;
  level: RuleLevel | string;
  threshold_value: number;
  node_name?: string;
  pod_name?: string;
}

/** The notification extension's stored configuration, as the daemon reads it. */
export interface NotificationConfig {
  enabled: boolean;
  interval_seconds: number;
  webhooks: WebhookRow[];
  thresholds: ThresholdRow[];
  email_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_use_tls: boolean;
  smtp_username: string;
  smtp_password: string;
  email_from: string;
  email_to: string;
}
