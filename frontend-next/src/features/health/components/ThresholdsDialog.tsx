"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, InputNumber, Modal } from "antd";
import { ErrorState, SkeletonRows } from "@/components/common/feedback";
import { useMetricsConfig, useSaveMetricsConfig } from "../hooks/use-health-actions";
import type { MetricsConfig } from "@/types/health";

const positive = z.coerce.number({ error: "Enter a number" }).positive("Must be greater than 0");

const schema = z.object({
  dns_latency_threshold: positive,
  tcp_retrans_threshold: positive,
  packet_loss_threshold: positive,
  rtt_threshold: positive,
  restart_count_threshold: positive,
});

const FIELDS: { name: keyof MetricsConfig; label: string; unit: string }[] = [
  { name: "dns_latency_threshold", label: "DNS latency", unit: "ms" },
  { name: "rtt_threshold", label: "RTT", unit: "ms" },
  { name: "tcp_retrans_threshold", label: "TCP retransmissions", unit: "count" },
  { name: "packet_loss_threshold", label: "Packet loss", unit: "count" },
  { name: "restart_count_threshold", label: "Pod restarts", unit: "count" },
];

export function ThresholdsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useMetricsConfig(open);
  const save = useSaveMetricsConfig();
  const { control, handleSubmit, reset, formState } = useForm<MetricsConfig>({ resolver: zodResolver(schema) as never });

  useEffect(() => {
    if (data) reset(data);
  }, [data, reset]);

  const submit = handleSubmit((values) => save.mutate(values, { onSuccess: onClose }));

  return (
    <Modal
      open={open}
      title="Health thresholds"
      onCancel={onClose}
      onOk={submit}
      okText="Save"
      okButtonProps={{ disabled: !data || !formState.isDirty, loading: save.isPending }}
      width={420}
      destroyOnHidden
    >
      {isLoading ? (
        <SkeletonRows rows={5} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <Form layout="horizontal" labelCol={{ span: 11 }} wrapperCol={{ span: 13 }} style={{ marginTop: 12 }} onFinish={submit}>
          {FIELDS.map((f) => (
            <Controller
              key={f.name}
              control={control}
              name={f.name}
              render={({ field, fieldState }) => (
                <Form.Item label={f.label} validateStatus={fieldState.error ? "error" : undefined} help={fieldState.error?.message}>
                  <InputNumber {...field} value={field.value ?? null} onChange={(v) => field.onChange(v)} min={0} addonAfter={f.unit} style={{ width: "100%" }} />
                </Form.Item>
              )}
            />
          ))}
        </Form>
      )}
    </Modal>
  );
}
