import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, recommend, sanitizeThresholds } from "./recommendations";

describe("recommend", () => {
  it("ignores healthy pods", () => {
    expect(recommend({ "default/a": { dns_latency: { avg_latency_ns: 1_000_000 } } }, DEFAULT_THRESHOLDS)).toEqual([]);
  });

  it("converts DNS latency from ns and ranks the worst pod first", () => {
    const r = recommend(
      {
        "default/slow": { dns_latency: { avg_latency_ns: 3_000_000 } },
        "prod/dead": { dns_latency: { avg_latency_ns: 11_000_000 } },
      },
      DEFAULT_THRESHOLDS,
      "n1",
    );
    expect(r.map((x) => x.pod)).toEqual(["dead", "slow"]);
    expect(r[0]).toMatchObject({ namespace: "prod", severity: "high", action: "Restart pod", node: "n1" });
  });

  it("takes the action from the most severe finding", () => {
    const [r] = recommend(
      { "default/a": { dns_latency: { avg_latency_ns: 3_000_000 }, tcp_metrics: { packet_loss: 9 } } },
      DEFAULT_THRESHOLDS,
    );
    expect(r?.severity).toBe("high");
    expect(r?.action).toBe("Urgent: migrate pod");
    expect(r?.issues).toHaveLength(2);
  });

  it("treats any packet loss above 0 as a minor issue by default", () => {
    const [r] = recommend({ "default/a": { tcp_metrics: { packet_loss: 1 } } }, DEFAULT_THRESHOLDS);
    expect(r?.severity).toBe("medium");
  });
});

describe("sanitizeThresholds", () => {
  it("falls back to defaults for junk and keeps valid numbers", () => {
    expect(sanitizeThresholds(null)).toEqual(DEFAULT_THRESHOLDS);
    const s = sanitizeThresholds({ dns_latency_high: 123, dns_latency_medium: "x", tcp_retrans_high: -1 });
    expect(s.dns_latency_high).toBe(123);
    expect(s.dns_latency_medium).toBe(DEFAULT_THRESHOLDS.dns_latency_medium);
    expect(s.tcp_retrans_high).toBe(DEFAULT_THRESHOLDS.tcp_retrans_high);
  });
});
