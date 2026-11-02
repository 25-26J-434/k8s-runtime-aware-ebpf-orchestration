"use client";

import { Button, Descriptions, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { EmptyState, ErrorState } from "@/components/common/feedback";
import { StatusText } from "@/components/common/StatusText";
import { usePlacement } from "../hooks/use-scaling";
import type { PlacementPod } from "@/types/scaling";

function age(seconds: number) {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

const columns: TableColumnsType<PlacementPod> = [
  { title: "Pod", dataIndex: "name", ellipsis: true },
  { title: "Node", dataIndex: "node" },
  { title: "Phase", key: "phase", render: (_, p) => <StatusText tone={p.phase === "Running" && p.ready ? "success" : p.phase === "Pending" ? "warning" : "neutral"} label={p.phase} /> },
  { title: "Age", dataIndex: "ageSeconds", align: "right", render: (s: number) => age(s) },
];

/** Where the selected deployment's pods actually run. */
export function PlacementPanel({ namespace, deployment, observedNode }: { namespace?: string; deployment?: string; observedNode?: string }) {
  const q = usePlacement(namespace, deployment);

  if (!namespace || !deployment) return <EmptyState title="Select a rule or deployment" description="Node placement for its pods appears here." />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const counts = Object.entries(q.data?.nodeCounts ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const latest = [...(q.data?.pods ?? [])].sort((a, b) => (b.startTime ? +new Date(b.startTime) : 0) - (a.startTime ? +new Date(a.startTime) : 0)).slice(0, 6);

  return (
    <>
      <Descriptions
        column={1}
        size="small"
        extra={<Button size="small" icon={<ReloadOutlined />} loading={q.isFetching} onClick={() => q.refetch()}>Refresh</Button>}
        items={[
          { key: "obs", label: "Observed node", children: observedNode || "—" },
          { key: "place", label: "Pods per node", children: counts.length ? counts.map(([n, c]) => `${n}: ${c}`).join("   ") : q.isLoading ? "Loading…" : "No scheduled pods yet" },
        ]}
      />
      <Typography.Text type="secondary" style={{ display: "block", margin: "12px 0 6px", fontSize: 13 }}>Newest pods</Typography.Text>
      <Table size="small" rowKey="name" loading={q.isLoading} columns={columns} dataSource={latest} pagination={false} locale={{ emptyText: "No pods found for this deployment" }} />
    </>
  );
}
