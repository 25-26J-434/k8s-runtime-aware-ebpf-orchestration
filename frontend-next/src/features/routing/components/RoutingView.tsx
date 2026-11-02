"use client";

import { useState } from "react";
import { Alert, Button, Descriptions, Input, Popconfirm, Space, Table, Tabs, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/common/PageHeader";
import { Section } from "@/components/common/Section";
import { ErrorState } from "@/components/common/feedback";
import { StatusText } from "@/components/common/StatusText";
import { useApplyPolicy, usePolicies, usePolicyMutations, useRedirections } from "../hooks/use-routing";
import { policyState, resolveFrontend, resolveMetric, resolveTarget, resolveThreshold, resolveTtl } from "../lib/policy";
import { PolicyDrawer, type DrawerMode } from "./PolicyDrawer";
import type { PolicyRecord, RedirectionEvent } from "@/types/routing";

const STATE_TONE = { active: "success", expired: "neutral", unknown: "neutral" } as const;
const EVENT_TONE = { applied: "success", expired: "neutral", deleted: "neutral", skipped: "warning", observed: "info" } as const;

function PoliciesTab() {
  const policies = usePolicies();
  const { remove } = usePolicyMutations();
  const { apply, lastResult, probe, probeError, clearProbe } = useApplyPolicy();
  const [drawer, setDrawer] = useState<{ open: boolean; mode: DrawerMode; policy: PolicyRecord | null }>({ open: false, mode: "view", policy: null });
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const rows = (policies.data ?? []).filter((p) => !q || `${p.policy_name} ${p.namespace} ${resolveFrontend(p).service}`.toLowerCase().includes(q));
  const open = (mode: DrawerMode, policy: PolicyRecord | null) => setDrawer({ open: true, mode, policy });

  const columns: TableColumnsType<PolicyRecord> = [
    {
      title: "Policy",
      key: "name",
      sorter: (a, b) => (a.policy_name ?? "").localeCompare(b.policy_name ?? ""),
      render: (_, p) => (
        <div>
          <div>{p.policy_name}</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>{p.namespace}</div>
        </div>
      ),
    },
    { title: "Frontend", key: "front", render: (_, p) => { const f = resolveFrontend(p); return f.service ? `${f.service}:${f.port}` : "—"; } },
    { title: "State", key: "state", render: (_, p) => <StatusText tone={STATE_TONE[policyState(p)]} label={policyState(p)} /> },
    { title: "Metric", key: "metric", render: (_, p) => `${resolveMetric(p)} > ${String(resolveThreshold(p))}` },
    { title: "Lifetime", key: "ttl", align: "right", render: (_, p) => `${String(resolveTtl(p))} s` },
    { title: "Redirects to", key: "target", ellipsis: true, width: 190, render: (_, p) => resolveTarget(p) },
    {
      title: "",
      key: "ops",
      align: "right",
      render: (_, p) => (
        <Space size={4} onClick={(e) => e.stopPropagation()}>
          <Popconfirm title="Evaluate and apply?" description="If the metric violates the threshold, traffic is redirected now." okText="Apply" onConfirm={() => apply.mutate(p)}>
            <Button size="small" type="primary" loading={apply.isPending && apply.variables?.policy_name === p.policy_name}>Apply</Button>
          </Popconfirm>
          <Button size="small" icon={<EditOutlined />} onClick={() => open("edit", p)} aria-label="Edit policy" />
          <Popconfirm title={`Delete ${p.policy_name}?`} okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => p.policy_name && remove.mutate(p.policy_name)}>
            <Button size="small" danger icon={<DeleteOutlined />} aria-label="Delete policy" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {lastResult && (
        <Alert
          style={{ marginBottom: 16 }}
          type={lastResult.applied ? "success" : "info"}
          showIcon
          closable
          title={lastResult.applied ? "Redirect applied" : "Policy evaluated, no redirect applied"}
          description={
            <div>
              {lastResult.message && <div>{lastResult.message}</div>}
              {lastResult.target_backend && <div>Target: {lastResult.target_backend}{lastResult.ttl_seconds ? ` for ${lastResult.ttl_seconds}s` : ""}</div>}
              {lastResult.metric && <div>{lastResult.metric}: average {lastResult.metric_average ?? "n/a"}{lastResult.violation === undefined ? "" : lastResult.violation ? " (violated)" : " (within threshold)"}</div>}
              {lastResult.details?.map((d) => <div key={d} style={{ opacity: 0.75 }}>{d}</div>)}
            </div>
          }
        />
      )}
      {(probe || probeError) && (
        <Alert
          style={{ marginBottom: 16 }}
          type={probeError ? "error" : probe?.result.winnerLabelPresent ? "success" : "warning"}
          showIcon
          closable
          onClose={clearProbe}
          title={probeError ? "Probe failed" : `Probe of ${probe?.policy}: answered by ${probe?.result.service}`}
          description={
            probeError ? probeError : probe && (
              <Descriptions
                size="small"
                column={1}
                items={[
                  { key: "pod", label: "Pod", children: probe.result.pod || "unknown" },
                  { key: "node", label: "Node", children: probe.result.node || "unknown" },
                  { key: "win", label: `Winner label ${probe.result.winnerLabel}`, children: probe.result.winnerLabelPresent ? "present on this pod" : "not on this pod" },
                ]}
              />
            )
          }
        />
      )}

      {policies.isError && !policies.data ? (
        <ErrorState error={policies.error} onRetry={() => policies.refetch()} />
      ) : (
        <Section
          title="Policies"
          extra={
            <Space>
              <Input.Search allowClear placeholder="Search policies" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 220 }} />
              <Button icon={<ReloadOutlined />} loading={policies.isFetching} onClick={() => policies.refetch()}>Reload</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => open("create", null)}>New policy</Button>
            </Space>
          }
        >
          <Table
            size="middle"
            rowKey={(p) => p.policy_name ?? p.id ?? ""}
            loading={policies.isLoading}
            columns={columns}
            dataSource={rows}
            onRow={(p) => ({ onClick: () => open("view", p), style: { cursor: "pointer" } })}
            pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
            locale={{ emptyText: policies.data?.length ? "No policies match" : "No policies yet. Create one to redirect traffic when a metric degrades." }}
          />
        </Section>
      )}

      <PolicyDrawer open={drawer.open} mode={drawer.mode} policy={drawer.policy} onMode={(mode) => setDrawer((d) => ({ ...d, mode }))} onClose={() => setDrawer((d) => ({ ...d, open: false }))} />
    </>
  );
}

