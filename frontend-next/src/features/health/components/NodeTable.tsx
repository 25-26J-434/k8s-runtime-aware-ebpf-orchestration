"use client";

import { Table } from "antd";
import type { TableColumnsType } from "antd";
import { formatDistanceToNowStrict } from "date-fns";
import { StatusText } from "@/components/common/StatusText";
import { freshnessTone } from "../utils/pod-status";
import type { NodeHealth } from "@/types/health";

const columns: TableColumnsType<NodeHealth> = [
  {
    title: "Node",
    key: "node",
    render: (_, n) => (
      <div>
        <div>{n.node_name}</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>{n.node_ip ?? ""}</div>
      </div>
    ),
  },
  { title: "Reporting", key: "fresh", render: (_, n) => <StatusText tone={freshnessTone[n.freshness ?? "live"]} label={n.freshness ?? "live"} /> },
  {
    title: "Health",
    key: "health",
    render: (_, n) => (
      <div>
        <StatusText tone={n.healthy ? "success" : "critical"} label={n.healthy ? "Healthy" : "Unhealthy"} />
        {!n.healthy && n.health_reasons?.[0] && <div style={{ fontSize: 13, opacity: 0.6 }}>{n.health_reasons[0]}</div>}
      </div>
    ),
  },
  { title: "Pods healthy / total", key: "pods", align: "right", render: (_, n) => `${n.healthy_pods} / ${n.total_pods}` },
  { title: "Last seen", key: "seen", render: (_, n) => (n.last_seen ? (Date.now() - new Date(n.last_seen).getTime() < 5000 ? "just now" : `${formatDistanceToNowStrict(new Date(n.last_seen))} ago`) : "—") },
];

export function NodeTable({ nodes, loading }: { nodes: NodeHealth[]; loading?: boolean }) {
  return <Table size="middle" rowKey="node_name" loading={loading} columns={columns} dataSource={nodes} pagination={false} locale={{ emptyText: "No nodes reporting" }} />;
}
