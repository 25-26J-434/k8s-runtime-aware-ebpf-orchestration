"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Collapse, Drawer, Empty, Flex, Form, InputNumber, Tag, Typography } from "antd";
import { StatusText } from "@/components/common/StatusText";
import type { Tone } from "@/components/common/tone";
import { DEFAULT_THRESHOLDS, type Recommendation, type RecommendationThresholds, type Severity } from "../lib/recommendations";

const TONE: Record<Severity, Tone> = { high: "critical", medium: "warning", low: "info" };

const num = z.number({ error: "Enter a number" }).min(0, "Cannot be negative");
const schema = z.object({
  dns_latency_critical: num, dns_latency_high: num, dns_latency_medium: num,
  tcp_retrans_critical: num, tcp_retrans_high: num, tcp_retrans_medium: num,
  packet_loss_critical: num, packet_loss_high: num, packet_loss_medium: num,
  cpu_latency_critical: num, cpu_latency_high: num,
});

const GROUPS: { title: string; unit: string; fields: { name: keyof RecommendationThresholds; label: string }[] }[] = [
  { title: "DNS latency", unit: "µs", fields: [{ name: "dns_latency_medium", label: "Elevated above" }, { name: "dns_latency_high", label: "High above" }, { name: "dns_latency_critical", label: "Critical above" }] },
  { title: "TCP retransmissions", unit: "count", fields: [{ name: "tcp_retrans_medium", label: "Minor above" }, { name: "tcp_retrans_high", label: "Notable above" }, { name: "tcp_retrans_critical", label: "Excessive above" }] },
  { title: "Packet loss", unit: "count", fields: [{ name: "packet_loss_medium", label: "Minor above" }, { name: "packet_loss_high", label: "Notable above" }, { name: "packet_loss_critical", label: "Critical above" }] },
  { title: "CPU scheduling latency", unit: "µs", fields: [{ name: "cpu_latency_high", label: "Moderate above" }, { name: "cpu_latency_critical", label: "High above" }] },
];

function ThresholdForm({ thresholds, onSave }: { thresholds: RecommendationThresholds; onSave: (t: RecommendationThresholds) => void }) {
  const { control, handleSubmit, reset, formState } = useForm<RecommendationThresholds>({ resolver: zodResolver(schema), defaultValues: thresholds });
  useEffect(() => reset(thresholds), [thresholds, reset]);
  const submit = handleSubmit(onSave);

  return (
    <Form layout="horizontal" labelCol={{ span: 12 }} wrapperCol={{ span: 12 }} onFinish={submit}>
      {GROUPS.map((g) => (
        <div key={g.title} style={{ marginBottom: 12 }}>
          <Typography.Text strong>{g.title} <Typography.Text type="secondary" style={{ fontWeight: 400 }}>({g.unit})</Typography.Text></Typography.Text>
          {g.fields.map((f) => (
            <Controller key={f.name} control={control} name={f.name} render={({ field, fieldState }) => (
              <Form.Item label={f.label} style={{ marginBottom: 6, marginTop: 6 }} validateStatus={fieldState.error ? "error" : undefined} help={fieldState.error?.message}>
                <InputNumber {...field} min={0} style={{ width: "100%" }} />
              </Form.Item>
            )} />
          ))}
        </div>
      ))}
      <Flex gap={8}>
        <Button type="primary" htmlType="submit" disabled={!formState.isDirty}>Save thresholds</Button>
        <Button onClick={() => onSave(DEFAULT_THRESHOLDS)}>Reset to defaults</Button>
      </Flex>
    </Form>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  recommendations: Recommendation[];
  thresholds: RecommendationThresholds;
  onSaveThresholds: (t: RecommendationThresholds) => void;
  /** Jump to the pod on the graph. */
  onSelectPod: (r: Recommendation) => void;
}

const fmtUs = (us: number) => (us >= 1000 ? `${(us / 1000).toFixed(1)} ms` : `${Math.round(us)} µs`);

export function RecommendationsDrawer({ open, onClose, recommendations, thresholds, onSaveThresholds, onSelectPod }: Props) {
  return (
    <Drawer open={open} onClose={onClose} title="Pod recommendations" size={440} destroyOnHidden>
      <Collapse
        ghost
        defaultActiveKey={["findings"]}
        items={[
          {
            key: "findings",
            label: `Findings (${recommendations.length})`,
            children: recommendations.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No pod is over its thresholds" />
            ) : (
              <Flex vertical gap={12}>
                {recommendations.map((r) => (
                  <div key={r.key} style={{ borderLeft: "3px solid currentColor", paddingLeft: 12 }}>
                    <Flex justify="space-between" align="start" gap={8}>
                      <div style={{ minWidth: 0 }}>
                        <Typography.Text strong style={{ wordBreak: "break-all" }}>{r.pod}</Typography.Text>
                        <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.namespace}{r.node ? ` · ${r.node}` : ""}</Typography.Text></div>
                      </div>
                      <StatusText tone={TONE[r.severity]} label={r.severity} />
                    </Flex>
                    <div style={{ margin: "6px 0" }}>{r.issues.map((i) => <Tag key={i}>{i}</Tag>)}</div>
                    <Typography.Paragraph style={{ margin: "4px 0" }}><strong>{r.action}.</strong> {r.advice}</Typography.Paragraph>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      DNS {fmtUs(r.metrics.dnsUs)} · retrans {r.metrics.retrans} · loss {r.metrics.packetLoss} · CPU sched {fmtUs(r.metrics.cpuLatencyUs)}
                    </Typography.Text>
                    <div style={{ marginTop: 6 }}><Button size="small" onClick={() => onSelectPod(r)}>Show on graph</Button></div>
                  </div>
                ))}
              </Flex>
            ),
          },
          { key: "thresholds", label: "Thresholds", children: <ThresholdForm thresholds={thresholds} onSave={onSaveThresholds} /> },
        ]}
      />
    </Drawer>
  );
}
