"use client";

import { useCallback, useMemo, useState } from "react";
import { Button, Col, Descriptions, Input, Popconfirm, Row, Segmented, Select, Space, Switch, Table } from "antd";
import type { TableColumnsType } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/common/PageHeader";
import { Section } from "@/components/common/Section";
import { StatStrip } from "@/components/common/StatStrip";
import { ErrorState } from "@/components/common/feedback";
import { StatusText } from "@/components/common/StatusText";
import { formatMetricValue, formatThreshold, METRICS } from "../lib/metrics";
import { useLatestRuleMetrics, useRuleDeployments, useRuleMutations, useRules, useTriggerNodes } from "../hooks/use-scaling";
import { PlacementPanel } from "./PlacementPanel";
import { RuleDrawer } from "./RuleDrawer";
import type { ScalingRule } from "@/types/scaling";

type StatusFilter = "all" | "enabled" | "disabled";

const NODE_KEY = "scaling-trigger-node";
const readStoredNode = () => {
  try {
    return localStorage.getItem(NODE_KEY) ?? "";
  } catch {
    return "";
  }
};

export function ScalingView() {
  const nodes = useTriggerNodes();
  const [chosenNode, setChosenNode] = useState(readStoredNode);
  // The stored node may no longer exist; fall back to the first one.
  const node = nodes.data?.some((n) => n.name === chosenNode) ? chosenNode : nodes.data?.[0]?.name;

  const rules = useRules(node);
  const deployments = useRuleDeployments(node);
  const latest = useLatestRuleMetrics(node);
  const { toggle, remove } = useRuleMutations();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ open: boolean; rule: ScalingRule | null }>({ open: false, rule: null });
  const [formTarget, setFormTarget] = useState<{ namespace?: string; deployment?: string }>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const list = useMemo(() => rules.data ?? [], [rules.data]);
  const selected = list.find((r) => r._id === selectedId) ?? list[0];

  const depByKey = useMemo(() => new Map((deployments.data ?? []).map((d) => [`${d.namespace}/${d.name}`, d])), [deployments.data]);
  const latestByKey = useMemo(() => new Map((latest.data ?? []).map((m) => [`${m.namespace}/${m.deployment}/${m.metric}`, m])), [latest.data]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((r) => status === "all" || (status === "enabled" ? r.enabled : !r.enabled))
      .filter((r) => !q || `${r.namespace}/${r.deployment}`.toLowerCase().includes(q) || r.metric.includes(q));
  }, [list, query, status]);

  const summary = useMemo(() => {
    const enabled = list.filter((r) => r.enabled).length;
    const counts = new Map<string, number>();
    list.forEach((r) => counts.set(r.metric, (counts.get(r.metric) ?? 0) + 1));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as keyof typeof METRICS | undefined;
    return { total: list.length, enabled, disabled: list.length - enabled, top: top ? METRICS[top].label : "—" };
  }, [list]);

  const pickNode = (name: string) => {
    setChosenNode(name);
    try {
      localStorage.setItem(NODE_KEY, name);
    } catch {
      // storage unavailable: choice just won't persist
    }
  };

  const onTargetChange = useCallback((t: { namespace?: string; deployment?: string }) => setFormTarget(t), []);

  const columns: TableColumnsType<ScalingRule> = [
    {
      title: "Target",
      key: "target",
      sorter: (a, b) => `${a.namespace}/${a.deployment}`.localeCompare(`${b.namespace}/${b.deployment}`),
      render: (_, r) => (
        <div>
          <div>{r.deployment}</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>{r.namespace}</div>
        </div>
      ),
    },
    { title: "Condition", key: "cond", render: (_, r) => `${METRICS[r.metric].label} ${r.operator} ${formatThreshold(r.metric, r.threshold)}` },
    { title: "Action", key: "action", render: (_, r) => (r.action === "scale_down" ? "Scale down" : "Scale up") },
    { title: "Step", dataIndex: "step", align: "right" },
    { title: "Replicas", key: "rep", align: "right", render: (_, r) => `${r.minReplicas}–${r.maxReplicas}` },
    {
      title: "Enabled",
      key: "enabled",
      render: (_, r) => (
        <Switch size="small" checked={r.enabled} onClick={(_c, e) => e.stopPropagation()} onChange={(enabled) => toggle.mutate({ id: r._id, enabled })} />
      ),
    },
    {
      title: "",
      key: "ops",
      align: "right",
      render: (_, r) => (
        <Space size={4} onClick={(e) => e.stopPropagation()}>
          <Button size="small" icon={<EditOutlined />} onClick={() => setDrawer({ open: true, rule: r })} aria-label="Edit rule" />
          <Popconfirm title="Delete this rule?" description="The deployment will stop scaling on this condition." okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate(r._id)}>
            <Button size="small" danger icon={<DeleteOutlined />} aria-label="Delete rule" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // Detail of the selected rule, reproducing the legacy "last action" staleness check.
  const detail = (() => {
    if (!selected) return null;
    const dep = depByKey.get(`${selected.namespace}/${selected.deployment}`);
    const lat = latestByKey.get(`${selected.namespace}/${selected.deployment}/${selected.metric}`);
    const value = selected.enabled ? (lat?.value ?? selected.lastValue) : undefined;
    const hasAction = selected.enabled && selected.lastAction && selected.lastAction !== "noop" && selected.lastActionAt;
    const stale = hasAction && dep && selected.lastTo !== undefined && dep.replicas !== selected.lastTo;
    const lastAction = hasAction && !stale
      ? `${selected.lastAction}${selected.lastFrom !== undefined && selected.lastTo !== undefined ? ` (${selected.lastFrom} → ${selected.lastTo})` : ""} · ${new Date(selected.lastActionAt as string).toLocaleString()}`
      : "—";
    return { dep, value, lastAction };
  })();

  const placementTarget = drawer.open ? formTarget : { namespace: selected?.namespace, deployment: selected?.deployment };

  return (
    <>
      <PageHeader
        title="Scaling"
        note="Rules that resize a deployment when a telemetry metric crosses a threshold"
        extra={
          <>
            <Select
              value={node}
              onChange={pickNode}
              loading={nodes.isLoading}
              style={{ minWidth: 220 }}
              placeholder="Trigger node"
              options={(nodes.data ?? []).map((n) => ({ value: n.name, label: n.ip ? `${n.name} (${n.ip})` : n.name }))}
              aria-label="Trigger node"
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer({ open: true, rule: null })}>New rule</Button>
          </>
        }
      />

      {rules.isError && !rules.data ? (
        <ErrorState error={rules.error} onRetry={() => rules.refetch()} />
      ) : (
        <>
          <StatStrip
            loading={rules.isLoading}
            stats={[
              { label: "Rules", value: String(summary.total) },
              { label: "Enabled", value: String(summary.enabled), tone: summary.enabled ? "success" : undefined },
              { label: "Disabled", value: String(summary.disabled) },
              { label: "Most used metric", value: summary.top },
            ]}
          />
          <div style={{ height: 24 }} />

          <Section
            title="Rules"
            extra={
              <Space>
                <Input.Search allowClear placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 200 }} />
                <Segmented value={status} onChange={(v) => setStatus(v as StatusFilter)} options={[{ value: "all", label: "All" }, { value: "enabled", label: "Enabled" }, { value: "disabled", label: "Disabled" }]} />
              </Space>
            }
          >
            <Table
              size="middle"
              rowKey="_id"
              loading={rules.isLoading}
              columns={columns}
              dataSource={rows}
              onRow={(r) => ({ onClick: () => setSelectedId(r._id), style: { cursor: "pointer", opacity: r.enabled ? 1 : 0.6 } })}
              rowClassName={(r) => (r._id === selected?._id ? "ant-table-row-selected" : "")}
              pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
              locale={{ emptyText: list.length ? "No rules match the filters" : "No rules yet. Create one to start scaling on telemetry." }}
            />
          </Section>

          <Row gutter={24}>
            <Col xs={24} xl={10}>
              <Section title="Selected rule">
                {detail && selected ? (
                  <Descriptions
                    column={1}
                    size="small"
                    items={[
                      { key: "t", label: "Target", children: `${selected.namespace}/${selected.deployment}` },
                      { key: "s", label: "State", children: <StatusText tone={selected.enabled ? "success" : "neutral"} label={selected.enabled ? "Enabled" : "Disabled"} /> },
                      { key: "v", label: "Latest value", children: `${formatMetricValue(selected.metric, detail.value)} (${METRICS[selected.metric].label})` },
                      { key: "r", label: "Current replicas", children: detail.dep ? `${detail.dep.availableReplicas ?? 0} available of ${detail.dep.replicas}` : "—" },
                      { key: "l", label: "Last scaling action", children: detail.lastAction },
                    ]}
                  />
                ) : (
                  <span style={{ opacity: 0.6 }}>No rule selected.</span>
                )}
              </Section>
            </Col>
            <Col xs={24} xl={14}>
              <Section title="Pod placement">
                <PlacementPanel namespace={placementTarget.namespace} deployment={placementTarget.deployment} observedNode={node} />
              </Section>
            </Col>
          </Row>
        </>
      )}

      <RuleDrawer open={drawer.open} rule={drawer.rule} node={node} onClose={() => setDrawer({ open: false, rule: null })} onTargetChange={onTargetChange} />
    </>
  );
}
