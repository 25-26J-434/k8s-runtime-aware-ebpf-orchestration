import { useEffect, useState } from "react";
import type { MetricsConfig } from "../../services/metricsConfig";
import { useMetricsConfig, useSaveMetricsConfig } from "../../hooks/useMetricsConfig";

// Standard defaults the backend ships with; users can override any of them.
export const STANDARD_THRESHOLDS: MetricsConfig = {
  dns_latency_threshold: 20,
  tcp_retrans_threshold: 50,
  packet_loss_threshold: 20,
  rtt_threshold: 200,
  restart_count_threshold: 5,
};

const SECTIONS: { title: string; help: string; threshold: keyof MetricsConfig; unit: string }[] = [
  { title: "DNS latency", help: "Slow name lookups", threshold: "dns_latency_threshold", unit: "ms" },
  { title: "TCP retransmissions", help: "Packets that had to be re-sent", threshold: "tcp_retrans_threshold", unit: "count" },
  { title: "Packet loss", help: "Dropped packets", threshold: "packet_loss_threshold", unit: "%" },
  { title: "Round-trip time", help: "Network delay between peers", threshold: "rtt_threshold", unit: "ms" },
  { title: "Restart count", help: "Container restarts", threshold: "restart_count_threshold", unit: "restarts" },
];

export function ThresholdsDialog({ onClose }: { onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useMetricsConfig();
  const save = useSaveMetricsConfig();
  const [draft, setDraft] = useState<MetricsConfig | null>(null);

  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const invalid = draft ? Object.values(draft).some((v) => !Number.isFinite(v) || v < 0) : false;
  const dirty = !!draft && !!data && JSON.stringify(draft) !== JSON.stringify(data);

  const set = (key: keyof MetricsConfig, raw: string) =>
    setDraft((d) => (d ? { ...d, [key]: raw === "" ? NaN : Number(raw) } : d));

  return (
    <div className="hm-overlay" onMouseDown={onClose}>
      <div className="hm-modal" role="dialog" aria-modal="true" aria-label="Health thresholds" onMouseDown={(e) => e.stopPropagation()}>
        <div className="hm-modal-head">
          <h2>Health thresholds</h2>
          <button type="button" className="hm-icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="hm-modal-sub">
          Health warnings appear when a metric passes its threshold. Set your own limits, or restore the standard values.
        </p>

        {isLoading || (!draft && !isError) ? (
          <div className="hm-skeleton-list" aria-busy="true">
            <div className="hm-skeleton" />
            <div className="hm-skeleton" />
            <div className="hm-skeleton" />
          </div>
        ) : isError || !draft ? (
          <div className="hm-banner is-crit" role="alert">
            Could not load the current thresholds.
            <button type="button" className="hm-btn" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        ) : (
          <div className="hm-config-grid">
            {SECTIONS.map((s) => (
              <fieldset key={s.title} className="hm-config-section">
                <legend>{s.title}</legend>
                <span className="hm-config-help">{s.help}</span>
                <label>
                  Warn above ({s.unit})
                  <input
                    type="number"
                    min={0}
                    className="hm-input"
                    value={Number.isNaN(draft[s.threshold]) ? "" : draft[s.threshold]}
                    onChange={(e) => set(s.threshold, e.target.value)}
                  />
                </label>
              </fieldset>
            ))}
          </div>
        )}

        {save.isError && (
          <div className="hm-banner is-crit" role="alert">
            {save.error instanceof Error ? save.error.message : "Could not save thresholds."}
          </div>
        )}

        <div className="hm-modal-foot">
          <button type="button" className="hm-btn" disabled={!draft} onClick={() => setDraft({ ...STANDARD_THRESHOLDS })}>
            Restore standard values
          </button>
          <span className="hm-spacer" />
          <button type="button" className="hm-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="hm-btn is-primary"
            disabled={!draft || !dirty || invalid || save.isPending}
            onClick={() => draft && save.mutate(draft, { onSuccess: onClose })}
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
        {invalid && <div className="hm-field-error">Every value must be a number, 0 or higher.</div>}
      </div>
    </div>
  );
}
