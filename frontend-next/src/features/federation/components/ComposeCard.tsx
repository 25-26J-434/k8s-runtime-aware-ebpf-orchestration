"use client";

import { useMemo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Form, Input, Segmented, Select } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { monoFamily } from "@/lib/theme/tokens";
import { EVENT_TYPES } from "@/types/federation";
import { useClusterTopology, useSendMessage, type SendMode } from "../hooks/use-federation";

const schema = z
  .object({
    mode: z.enum(["broadcast", "unicast", "multicast"]),
    event: z.enum(EVENT_TYPES),
    targets: z.array(z.string()),
    payload: z.string().superRefine((v, ctx) => {
      try {
        const parsed: unknown = JSON.parse(v || "{}");
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          ctx.addIssue({ code: "custom", message: "Payload must be a JSON object" });
        }
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid JSON" });
      }
    }),
  })
  .refine((v) => v.mode === "broadcast" || v.targets.length > 0, { path: ["targets"], message: "Choose at least one target" })
  .refine((v) => v.mode !== "unicast" || v.targets.length === 1, { path: ["targets"], message: "Unicast takes exactly one target" });

type FormValues = z.infer<typeof schema>;

const EMPTY_PAYLOAD = '{\n  "message": ""\n}';

export function ComposeCard() {
  const topology = useClusterTopology();
  const send = useSendMessage();

  const targets = useMemo(
    () => (topology.data?.nodes ?? []).filter((n) => n.ip).map((n) => ({ value: n.ip as string, label: `${n.name} (${n.ip})` })),
    [topology.data],
  );

  const { control, handleSubmit, setValue, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { mode: "broadcast", event: "STATE_UPDATE", targets: [], payload: EMPTY_PAYLOAD },
  });
  const mode = useWatch({ control, name: "mode" });

  const onSubmit = handleSubmit((v) =>
    send.mutate(
      { mode: v.mode as SendMode, targets: v.targets, message: { event: v.event, payload: JSON.parse(v.payload || "{}") as Record<string, unknown>, action: "NONE" } },
      { onSuccess: () => reset({ ...v, payload: EMPTY_PAYLOAD }) },
    ),
  );

  return (
    <Form layout="vertical" onFinish={onSubmit}>
      <Form.Item label="Delivery">
        <Controller
          control={control}
          name="mode"
          render={({ field }) => (
            <Segmented
              block
              value={field.value}
              options={[{ value: "broadcast", label: "Broadcast" }, { value: "unicast", label: "Unicast" }, { value: "multicast", label: "Multicast" }]}
              onChange={(v) => {
                field.onChange(v);
                setValue("targets", []);
              }}
            />
          )}
        />
      </Form.Item>
      <Form.Item label="Event type">
        <Controller control={control} name="event" render={({ field }) => <Select {...field} options={EVENT_TYPES.map((e) => ({ value: e, label: e }))} />} />
      </Form.Item>
      {mode !== "broadcast" && (
        <Controller
          control={control}
          name="targets"
          render={({ field, fieldState }) => (
            <Form.Item label="Target nodes" validateStatus={fieldState.error ? "error" : undefined} help={fieldState.error?.message ?? (topology.isError ? "Could not load nodes" : undefined)}>
              <Select
                mode={mode === "multicast" ? "multiple" : undefined}
                loading={topology.isLoading}
                options={targets}
                value={mode === "multicast" ? field.value : (field.value[0] ?? undefined)}
                onChange={(v: string | string[]) => field.onChange(Array.isArray(v) ? v : v ? [v] : [])}
                placeholder="Select node"
              />
            </Form.Item>
          )}
        />
      )}
      <Controller
        control={control}
        name="payload"
        render={({ field, fieldState }) => (
          <Form.Item label="Payload (JSON)" validateStatus={fieldState.error ? "error" : undefined} help={fieldState.error?.message}>
            <Input.TextArea {...field} rows={5} style={{ fontFamily: monoFamily, fontSize: 13 }} />
          </Form.Item>
        )}
      />
      <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={send.isPending} block>
        Send
      </Button>
    </Form>
  );
}
