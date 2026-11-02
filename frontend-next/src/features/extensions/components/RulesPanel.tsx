"use client";

import { useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Form, InputNumber, Modal, Popconfirm, Select, Space, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Section } from "@/components/common/Section";
import { useMetricsStore } from "@/features/dashboard/hooks/metrics-store";
import { StatusText } from "@/components/common/StatusText";
import { genId, metricLabel, RULE_LEVELS, RULE_METRICS } from "../lib/notification";
import { ruleUnit, ruleValues, type RuleValue } from "../lib/rule-values";
import type { NotificationConfig, ThresholdRow } from "@/types/extensions";

const schema = z.object({
  metric_type: z.string().min(1),
  level: z.string().min(1),
  threshold_value: z.number({ error: "Enter a number" }).gt(0, "Must be greater than 0"),
  node_name: z.string(),
  pod_name: z.string(),
});
type RuleForm = z.infer<typeof schema>;

const EMPTY: RuleForm = { metric_type: "dns_latency", level: "pod", threshold_value: 100, node_name: "", pod_name: "" };

function RuleModal({ open, row, onClose, onSave }: { open: boolean; row: ThresholdRow | null; onClose: () => void; onSave: (v: RuleForm) => void }) {
  const { control, handleSubmit, reset, setValue } = useForm<RuleForm>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  useEffect(() => {
    if (open) reset(row ? { metric_type: row.metric_type, level: row.level, threshold_value: row.threshold_value, node_name: row.node_name ?? "", pod_name: row.pod_name ?? "" } : EMPTY);
  }, [open, row, reset]);

  const level = useWatch({ control, name: "level" });
  const nodeName = useWatch({ control, name: "node_name" });

  // Node and pod choices come from the live metrics stream (same source the dashboard uses).
  const nodes = useMetricsStore((s) => s.nodes);
  const nodeOptions = useMemo(() => Object.entries(nodes).map(([key, n]) => ({ value: n.node_name ?? key, label: n.node_name ?? key })), [nodes]);
  const podOptions = useMemo(() => {
    const entry = Object.entries(nodes).find(([key, n]) => (n.node_name ?? key) === nodeName)?.[1];
    return Object.keys(entry?.pods ?? {}).map((k) => ({ value: k, label: k }));
  }, [nodes, nodeName]);

  return (
    <Modal open={open} title={row ? "Edit alert rule" : "Add alert rule"} okText={row ? "Save" : "Add"} onOk={handleSubmit(onSave)} onCancel={onClose} destroyOnHidden width={500}>
      <Form layout="vertical" style={{ marginTop: 12 }} onFinish={handleSubmit(onSave)}>
        <Controller control={control} name="metric_type" render={({ field }) => <Form.Item label="Metric"><Select {...field} options={RULE_METRICS} /></Form.Item>} />
        <Controller control={control} name="level" render={({ field }) => <Form.Item label="Applies to"><Select {...field} options={RULE_LEVELS} /></Form.Item>} />
        <Controller control={control} name="threshold_value" render={({ field, fieldState }) => (
          <Form.Item label="Alert when above" validateStatus={fieldState.error ? "error" : undefined} help={fieldState.error?.message}>
            <InputNumber {...field} min={0} style={{ width: "100%" }} />
          </Form.Item>
        )} />
        <Controller control={control} name="node_name" render={({ field }) => (
          <Form.Item label="Node"><Select value={field.value} onChange={(v) => { field.onChange(v); setValue("pod_name", ""); }} options={[{ value: "", label: "Any node (cluster-wide)" }, ...nodeOptions]} /></Form.Item>
        )} />
        {level !== "node" && (
          <Controller control={control} name="pod_name" render={({ field }) => (
            <Form.Item label="Pod" extra={nodeName ? undefined : "Choose a node to limit this rule to one of its pods"}>
              <Select {...field} showSearch disabled={!nodeName} options={[{ value: "", label: "All pods" }, ...podOptions]} />
            </Form.Item>
          )} />
        )}
      </Form>
    </Modal>
  );
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

/** Live readings behind one rule, so a threshold can be judged against what the cluster is doing now. */
function LiveValues({ rule }: { rule: ThresholdRow }) {
  const nodes = useMetricsStore((s) => s.nodes);
  const rows = useMemo(() => ruleValues(rule, nodes), [rule, nodes]);
  const unit = ruleUnit(rule.metric_type);
  const columns: TableColumnsType<RuleValue> = [
    { title: "Level", dataIndex: "level", width: 100 },
    { title: "Node", dataIndex: "node", width: 160 },
    { title: "Source", dataIndex: "source", ellipsis: true },
    { title: `Now (${unit})`, dataIndex: "value", align: "right", width: 130, render: fmt },
    { title: "Status", key: "s", width: 150, render: (_, r) => <StatusText tone={r.value >= rule.threshold_value ? "critical" : "success"} label={r.value >= rule.threshold_value ? "Above threshold" : "OK"} /> },
  ];
  if (rows.length === 0) return <Typography.Text type="secondary">No readings yet for this metric. They appear as telemetry arrives.</Typography.Text>;
  return <Table size="small" rowKey="key" columns={columns} dataSource={rows} pagination={rows.length > 8 ? { pageSize: 8, size: "small" } : false} />;
}

function worst(rule: ThresholdRow, nodes: ReturnType<typeof useMetricsStore.getState>["nodes"]) {
  const rows = ruleValues(rule, nodes);
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => (b.value > a.value ? b : a));
}

