import { describe, expect, it } from "vitest";
import { buildCreateBody, buildUpdateBody, DEFAULT_FORM, interpretProbe, parseWhoami, policyState, resolveFrontend, resolveTarget, toFormValues, type PolicyFormValues } from "./policy";
import type { ClusterSummary, PolicyRecord } from "@/types/routing";

const form = (over: Partial<PolicyFormValues> = {}): PolicyFormValues => ({
  ...DEFAULT_FORM,
  policy_name: "dns-guard",
  namespace: "default",
  frontend_service: "checkout-api",
  frontend_port: "5000",
  telemetry_violation_threshold: "5000000",
  telemetry_monitor: "checkout-api",
  action_backend_selector: "app=checkout-api-b",
  action_backend_port: "5001",
  ...over,
});

describe("buildCreateBody (POST /api/policies)", () => {
  it("nests frontend/telemetry/action and coerces numbers, as the legacy console did", () => {
    expect(buildCreateBody(form())).toEqual({
      policy_name: "dns-guard",
      namespace: "default",
      scope: "local",
      frontend: { service: "checkout-api", port: 5000 },
      telemetry: { metric: "dns_latency", violation_threshold: 5000000, monitor_pod_contains: "checkout-api" },
      action: {
        type: "redirect",
        backend_selector: "app=checkout-api-b",
        backend_port: 5001,
        protocol: "TCP",
        ttl_seconds: 300,
        strategy: "best_pod",
        backend_candidates_selector: "",
        winner_label: "redirect-winner=yes",
      },
    });
  });

  it("always sends the fixed winner label, whatever the form holds", () => {
    expect(buildCreateBody(form({ action_winner_label: "x=y" })).action.winner_label).toBe("redirect-winner=yes");
  });

  it("keeps a non-numeric value as the string it was", () => {
    expect(buildCreateBody(form({ frontend_port: "http" })).frontend.port).toBe("http");
  });
});

describe("buildUpdateBody (PUT /api/policies/{name})", () => {
  it("omits empty fields so untouched values are not overwritten", () => {
    const body = buildUpdateBody({ ...DEFAULT_FORM, namespace: "default", action_ttl_seconds: "", action_strategy: "", action_protocol: "", action_type: "", telemetry_metric: "" });
    expect(body).toEqual({ namespace: "default", scope: "local" });
  });

  it("includes only the sections that have values", () => {
    const body = buildUpdateBody({ ...DEFAULT_FORM, telemetry_violation_threshold: "42", action_ttl_seconds: "", action_strategy: "", action_protocol: "", action_type: "", telemetry_metric: "" });
    expect(body).toEqual({ scope: "local", telemetry: { violation_threshold: 42 } });
  });

  it("carries the existing winner label forward and includes target_namespace", () => {
    const existing: PolicyRecord = { policy_name: "p", action: { winner_label: "mine=1" } };
    const body = buildUpdateBody(form({ action_target_namespace: "other" }), existing) as { action: Record<string, unknown> };
    expect(body.action.winner_label).toBe("mine=1");
    expect(body.action.target_namespace).toBe("other");
    expect(body.action.backend_port).toBe(5001);
  });

  it("falls back to the default winner label", () => {
    const body = buildUpdateBody(form(), { policy_name: "p" }) as { action: Record<string, unknown> };
    expect(body.action.winner_label).toBe("redirect-winner=yes");
  });
});

describe("toFormValues", () => {
  it("reads the nested shape", () => {
    const p: PolicyRecord = {
      policy_name: "n",
      namespace: "ns",
      scope: "cluster",
      frontend: { service: "web", port: 8080 },
      telemetry: { metric: "disk_io", violation_threshold: 90 },
      action: { type: "redirect", backend_selector: "app=b", backend_port: 9000, protocol: "UDP", ttl_seconds: 120, strategy: "all" },
    };
    expect(toFormValues(p)).toMatchObject({ frontend_service: "web", frontend_port: "8080", telemetry_metric: "disk_io", telemetry_violation_threshold: "90", action_backend_selector: "app=b", action_backend_port: "9000", action_protocol: "UDP", action_ttl_seconds: "120", action_strategy: "all", scope: "cluster" });
  });

  it("reads the flat shape", () => {
    const p: PolicyRecord = { policy_name: "n", namespace: "ns", frontend_service: "web", frontend_service_port: 80, metric: "dns_latency", violation_threshold: 5, redirect_backend_label: "app=b", redirect_backend_port: 81, redirect_backend_protocol: "TCP", ttl_seconds: 60, action: "redirect" };
    expect(toFormValues(p)).toMatchObject({ frontend_service: "web", frontend_port: "80", telemetry_metric: "dns_latency", action_backend_selector: "app=b", action_backend_port: "81", action_ttl_seconds: "60", action_type: "redirect" });
  });
});

describe("resolvers", () => {
  it("defaults the frontend port to 5000 and namespace to default", () => {
    expect(resolveFrontend({ frontend_service: "web" })).toEqual({ service: "web", port: 5000, namespace: "default" });
  });
  it("finds the redirect target in either shape", () => {
    expect(resolveTarget({ redirect_backend_label: "app=a" })).toBe("app=a");
    expect(resolveTarget({ action: { backend_selector: "app=b" } })).toBe("app=b");
    expect(resolveTarget({})).toBe("—");
  });
});

describe("policyState", () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  it("is active when applied after (or without) expiry", () => {
    expect(policyState({ status: { last_applied_at: ago(1000), last_expired_at: ago(5000) } })).toBe("active");
    expect(policyState({ status: { last_applied_at: ago(1000) } })).toBe("active");
  });
  it("is expired when the last expiry is newer, or the decision says so", () => {
    expect(policyState({ status: { last_applied_at: ago(5000), last_expired_at: ago(1000) } })).toBe("expired");
    expect(policyState({ status: { last_decision: "EXPIRED" } })).toBe("expired");
  });
  it("is unknown with no history", () => {
    expect(policyState({})).toBe("unknown");
  });
});

describe("probe", () => {
  it("parses the /whoami greeting", () => {
    expect(parseWhoami("Hi, I am checkout-api-b (pod=checkout-api-7d9f-x2k4p)\n")).toEqual({ service: "checkout-api-b", pod: "checkout-api-7d9f-x2k4p" });
    expect(parseWhoami("garbage")).toEqual({ service: "unknown", pod: "" });
  });

  it("reports whether the winner label is on the answering pod", () => {
    const summary: ClusterSummary = { pods: [{ name: "p1", namespace: "default", node: "n1", labels: { "redirect-winner": "yes" } }, { name: "p2", namespace: "default", node: "n2", labels: {} }] };
    const policy: PolicyRecord = { namespace: "default", frontend_service: "web" };
    expect(interpretProbe("Hi, I am web (pod=p1)", policy, summary)).toMatchObject({ pod: "p1", node: "n1", winnerLabelPresent: true });
    expect(interpretProbe("Hi, I am web (pod=p2)", policy, summary)).toMatchObject({ pod: "p2", node: "n2", winnerLabelPresent: false });
    expect(interpretProbe("Hi, I am web (pod=p1)", policy, null).winnerLabelPresent).toBe(false);
  });
});
