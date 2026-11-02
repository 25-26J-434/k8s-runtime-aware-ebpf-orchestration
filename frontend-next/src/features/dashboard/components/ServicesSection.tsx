"use client";

import { Table } from "antd";
import type { TableColumnsType } from "antd";
import { StatusText } from "@/components/common/StatusText";
import type { EndpointHealth, ServiceHealth, ServiceHealthSummary } from "@/types/metrics";

const TONE = { healthy: "success", degraded: "warning", unhealthy: "critical" } as const;

const endpointColumns: TableColumnsType<EndpointHealth> = [
  { title: "Pod", dataIndex: "pod_name" },
  { title: "IP", dataIndex: "pod_ip" },
  {
    title: "Readiness",
    dataIndex: "status",
    render: (s: EndpointHealth["status"]) => <StatusText tone={s === "ready" ? "success" : "critical"} label={s === "ready" ? "Ready" : "Not ready"} />,
  },
  { title: "HTTP check", dataIndex: "http_check", render: (ok: boolean) => (ok ? "Pass" : "Fail") },
  { title: "Latency", dataIndex: "latency_ms", align: "right", render: (ms: number) => `${ms.toFixed(1)} ms` },
];

const columns: TableColumnsType<ServiceHealth> = [
  {
    title: "Service",
    key: "svc",
    render: (_, s) => (
      <div>
        <div>{s.name}</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>{s.namespace}</div>
      </div>
    ),
  },
  { title: "Type", dataIndex: "type" },
  { title: "Cluster IP", dataIndex: "cluster_ip" },
  { title: "Ready endpoints", key: "ready", align: "right", render: (_, s) => `${s.ready_endpoints} / ${s.total_endpoints}` },
  { title: "Status", dataIndex: "status", render: (s: ServiceHealth["status"]) => <StatusText tone={TONE[s] ?? "neutral"} label={s} /> },
];

export function ServicesSection({ services, loading }: { services?: ServiceHealthSummary; loading?: boolean }) {
  const rows = Object.entries(services?.service_details ?? {}).map(([k, s]) => ({ ...s, key: k }));
  return (
    <Table
      size="middle"
      loading={loading}
      columns={columns}
      dataSource={rows}
      pagination={false}
      locale={{ emptyText: "No services reported" }}
      expandable={{
        rowExpandable: (s) => Object.keys(s.endpoint_health ?? {}).length > 0,
        expandedRowRender: (s) => (
          <Table size="middle" rowKey="pod_name" columns={endpointColumns} dataSource={Object.values(s.endpoint_health)} pagination={false} />
        ),
      }}
    />
  );
}
