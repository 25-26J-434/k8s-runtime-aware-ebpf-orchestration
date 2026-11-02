"use client";

import { useMemo, useState } from "react";
import { useMetricsStore, type HistoryPoint } from "./metrics-store";
import { toNodeView } from "@/lib/metrics/transform";
import type { NodeView } from "@/types/metrics";

const EMPTY: HistoryPoint[] = [];

/** Selected node's view model plus its rolling client-side history. */
export function useNodeView() {
  const nodes = useMetricsStore((s) => s.nodes);
  const allHistory = useMetricsStore((s) => s.history);
  const status = useMetricsStore((s) => s.status);
  const [selected, setSelected] = useState<string | null>(null);

  const keys = useMemo(() => Object.keys(nodes).sort(), [nodes]);
  const activeKey = selected && nodes[selected] ? selected : (keys[0] ?? null);

  const options = useMemo(
    () => keys.map((k) => ({ key: k, name: nodes[k]?.node_name ?? k })),
    [keys, nodes],
  );

  const raw = activeKey ? nodes[activeKey] : undefined;
  const node = useMemo<NodeView | null>(
    () => (activeKey && raw ? toNodeView(activeKey, raw) : null),
    [activeKey, raw],
  );

  /** Every pod across all nodes, de-duplicated by key. */
  const totalPods = useMemo(() => {
    const set = new Set<string>();
    for (const n of Object.values(nodes)) for (const k of Object.keys(n.pods ?? {})) set.add(k);
    return set.size;
  }, [nodes]);

  return {
    node,
    nodeOptions: options,
    selectedKey: activeKey,
    selectNode: setSelected,
    history: (activeKey && allHistory[activeKey]) || EMPTY,
    totalPods,
    status,
    isLoading: status !== "offline" && keys.length === 0,
    isOffline: status === "offline" && keys.length === 0,
  };
}
