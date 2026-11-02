"use client";

import { useCallback, useMemo, useState } from "react";
import { useMetricsStore } from "@/features/dashboard/hooks/metrics-store";
import { DEFAULT_THRESHOLDS, recommend, sanitizeThresholds, type Recommendation, type RecommendationThresholds } from "../lib/recommendations";

// Same key the legacy console used, so thresholds carry over in the same browser.
const STORAGE_KEY = "migrationThresholds";

function load(): RecommendationThresholds {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeThresholds(JSON.parse(raw)) : DEFAULT_THRESHOLDS;
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

/** Recommendation thresholds, kept per browser. */
export function useRecommendationThresholds() {
  const [thresholds, setThresholds] = useState<RecommendationThresholds>(DEFAULT_THRESHOLDS);
  const [hydrated, setHydrated] = useState(false);
  if (!hydrated && typeof window !== "undefined") {
    setHydrated(true);
    setThresholds(load());
  }

  const save = useCallback((next: RecommendationThresholds) => {
    setThresholds(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked: the change still applies for this session */
    }
  }, []);

  return { thresholds, save, reset: () => save(DEFAULT_THRESHOLDS) };
}

/** Per-pod findings across every node the metrics stream reports. `nodeName` limits it to one node. */
export function useRecommendations(thresholds: RecommendationThresholds, nodeName?: string) {
  const nodes = useMetricsStore((s) => s.nodes);
  return useMemo<Recommendation[]>(() => {
    const all = Object.entries(nodes).flatMap(([key, m]) => {
      const name = m.node_name ?? key;
      return nodeName && name !== nodeName ? [] : recommend(m.pods ?? {}, thresholds, name);
    });
    const rank = { high: 3, medium: 2, low: 1 } as const;
    return all.sort((a, b) => rank[b.severity] - rank[a.severity]);
  }, [nodes, thresholds, nodeName]);
}
