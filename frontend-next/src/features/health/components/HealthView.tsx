"use client";

import { useMemo, useState } from "react";
import { Alert, Button, Col, Row } from "antd";
import { ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/common/PageHeader";
import { Section } from "@/components/common/Section";
import { StatStrip } from "@/components/common/StatStrip";
import { ErrorState } from "@/components/common/feedback";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatusText } from "@/components/common/StatusText";
import { useClusterHealth } from "../hooks/use-cluster-health";
import { useRestartPod } from "../hooks/use-health-actions";
import { NodeTable } from "./NodeTable";
import { PodRow, PodTable, podRowKey } from "./PodTable";
import { AlertsPanel } from "./AlertsPanel";
import { PodDrawer } from "./PodDrawer";
import { ThresholdsDialog } from "./ThresholdsDialog";

const STREAM = {
  live: { tone: "success", label: "Live" },
  connecting: { tone: "neutral", label: "Connecting" },
  offline: { tone: "warning", label: "Reconnecting" },
} as const;

export function HealthView() {
  const health = useClusterHealth();
  const restart = useRestartPod();

  const [selected, setSelected] = useState<PodRow | null>(null);
  const [confirm, setConfirm] = useState<PodRow | null>(null);
  const [showThresholds, setShowThresholds] = useState(false);
  const [restarting, setRestarting] = useState<ReadonlySet<string>>(new Set());

  const nodes = useMemo(() => Object.values(health.data?.nodes ?? {}), [health.data]);
  const pods = useMemo<PodRow[]>(
    () => Object.entries(health.data?.nodes ?? {}).flatMap(([nodeKey, n]) => (n.pods ?? []).map((p) => ({ ...p, nodeKey }))),
    [health.data],
  );
  const offline = nodes.filter((n) => n.freshness === "offline");

  const summary = health.data?.summary;
  const healthyPods = pods.filter((p) => p.healthy && p.ready).length;
  const unhealthyNodes = nodes.filter((n) => !n.healthy).length;
  const stream = STREAM[health.streamStatus];

  const doRestart = (pod: PodRow) => {
    const key = podRowKey(pod);
    setConfirm(null);
    setRestarting((s) => new Set(s).add(key));
    restart.mutate(
      { namespace: pod.namespace, name: pod.name },
      {
        // Keep the row marked while Kubernetes recreates the pod.
        onSettled: () =>
          setTimeout(() => setRestarting((s) => {
            const n = new Set(s);
            n.delete(key);
            return n;
          }), 15_000),
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Health"
        extra={
          <>
            <StatusText tone={stream.tone} label={stream.label} />
            <Button icon={<SettingOutlined />} onClick={() => setShowThresholds(true)}>Thresholds</Button>
            <Button icon={<ReloadOutlined />} loading={health.isFetching} onClick={() => health.refetch()}>Refresh</Button>
          </>
        }
      />

      {health.isError && !health.data ? (
        <ErrorState error={health.error} onRetry={() => health.refetch()} />
      ) : (
        <>
          {offline.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              title={`${offline.map((n) => n.node_name).join(", ")} stopped reporting. Pod data for ${offline.length === 1 ? "this node" : "these nodes"} may be out of date.`}
            />
          )}

          <StatStrip
            loading={!health.data}
            stats={[
              { label: "Nodes reporting", value: `${summary?.nodes_live ?? nodes.filter((n) => n.freshness !== "offline").length} / ${nodes.length}`, hint: unhealthyNodes ? `${unhealthyNodes} unhealthy` : undefined, tone: offline.length ? "warning" : undefined },
              { label: "Pods healthy", value: `${healthyPods} / ${pods.length}`, tone: healthyPods < pods.length ? "warning" : undefined },
              { label: "Critical alerts", value: String(summary?.critical_alerts ?? 0), tone: summary?.critical_alerts ? "critical" : undefined },
              { label: "Warnings", value: String(summary?.warning_alerts ?? 0), tone: summary?.warning_alerts ? "warning" : undefined },
            ]}
          />

          <div style={{ height: 24 }} />
          <Section title="Nodes">
            <NodeTable nodes={nodes} loading={!health.data} />
          </Section>

          <Row gutter={24}>
            <Col xs={24} xl={15}>
              <Section title="Pods">
                <PodTable pods={pods} nodeNames={Object.keys(health.data?.nodes ?? {})} restartingKeys={restarting} loading={!health.data} onSelect={setSelected} onRestart={setConfirm} />
              </Section>
            </Col>
            <Col xs={24} xl={9}>
              <Section title="Alerts">
                <AlertsPanel />
              </Section>
            </Col>
          </Row>
        </>
      )}

      <PodDrawer pod={selected} restarting={!!selected && restarting.has(podRowKey(selected))} onClose={() => setSelected(null)} onRestart={setConfirm} />
      <ConfirmDialog
        open={!!confirm}
        destructive
        title="Restart pod?"
        confirmLabel="Restart"
        description={confirm && <>Kubernetes will delete <strong>{confirm.name}</strong> ({confirm.namespace}) and recreate it. Active connections to this pod will drop.</>}
        loading={restart.isPending}
        onConfirm={() => confirm && doRestart(confirm)}
        onClose={() => setConfirm(null)}
      />
      <ThresholdsDialog open={showThresholds} onClose={() => setShowThresholds(false)} />
    </>
  );
}
