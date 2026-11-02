"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Alert, Col, Row, Select, Space, Typography } from "antd";
import { PageHeader } from "@/components/common/PageHeader";
import { Section } from "@/components/common/Section";
import { StatStrip, type Stat } from "@/components/common/StatStrip";
import { EmptyState } from "@/components/common/feedback";
import { BarChart, DonutChart, TimeSeriesChart, type Series } from "@/components/charts/charts";
import { useClusterHealth } from "@/features/health/hooks/use-cluster-health";
import { formatBytes, formatCount, formatMegabytes, formatMicros, formatNanos, formatPercent } from "@/lib/format/units";
import { useNodeView } from "../hooks/use-node-view";
import { PerformanceTable, PodMetricsTable } from "./PodsTables";
import { ServicesSection } from "./ServicesSection";
import { TcpEventsTable } from "./TcpEventsTable";
import type { HistoryPoint } from "../hooks/metrics-store";
import type { Tone } from "@/components/common/tone";

const series = (h: HistoryPoint[], name: string, pick: (p: HistoryPoint) => number | undefined): Series => ({
  name,
  data: h.flatMap((p) => {
    const v = pick(p);
    return v === undefined ? [] : ([[p.t, v]] as [number, number][]);
  }),
});

const microsFmt = (v: number) => formatMicros(v);
const pctFmt = (v: number) => `${Math.round(v)}%`;
const countFmt = (v: number) => formatCount(v);

function usageTone(pct: number | undefined): Tone | undefined {
  if (pct === undefined) return undefined;
  return pct >= 90 ? "critical" : pct >= 75 ? "warning" : undefined;
}

