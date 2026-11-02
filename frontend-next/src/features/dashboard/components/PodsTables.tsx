"use client";

import { useMemo, useState } from "react";
import { Input, Table } from "antd";
import type { TableColumnsType } from "antd";
import { formatCount, formatMicros } from "@/lib/format/units";
import type { PodView } from "@/types/metrics";

const dash = "—";
const byNum = (pick: (p: PodView) => number | undefined) => (a: PodView, b: PodView) => (pick(a) ?? -1) - (pick(b) ?? -1);

const podColumn: TableColumnsType<PodView>[number] = {
  title: "Pod",
  key: "pod",
  sorter: (a, b) => a.name.localeCompare(b.name),
  render: (_, p) => (
    <div>
      <div>{p.name}</div>
      <div style={{ fontSize: 13, opacity: 0.6 }}>{p.namespace}</div>
    </div>
  ),
};

/**
 * Relative ranking of what this node observed (DNS latency, retransmissions, run-queue wait).
 * It is not a health verdict; health lives on the Health page.
 */
export function PerformanceTable({ pods, loading }: { pods: PodView[]; loading?: boolean }) {
  const ranked = useMemo(
    () =>
      pods
        .map((p) => ({ p, score: (p.dns?.avgUs ?? 0) / 1000 + (p.tcp?.retransmissions ?? 0) + (p.sched?.avgRunqueueUs ?? 0) / 1000 }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map((r) => r.p),
    [pods],
  );

  const columns: TableColumnsType<PodView> = [
    { ...podColumn, sorter: undefined },
    { title: "DNS avg", key: "dns", align: "right", render: (_, p) => (p.dns ? formatMicros(p.dns.avgUs) : dash) },
    { title: "Retrans.", key: "re", align: "right", render: (_, p) => (p.tcp ? formatCount(p.tcp.retransmissions) : dash) },
    { title: "Run-queue avg", key: "rq", align: "right", render: (_, p) => (p.sched ? formatMicros(p.sched.avgRunqueueUs) : dash) },
  ];
  return (
    <Table
      size="middle"
      rowKey="key"
      loading={loading}
      columns={columns}
      dataSource={ranked}
      pagination={false}
      locale={{ emptyText: "No pod has reported latency or retransmission activity" }}
    />
  );
}

export function PodMetricsTable({ pods, loading }: { pods: PodView[]; loading?: boolean }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? pods.filter((p) => p.name.toLowerCase().includes(needle) || p.namespace.toLowerCase().includes(needle)) : pods;
  }, [pods, q]);

  const columns: TableColumnsType<PodView> = [
    podColumn,
    { title: "DNS avg", key: "dns", align: "right", sorter: byNum((p) => p.dns?.avgUs), render: (_, p) => (p.dns ? formatMicros(p.dns.avgUs) : dash) },
    { title: "DNS events", key: "dnse", align: "right", sorter: byNum((p) => p.dns?.totalEvents), render: (_, p) => (p.dns ? formatCount(p.dns.totalEvents) : dash) },
    { title: "SRTT", key: "srtt", align: "right", sorter: byNum((p) => p.tcp?.lastSrttUs), render: (_, p) => (p.tcp ? formatMicros(p.tcp.lastSrttUs) : dash) },
    { title: "Retrans.", key: "re", align: "right", sorter: byNum((p) => p.tcp?.retransmissions), render: (_, p) => (p.tcp ? formatCount(p.tcp.retransmissions) : dash) },
    { title: "Pkt loss", key: "pl", align: "right", sorter: byNum((p) => p.tcp?.packetLoss), render: (_, p) => (p.tcp ? formatCount(p.tcp.packetLoss) : dash) },
    { title: "Run-queue avg", key: "rq", align: "right", sorter: byNum((p) => p.sched?.avgRunqueueUs), render: (_, p) => (p.sched ? formatMicros(p.sched.avgRunqueueUs) : dash) },
    { title: "Starvation", key: "st", align: "right", sorter: byNum((p) => p.sched?.starvation), render: (_, p) => (p.sched ? formatCount(p.sched.starvation) : dash) },
    { title: "Disk I/O avg", key: "dk", align: "right", sorter: byNum((p) => p.disk?.avgIoLatencyUs), render: (_, p) => (p.disk ? formatMicros(p.disk.avgIoLatencyUs) : dash) },
  ];

  return (
    <>
      <Input.Search allowClear placeholder="Filter pods" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240, marginBottom: 8 }} />
      <Table
        size="middle"
        rowKey="key"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 900 }}
        pagination={{ pageSize: 15, hideOnSinglePage: true, showSizeChanger: false }}
        locale={{ emptyText: "No pods reported" }}
      />
    </>
  );
}
