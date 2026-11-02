import type { ClusterSummary, PolicyAction, PolicyRecord, ProbeResult } from "@/types/routing";

/**
 * Pure helpers over policy records. They mirror the legacy console's resolvers and payload
 * builders so the request bodies sent to the routing service are unchanged.
 */

export const METRIC_OPTIONS = ["dns_latency", "disk_io"] as const;
export const DEFAULT_WINNER_LABEL = "redirect-winner=yes";

const actionOf = (p: PolicyRecord): PolicyAction => (typeof p.action === "object" && p.action !== null ? p.action : {});

export const resolveFrontend = (p: PolicyRecord) => ({
  service: p.frontend?.service || p.frontend_service || "",
  port: p.frontend?.port || p.frontend_service_port || (p.frontend_port as string | number | undefined) || 5000,
  namespace: p.namespace || "default",
});

export const resolveMetric = (p: PolicyRecord) => p.telemetry?.metric || p.metric || "—";
export const resolveThreshold = (p: PolicyRecord) => p.telemetry?.violation_threshold || p.violation_threshold || "—";
export const resolveTtl = (p: PolicyRecord) => actionOf(p).ttl_seconds || p.ttl_seconds || "—";
export const resolveProtocol = (p: PolicyRecord) => actionOf(p).protocol || p.redirect_backend_protocol || "—";
export const resolveWinnerLabel = (p: PolicyRecord) => actionOf(p).winner_label || p.winner_label || DEFAULT_WINNER_LABEL;

export const resolveTarget = (p: PolicyRecord) =>
  p.redirect_backend_label || actionOf(p).backend_selector || p.backend_selector || actionOf(p).backend_candidates_selector || p.backend_candidates_selector || "—";

export type PolicyState = "active" | "expired" | "unknown";

/** Whether the policy's redirect is currently in effect, from its last applied/expired timestamps. */
export function policyState(p: PolicyRecord): PolicyState {
  const s = (p.status ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => keys.map((k) => s[k] ?? p[k]).find(Boolean) as string | undefined;
  const lastDecision = pick("last_decision", "lastDecision");
  const lastExpired = pick("last_expired_at", "lastExpiredAt");
  const lastApplied = pick("last_applied_at", "lastAppliedAt");
  const applied = lastApplied ? new Date(lastApplied).getTime() : 0;
  const expired = lastExpired ? new Date(lastExpired).getTime() : 0;
  if (applied > 0 && applied >= expired) return "active";
  if (String(lastDecision ?? "").toUpperCase() === "EXPIRED" || lastExpired) return "expired";
  if (String(lastDecision ?? "").toUpperCase() === "APPLIED" || lastApplied) return "active";
  return "unknown";
}

/* ---- form <-> payload ---- */

export interface PolicyFormValues {
  policy_name: string;
  namespace: string;
  scope: string;
  action_target_namespace: string;
  frontend_service: string;
  frontend_port: string;
  telemetry_metric: string;
  telemetry_violation_threshold: string;
  telemetry_monitor: string;
  action_type: string;
  action_backend_selector: string;
  action_backend_port: string;
  action_protocol: string;
  action_ttl_seconds: string;
  action_strategy: string;
  action_backend_candidates_selector: string;
  action_winner_label: string;
}

export const DEFAULT_FORM: PolicyFormValues = {
  policy_name: "",
  namespace: "",
  scope: "local",
  action_target_namespace: "",
  frontend_service: "",
  frontend_port: "",
  telemetry_metric: METRIC_OPTIONS[0],
  telemetry_violation_threshold: "",
  telemetry_monitor: "",
  action_type: "redirect",
  action_backend_selector: "",
  action_backend_port: "",
  action_protocol: "TCP",
  action_ttl_seconds: "300",
  action_strategy: "best_pod",
  action_backend_candidates_selector: "",
  action_winner_label: DEFAULT_WINNER_LABEL,
};

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export function toFormValues(p: PolicyRecord): PolicyFormValues {
  const a = actionOf(p);
  return {
    policy_name: str(p.policy_name),
    namespace: str(p.namespace),
    scope: str(p.scope) || "local",
    action_target_namespace: str(p.action_target_namespace || p.namespace),
    frontend_service: str(p.frontend?.service || p.frontend_service),
    frontend_port: str(p.frontend?.port || p.frontend_service_port),
    telemetry_metric: str(p.telemetry?.metric || p.metric),
    telemetry_violation_threshold: str(p.telemetry?.violation_threshold || p.violation_threshold),
    telemetry_monitor: str(p.frontend?.service || p.frontend_service || p.telemetry?.monitor_pod_contains || p.monitor_pod_contains),
    action_type: str(a.type || (typeof p.action === "string" ? p.action : "") || "redirect"),
    action_backend_selector: str(a.backend_selector || p.redirect_backend_label),
    action_backend_port: str(a.backend_port || p.redirect_backend_port),
    action_protocol: str(a.protocol || p.redirect_backend_protocol || "TCP"),
    action_ttl_seconds: str(a.ttl_seconds || p.ttl_seconds),
    action_strategy: str(a.strategy || p.strategy),
    action_backend_candidates_selector: str(a.backend_candidates_selector || p.backend_candidates_selector),
    action_winner_label: str(a.winner_label || p.winner_label),
  };
}

const numOrString = (v: unknown): number | string | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : (v as string);
};

const put = (obj: Record<string, unknown>, key: string, value: unknown) => {
  if (value === null || value === undefined || value === "") return;
  obj[key] = value;
};