const eventColumns: TableColumnsType<RedirectionEvent> = [
  { title: "Time", key: "time", width: 170, render: (_, e) => { const t = e.occurred_at ?? e.createdAt; return t ? new Date(t).toLocaleString() : "—"; } },
  { title: "Policy", dataIndex: "policy_name" },
  { title: "Frontend", dataIndex: "frontend_service", render: (v?: string) => v ?? "—" },
  { title: "Planned backend", key: "planned", render: (_, e) => e.planned_backend_service ?? e.planned_backend_label ?? "—" },
  { title: "Final backend", key: "final", render: (_, e) => e.final_backend_service ?? e.final_backend_label ?? e.accepted_service ?? "—" },
  { title: "Violation", dataIndex: "violation_triggered", render: (v: boolean) => (v ? <Tag color="warning">triggered</Tag> : <span style={{ opacity: 0.6 }}>no</span>) },
  { title: "Status", dataIndex: "status", render: (s?: RedirectionEvent["status"]) => (s ? <StatusText tone={EVENT_TONE[s]} label={s} /> : "—") },
];

function HistoryTab() {
  const events = useRedirections();
  const rows = [...(events.data ?? [])].sort((a, b) => +new Date(b.occurred_at ?? b.createdAt ?? 0) - +new Date(a.occurred_at ?? a.createdAt ?? 0));
  if (events.isError && !events.data) return <ErrorState error={events.error} onRetry={() => events.refetch()} />;
  return (
    <Section title="Redirection history" extra={<Button icon={<ReloadOutlined />} loading={events.isFetching} onClick={() => events.refetch()}>Reload</Button>}>
      <Table
        size="middle"
        rowKey={(e) => e.id ?? `${e.policy_name}-${e.occurred_at ?? e.createdAt}`}
        loading={events.isLoading}
        columns={eventColumns}
        dataSource={rows}
        expandable={{ rowExpandable: (e) => Boolean(e.notes), expandedRowRender: (e) => e.notes }}
        pagination={{ pageSize: 15, hideOnSinglePage: true, showSizeChanger: false }}
        locale={{ emptyText: "No redirections recorded yet" }}
      />
    </Section>
  );
}

export function RoutingView() {
  return (
    <>
      <PageHeader title="Routing" note="Policies that redirect a service's traffic to a healthier backend when telemetry degrades" />
      <Tabs
        defaultActiveKey="policies"
        destroyOnHidden
        items={[
          { key: "policies", label: "Policies", children: <PoliciesTab /> },
          { key: "history", label: "Redirection history", children: <HistoryTab /> },
        ]}
      />
    </>
  );
}
