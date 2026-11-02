import { describe, expect, it } from "vitest";
import { checkBlocker, DEFAULT_NOTIFICATION, emailList, isValidEmail, normalizeNotification } from "./notification";

describe("normalizeNotification", () => {
  it("lifts a legacy flat webhook and threshold into arrays with ids", () => {
    const c = normalizeNotification({ webhook_type: "teams", webhook_url_teams: " https://t.example/hook ", metric_type: "rtt", level: "node", threshold_value: 7 });
    expect(c.webhooks).toHaveLength(1);
    expect(c.webhooks[0]).toMatchObject({ type: "teams", url: "https://t.example/hook", enabled: true });
    expect(c.webhooks[0]?.id).toBeTruthy();
    expect(c.thresholds[0]).toMatchObject({ metric_type: "rtt", level: "node", threshold_value: 7 });
  });

  it("keeps array configs, filling ids and defaults", () => {
    const c = normalizeNotification({ webhooks: [{ type: "slack", url: "https://s.example" }], thresholds: [{ metric_type: "dns_latency", threshold_value: "5" }], smtp_port: "2525" });
    expect(c.webhooks[0]).toMatchObject({ type: "slack", enabled: true });
    expect(c.thresholds[0]).toMatchObject({ metric_type: "dns_latency", level: "pod", threshold_value: 5 });
    expect(c.smtp_port).toBe(2525);
  });

  it("applies the daemon defaults to an empty config", () => {
    const c = normalizeNotification({});
    expect(c).toMatchObject({ enabled: true, interval_seconds: 15, smtp_port: 587, smtp_use_tls: true, email_enabled: false, webhooks: [], thresholds: [] });
  });

  it("honours explicit false for enabled and TLS", () => {
    expect(normalizeNotification({ enabled: false, smtp_use_tls: false })).toMatchObject({ enabled: false, smtp_use_tls: false });
  });
});

describe("checkBlocker", () => {
  const rule = { id: "1", metric_type: "rtt", level: "node", threshold_value: 5 };
  const hook = { id: "h", type: "slack" as const, url: "https://s.example", enabled: true };

  it("needs an enabled channel", () => {
    expect(checkBlocker({ ...DEFAULT_NOTIFICATION, thresholds: [rule] })).toMatch(/channel/);
    expect(checkBlocker({ ...DEFAULT_NOTIFICATION, thresholds: [rule], webhooks: [{ ...hook, enabled: false }] })).toMatch(/channel/);
  });
  it("needs a rule above zero", () => {
    expect(checkBlocker({ ...DEFAULT_NOTIFICATION, webhooks: [hook] })).toMatch(/rule/);
    expect(checkBlocker({ ...DEFAULT_NOTIFICATION, webhooks: [hook], thresholds: [{ ...rule, threshold_value: 0 }] })).toMatch(/rule/);
  });
  it("passes with a channel and a rule, including email-only", () => {
    expect(checkBlocker({ ...DEFAULT_NOTIFICATION, webhooks: [hook], thresholds: [rule] })).toBeNull();
    expect(checkBlocker({ ...DEFAULT_NOTIFICATION, email_enabled: true, thresholds: [rule] })).toBeNull();
  });
});

describe("email helpers", () => {
  it("splits recipients on commas and semicolons", () => {
    expect(emailList("a@x.io, b@x.io;c@x.io ,")).toEqual(["a@x.io", "b@x.io", "c@x.io"]);
  });
  it("validates addresses", () => {
    expect(isValidEmail("a@x.io")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
});
