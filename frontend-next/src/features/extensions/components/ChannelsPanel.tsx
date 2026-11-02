"use client";

import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Col, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Switch, Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Section } from "@/components/common/Section";
import { notify } from "@/lib/notify";
import { emailList, genId, isValidEmail, WEBHOOK_LABEL } from "../lib/notification";
import type { NotificationConfig, WebhookRow, WebhookType } from "@/types/extensions";

type Save = (next: NotificationConfig, message: string) => void;

const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host}/…${url.slice(-6)}`;
  } catch {
    return url ? `${url.slice(0, 18)}…` : "—";
  }
};

const webhookSchema = z.object({
  type: z.enum(["teams", "discord", "slack"]),
  url: z.string().trim().url("Enter a full URL, starting with https://").refine((v) => v.startsWith("https://"), "Webhook URLs must use https"),
});
type WebhookForm = z.infer<typeof webhookSchema>;

function WebhookModal({ open, row, onClose, onSave }: { open: boolean; row: WebhookRow | null; onClose: () => void; onSave: (v: WebhookForm) => void }) {
  const { control, handleSubmit, reset } = useForm<WebhookForm>({ resolver: zodResolver(webhookSchema), defaultValues: { type: "teams", url: "" } });
  useEffect(() => {
    if (open) reset(row ? { type: row.type, url: row.url } : { type: "teams", url: "" });
  }, [open, row, reset]);

  return (
    <Modal open={open} title={row ? "Edit channel" : "Add channel"} okText={row ? "Save" : "Add"} onOk={handleSubmit(onSave)} onCancel={onClose} destroyOnHidden width={480}>
      <Form layout="vertical" style={{ marginTop: 12 }} onFinish={handleSubmit(onSave)}>
        <Controller control={control} name="type" render={({ field }) => (
          <Form.Item label="Service"><Select {...field} options={(Object.keys(WEBHOOK_LABEL) as WebhookType[]).map((t) => ({ value: t, label: WEBHOOK_LABEL[t] }))} /></Form.Item>
        )} />
        <Controller control={control} name="url" render={({ field, fieldState }) => (
          <Form.Item label="Webhook URL" validateStatus={fieldState.error ? "error" : undefined} help={fieldState.error?.message}>
            <Input {...field} placeholder="https://" autoComplete="off" />
          </Form.Item>
        )} />
      </Form>
    </Modal>
  );
}

const emailSchema = z
  .object({
    email_enabled: z.boolean(),
    smtp_host: z.string().trim(),
    smtp_port: z.number().int().min(1).max(65535),
    smtp_use_tls: z.boolean(),
    smtp_username: z.string().trim(),
    smtp_password: z.string(),
    email_from: z.string().trim(),
    email_to: z.array(z.string()),
  })
  .superRefine((v, ctx) => {
    if (v.email_from && !isValidEmail(v.email_from)) ctx.addIssue({ code: "custom", path: ["email_from"], message: "Not a valid email address" });
    v.email_to.forEach((e) => { if (!isValidEmail(e)) ctx.addIssue({ code: "custom", path: ["email_to"], message: `"${e}" is not a valid email address` }); });
    if (v.email_enabled) {
      if (!v.smtp_host) ctx.addIssue({ code: "custom", path: ["smtp_host"], message: "Required when email is enabled" });
      if (!v.email_from) ctx.addIssue({ code: "custom", path: ["email_from"], message: "Required when email is enabled" });
      if (v.email_to.length === 0) ctx.addIssue({ code: "custom", path: ["email_to"], message: "Add at least one recipient" });
    }
  });
type EmailForm = z.infer<typeof emailSchema>;

function EmailForm({ config, saving, onSave }: { config: NotificationConfig; saving: boolean; onSave: Save }) {
  const toValues = (c: NotificationConfig): EmailForm => ({ email_enabled: c.email_enabled, smtp_host: c.smtp_host, smtp_port: c.smtp_port, smtp_use_tls: c.smtp_use_tls, smtp_username: c.smtp_username, smtp_password: c.smtp_password, email_from: c.email_from, email_to: emailList(c.email_to) });
  const { control, handleSubmit, reset, formState } = useForm<EmailForm>({ resolver: zodResolver(emailSchema), defaultValues: toValues(config) });
  useEffect(() => reset(toValues(config)), [config, reset]);

  const submit = handleSubmit((v) => onSave({ ...config, ...v, email_to: v.email_to.join(", ") }, "Email settings saved"));

  return (
    <Form layout="vertical" onFinish={submit}>
      <Controller control={control} name="email_enabled" render={({ field }) => (
        <Form.Item><Space><Switch checked={field.value} onChange={field.onChange} /><span>Send alerts by email</span></Space></Form.Item>
      )} />
      <Row gutter={16}>
        <Col xs={24} md={16}><Controller control={control} name="smtp_host" render={({ field, fieldState }) => (
          <Form.Item label="SMTP host" validateStatus={fieldState.error ? "error" : undefined} help={fieldState.error?.message}><Input {...field} placeholder="smtp.example.com" /></Form.Item>
        )} /></Col>
        <Col xs={24} md={8}><Controller control={control} name="smtp_port" render={({ field }) => (
          <Form.Item label="Port"><InputNumber {...field} min={1} max={65535} precision={0} style={{ width: "100%" }} /></Form.Item>
        )} /></Col>
        <Col xs={24} md={12}><Controller control={control} name="smtp_username" render={({ field }) => (
          <Form.Item label="Username"><Input {...field} autoComplete="off" /></Form.Item>
        )} /></Col>
        <Col xs={24} md={12}><Controller control={control} name="smtp_password" render={({ field }) => (
          <Form.Item label="Password"><Input.Password {...field} autoComplete="new-password" /></Form.Item>
        )} /></Col>
        <Col xs={24} md={12}><Controller control={control} name="email_from" render={({ field, fieldState }) => (
          <Form.Item label="From" validateStatus={fieldState.error ? "error" : undefined} help={fieldState.error?.message}><Input {...field} placeholder="alerts@example.com" /></Form.Item>
        )} /></Col>
        <Col xs={24} md={12}><Controller control={control} name="smtp_use_tls" render={({ field }) => (
          <Form.Item label="Use TLS"><Switch checked={field.value} onChange={field.onChange} /></Form.Item>
        )} /></Col>
      </Row>
      <Controller control={control} name="email_to" render={({ field, fieldState }) => (
        <Form.Item label="Recipients" validateStatus={fieldState.error ? "error" : undefined} help={fieldState.error?.message ?? "Press Enter after each address"}>
          <Select mode="tags" value={field.value} onChange={field.onChange} tokenSeparators={[",", ";", " "]} open={false} placeholder="name@example.com" />
        </Form.Item>
      )} />
      <Button type="primary" htmlType="submit" loading={saving} disabled={!formState.isDirty}>Save email settings</Button>
    </Form>
  );
}

export function ChannelsPanel({ config, saving, onSave }: { config: NotificationConfig; saving: boolean; onSave: Save }) {
  const [modal, setModal] = useState<{ open: boolean; row: WebhookRow | null }>({ open: false, row: null });

  const columns: TableColumnsType<WebhookRow> = [
    { title: "Service", dataIndex: "type", render: (t: WebhookType) => WEBHOOK_LABEL[t] },
    { title: "Webhook", dataIndex: "url", render: (u: string) => <Typography.Text type="secondary">{hostOf(u)}</Typography.Text> },
    { title: "Enabled", key: "on", render: (_, w) => <Switch size="small" checked={w.enabled} onChange={(enabled) => onSave({ ...config, webhooks: config.webhooks.map((x) => (x.id === w.id ? { ...x, enabled } : x)) }, `${WEBHOOK_LABEL[w.type]} ${enabled ? "enabled" : "disabled"}`)} /> },
    {
      title: "",
      key: "ops",
      align: "right",
      render: (_, w) => (
        <Space size={4}>
          <Button size="small" icon={<CopyOutlined />} aria-label="Copy webhook URL" onClick={() => navigator.clipboard.writeText(w.url).then(() => notify.success("Webhook URL copied"), () => notify.error("Could not copy the URL"))} />
          <Button size="small" icon={<EditOutlined />} onClick={() => setModal({ open: true, row: w })} aria-label="Edit channel" />
          <Popconfirm title="Remove this channel?" okText="Remove" okButtonProps={{ danger: true }} onConfirm={() => onSave({ ...config, webhooks: config.webhooks.filter((x) => x.id !== w.id) }, `${WEBHOOK_LABEL[w.type]} channel removed`)}>
            <Button size="small" danger icon={<DeleteOutlined />} aria-label="Remove channel" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const saveWebhook = (v: WebhookForm) => {
    const url = v.url.trim();
    const next = modal.row
      ? config.webhooks.map((x) => (x.id === modal.row?.id ? { ...x, type: v.type, url } : x))
      : [...config.webhooks, { id: genId(), type: v.type, url, enabled: true }];
    onSave({ ...config, webhooks: next }, `${WEBHOOK_LABEL[v.type]} channel ${modal.row ? "updated" : "added"}`);
    setModal({ open: false, row: null });
  };

  return (
    <>
      <Section title="Webhooks" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setModal({ open: true, row: null })}>Add channel</Button>}>
        <Table size="middle" rowKey="id" columns={columns} dataSource={config.webhooks} pagination={false} locale={{ emptyText: "No webhook channels yet" }} />
      </Section>
      <Section title="Email (SMTP)">
        <EmailForm config={config} saving={saving} onSave={onSave} />
      </Section>
      <WebhookModal open={modal.open} row={modal.row} onClose={() => setModal({ open: false, row: null })} onSave={saveWebhook} />
    </>
  );
}
