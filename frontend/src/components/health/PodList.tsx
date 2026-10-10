import { memo, useDeferredValue, useMemo, useState } from "react";
import { FiRotateCw } from "react-icons/fi";
import type { PodHealth } from "../../types/health";
import { podKey, type RestartTarget } from "../../hooks/usePodRestart";
import { podStatus, scoreTone } from "./podStatus";

export interface PodEntry {
  pod: PodHealth;
  node: string;
}

type StatusFilter = "all" | "issues" | "healthy";

const PAGE_SIZE = 100;

interface RowProps {
  entry: PodEntry;
  busy: boolean;
  onRestart: (t: RestartTarget) => void;
}

const PodRow = memo(function PodRow({ entry, busy, onRestart }: RowProps) {
  const { pod, node } = entry;
  const status = busy ? { label: "Restarting", tone: "warn" as const } : podStatus(pod);
  const reason = pod.health_reasons?.find((r) => r.trim());

  return (
    <li className={`hm-pod ${busy ? "is-busy" : ""}`}>
      <span className={`hm-dot is-${status.tone} ${busy ? "is-pulse" : ""}`} aria-hidden="true" />
      <div className="hm-pod-main">
        <span className="hm-pod-name" title={pod.name}>
          {pod.name}
        </span>
        <span className="hm-pod-meta">
          {pod.namespace} · {node}
          {reason && <span className="hm-pod-reason"> · {reason}</span>}
        </span>
      </div>
      <span className={`hm-badge is-${status.tone}`}>{status.label}</span>
      <span className="hm-pod-num" title="Container restarts">
        {pod.restart_count > 0 ? `${pod.restart_count}↻` : ""}
      </span>
      <span className={`hm-pod-score is-${scoreTone(pod.health_score)}`} title="Health score (0–100)">
        {pod.health_score ?? "–"}
      </span>
      <button
        type="button"
        className="hm-icon-btn"
        disabled={busy}
        onClick={() => onRestart({ namespace: pod.namespace, name: pod.name, node })}
        aria-label={`Restart ${pod.name}`}
        title="Restart pod (Kubernetes recreates it)"
      >
        <FiRotateCw size={15} className={busy ? "hm-spin" : ""} />
      </button>
    </li>
  );
});

interface Props {
  entries: PodEntry[];
  selectedNode: string;
  restarting: ReadonlySet<string>;
  onRestart: (t: RestartTarget) => void;
  loading: boolean;
}

export function PodList({ entries, selectedNode, restarting, onRestart, loading }: Props) {
  const [search, setSearch] = useState("");
  const [namespace, setNamespace] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const deferredSearch = useDeferredValue(search);

  const scoped = useMemo(
    () => (selectedNode === "all" ? entries : entries.filter((e) => e.node === selectedNode)),
    [entries, selectedNode],
  );
  const namespaces = useMemo(() => Array.from(new Set(scoped.map((e) => e.pod.namespace))).sort(), [scoped]);

  const visible = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return scoped
      .filter((e) => namespace === "all" || e.pod.namespace === namespace)
      .filter((e) => !q || e.pod.name.toLowerCase().includes(q))
      .filter((e) => {
        if (status === "all") return true;
        const ok = podStatus(e.pod).tone === "ok" || podStatus(e.pod).tone === "idle";
        return status === "healthy" ? ok : !ok;
      })
      .sort((a, b) => podStatus(a.pod).rank - podStatus(b.pod).rank || a.pod.name.localeCompare(b.pod.name));
  }, [scoped, namespace, deferredSearch, status]);

  const resetLimit = () => setLimit(PAGE_SIZE);
  const shown = visible.slice(0, limit);

  return (
    <section className="hm-card hm-pods" aria-label="Pods">
      <div className="hm-toolbar">
        <input
          type="search"
          className="hm-input"
          placeholder="Search pods…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetLimit();
          }}
          aria-label="Search pods"
        />
        <select
          className="hm-input"
          value={namespace}
          onChange={(e) => {
            setNamespace(e.target.value);
            resetLimit();
          }}
          aria-label="Namespace"
        >
          <option value="all">All namespaces</option>
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>
              {ns}
            </option>
          ))}
        </select>
        <div className="hm-segmented" role="group" aria-label="Status">
          {(["all", "issues", "healthy"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => {
                setStatus(s);
                resetLimit();
              }}
            >
              {s === "all" ? "All" : s === "issues" ? "Issues" : "Healthy"}
            </button>
          ))}
        </div>
        <span className="hm-count">
          {visible.length} of {scoped.length}
        </span>
      </div>

      {loading ? (
        <div className="hm-skeleton-list" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="hm-skeleton" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="hm-empty">
          <strong>{scoped.length === 0 ? "No pods reported yet" : "No pods match these filters"}</strong>
          {scoped.length === 0 ? "Pods appear here as soon as a node reports." : "Try clearing the search or filters."}
        </div>
      ) : (
        <>
          <ul className="hm-pod-list">
            {shown.map((e) => (
              <PodRow
                key={`${e.node}|${podKey(e.pod.namespace, e.pod.name)}`}
                entry={e}
                busy={restarting.has(podKey(e.pod.namespace, e.pod.name))}
                onRestart={onRestart}
              />
            ))}
          </ul>
          {visible.length > shown.length && (
            <button type="button" className="hm-btn hm-more" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, visible.length - shown.length)} more
            </button>
          )}
        </>
      )}
    </section>
  );
}