function NowCell({ rule }: { rule: ThresholdRow }) {
  const nodes = useMetricsStore((s) => s.nodes);
  const w = useMemo(() => worst(rule, nodes), [rule, nodes]);
  if (!w) return <Typography.Text type="secondary">No data</Typography.Text>;
  const over = w.value >= rule.threshold_value;
  return <StatusText tone={over ? "critical" : "success"} label={`${fmt(w.value)} ${w.unit}`} />;
}

export function RulesPanel({ config, onSave }: { config: NotificationConfig; onSave: (next: NotificationConfig, message: string) => void }) {
  const [modal, setModal] = useState<{ open: boolean; row: ThresholdRow | null }>({ open: false, row: null });

  const columns: TableColumnsType<ThresholdRow> = [
    { title: "Metric", dataIndex: "metric_type", render: (m: string) => metricLabel(m) },
    { title: "Applies to", dataIndex: "level", render: (l: string) => RULE_LEVELS.find((x) => x.value === l)?.label.split(" (")[0] ?? l },
    { title: "Alert above", dataIndex: "threshold_value", align: "right" },
    { title: "Highest now", key: "now", render: (_, r) => <NowCell rule={r} /> },
    { title: "Node", dataIndex: "node_name", render: (v?: string) => v || "Any" },
    { title: "Pod", dataIndex: "pod_name", ellipsis: true, render: (v?: string) => v || "All" },
    {
      title: "",
      key: "ops",
      align: "right",
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => setModal({ open: true, row: r })} aria-label="Edit rule" />
          <Popconfirm title="Delete this rule?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => onSave({ ...config, thresholds: config.thresholds.filter((t) => t.id !== r.id) }, "Alert rule deleted")}>
            <Button size="small" danger icon={<DeleteOutlined />} aria-label="Delete rule" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const save = (v: RuleForm) => {
    const next = modal.row
      ? config.thresholds.map((t) => (t.id === modal.row?.id ? { ...t, ...v } : t))
      : [...config.thresholds, { id: genId(), ...v }];
    onSave({ ...config, thresholds: next }, `Alert rule ${modal.row ? "updated" : "added"}`);
    setModal({ open: false, row: null });
  };

  return (
    <>
      <Section title="Alert rules" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setModal({ open: true, row: null })}>Add rule</Button>}>
        <Table size="middle" rowKey="id" columns={columns} dataSource={config.thresholds} pagination={false} locale={{ emptyText: "No alert rules yet" }} expandable={{ expandedRowRender: (r) => <LiveValues rule={r} /> }} />
      </Section>
      <RuleModal open={modal.open} row={modal.row} onClose={() => setModal({ open: false, row: null })} onSave={save} />
    </>
  );
}
