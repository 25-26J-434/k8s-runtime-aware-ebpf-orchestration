import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FiRefreshCw, FiSliders } from "react-icons/fi";
import { useClusterHealth } from "../hooks/useClusterHealth";
import { usePodRestart, type RestartTarget } from "../hooks/usePodRestart";
import { ClusterSummary } from "../components/health/ClusterSummary";
import { PodList, type PodEntry } from "../components/health/PodList";
import { AlertsPanel } from "../components/health/AlertsPanel";
import { ThresholdsDialog } from "../components/health/ThresholdsDialog";
import { timeAgo, useNow } from "../utils/time";
import "./Page.css";
import "./HealthMonitoring.css";

const STREAM_LABEL = { live: "Live", connecting: "Connecting…", offline: "Reconnecting…" } as const;

// Scoped to this page so no shared entry file (main.tsx / App.tsx) has to change.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5000, retry: 1, refetchOnWindowFocus: true } },
});

function HealthMonitoringContent() {
  const health = useClusterHealth();
  const { restart, restarting, notice, dismissNotice } = usePodRestart();
  const now = useNow();

  const [selectedNode, setSelectedNode] = useState("all");
  const [confirm, setConfirm] = useState<RestartTarget | null>(null);
  const [showThresholds, setShowThresholds] = useState(false);

  const entries = useMemo<PodEntry[]>(
    () =>
      Object.entries(health.data?.nodes ?? {}).flatMap(([node, n]) =>
        (n.pods ?? []).map((pod) => ({ pod, node })),
      ),
    [health.data],
  );

  const offlineNodes = Object.entries(health.data?.nodes ?? {}).filter(([, n]) => n.freshness === "offline");
  // A node that vanished from the report while selected would leave an empty, confusing list.
  const node = selectedNode !== "all" && !health.data?.nodes?.[selectedNode] ? "all" : selectedNode;

  return (
    <div className="page-container health-page">
      <div className="page-header hm-header">
        <div className="page-title-section">
          <h1 className="page-title">Cluster Health</h1>
          <p className="page-subtitle">Pod and node status across the cluster, updated live.</p>
        </div>
        <div className="hm-header-actions">
          <span className={`hm-live is-${health.status}`} role="status">
            <span className="hm-dot" aria-hidden="true" />
            {STREAM_LABEL[health.status]}
            {health.updatedAt > 0 && health.status === "live" && <small> · {timeAgo(new Date(health.updatedAt).toISOString(), now)}</small>}
          </span>
          <button type="button" className="hm-btn" onClick={() => setShowThresholds(true)}>
            <FiSliders size={15} /> Thresholds
          </button>
          <button type="button" className="hm-btn" onClick={() => health.refresh()} disabled={health.isRefreshing} aria-label="Refresh now">
            <FiRefreshCw size={15} className={health.isRefreshing ? "hm-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      <div className="hm-content">
        {health.isError && (
          <div className="hm-banner is-crit" role="alert">
            Could not reach the daemon{health.error ? ` (${health.error.message})` : ""}. Retrying automatically.
            <button type="button" className="hm-btn" onClick={() => health.refresh()}>
              Retry now
            </button>
          </div>
        )}
        {!health.isError && health.status === "offline" && health.data && (
          <div className="hm-banner is-warn" role="status">
            Live updates paused — showing the last known data and checking every few seconds.
          </div>
        )}
        {offlineNodes.length > 0 && (
          <div className="hm-banner is-crit" role="alert">
            {offlineNodes.map(([k]) => k).join(", ")} {offlineNodes.length === 1 ? "has" : "have"} stopped reporting.
          </div>
        )}
        {notice && (
          <div className={`hm-banner ${notice.ok ? "is-ok" : "is-crit"}`} role="status">
            {notice.message}
            <button type="button" className="hm-btn" onClick={dismissNotice}>
              Dismiss
            </button>
          </div>
        )}

        <ClusterSummary data={health.data} selectedNode={node} onSelectNode={setSelectedNode} now={now} />

        <div className="hm-layout">
          <PodList
            entries={entries}
            selectedNode={node}
            restarting={restarting}
            onRestart={setConfirm}
            loading={health.isLoading}
          />
          <AlertsPanel active={health.data?.alerts ?? []} loading={health.isLoading} now={now} />
        </div>
      </div>

      {showThresholds && <ThresholdsDialog onClose={() => setShowThresholds(false)} />}

      {confirm && (
        <div className="hm-overlay" onMouseDown={() => setConfirm(null)}>
          <div className="hm-modal hm-modal-sm" role="dialog" aria-modal="true" aria-label="Restart pod" onMouseDown={(e) => e.stopPropagation()}>
            <div className="hm-modal-head">
              <h2>Restart this pod?</h2>
            </div>
            <p className="hm-modal-sub">
              <strong>{confirm.name}</strong> in <strong>{confirm.namespace}</strong> on <strong>{confirm.node}</strong> will be deleted. Kubernetes
              recreates it automatically if a controller manages it.
            </p>
            <div className="hm-modal-foot">
              <span className="hm-spacer" />
              <button type="button" className="hm-btn" onClick={() => setConfirm(null)} autoFocus>
                Cancel
              </button>
              <button
                type="button"
                className="hm-btn is-danger"
                onClick={() => {
                  restart(confirm);
                  setConfirm(null);
                }}
              >
                Restart pod
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function HealthMonitoring() {
  return (
    <QueryClientProvider client={queryClient}>
      <HealthMonitoringContent />
    </QueryClientProvider>
  );
}

export default HealthMonitoring;
