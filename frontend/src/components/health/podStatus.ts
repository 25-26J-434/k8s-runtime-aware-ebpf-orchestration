import type { PodHealth } from "../../types/health";

export type Tone = "ok" | "warn" | "crit" | "idle";

export interface PodStatus {
  label: string;
  tone: Tone;
  /** Lower sorts first: problems surface at the top of the list. */
  rank: number;
}

export function podStatus(pod: PodHealth): PodStatus {
  switch (pod.phase) {
    case "Failed":
      return { label: "Failed", tone: "crit", rank: 0 };
    case "Unknown":
      return { label: "Unknown", tone: "crit", rank: 0 };
    case "Pending":
      return { label: "Pending", tone: "warn", rank: 2 };
    case "Succeeded":
      return { label: "Completed", tone: "idle", rank: 4 };
    case "Running":
      if (!pod.ready) return { label: "Not ready", tone: "crit", rank: 1 };
      return pod.healthy
        ? { label: "Healthy", tone: "ok", rank: 4 }
        : { label: "Degraded", tone: "warn", rank: 3 };
    default:
      return { label: pod.phase || "Unknown", tone: "warn", rank: 3 };
  }
}

export function scoreTone(score: number | undefined): Tone {
  if (score === undefined) return "idle";
  if (score >= 80) return "ok";
  if (score >= 50) return "warn";
  return "crit";
}
