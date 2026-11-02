"use client";

import { useMemo } from "react";
import { Controller, useForm, useWatch, type Control, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AutoComplete, Col, Form, Input, Row, Segmented, Select } from "antd";
import { backendPortFor, DEFAULT_FORM, METRIC_OPTIONS, namespacesOf, selectorOf, servicesIn, type PolicyFormValues } from "../lib/policy";
import type { ClusterSummary } from "@/types/routing";

/** The drawer footer submits this form by id, so its buttons stay visible while the form scrolls. */
export const FORM_ID = "policy-form";

const REQUIRED: (keyof PolicyFormValues)[] = [
  "policy_name",
  "namespace",
  "frontend_service",
  "frontend_port",
  "telemetry_metric",
  "telemetry_violation_threshold",
  "action_backend_selector",
  "action_backend_port",
  "action_protocol",
  "action_ttl_seconds",
];
const NUMERIC: (keyof PolicyFormValues)[] = ["frontend_port", "telemetry_violation_threshold", "action_backend_port", "action_ttl_seconds"];

const str = z.string();

/** Create requires every core field; edit only validates what was filled in (untouched fields are not sent). */
function makeSchema(mode: "create" | "edit") {
  return z
    .object(Object.fromEntries((Object.keys(DEFAULT_FORM) as (keyof PolicyFormValues)[]).map((k) => [k, str])) as Record<keyof PolicyFormValues, typeof str>)
    .superRefine((v, ctx) => {
      if (mode === "create") {
        for (const k of REQUIRED) if (!v[k].trim()) ctx.addIssue({ code: "custom", path: [k], message: "Required" });
      }
      for (const k of NUMERIC) {
        const raw = v[k].trim();
        if (raw && !(Number.isFinite(Number(raw)) && Number(raw) > 0)) ctx.addIssue({ code: "custom", path: [k], message: "Enter a number greater than 0" });
      }
    });
}

interface FieldProps {
  control: Control<PolicyFormValues>;
  name: FieldPath<PolicyFormValues>;
  label: string;
  extra?: string;
  children: (field: { value: string; onChange: (v: string) => void }) => React.ReactNode;
}

function Field({ control, name, label, extra, children }: FieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Form.Item label={label} extra={extra} validateStatus={fieldState.error ? "error" : undefined} help={fieldState.error?.message}>
          {children({ value: field.value ?? "", onChange: field.onChange })}
        </Form.Item>
      )}
    />
  );
}

interface Props {
  mode: "create" | "edit";
  initial: PolicyFormValues;
  summary: ClusterSummary | null;
  summaryLoading: boolean;
  onSubmit: (v: PolicyFormValues) => void;
}

