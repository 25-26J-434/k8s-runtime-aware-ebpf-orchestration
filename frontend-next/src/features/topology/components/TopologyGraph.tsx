"use client";

import { useMemo } from "react";
import { Background, Controls, ReactFlow, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { theme } from "antd";
import { useColorMode } from "@/app/providers";
import type { ClusterTopology } from "@/types/cluster";
import type { Severity } from "../lib/recommendations";

export type Selection =
  | { kind: "node"; name: string }
  | { kind: "pod"; namespace: string; name: string; node: string }
  | null;

const POD_W = 216;
const POD_H = 46;
const COLS = 2;
const GAP = 10;
const HEADER = 44;
const NODE_GAP = 48;

interface Props {
  topology: ClusterTopology;
  query: string;
  /** Metric-based findings by "namespace/pod"; overrides the Kubernetes status colour. */
  health: Record<string, Severity>;
  selection: Selection;
  onSelect: (s: Selection) => void;
}

/** Each cluster node is a container with its pods laid out inside; no edges needed for placement. */
export function TopologyGraph({ topology, query, health, selection, onSelect }: Props) {
  const { token } = theme.useToken();
  const { mode } = useColorMode();
  const q = query.trim().toLowerCase();

  const nodes = useMemo(() => {
    const colour = (status: string) => {
      const s = status.toLowerCase();
      return s === "running" ? token.colorSuccess : s === "pending" ? token.colorWarning : s === "succeeded" ? token.colorInfo : token.colorError;
    };
    const out: Node[] = [];
    let x = 0;
    for (const n of topology.nodes) {
      const pods = n.pods ?? [];
      const rows = Math.max(1, Math.ceil(pods.length / COLS));
      const width = COLS * POD_W + (COLS + 1) * GAP;
      const height = HEADER + rows * (POD_H + GAP) + GAP;
      const nodePicked = selection?.kind === "node" && selection.name === n.name;
      out.push({
        id: `node:${n.name}`,
        position: { x, y: 0 },
        data: { label: `${n.name}${n.role ? `  ·  ${n.role}` : ""}` },
        draggable: false,
        style: {
          width,
          height,
          padding: "12px 14px",
          textAlign: "left",
          fontSize: 14,
          fontWeight: 600,
          background: token.colorBgContainer,
          color: token.colorText,
          border: `1px solid ${nodePicked ? token.colorPrimary : token.colorBorder}`,
          borderRadius: token.borderRadiusLG,
        },
      });
      pods.forEach((p, i) => {
        const matches = !q || p.name.toLowerCase().includes(q) || p.namespace.toLowerCase().includes(q);
        const finding = health[`${p.namespace}/${p.name}`];
        const stripe = finding === "high" ? token.colorError : finding === "medium" ? token.colorWarning : finding === "low" ? token.colorInfo : colour(p.status);
        const picked = selection?.kind === "pod" && selection.namespace === p.namespace && selection.name === p.name && selection.node === n.name;
        out.push({
          id: `pod:${n.name}|${p.namespace}/${p.name}`,
          parentId: `node:${n.name}`,
          extent: "parent",
          draggable: false,
          position: { x: GAP + (i % COLS) * (POD_W + GAP), y: HEADER + Math.floor(i / COLS) * (POD_H + GAP) },
          data: {
            label: (
              <div title={`${p.namespace}/${p.name}`} style={{ lineHeight: 1.25 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                <div style={{ fontSize: 10, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.namespace}</div>
              </div>
            ),
          },
          style: {
            width: POD_W,
            height: POD_H,
            padding: "8px 10px",
            fontSize: 12,
            fontWeight: 400,
            textAlign: "left",
            background: token.colorBgLayout,
            color: token.colorText,
            borderRadius: token.borderRadius,
            border: `1px solid ${picked ? token.colorPrimary : token.colorBorderSecondary}`,
            borderLeft: `4px solid ${stripe}`,
            opacity: matches ? 1 : 0.25,
          },
        });
      });
      x += width + NODE_GAP;
    }
    return out;
  }, [topology, q, health, selection, token]);

  return (
    <>
      <style>{".react-flow__handle{opacity:0;pointer-events:none}"}</style>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.1, maxZoom: 1.2 }}
        minZoom={0.2}
        colorMode={mode}
        onNodeClick={(_, node) => {
          if (node.id.startsWith("node:")) return onSelect({ kind: "node", name: node.id.slice(5) });
          // id format: pod:<node>|<namespace>/<name>
          const [owner = "", rest = ""] = node.id.slice(4).split("|");
          const [ns = "", ...nameParts] = rest.split("/");
          onSelect({ kind: "pod", namespace: ns, name: nameParts.join("/"), node: owner });
        }}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </>
  );
}
