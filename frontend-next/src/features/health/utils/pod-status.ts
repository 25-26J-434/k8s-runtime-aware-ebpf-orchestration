import type { Tone } from "@/components/common/tone";
import type { Freshness, PodHealth, Severity } from "@/types/health";

export interface PodStatus {
  label: string;
  tone: Tone;
  /** Sort rank: lower = needs more attention. */
  rank: number;
}

export function podStatus(pod: PodHealth): PodStatus {
  switch (pod.phase) {
    case "Failed":
      return { label: "Failed", tone: "critical", rank: 0 };
    case "Succeeded":
      return { label: "Completed", tone: "neutral", rank: 4 };
    case "Pending":
      return { label: "Pending", tone: "warning", rank: 2 };
    case "Running":
      if (!pod.ready) return { label: "Not ready", tone: "critical", rank: 1 };
      return pod.healthy
        ? { label: "Healthy", tone: "success", rank: 5 }
        : { label: "Unhealthy", tone: "warning", rank: 3 };
    default:
      return { label: pod.phase || "Unknown", tone: "neutral", rank: 3 };
  }
}

export const freshnessTone: Record<Freshness, Tone> = { live: "success", stale: "warning", offline: "critical" };

export const severityTone: Record<Severity, Tone> = { critical: "critical", warning: "warning", info: "info" };
