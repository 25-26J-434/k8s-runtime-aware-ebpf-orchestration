"use client";

import { useMemo, useState } from "react";
import { Descriptions, Drawer, Select, Table } from "antd";
import type { TableColumnsType } from "antd";
import { format } from "date-fns";
import { ErrorState } from "@/components/common/feedback";
import { StatusText } from "@/components/common/StatusText";
import { monoFamily } from "@/lib/theme/tokens";
import { useCommLogs } from "../hooks/use-federation";
import { EVENT_TYPES, type CommLogEntry } from "@/types/federation";

function outcome(e: CommLogEntry) {
  if (e.direction === "RECEIVED") return { tone: "info", label: "Received" } as const;
  if (e.failed?.length) return e.delivered?.length ? ({ tone: "warning", label: "Partial" } as const) : ({ tone: "critical", label: "Failed" } as const);
  return { tone: "success", label: "Delivered" } as const;
}

const columns: TableColumnsType<CommLogEntry> = [
  { title: "Time", dataIndex: "timestamp", width: 90, render: (t: string) => format(new Date(t), "HH:mm:ss") },
  { title: "Event", dataIndex: "event", width: 150 },
  { title: "Mode", dataIndex: "mode", width: 120 },
  {
    title: "From → To",
    key: "route",
    ellipsis: true,
    render: (_, e) => `${e.source ?? e.node} → ${e.targets?.length ? e.targets.join(", ") : e.direction === "SENT" ? "all peers" : e.node}`,
  },
  { title: "Result", key: "result", width: 120, render: (_, e) => <StatusText tone={outcome(e).tone} label={outcome(e).label} /> },
];

export function MessageLog() {
  const { data, isLoading, error, refetch } = useCommLogs(100);
  const [event, setEvent] = useState("all");
  const [selected, setSelected] = useState<CommLogEntry | null>(null);

  const rows = useMemo(() => (data ?? []).filter((e) => event === "all" || e.event === event), [data, event]);

  if (error && !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <Select value={event} onChange={setEvent} style={{ width: 180, marginBottom: 8 }} options={[{ value: "all", label: "All events" }, ...EVENT_TYPES.map((e) => ({ value: e, label: e }))]} />
      <Table
        size="middle"
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        onRow={(e) => ({ onClick: () => setSelected(e), style: { cursor: "pointer" } })}
        pagination={{ pageSize: 12, showSizeChanger: false, hideOnSinglePage: true }}
        locale={{ emptyText: "No messages yet" }}
      />
      <Drawer open={!!selected} onClose={() => setSelected(null)} size={440} title={selected?.event}>
        {selected && (
          <>
            <Descriptions
              column={1}
              size="small"
              items={[
                { key: "t", label: "Time", children: format(new Date(selected.timestamp), "PPpp") },
                { key: "d", label: "Direction", children: selected.direction },
                { key: "m", label: "Mode", children: selected.mode },
                { key: "n", label: "Node", children: `${selected.node} (${selected.node_ip})` },
                { key: "ok", label: "Delivered", children: selected.delivered?.join(", ") || "—" },
                { key: "fail", label: "Failed", children: selected.failed?.join(", ") || "—" },
                { key: "r", label: "Result", children: selected.result ?? "—" },
              ]}
            />
            <div style={{ margin: "16px 0 6px", fontWeight: 600 }}>Payload</div>
            <pre style={{ margin: 0, padding: 12, background: "rgba(128,128,128,0.1)", borderRadius: 4, fontFamily: monoFamily, fontSize: 13, overflow: "auto" }}>
              {JSON.stringify(selected.payload ?? {}, null, 2)}
            </pre>
          </>
        )}
      </Drawer>
    </>
  );
}
