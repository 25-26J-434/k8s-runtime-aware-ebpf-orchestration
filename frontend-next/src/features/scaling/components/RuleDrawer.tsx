"use client";

import { useEffect } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Drawer, Form, InputNumber, Segmented, Select, Space, Switch, Typography } from "antd";
import { METRICS, METRIC_OPTIONS } from "../lib/metrics";
import { useRuleDeployments, useRuleMutations, useRuleNamespaces } from "../hooks/use-scaling";
import type { RuleInput, ScalingRule } from "@/types/scaling";

const int = (min: number, label: string) =>
  z.coerce.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`);

const schema = z
  .object({
    namespace: z.string().min(1, "Choose a namespace"),
    deployment: z.string().min(1, "Choose a deployment"),
    metric: z.enum(["dns_latency", "rtt", "tcp_retrans", "disk_read_latency", "disk_write_latency"]),
    operator: z.enum([">", "<"]),
    threshold: z.coerce.number({ error: "Enter a number" }).min(0, "Cannot be negative"),
    action: z.enum(["scale_up", "scale_down"]),
    step: int(1, "Step"),
    minReplicas: int(0, "Minimum"),
    maxReplicas: int(0, "Maximum"),
    enabled: z.boolean(),
  })
  .refine((v) => v.minReplicas <= v.maxReplicas, { path: ["minReplicas"], message: "Minimum must not exceed maximum" });

type FormValues = z.infer<typeof schema>;

const DEFAULTS: FormValues = {
  namespace: "default",
  deployment: "",
  metric: "dns_latency",
  operator: ">",
  threshold: 0,
  action: "scale_up",
  step: 1,
  minReplicas: 1,
  maxReplicas: 3,
  enabled: true,
};

interface Props {
  open: boolean;
  rule: ScalingRule | null;
  node?: string;
  onClose: () => void;
  onTargetChange: (t: { namespace?: string; deployment?: string }) => void;
}

export function RuleDrawer({ open, rule, node, onClose, onTargetChange }: Props) {
  const { create, update } = useRuleMutations();
  const { control, handleSubmit, reset, setValue } = useForm<FormValues>({ resolver: zodResolver(schema) as never, defaultValues: DEFAULTS });

  const namespace = useWatch({ control, name: "namespace" });
  const deployment = useWatch({ control, name: "deployment" });
  const metric = useWatch({ control, name: "metric" });

  const namespaces = useRuleNamespaces(node, open);
  const deployments = useRuleDeployments(node, namespace, open && Boolean(namespace));

  useEffect(() => {
    if (!open) return;
    reset(
      rule
        ? { namespace: rule.namespace, deployment: rule.deployment, metric: rule.metric, operator: rule.operator, threshold: rule.threshold, action: rule.action ?? "scale_up", step: rule.step, minReplicas: rule.minReplicas, maxReplicas: rule.maxReplicas, enabled: rule.enabled }
        : DEFAULTS,
    );
  }, [open, rule, reset]);

  useEffect(() => {
    if (open) onTargetChange({ namespace: namespace || undefined, deployment: deployment || undefined });
  }, [open, namespace, deployment, onTargetChange]);

  const saving = create.isPending || update.isPending;

  const submit = handleSubmit((v) => {
    const body: RuleInput = v;
    if (rule) update.mutate({ id: rule._id, rule: body }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  });

  const unit = METRICS[metric].unit;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={460}
      title={rule ? "Edit scaling rule" : "New scaling rule"}
      destroyOnHidden
      footer={
        <Space style={{ justifyContent: "flex-end", width: "100%" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={saving} onClick={submit}>{rule ? "Save changes" : "Create rule"}</Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={`Telemetry is read from ${node || "the selected node"}. New pods may still be placed on other nodes by the Kubernetes scheduler.`}
      />
      <Form layout="vertical" onFinish={submit}>
        <Controller
          control={control}
          name="namespace"
          render={({ field, fieldState }) => (
            <Form.Item label="Namespace" validateStatus={fieldState.error ? "error" : undefined} help={fieldState.error?.message}>
              <Select
                {...field}
                loading={namespaces.isLoading}
                options={(namespaces.data ?? []).map((n) => ({ value: n, label: n }))}
                onChange={(v) => { field.onChange(v); setValue("deployment", ""); }}
                notFoundContent={namespaces.isError ? "Could not load namespaces" : "No namespaces for this node"}
              />
            </Form.Item>
          )}
        />
        <Controller
          control={control}
          name="deployment"
          render={({ field, fieldState }) => (
            <Form.Item label="Deployment" validateStatus={fieldState.error ? "error" : undefined} help={fieldState.error?.message}>
              <Select
                {...field}
                showSearch
                loading={deployments.isLoading}
                options={(deployments.data ?? []).map((d) => ({ value: d.name, label: `${d.name} (${d.replicas} replicas)` }))}
                notFoundContent={deployments.isError ? "Could not load deployments" : "No deployments in this namespace"}
              />
            </Form.Item>
          )}
        />
        <Controller
          control={control}
          name="metric"
          render={({ field }) => (
            <Form.Item label="Metric" extra={METRICS[metric].hint}>
              <Select {...field} options={METRIC_OPTIONS} />
            </Form.Item>
          )}
        />
        <Space.Compact style={{ width: "100%", marginBottom: 24 }}>
          <Controller control={control} name="operator" render={({ field }) => <Select {...field} style={{ width: 120 }} options={[{ value: ">", label: "greater than" }, { value: "<", label: "less than" }]} />} />
          <Controller
            control={control}
            name="threshold"
            render={({ field, fieldState }) => (
              <div style={{ flex: 1 }}>
                <InputNumber {...field} min={0} style={{ width: "100%" }} addonAfter={unit} status={fieldState.error ? "error" : undefined} />
                {fieldState.error && <Typography.Text type="danger" style={{ fontSize: 13 }}>{fieldState.error.message}</Typography.Text>}
              </div>
            )}
          />
        </Space.Compact>
        <Controller
          control={control}
          name="action"
          render={({ field }) => (
            <Form.Item label="When triggered">
              <Segmented block {...field} options={[{ value: "scale_up", label: "Scale up" }, { value: "scale_down", label: "Scale down" }]} />
            </Form.Item>
          )}
        />
        <Space size={12} style={{ width: "100%" }} styles={{ item: { flex: 1 } }}>
          {([["step", "Step"], ["minReplicas", "Min replicas"], ["maxReplicas", "Max replicas"]] as const).map(([name, label]) => (
            <Controller
              key={name}
              control={control}
              name={name}
              render={({ field, fieldState }) => (
                <Form.Item label={label} validateStatus={fieldState.error ? "error" : undefined} help={fieldState.error?.message}>
                  <InputNumber {...field} min={name === "step" ? 1 : 0} precision={0} style={{ width: "100%" }} />
                </Form.Item>
              )}
            />
          ))}
        </Space>
        <Controller
          control={control}
          name="enabled"
          render={({ field }) => (
            <Form.Item label="Enabled">
              <Switch checked={field.value} onChange={field.onChange} />
            </Form.Item>
          )}
        />
      </Form>
    </Drawer>
  );
}
