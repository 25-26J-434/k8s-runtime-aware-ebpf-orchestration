"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Descriptions, Empty, Input, Select, Skeleton, Space, Typography, theme } from "antd";
import { DeleteOutlined, FileTextOutlined, PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/common/PageHeader";
import { ErrorState } from "@/components/common/feedback";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatusText } from "@/components/common/StatusText";
import type { Tone } from "@/components/common/tone";
import { useMetricsStore } from "@/features/dashboard/hooks/metrics-store";
import { useRestartPod } from "@/features/health/hooks/use-health-actions";
import { monoFamily } from "@/lib/theme/tokens";
import type { ClusterNode } from "@/types/cluster";
import { fetchPodLogs, useDeletePod, useTopology } from "../hooks/use-topology";
import { useRecommendations, useRecommendationThresholds } from "../hooks/use-recommendations";
import type { Recommendation, Severity } from "../lib/recommendations";
import { RecommendationsDrawer } from "./RecommendationsDrawer";
import type { Selection } from "./TopologyGraph";

const TopologyGraph = dynamic(() => import("./TopologyGraph").then((m) => m.TopologyGraph), {
  ssr: false,
  loading: () => <Skeleton active style={{ padding: 16 }} />,
});

const CLUSTER = "__cluster__";
const RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
const SEVERITY_TONE: Record<Severity, Tone> = { high: "critical", medium: "warning", low: "info" };

const fmtUs = (us?: number) => (us == null ? "—" : us >= 1000 ? `${(us / 1000).toFixed(1)} ms` : `${Math.round(us)} µs`);