export function PolicyForm({ mode, initial, summary, summaryLoading, onSubmit }: Props) {
  const schema = useMemo(() => makeSchema(mode), [mode]);
  const { control, handleSubmit, setValue, getValues } = useForm<PolicyFormValues>({ resolver: zodResolver(schema) as never, defaultValues: initial });

  const namespace = useWatch({ control, name: "namespace" });
  const strategy = useWatch({ control, name: "action_strategy" });

  const namespaces = useMemo(() => namespacesOf(summary).map((n) => ({ value: n, label: n })), [summary]);
  const services = useMemo(() => servicesIn(summary, namespace), [summary, namespace]);
  const selectors = useMemo(() => {
    const set = new Set<string>();
    services.forEach((s) => {
      const sel = selectorOf(s);
      if (sel) set.add(sel);
    });
    (summary?.pods ?? []).filter((p) => p.namespace === namespace && p.labels?.app).forEach((p) => set.add(`app=${p.labels?.app}`));
    return [...set].map((value) => ({ value }));
  }, [services, summary, namespace]);

  const chooseSelector = (sel: string) => {
    if (!getValues("action_backend_port")) setValue("action_backend_port", backendPortFor(summary, namespace, sel), { shouldDirty: true });
  };

  return (
    <Form id={FORM_ID} layout="vertical" onFinish={handleSubmit(onSubmit)}>
      <Row gutter={16}>
        <Col span={24}>
          <Field control={control} name="policy_name" label="Policy name">
            {(f) => <Input value={f.value} onChange={(e) => f.onChange(e.target.value)} disabled={mode === "edit"} />}
          </Field>
        </Col>
        <Col span={12}>
          <Field control={control} name="namespace" label="Namespace">
            {(f) => (
              <Select
                showSearch
                loading={summaryLoading}
                value={f.value || undefined}
                options={namespaces}
                onChange={(v) => {
                  f.onChange(v);
                  setValue("action_target_namespace", v);
                }}
                notFoundContent="No namespaces found"
              />
            )}
          </Field>
        </Col>
        <Col span={12}>
          <Field control={control} name="scope" label="Scope">
            {(f) => <Segmented block value={f.value} onChange={(v) => f.onChange(String(v))} options={[{ value: "local", label: "Local" }, { value: "cluster", label: "Cluster" }]} />}
          </Field>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={16}>
          <Field control={control} name="frontend_service" label="Frontend service" extra="The service whose traffic is redirected">
            {(f) => (
              <AutoComplete
                value={f.value}
                options={services.map((s) => ({ value: s.name }))}
                onChange={(v) => {
                  f.onChange(v);
                  setValue("telemetry_monitor", v);
                }}
                placeholder="service name"
              />
            )}
          </Field>
        </Col>
        <Col span={8}>
          <Field control={control} name="frontend_port" label="Port">
            {(f) => <Input value={f.value} onChange={(e) => f.onChange(e.target.value)} inputMode="numeric" />}
          </Field>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Field control={control} name="telemetry_metric" label="Telemetry metric">
            {(f) => <Select value={f.value || undefined} onChange={f.onChange} options={METRIC_OPTIONS.map((m) => ({ value: m, label: m }))} />}
          </Field>
        </Col>
        <Col span={12}>
          <Field control={control} name="telemetry_violation_threshold" label="Violation threshold" extra="A redirect is applied when the metric crosses this value">
            {(f) => <Input value={f.value} onChange={(e) => f.onChange(e.target.value)} inputMode="decimal" />}
          </Field>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Field control={control} name="action_strategy" label="Backend strategy">
            {(f) => <Select value={f.value || undefined} onChange={f.onChange} options={[{ value: "best_pod", label: "Best pod" }, { value: "all", label: "All backends" }]} />}
          </Field>
        </Col>
        <Col span={12}>
          <Field control={control} name="action_protocol" label="Protocol">
            {(f) => <Select value={f.value || undefined} onChange={f.onChange} options={[{ value: "TCP", label: "TCP" }, { value: "UDP", label: "UDP" }]} />}
          </Field>
        </Col>
        <Col span={16}>
          <Field control={control} name="action_backend_selector" label="Redirect backend selector" extra="Label selector of the backend, e.g. app=service-b">
            {(f) => (
              <AutoComplete
                value={f.value}
                options={selectors}
                onChange={f.onChange}
                onSelect={(v) => chooseSelector(String(v))}
                placeholder="key=value"
              />
            )}
          </Field>
        </Col>
        <Col span={8}>
          <Field control={control} name="action_backend_port" label="Backend port">
            {(f) => <Input value={f.value} onChange={(e) => f.onChange(e.target.value)} inputMode="numeric" />}
          </Field>
        </Col>
        {strategy === "best_pod" && (
          <Col span={24}>
            <Field control={control} name="action_backend_candidates_selector" label="Candidate pods selector" extra="Pods considered when choosing the best backend (optional)">
              {(f) => <AutoComplete value={f.value} options={selectors} onChange={f.onChange} placeholder="key=value" />}
            </Field>
          </Col>
        )}
        <Col span={12}>
          <Field control={control} name="action_ttl_seconds" label="Redirect lifetime (seconds)" extra="The redirect is removed after this long">
            {(f) => <Input value={f.value} onChange={(e) => f.onChange(e.target.value)} inputMode="numeric" />}
          </Field>
        </Col>
      </Row>

    </Form>
  );
}
