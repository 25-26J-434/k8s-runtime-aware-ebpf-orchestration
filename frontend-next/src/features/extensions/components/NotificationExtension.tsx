"use client";

import { useState } from "react";
import { Alert, Button, InputNumber, Space, Switch, Tabs } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { Section } from "@/components/common/Section";
import { ErrorState, SkeletonRows } from "@/components/common/feedback";
import { useNotificationConfig, useRunNotificationCheck, useSaveConfig } from "../hooks/use-extensions";
import { checkBlocker } from "../lib/notification";
import { ChannelsPanel } from "./ChannelsPanel";
import { RulesPanel } from "./RulesPanel";
import type { NotificationConfig } from "@/types/extensions";

function GeneralPanel({ config, saving, onSave }: { config: NotificationConfig; saving: boolean; onSave: (c: NotificationConfig, m: string) => void }) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [every, setEvery] = useState<number | null>(config.interval_seconds);

  const dirty = enabled !== config.enabled || every !== config.interval_seconds;
  return (
    <Section title="Monitoring">
      <Space orientation="vertical" size={16}>
        <Space><Switch checked={enabled} onChange={setEnabled} /><span>Evaluate alert rules continuously</span></Space>
        <Space><span>Check every</span><InputNumber min={5} value={every} onChange={setEvery} addonAfter="seconds" /></Space>
        <Button type="primary" loading={saving} disabled={!dirty || !every} onClick={() => onSave({ ...config, enabled, interval_seconds: every ?? config.interval_seconds }, "Monitoring settings saved")}>Save</Button>
      </Space>
    </Section>
  );
}

export function NotificationExtension() {
  const { config, isLoading, error, refetch } = useNotificationConfig();
  const save = useSaveConfig("notification");
  const check = useRunNotificationCheck();

  if (isLoading) return <SkeletonRows rows={6} />;
  if (error || !config) return <ErrorState error={error} onRetry={() => refetch()} />;

  const onSave = (next: NotificationConfig, message: string) => save.mutate({ config: { ...next }, message });
  const blocker = checkBlocker(config);

  return (
    <>
      {blocker ? (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={blocker} />
      ) : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="Channels and rules are set. Running a check evaluates the rules now and sends alerts for any that are violated."
          action={<Button icon={<SendOutlined />} loading={check.pending} onClick={() => check.run(config)}>Run check now</Button>}
        />
      )}
      <Tabs
        destroyOnHidden
        items={[
          { key: "channels", label: "Channels", children: <ChannelsPanel config={config} saving={save.isPending} onSave={onSave} /> },
          { key: "rules", label: `Alert rules (${config.thresholds.length})`, children: <RulesPanel config={config} onSave={onSave} /> },
          { key: "general", label: "General", children: <GeneralPanel key={`${config.enabled}-${config.interval_seconds}`} config={config} saving={save.isPending} onSave={onSave} /> },
        ]}
      />
    </>
  );
}
