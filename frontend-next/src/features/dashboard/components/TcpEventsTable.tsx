"use client";

import { Table } from "antd";
import type { TableColumnsType } from "antd";
import { format } from "date-fns";
import { formatMicros } from "@/lib/format/units";
import type { TcpEvent } from "@/types/metrics";

const columns: TableColumnsType<TcpEvent> = [
  { title: "Time", dataIndex: "timestamp", width: 90, render: (t: string) => format(new Date(t), "HH:mm:ss") },
  { title: "Type", dataIndex: "event_type", render: (t: TcpEvent["event_type"]) => (t === "packet_loss" ? "Packet loss" : "Retransmission") },
  { title: "Pod", key: "pod", render: (_, e) => `${e.namespace}/${e.pod_name}` },
  { title: "Connection", key: "conn", render: (_, e) => `${e.source_ip}:${e.source_port} → ${e.dest_ip}:${e.dest_port}` },
  { title: "SRTT", dataIndex: "srtt_us", align: "right", render: (v: number) => formatMicros(v) },
  { title: "cwnd", dataIndex: "cwnd", align: "right" },
];

export function TcpEventsTable({ events }: { events: TcpEvent[] }) {
  const rows = [...events].reverse();
  return (
    <Table
      size="middle"
      rowKey={(e) => `${e.timestamp}-${e.source_port}-${e.dest_port}-${e.event_type}`}
      columns={columns}
      dataSource={rows}
      pagination={{ pageSize: 8, hideOnSinglePage: true, showSizeChanger: false }}
      locale={{ emptyText: "No recent retransmission or loss events" }}
    />
  );
}
