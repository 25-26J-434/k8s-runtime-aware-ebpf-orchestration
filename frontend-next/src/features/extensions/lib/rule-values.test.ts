import { describe, expect, it } from "vitest";
import type { UnifiedMetrics } from "@/types/metrics";
import { ruleValues } from "./rule-values";

const nodes: Record<string, UnifiedMetrics> = {
  a: {
    timestamp: "",
    node_name: "node-a",
    node: { dns_latency: { avg_latency_ns: 4_000_000 }, node_system: { cpu_usage_percent: 42, memory_usage_percent: 61 } as never },
    pods: {
      "default/web": { dns_latency: { total_events: 3, avg_latency_ns: 2_000_000 }, tcp_metrics: { packet_loss: 1, retransmissions: 4 } },
      "default/db": { dns_latency: { total_events: 1, avg_latency_ns: 9_000_000 } },
    },
  },
  b: { timestamp: "", node_name: "node-b", pods: { "default/web": { dns_latency: { total_events: 2, avg_latency_ns: 1_000_000 } } } },
};

describe("ruleValues", () => {
  it("reads node-level values and converts ns to µs", () => {
    const r = ruleValues({ metric_type: "dns_latency", level: "node" }, nodes);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ level: "Node", node: "node-a", value: 4000, unit: "µs" });
  });

  it("reports CPU and memory for node_system in percent", () => {
    const r = ruleValues({ metric_type: "node_system", level: "node" }, nodes);
    expect(r.map((x) => [x.source, x.value, x.unit])).toEqual([["CPU", 42, "%"], ["Memory", 61, "%"]]);
  });

  it("limits pod rules to the named node and pod", () => {
    const r = ruleValues({ metric_type: "dns_latency", level: "pod", node_name: "node-a", pod_name: "default/db" }, nodes);
    expect(r.map((x) => x.source)).toEqual(["default/db"]);
  });

  it("emits loss and retransmissions separately for tcp pods", () => {
    const r = ruleValues({ metric_type: "tcp_metrics", level: "pod" }, nodes);
    expect(r.map((x) => x.source)).toEqual(["default/web (loss)", "default/web (retrans)"]);
  });

  it("returns nothing for a node-only metric at pod level", () => {
    expect(ruleValues({ metric_type: "node_system", level: "pod" }, nodes)).toEqual([]);
  });
});