function PodLogsView({ namespace, name }: { namespace: string; name: string }) {
  const logs = useQuery({ queryKey: ["pod-logs", namespace, name], queryFn: ({ signal }) => fetchPodLogs(namespace, name, signal), retry: false });
  if (logs.isLoading) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (logs.error) return <ErrorState error={logs.error} />;
  const text = logs.data?.success ? logs.data.logs || "No logs available" : `Error: ${logs.data?.error ?? "unknown"}`;
  return (
    <pre style={{ margin: 0, padding: 10, maxHeight: 300, overflow: "auto", fontFamily: monoFamily, fontSize: 11, background: "rgba(128,128,128,0.1)", borderRadius: 4, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
      {text}
    </pre>
  );
}

export function TopologyView() {
  const { token } = theme.useToken();
  const topo = useTopology();
  const restart = useRestartPod();
  const del = useDeletePod();
  const [selection, setSelection] = useState<Selection>(null);
  const [query, setQuery] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [confirm, setConfirm] = useState<"restart" | "delete" | null>(null);
  const [view, setView] = useState<string>(CLUSTER);
  const [frozen, setFrozen] = useState<ClusterNode[] | null>(null);
  const [advisor, setAdvisor] = useState(false);
  const { thresholds, save: saveThresholds } = useRecommendationThresholds();

  const liveNodes = topo.data?.nodes ?? [];
  // Pausing freezes the picture so a pod can be inspected while the cluster keeps changing.
  const allNodes = frozen ?? liveNodes;
  const nodes = useMemo(() => (view === CLUSTER ? allNodes : allNodes.filter((n) => n.name === view)), [allNodes, view]);
  const podCount = nodes.reduce((sum, n) => sum + (n.pods?.length ?? 0), 0);

  const recs = useRecommendations(thresholds, view === CLUSTER ? undefined : view);
  const health = useMemo(() => {
    const out: Record<string, Severity> = {};
    for (const r of recs) {
      const k = `${r.namespace}/${r.pod}`;
      const prev = out[k];
      if (!prev || RANK[r.severity] > RANK[prev]) out[k] = r.severity;
    }
    return out;
  }, [recs]);

  const metricNodes = useMetricsStore((s) => s.nodes);
  const podWire = (sel: Extract<Selection, { kind: "pod" }>) => {
    const entry = Object.entries(metricNodes).find(([k, m]) => (m.node_name ?? k) === sel.node)?.[1];
    return entry?.pods?.[`${sel.namespace}/${sel.name}`];
  };

  const pod = selection?.kind === "pod" ? nodes.flatMap((n) => n.pods ?? []).find((p) => p.name === selection.name && p.namespace === selection.namespace && p.node === selection.node) : undefined;
  const node = selection?.kind === "node" ? nodes.find((n) => n.name === selection.name) : undefined;
  const podRec = selection?.kind === "pod" ? recs.find((r) => r.pod === selection.name && r.namespace === selection.namespace && r.node === selection.node) : undefined;
  const wire = selection?.kind === "pod" ? podWire(selection) : undefined;

  const select = (s: Selection) => {
    setSelection(s);
    setShowLogs(false);
  };

  const showRecommendation = (r: Recommendation) => {
    if (!r.node) return;
    setView(r.node);
    select({ kind: "pod", namespace: r.namespace, name: r.pod, node: r.node });
    setAdvisor(false);
  };

  return (
    <>
      <PageHeader
        title="Topology"
        note={`${nodes.length} ${nodes.length === 1 ? "node" : "nodes"} · ${podCount} pods. Live connections are not drawn.`}
        extra={
          <>
            <StatusText tone={frozen ? "warning" : topo.streamStatus === "live" ? "success" : "neutral"} label={frozen ? "Paused" : topo.streamStatus === "live" ? "Live" : "Polling"} />
            <Select
              value={view}
              onChange={(v) => {
                setView(v);
                select(null);
              }}
              style={{ width: 220 }}
              options={[{ value: CLUSTER, label: "Cluster view: all nodes" }, ...allNodes.map((n) => ({ value: n.name, label: n.ip ? `${n.name} (${n.ip})` : n.name }))]}
            />
            <Input.Search allowClear placeholder="Filter pods" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 180 }} />
            <Button icon={frozen ? <PlayCircleOutlined /> : <PauseCircleOutlined />} onClick={() => setFrozen(frozen ? null : liveNodes)}>
              {frozen ? "Resume" : "Pause"}
            </Button>
            <Badge count={recs.length} size="small" offset={[-4, 4]}>
              <Button icon={<ThunderboltOutlined />} onClick={() => setAdvisor(true)}>Pod recommendations</Button>
            </Badge>
          </>
        }
      />
      {topo.isError && !topo.data ? (
        <ErrorState error={topo.error} onRetry={() => topo.refetch()} />
      ) : (
        <div style={{ display: "flex", gap: 16, flexDirection: "row", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 520px", height: "calc(100vh - 140px)", minHeight: 440, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius, overflow: "hidden", background: token.colorBgContainer }}>
            {topo.isLoading ? <Skeleton active style={{ padding: 16 }} /> : nodes.length === 0 ? <Empty style={{ marginTop: 80 }} description="No topology reported" /> : <TopologyGraph topology={{ nodes }} query={query} health={health} selection={selection} onSelect={select} />}
          </div>
          <div style={{ flex: "0 0 340px", maxWidth: "100%", border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius, padding: 12, alignSelf: "flex-start", background: token.colorBgContainer }}>
            {!selection && <Typography.Text type="secondary">Select a node or pod. The coloured edge of a pod is its Kubernetes status, or its worst finding when eBPF metrics are over a threshold.</Typography.Text>}
            {node && (
              <Descriptions
                title={node.name}
                column={1}
                size="small"
                items={[
                  { key: "s", label: "Status", children: <StatusText tone={node.status.toLowerCase() === "ready" ? "success" : "warning"} label={node.status} /> },
                  { key: "r", label: "Role", children: node.role ?? "—" },
                  { key: "ip", label: "IP", children: node.ip ?? "—" },
                  { key: "p", label: "Pods", children: node.pods?.length ?? 0 },
                ]}
              />
            )}
            {selection?.kind === "pod" && (
              <>
                <Descriptions
                  title={<span style={{ wordBreak: "break-all" }}>{selection.name}</span>}
                  column={1}
                  size="small"
                  items={[
                    { key: "ns", label: "Namespace", children: selection.namespace },
                    { key: "n", label: "Node", children: selection.node },
                    { key: "s", label: "Status", children: pod ? <StatusText tone={pod.status.toLowerCase() === "running" ? "success" : "warning"} label={pod.status} /> : "—" },
                    { key: "ip", label: "IP", children: pod?.ip || "—" },
                  ]}
                />
                {wire ? (
                  <Descriptions
                    style={{ marginTop: 8 }}
                    title="eBPF metrics"
                    column={1}
                    size="small"
                    items={[
                      { key: "dns", label: "DNS latency", children: fmtUs(wire.dns_latency?.avg_latency_ns != null ? wire.dns_latency.avg_latency_ns / 1000 : undefined) },
                      { key: "re", label: "TCP retransmissions", children: wire.tcp_metrics?.retransmissions ?? 0 },
                      { key: "pl", label: "Packet loss", children: wire.tcp_metrics?.packet_loss ?? 0 },
                      { key: "cpu", label: "CPU sched latency", children: fmtUs(wire.sched_latency?.avg_runqueue_latency_us) },
                    ]}
                  />
                ) : (
                  <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0", fontSize: 12 }}>No eBPF metrics reported for this pod yet.</Typography.Paragraph>
                )}
                {podRec && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <StatusText tone={SEVERITY_TONE[podRec.severity]} label={podRec.issues.join(", ")} />
                    <div style={{ marginTop: 4 }}><strong>{podRec.action}.</strong> {podRec.advice}</div>
                  </div>
                )}
                <Space style={{ marginTop: 8 }}>
                  <Button size="small" icon={<FileTextOutlined />} onClick={() => setShowLogs((v) => !v)}>{showLogs ? "Hide logs" : "Logs"}</Button>
                  <Button size="small" danger icon={<ReloadOutlined />} loading={restart.isPending} onClick={() => setConfirm("restart")}>Restart</Button>
                  <Button size="small" danger icon={<DeleteOutlined />} loading={del.isPending} onClick={() => setConfirm("delete")}>Delete</Button>
                </Space>
                {showLogs && <div style={{ marginTop: 10 }}><PodLogsView namespace={selection.namespace} name={selection.name} /></div>}
              </>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        destructive
        title={confirm === "delete" ? "Delete pod?" : "Restart pod?"}
        confirmLabel={confirm === "delete" ? "Delete" : "Restart"}
        description={
          selection?.kind === "pod" &&
          (confirm === "delete" ? (
            <>Kubernetes will delete <strong>{selection.name}</strong> ({selection.namespace}). If no controller manages it, it will not come back.</>
          ) : (
            <>Kubernetes will delete <strong>{selection.name}</strong> ({selection.namespace}) and recreate it.</>
          ))
        }
        loading={restart.isPending || del.isPending}
        onConfirm={() => {
          if (selection?.kind === "pod") {
            const t = { namespace: selection.namespace, name: selection.name };
            if (confirm === "delete") del.mutate(t, { onSuccess: (r) => r.success && select(null) });
            else restart.mutate(t);
          }
          setConfirm(null);
        }}
        onClose={() => setConfirm(null)}
      />
      <RecommendationsDrawer open={advisor} onClose={() => setAdvisor(false)} recommendations={recs} thresholds={thresholds} onSaveThresholds={saveThresholds} onSelectPod={showRecommendation} />
    </>
  );
}