export function DashboardView() {
  const { node, nodeOptions, selectedKey, selectNode, history, totalPods, isLoading, isOffline } = useNodeView();
  const health = useClusterHealth();

  const h = health.data;
  const clusterNodes = Object.values(h?.nodes ?? {});
  const clusterPods = clusterNodes.flatMap((n) => n.pods ?? []);
  const healthyNodes = clusterNodes.filter((n) => n.healthy).length;
  const healthyPods = clusterPods.filter((p) => p.healthy && p.ready).length;
  const critical = h?.summary?.critical_alerts ?? 0;
  const warnings = h?.summary?.warning_alerts ?? 0;

  const charts = useMemo(
    () => ({
      resources: [series(history, "CPU", (p) => p.cpu), series(history, "Memory", (p) => p.mem)],
      latency: [series(history, "DNS avg", (p) => p.dnsUs), series(history, "RTT avg", (p) => p.rttUs)],
      srtt: [series(history, "SRTT", (p) => p.srttUs)],
      issues: [series(history, "Retransmissions", (p) => p.retrans), series(history, "Packet loss", (p) => p.packetLoss)],
    }),
    [history],
  );

  if (isOffline) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Alert type="warning" showIcon title="The metrics stream is unreachable. Retrying automatically." />
      </>
    );
  }

  const sys = node?.system;
  const sched = node?.sched;
  const disk = node?.disk;
  const protocols = Object.entries(node?.packets?.packets_by_protocol ?? {}).map(([name, value]) => ({ name, value }));

  const healthStats: Stat[] = [
    { label: "Nodes healthy", value: h ? `${healthyNodes} / ${clusterNodes.length}` : "—", tone: h && healthyNodes < clusterNodes.length ? "warning" : undefined },
    { label: "Pods healthy", value: h ? `${healthyPods} / ${clusterPods.length}` : formatCount(totalPods), hint: h ? undefined : "observed by eBPF", tone: h && healthyPods < clusterPods.length ? "warning" : undefined },
    { label: "Critical alerts", value: h ? String(critical) : "—", tone: critical > 0 ? "critical" : undefined },
    { label: "Warnings", value: h ? String(warnings) : "—", tone: warnings > 0 ? "warning" : undefined },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        note={node ? `${node.name}${node.ip ? ` · ${node.ip}` : ""}` : undefined}
        extra={
          nodeOptions.length > 0 && (
            <Select
              value={selectedKey ?? undefined}
              onChange={selectNode}
              style={{ minWidth: 200 }}
              options={nodeOptions.map((o) => ({ value: o.key, label: o.name }))}
              aria-label="Node"
            />
          )
        }
      />

      <Section id="health" title="System Health" extra={<Link href="/health">Open Health</Link>}>
        <StatStrip bare stats={healthStats} loading={!h && isLoading} />
      </Section>

      <Section id="node-metrics" title="Node Metrics">
        <StatStrip bare
          loading={isLoading}
          stats={[
            { label: "DNS latency (avg)", value: formatMicros(node?.dns.avgUs), hint: node ? `${formatCount(node.dns.totalEvents)} events` : undefined },
            { label: "RTT (avg)", value: formatMicros(node?.rtt.avgUs), hint: node ? `${formatCount(node.rtt.totalEvents)} events` : undefined },
            { label: "TCP SRTT (last)", value: formatMicros(node?.tcp.lastSrttUs) },
            { label: "TCP retransmissions", value: formatCount(node?.tcp.retransmissions), tone: node && node.tcp.retransmissions > 0 ? "warning" : undefined },
            { label: "Pods observed", value: formatCount(node?.pods.length) },
          ]}
        />
      </Section>

      <Section id="system" title="Node System Metrics">
        <StatStrip bare
          loading={isLoading}
          stats={[
            { label: "CPU", value: formatPercent(sys?.cpu_usage_percent), tone: usageTone(sys?.cpu_usage_percent) },
            { label: "Memory", value: formatPercent(sys?.memory_usage_percent), hint: sys ? `${formatMegabytes(sys.memory_used_mb)} of ${formatMegabytes(sys.memory_total_mb)}` : undefined, tone: usageTone(sys?.memory_usage_percent) },
            { label: "Load 1m", value: sys ? sys.load_avg_1min.toFixed(2) : "—" },
            { label: "Load 5m", value: sys ? sys.load_avg_5min.toFixed(2) : "—" },
            { label: "Load 15m", value: sys ? sys.load_avg_15min.toFixed(2) : "—" },
          ]}
        />
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>CPU and memory, samples collected in this browser session</Typography.Text>
          <TimeSeriesChart series={charts.resources} format={pctFmt} loading={isLoading} />
        </div>
      </Section>

      <Section id="dns" title="DNS Metrics">
        <StatStrip bare
          loading={isLoading}
          stats={[
            { label: "Events", value: formatCount(node?.dns.totalEvents) },
            { label: "Average", value: formatMicros(node?.dns.avgUs) },
            { label: "Last", value: formatMicros(node?.dns.lastUs) },
            { label: "Min", value: formatMicros(node?.dns.minUs) },
            { label: "Max", value: formatMicros(node?.dns.maxUs) },
          ]}
        />
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>DNS and RTT average, per sample</Typography.Text>
          <TimeSeriesChart series={charts.latency} format={microsFmt} loading={isLoading} />
        </div>
      </Section>

      <Section id="tcp" title="TCP Metrics">
        <StatStrip bare
          loading={isLoading}
          stats={[
            { label: "Events", value: formatCount(node?.tcp.totalEvents) },
            { label: "Avg SRTT", value: formatMicros(node?.tcp.avgSrttUs) },
            { label: "Last SRTT", value: formatMicros(node?.tcp.lastSrttUs), hint: node ? `cwnd ${formatCount(node.tcp.lastCwnd)}` : undefined },
            { label: "Min RTT", value: formatMicros(node?.tcp.lastMinRttUs) },
            { label: "Retransmissions", value: formatCount(node?.tcp.retransmissions), tone: node && node.tcp.retransmissions > 0 ? "warning" : undefined },
            { label: "Packet loss", value: formatCount(node?.tcp.packetLoss), tone: node && node.tcp.packetLoss > 0 ? "warning" : undefined },
            { label: "Bad handshakes", value: formatCount(node?.tcp.badHandshakes) },
          ]}
        />
        <Row gutter={[16, 12]} style={{ marginTop: 12 }}>
          <Col xs={24} lg={8}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>Smoothed RTT</Typography.Text>
            <TimeSeriesChart series={charts.srtt} format={microsFmt} loading={isLoading} height={190} />
          </Col>
          <Col xs={24} lg={8}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>Retransmissions and loss (cumulative)</Typography.Text>
            <TimeSeriesChart series={charts.issues} format={countFmt} loading={isLoading} height={190} />
          </Col>
          <Col xs={24} lg={8}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>Packets by protocol</Typography.Text>
            <DonutChart items={protocols} format={countFmt} loading={isLoading} height={190} />
          </Col>
        </Row>
        <Typography.Text type="secondary" style={{ fontSize: 13, display: "block", margin: "12px 0 6px" }}>Recent events</Typography.Text>
        <TcpEventsTable events={node?.tcp.recentEvents ?? []} />
      </Section>

      <Section id="disk-io" title="Disk I/O">
        {disk ? (
          <>
            <StatStrip bare
              stats={[
                { label: "Reads", value: formatCount(disk.total_reads), hint: formatBytes(disk.total_read_bytes) },
                { label: "Writes", value: formatCount(disk.total_writes), hint: formatBytes(disk.total_write_bytes) },
                { label: "Avg I/O latency", value: formatNanos(disk.avg_io_latency_ns) },
                { label: "Queue depth", value: String(disk.current_queue_depth), hint: `max ${disk.max_queue_depth}` },
                { label: "File opens", value: formatCount(disk.total_opens), hint: `${formatCount(disk.total_closes)} closes` },
              ]}
            />
            <div style={{ marginTop: 12 }}>
              <BarChart
                height={170}
                format={microsFmt}
                items={[
                  { name: "avg read", value: disk.avg_read_latency_ns / 1000 },
                  { name: "avg write", value: disk.avg_write_latency_ns / 1000 },
                  { name: "max read", value: disk.max_read_latency_ns / 1000 },
                  { name: "max write", value: disk.max_write_latency_ns / 1000 },
                ]}
              />
            </div>
          </>
        ) : (
          <EmptyState title="No disk I/O samples" />
        )}
      </Section>

      <Section id="cpu-scheduling" title="CPU Scheduling">
        {sched && sched.total_events > 0 ? (
          <>
            <StatStrip bare
              stats={[
                { label: "Events", value: formatCount(sched.total_events) },
                { label: "Avg run-queue", value: formatMicros(sched.avg_runqueue_latency_us) },
                { label: "p95", value: formatMicros(sched.p95_runqueue_latency_us) },
                { label: "p99", value: formatMicros(sched.p99_runqueue_latency_us) },
                { label: "Starvation", value: formatCount(sched.cpu_starvation_count), tone: sched.cpu_starvation_count > 0 ? "warning" : undefined },
                { label: "Avg CPU time", value: formatMicros(sched.avg_cpu_time_us) },
              ]}
            />
            <div style={{ marginTop: 12 }}>
              <BarChart
                height={170}
                format={microsFmt}
                items={[
                  { name: "min", value: sched.min_runqueue_latency_us },
                  { name: "avg", value: sched.avg_runqueue_latency_us },
                  { name: "p50", value: sched.p50_runqueue_latency_us },
                  { name: "p95", value: sched.p95_runqueue_latency_us },
                  { name: "p99", value: sched.p99_runqueue_latency_us },
                  { name: "max", value: sched.max_runqueue_latency_us },
                ]}
              />
            </div>
          </>
        ) : (
          <EmptyState title="No scheduling samples" description="The scheduler probe has not reported events for this node." />
        )}
      </Section>

      <Section id="performance" title="Performance">
        <Typography.Text type="secondary" style={{ fontSize: 13, display: "block", marginBottom: 6 }}>
          Pods with the most DNS latency, retransmissions and run-queue wait on this node. A relative ranking, not a health verdict.
        </Typography.Text>
        <PerformanceTable pods={node?.pods ?? []} loading={isLoading} />
      </Section>

      <Section id="pod-metrics" title="Pod Metrics">
        <PodMetricsTable pods={node?.pods ?? []} loading={isLoading} />
      </Section>

      <Section id="services" title="Service Health">
        <Space orientation="vertical" style={{ width: "100%" }} size={8}>
          <ServicesSection services={node?.services} loading={isLoading} />
        </Space>
      </Section>
    </>
  );
}
