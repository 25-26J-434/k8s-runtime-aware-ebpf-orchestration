"use client";

import { useMemo, useState } from "react";
import { Flex, List, Segmented, Tabs, Typography } from "antd";
import { formatDistanceToNowStrict } from "date-fns";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/common/feedback";
import { StatusText } from "@/components/common/StatusText";
import { useHealthAlerts } from "../hooks/use-health-actions";
import { severityTone } from "../utils/pod-status";
import type { HealthAlert, Severity } from "@/types/health";

type View = "active" | "history";
type Filter = "all" | Severity;

function describe(a: HealthAlert) {
  const target = a.pod_name ? `${a.namespace ?? ""}/${a.pod_name}` : a.node_name;
  const age = `${formatDistanceToNowStrict(new Date(a.timestamp))} ago`;
  const resolved = a.state === "resolved" && a.resolved_at ? ` · resolved ${formatDistanceToNowStrict(new Date(a.resolved_at))} ago` : "";
  return `${target} · ${age}${resolved}`;
}

export function AlertsPanel() {
  const { data, isLoading, error, refetch } = useHealthAlerts();
  const [view, setView] = useState<View>("active");
  const [severity, setSeverity] = useState<Filter>("all");

  const list = useMemo(() => {
    const source = view === "active" ? (data?.active ?? []) : (data?.history ?? []);
    return source
      .filter((a) => severity === "all" || a.severity === severity)
      .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
  }, [data, view, severity]);

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Tabs
          size="small"
          activeKey={view}
          onChange={(k) => setView(k as View)}
          items={[
            { key: "active", label: `Active${data ? ` (${data.active?.length ?? 0})` : ""}` },
            { key: "history", label: "Resolved and history" },
          ]}
          style={{ marginBottom: 0 }}
        />
        <Segmented size="small" value={severity} onChange={(v) => setSeverity(v as Filter)} options={[{ value: "all", label: "All" }, { value: "critical", label: "Critical" }, { value: "warning", label: "Warning" }, { value: "info", label: "Info" }]} />
      </Flex>
      <div style={{ marginTop: 8 }}>
        {isLoading ? (
          <SkeletonRows rows={3} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : list.length === 0 ? (
          <EmptyState title={view === "active" ? "No active alerts" : "No alert history"} />
        ) : (
          <List
            size="small"
            style={{ maxHeight: 420, overflowY: "auto" }}
            dataSource={list}
            renderItem={(a) => (
              <List.Item>
                <div style={{ minWidth: 0 }}>
                  <StatusText tone={severityTone[a.severity]} label={a.severity} />
                  <div>{a.message}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>{describe(a)}</Typography.Text>
                </div>
              </List.Item>
            )}
          />
        )}
      </div>
    </>
  );
}
