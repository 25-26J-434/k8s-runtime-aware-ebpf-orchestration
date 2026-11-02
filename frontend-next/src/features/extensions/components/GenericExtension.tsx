"use client";

import { useState } from "react";
import { Button, Form, Input, InputNumber, Select, Switch } from "antd";
import { Section } from "@/components/common/Section";
import { ErrorState, SkeletonRows } from "@/components/common/feedback";
import { useExtensionConfig, useSaveConfig } from "../hooks/use-extensions";
import type { ExtensionInfo, ExtensionInput } from "@/types/extensions";

function InputControl({ input, value, onChange }: { input: ExtensionInput; value: unknown; onChange: (v: unknown) => void }) {
  if (input.type === "boolean") return <Switch checked={Boolean(value)} onChange={onChange} />;
  if (input.type === "select") {
    const raw = String(value ?? input.default ?? "");
    const match = input.options?.find((o) => o.value.toLowerCase() === raw.toLowerCase());
    return <Select value={match?.value ?? input.options?.[0]?.value} onChange={onChange} options={input.options} />;
  }
  if (input.type === "number") return <InputNumber style={{ width: "100%" }} value={value == null ? null : Number(value)} onChange={(v) => onChange(v ?? undefined)} />;
  return <Input value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value)} />;
}

function GenericForm({ ext, initial }: { ext: ExtensionInfo; initial: Record<string, unknown> }) {
  const save = useSaveConfig(ext.name);
  const [draft, setDraft] = useState<Record<string, unknown>>(initial);
  const inputs = ext.inputs ?? [];

  const valueOf = (i: ExtensionInput) => draft[i.key] ?? i.default;
  const isEmpty = (v: unknown) => v === undefined || v === null || v === "";
  const missing = inputs.some((i) => i.required && isEmpty(valueOf(i)));

  const submit = () => {
    const config: Record<string, unknown> = {};
    inputs.forEach((i) => { config[i.key] = valueOf(i); });
    save.mutate({ config, message: "Extension settings saved" });
  };

  return (
    <Section title="Settings">
      <Form layout="vertical" style={{ maxWidth: 520 }} onFinish={submit}>
        {inputs.map((i) => (
          <Form.Item key={i.key} label={i.label} required={i.required}>
            <InputControl input={i} value={valueOf(i)} onChange={(v) => setDraft((d) => ({ ...d, [i.key]: v }))} />
          </Form.Item>
        ))}
        <Button type="primary" htmlType="submit" loading={save.isPending} disabled={missing}>Save</Button>
      </Form>
    </Section>
  );
}

/** Renders a form straight from the extension's own `inputs` metadata. */
export function GenericExtension({ ext }: { ext: ExtensionInfo }) {
  const { data, isLoading, error, refetch } = useExtensionConfig(ext.name);

  if (isLoading) return <SkeletonRows rows={4} />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if ((ext.inputs ?? []).length === 0) return <Section title={ext.label || ext.name}>This extension has no settings.</Section>;

  // Re-key on saved data so the form restarts from what the daemon holds after a save.
  return <GenericForm key={JSON.stringify(data ?? {})} ext={ext} initial={data ?? {}} />;
}
