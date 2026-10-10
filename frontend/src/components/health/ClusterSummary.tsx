import { useMemo } from "react";
import type { ClusterHealthResponse, Freshness, NodeHealthUpdate } from "../../types/health";
import { scoreTone } from "./podStatus";

interface Props {
  data: ClusterHealthResponse | undefined;
  selectedNode: string;
  onSelectNode: (node: string) => void;
  now: number;
}

const FRESHNESS_LABEL: Record<Freshness, string> = { live: "Live", stale: "Delayed", offline: "Offline" };

function nodeFreshness(n: NodeHealthUpdate): Freshness {
  return n.freshness ?? "live";
}

function formatAge(seconds: number | undefined) {
  if (seconds === undefined || seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

export function ClusterSummary({ data, selectedNode, onSelectNode }: Props) {
  const totals = useMemo(() => {
    const nodes = Object.values(data?.nodes ?? {});
    const pods = nodes.reduce(
      (a, n) => ({
        total: a.total + n.total_pods,
        healthy: a.healthy + n.healthy_pods,
        unhealthy: a.unhealthy + n.unhealthy_pods,
        unknown: a.unknown + n.unknown_pods,
      }),
      { total: 0, healthy: 0, unhealthy: 0, unknown: 0 },
    );
    const alerts = data?.alerts ?? [];
    return {
      nodeCount: nodes.length,
      pods,
      critical: data?.summary?.critical_alerts ?? alerts.filter((a) => a.severity === "critical").length,
      warning: data?.summary?.warning_alerts ?? alerts.filter((a) => a.severity === "warning").length,
      offline: data?.summary?.nodes_offline ?? nodes.filter((n) => nodeFreshness(n) === "offline").length,
    };
  }, [data]);

  const nodeEntries = useMemo(() => Object.entries(data?.nodes ?? {}).sort(([a], [b]) => a.localeCompare(b)), [data]);
  const podPct = totals.pods.total ? Math.round((totals.pods.healthy / totals.pods.total) * 100) : 0;

  return (
    <>
      <div className="hm-stats">
        <div className="hm-card hm-stat">
          <span className="hm-stat-label">Pods healthy</span>
          <span className="hm-stat-value">
            {totals.pods.healthy}
            <small> / {totals.pods.total}</small>
          </span>
          <div className="hm-bar" aria-hidden="true">
            <span className="is-ok" style={{ width: `${totals.pods.total ? (totals.pods.healthy / totals.pods.total) * 100 : 0}%` }} />
            <span className="is-crit" style={{ width: `${totals.pods.total ? (totals.pods.unhealthy / totals.pods.total) * 100 : 0}%` }} />
            <span className="is-warn" style={{ width: `${totals.pods.total ? (totals.pods.unknown / totals.pods.total) * 100 : 0}%` }} />
          </div>
          <span className="hm-stat-hint">
            {totals.pods.total ? `${podPct}% running well` : "No pods reported yet"}
            {totals.pods.unhealthy > 0 && ` · ${totals.pods.unhealthy} need attention`}
          </span>
        </div>

        <div className="hm-card hm-stat">
          <span className="hm-stat-label">Nodes</span>
          <span className="hm-stat-value">{totals.nodeCount}</span>
          <span className="hm-stat-hint">
            {totals.offline > 0 ? `${totals.offline} offline` : totals.nodeCount ? "All reporting" : "Waiting for nodes"}
          </span>
        </div>

        <div className="hm-card hm-stat">
          <span className="hm-stat-label">Active alerts</span>
          <span className={`hm-stat-value ${totals.critical ? "is-crit" : totals.warning ? "is-warn" : "is-ok"}`}>
            {totals.critical + totals.warning}
          </span>
          <span className="hm-stat-hint">
            {totals.critical} critical · {totals.warning} warning
          </span>
        </div>
      </div>

      {nodeEntries.length > 0 && (
        <div className="hm-nodes" role="group" aria-label="Filter by node">
          <button type="button" className={`hm-node ${selectedNode === "all" ? "is-selected" : ""}`} onClick={() => onSelectNode("all")}>
            <span className="hm-node-name">All nodes</span>
            <span className="hm-node-meta">{totals.pods.total} pods</span>
          </button>
          {nodeEntries.map(([key, n]) => {
            const f = nodeFreshness(n);
            const tone = f === "offline" ? "crit" : f === "stale" ? "warn" : scoreTone(n.health_score);
            return (
              <button
                key={key}
                type="button"
                className={`hm-node ${selectedNode === key ? "is-selected" : ""}`}
                onClick={() => onSelectNode(key)}
                title={n.health_reasons?.join(", ") || undefined}
              >
                <span className="hm-node-name">
                  <span className={`hm-dot is-${tone}`} aria-hidden="true" />
                  {key}
                </span>
                <span className="hm-node-meta">
                  {n.healthy_pods}/{n.total_pods} pods healthy
                  {n.health_score !== undefined && ` · score ${n.health_score}`}
                </span>
                <span className={`hm-node-fresh is-${f}`}>
                  {FRESHNESS_LABEL[f]} · {formatAge(n.age_seconds)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
