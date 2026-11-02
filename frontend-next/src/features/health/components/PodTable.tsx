"use client";

import { useMemo, useState } from "react";
import { Button, Flex, Input, Select, Table } from "antd";
import type { TableColumnsType } from "antd";
import { StatusText } from "@/components/common/StatusText";
import { podStatus } from "../utils/pod-status";
import type { PodHealth } from "@/types/health";

export interface PodRow extends PodHealth {
  nodeKey: string;
}

type StatusFilter = "all" | "attention" | "healthy";

interface PodTableProps {
  pods: PodRow[];
  nodeNames: string[];
  restartingKeys: ReadonlySet<string>;
  loading?: boolean;
  onSelect: (pod: PodRow) => void;
  onRestart: (pod: PodRow) => void;
}

export const podRowKey = (p: { namespace: string; name: string }) => `${p.namespace}/${p.name}`;

export function PodTable({ pods, nodeNames, restartingKeys, loading, onSelect, onRestart }: PodTableProps) {
  const [node, setNode] = useState("all");
  const [namespace, setNamespace] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const namespaces = useMemo(() => [...new Set(pods.map((p) => p.namespace))].sort(), [pods]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pods
      .filter((p) => (node === "all" || p.nodeKey === node) && (namespace === "all" || p.namespace === namespace))
      .filter((p) => {
        const tone = podStatus(p).tone;
        return status === "all" || (status === "healthy" ? tone === "success" : tone === "critical" || tone === "warning");
      })
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => podStatus(a).rank - podStatus(b).rank || a.name.localeCompare(b.name));
  }, [pods, node, namespace, status, query]);

  const columns: TableColumnsType<PodRow> = [
    {
      title: "Pod",
      key: "pod",
      render: (_, p) => (
        <div>
          <div>{p.name}</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>{p.namespace}</div>
        </div>
      ),
    },
    { title: "Node", dataIndex: "nodeKey" },
    { title: "Status", key: "status", render: (_, p) => <StatusText tone={podStatus(p).tone} label={podStatus(p).label} /> },
    { title: "Restarts", dataIndex: "restart_count", align: "right", sorter: (a, b) => a.restart_count - b.restart_count },
    {
      title: "",
      key: "act",
      align: "right",
      render: (_, p) => (
        <Button
          size="small"
          loading={restartingKeys.has(podRowKey(p))}
          onClick={(e) => {
            e.stopPropagation();
            onRestart(p);
          }}
        >
          Restart
        </Button>
      ),
    },
  ];

  return (
    <>
      <Flex gap={8} wrap style={{ marginBottom: 8 }}>
        <Input.Search allowClear placeholder="Search pods" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 170 }} />
        <Select value={node} onChange={setNode} style={{ width: 130 }} options={[{ value: "all", label: "All nodes" }, ...nodeNames.map((n) => ({ value: n, label: n }))]} />
        <Select value={namespace} onChange={setNamespace} style={{ width: 150 }} options={[{ value: "all", label: "All namespaces" }, ...namespaces.map((n) => ({ value: n, label: n }))]} />
        <Select
          value={status}
          onChange={setStatus}
          style={{ width: 140 }}
          options={[
            { value: "all", label: "Any status" },
            { value: "attention", label: "Needs attention" },
            { value: "healthy", label: "Healthy" },
          ]}
        />
      </Flex>
      <Table
        size="middle"
        rowKey={(p) => `${p.nodeKey}/${podRowKey(p)}`}
        loading={loading}
        columns={columns}
        dataSource={rows}
        onRow={(p) => ({ onClick: () => onSelect(p), style: { cursor: "pointer" } })}
        pagination={{ pageSize: 15, showSizeChanger: false, hideOnSinglePage: true, showTotal: (t) => `${t} pods` }}
        locale={{ emptyText: "No pods match the filters" }}
      />
    </>
  );
}