/** Body for POST /api/policies. */
export function buildCreateBody(v: PolicyFormValues) {
  return {
    policy_name: v.policy_name,
    namespace: v.namespace,
    scope: v.scope || "local",
    frontend: { service: v.frontend_service, port: numOrString(v.frontend_port) },
    telemetry: {
      metric: v.telemetry_metric,
      violation_threshold: numOrString(v.telemetry_violation_threshold),
      monitor_pod_contains: v.telemetry_monitor,
    },
    action: {
      type: v.action_type || "redirect",
      backend_selector: v.action_backend_selector,
      backend_port: numOrString(v.action_backend_port),
      protocol: v.action_protocol || "TCP",
      ttl_seconds: numOrString(v.action_ttl_seconds),
      strategy: v.action_strategy || "",
      backend_candidates_selector: v.action_backend_candidates_selector || "",
      winner_label: DEFAULT_WINNER_LABEL,
    },
  };
}

/** Body for PUT /api/policies/{name}: only fields with a value, so untouched fields are not overwritten. */
export function buildUpdateBody(v: PolicyFormValues, existing?: PolicyRecord) {
  const body: Record<string, unknown> = {};
  put(body, "namespace", v.namespace);
  put(body, "scope", v.scope);

  const frontend: Record<string, unknown> = {};
  put(frontend, "service", v.frontend_service);
  put(frontend, "port", numOrString(v.frontend_port));
  if (Object.keys(frontend).length) body.frontend = frontend;

  const telemetry: Record<string, unknown> = {};
  put(telemetry, "metric", v.telemetry_metric);
  put(telemetry, "violation_threshold", numOrString(v.telemetry_violation_threshold));
  put(telemetry, "monitor_pod_contains", v.telemetry_monitor);
  if (Object.keys(telemetry).length) body.telemetry = telemetry;

  const action: Record<string, unknown> = {};
  put(action, "type", v.action_type);
  put(action, "backend_selector", v.action_backend_selector);
  put(action, "target_namespace", v.action_target_namespace);
  put(action, "backend_port", numOrString(v.action_backend_port));
  put(action, "protocol", v.action_protocol);
  put(action, "ttl_seconds", numOrString(v.action_ttl_seconds));
  put(action, "strategy", v.action_strategy);
  put(action, "backend_candidates_selector", v.action_backend_candidates_selector);
  if (Object.keys(action).length) {
    action.winner_label = (typeof existing?.action === "object" && existing.action?.winner_label) || DEFAULT_WINNER_LABEL;
    body.action = action;
  }
  return body;
}

/* ---- probe ---- */

export function parseWhoami(text: string): { service: string; pod: string } {
  const m = text.match(/Hi,\s*I am\s*([^\n(]+)\s*\(([^)]+)\)/i);
  if (!m) return { service: "unknown", pod: "" };
  const pod = (m[2] ?? "").trim();
  return { service: (m[1] ?? "").trim(), pod: pod.startsWith("pod=") ? pod.slice(4) : pod };
}

export function parseWinnerLabel(label: string) {
  const i = label.indexOf("=");
  return i === -1 ? { key: label, value: "" } : { key: label.slice(0, i), value: label.slice(i + 1) };
}

/** Interprets a /whoami response against cluster pods to tell whether the redirect winner label is on the answering pod. */
export function interpretProbe(raw: string, policy: PolicyRecord, summary: ClusterSummary | null): ProbeResult {
  const { namespace } = resolveFrontend(policy);
  const parsed = parseWhoami(raw);
  const pods = summary?.pods ?? [];
  const pod = pods.find((p) => p.name === parsed.pod && p.namespace === namespace) ?? pods.find((p) => p.name === parsed.pod);
  const labels = pod?.labels ?? {};
  const winnerLabel = resolveWinnerLabel(policy);
  const { key, value } = parseWinnerLabel(winnerLabel);
  const present = key && value ? labels[key] === value : key ? Object.prototype.hasOwnProperty.call(labels, key) : false;
  return { raw, service: parsed.service, pod: parsed.pod, node: pod?.node ?? "", podLabels: labels, winnerLabel, winnerLabelPresent: present };
}

/* ---- cluster-summary lookups used by the form ---- */

export const selectorOf = (svc: { selector?: Record<string, string> }) => {
  const first = Object.entries(svc.selector ?? {})[0];
  return first ? `${first[0]}=${first[1]}` : "";
};

export const servicesIn = (s: ClusterSummary | null | undefined, ns: string) => (s?.services ?? []).filter((x) => x.namespace === ns);

export function namespacesOf(s: ClusterSummary | null | undefined): string[] {
  const set = new Set<string>(s?.namespaces ?? []);
  (s?.services ?? []).forEach((x) => set.add(x.namespace));
  (s?.pods ?? []).forEach((x) => set.add(x.namespace));
  return [...set].filter(Boolean).sort();
}

export function backendPortFor(s: ClusterSummary | null | undefined, ns: string, selector: string): string {
  if (!selector) return "";
  const svc = servicesIn(s, ns).find((x) => selectorOf(x) === selector);
  const svcPort = svc?.ports?.[0]?.port;
  if (svcPort) return String(svcPort);
  const pod = (s?.pods ?? []).find((p) => p.namespace === ns && p.labels?.app && `app=${p.labels.app}` === selector);
  const podPort = pod?.containers?.[0]?.ports?.[0]?.containerPort;
  return podPort ? String(podPort) : "";
}
