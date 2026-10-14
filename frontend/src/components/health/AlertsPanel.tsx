import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAlertHistory, healthKeys } from "../../hooks/useClusterHealth";
import { timeAgo } from "../../utils/time";
import type { HealthAlert } from "../../types/health";

interface Props {
  active: HealthAlert[];
  loading: boolean;
  now: number;
}

function AlertRow({ alert, now }: { alert: HealthAlert; now: number }) {
  const resolved = alert.state === "resolved";
  const where = [alert.pod_name && `${alert.namespace ?? ""}/${alert.pod_name}`.replace(/^\//, ""), alert.node_name]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={`hm-alert is-${resolved ? "resolved" : alert.severity}`}>
      <div className="hm-alert-head">
        <span className={`hm-badge is-${resolved ? "ok" : alert.severity === "critical" ? "crit" : alert.severity === "warning" ? "warn" : "idle"}`}>
          {resolved ? "Resolved" : alert.severity}
        </span>
        <span className="hm-alert-time">{timeAgo(resolved ? alert.resolved_at : alert.timestamp, now)}</span>
      </div>
      <div className="hm-alert-msg">{alert.message}</div>
      {where && <div className="hm-alert-where">{where}</div>}
    </li>
  );
}

export function AlertsPanel({ active, loading, now }: Props) {
  const [tab, setTab] = useState<"active" | "history">("active");

  const history = useQuery({
    queryKey: healthKeys.alertHistory,
    queryFn: fetchAlertHistory,
    enabled: tab === "history",
    refetchInterval: tab === "history" ? 15000 : false,
  });

  return (
    <aside className="hm-card hm-alerts" aria-label="Alerts">
      <div className="hm-alerts-head">
        <div className="hm-segmented" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "active"} aria-pressed={tab === "active"} onClick={() => setTab("active")}>
            Active{active.length > 0 && ` (${active.length})`}
          </button>
          <button type="button" role="tab" aria-selected={tab === "history"} aria-pressed={tab === "history"} onClick={() => setTab("history")}>
            History
          </button>
        </div>
      </div>

      {tab === "active" ? (
        loading ? (
          <div className="hm-skeleton-list" aria-busy="true">
            <div className="hm-skeleton" />
            <div className="hm-skeleton" />
          </div>
        ) : active.length === 0 ? (
          <div className="hm-empty">
            <strong>All clear</strong>No active alerts right now.
          </div>
        ) : (
          <ul className="hm-alert-list">
            {active.map((a) => (
              <AlertRow key={a.id ?? `${a.message}|${a.timestamp}`} alert={a} now={now} />
            ))}
          </ul>
        )
      ) : history.isLoading ? (
        <div className="hm-skeleton-list" aria-busy="true">
          <div className="hm-skeleton" />
          <div className="hm-skeleton" />
        </div>
      ) : history.isError ? (
        <div className="hm-empty">
          <strong>Could not load history</strong>
          <button type="button" className="hm-btn" onClick={() => history.refetch()}>
            Try again
          </button>
        </div>
      ) : (history.data?.history.length ?? 0) === 0 ? (
        <div className="hm-empty">
          <strong>Nothing yet</strong>Alerts that fire or resolve will be listed here.
        </div>
      ) : (
        <ul className="hm-alert-list">
          {history.data!.history.slice(0, 60).map((a, i) => (
            <AlertRow key={`${a.id}|${a.state}|${a.timestamp}|${i}`} alert={a} now={now} />
          ))}
        </ul>
      )}
    </aside>
  );
}
