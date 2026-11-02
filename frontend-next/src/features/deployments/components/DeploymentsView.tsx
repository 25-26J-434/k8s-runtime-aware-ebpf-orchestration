"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select, Table } from "antd";
import type { TableColumnsType } from "antd";
import { PageHeader } from "@/components/common/PageHeader";
import { ErrorState } from "@/components/common/feedback";
import { StatusText } from "@/components/common/StatusText";
import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { formatCount, formatNanos } from "@/lib/format/units";
import type { DeploymentInfo, LatestMetric, ScalingMetric } from "@/types/cluster";

const METRIC_LABEL: Record<ScalingMetric, string> = {
  dns_latency: "DNS",
  rtt: "RTT",
  tcp_retrans: "TCP retrans.",
  disk_read_latency: "Disk read",
  disk_write_latency: "Disk write",
};

// The scaling service reports latency metrics in nanoseconds (daemon/pkg/scaling/metrics.go); retransmissions are a count.
const fmtMetric = (m: LatestMetric) => (m.metric === "tcp_retrans" ? formatCount(m.value) : formatNanos(m.value));

export function DeploymentsView() {
  const deployments = useQuery({
    queryKey: ["deployments", "list"],
    queryFn: ({ signal }) => apiRequest<DeploymentInfo[]>(endpoints.scalingDeployments, { signal }),
    refetchInterval: 15_000,
  });
  const metrics = useQuery({
    queryKey: ["deployments", "latest-metrics"],
    queryFn: ({ signal }) => apiRequest<LatestMetric[]>(endpoints.scalingLatestMetrics, { signal }),
    refetchInterval: 15_000,
  });
  const [namespace, setNamespace] = useState("all");

  const rows = useMemo(() => (deployments.data ?? []).filter((d) => namespace === "all" || d.namespace === namespace), [deployments.data, namespace]);
  const namespaces = useMemo(() => [...new Set((deployments.data ?? []).map((d) => d.namespace))].sort(), [deployments.data]);
  const byDeployment = useMemo(() => {
    const map = new Map<string, LatestMetric[]>();
    for (const m of metrics.data ?? []) {
      const k = `${m.namespace}/${m.deployment}`;
      map.set(k, [...(map.get(k) ?? []), m]);
    }
    return map;
  }, [metrics.data]);

  const columns: TableColumnsType<DeploymentInfo> = [
    {
      title: "Deployment",
      key: "name",
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (_, d) => (
        <div>
          <div>{d.name}</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>{d.namespace}</div>
        </div>
      ),
    },
    { title: "Replicas", dataIndex: "replicas", align: "right", sorter: (a, b) => a.replicas - b.replicas },
    {
      title: "Available",
      key: "avail",
      render: (_, d) => {
        const available = d.availableReplicas ?? 0;
        const tone = available >= d.replicas ? "success" : available === 0 ? "critical" : "warning";
        return <StatusText tone={tone} label={`${available} / ${d.replicas}`} />;
      },
    },
    {
      title: "Latest metrics",
      key: "metrics",
      render: (_, d) => {
        const latest = byDeployment.get(`${d.namespace}/${d.name}`) ?? [];
        return latest.length === 0 ? <span style={{ opacity: 0.5 }}>—</span> : latest.map((m) => <span key={m.metric} style={{ marginRight: 16 }}><span style={{ opacity: 0.6 }}>{METRIC_LABEL[m.metric]} </span>{fmtMetric(m)}</span>);
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Deployments"
        note="Replica availability and the values the autoscaler is watching"
        extra={<Select value={namespace} onChange={setNamespace} style={{ width: 180 }} options={[{ value: "all", label: "All namespaces" }, ...namespaces.map((n) => ({ value: n, label: n }))]} />}
      />
      {deployments.error && !deployments.data ? (
        <ErrorState error={deployments.error} onRetry={() => deployments.refetch()} />
      ) : (
        <Table size="middle" rowKey={(d) => `${d.namespace}/${d.name}`} loading={deployments.isLoading} columns={columns} dataSource={rows} pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }} locale={{ emptyText: "No deployments" }} />
      )}
    </>
  );
  
}
