"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "antd";
import { series as palette } from "@/lib/theme/tokens";

// ECharts is heavy and canvas-only; load it on demand, client side.
const EChart = dynamic(() => import("./EChart").then((m) => m.EChart), {
  ssr: false,
  loading: () => <Skeleton.Node active style={{ width: "100%", height: 220 }}>{" "}</Skeleton.Node>,
});

export interface Series {
  name: string;
  /** [epoch ms, value] pairs */
  data: [number, number][];
  color?: string;
}

interface TimeSeriesProps {
  series: Series[];
  /** Formats axis ticks and tooltip values; carries the unit. */
  format: (v: number) => string;
  area?: boolean;
  height?: number;
  loading?: boolean;
  emptyLabel?: string;
}

export function TimeSeriesChart({ series, format, area, height, loading, emptyLabel }: TimeSeriesProps) {
  const option = useMemo(
    () => ({
      xAxis: { type: "time", axisLabel: { hideOverlap: true, formatter: "{HH}:{mm}:{ss}" }, splitLine: { show: false } },
      yAxis: { type: "value", axisLabel: { formatter: (v: number) => format(v) }, splitLine: { lineStyle: { opacity: 0.35 } } },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: number) => format(Number(v)),
      },
      series: series.map((s, i) => ({
        name: s.name,
        type: "line",
        showSymbol: false,
        smooth: false,
        lineStyle: { width: 2 },
        itemStyle: { color: s.color ?? palette[i % palette.length] },
        areaStyle: area ? { opacity: 0.12 } : undefined,
        data: s.data,
      })),
    }),
    [series, format, area],
  );
  const empty = series.every((s) => s.data.length < 2);
  return <EChart option={option} height={height} loading={loading} empty={empty} emptyLabel={emptyLabel ?? "Collecting samples…"} />;
}

interface BarProps {
  items: { name: string; value: number }[];
  format: (v: number) => string;
  height?: number;
  loading?: boolean;
  horizontal?: boolean;
}

export function BarChart({ items, format, height, loading, horizontal }: BarProps) {
  const option = useMemo(() => {
    const cat = { type: "category", data: items.map((i) => i.name), axisLabel: { hideOverlap: true } };
    const val = { type: "value", axisLabel: { formatter: (v: number) => format(v) }, splitLine: { lineStyle: { opacity: 0.35 } } };
    return {
      legend: { show: false },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => format(Number(v)) },
      xAxis: horizontal ? val : cat,
      yAxis: horizontal ? { ...cat, inverse: true } : val,
      series: [{ type: "bar", barMaxWidth: 28, itemStyle: { borderRadius: 3 }, data: items.map((i) => i.value) }],
    };
  }, [items, format, horizontal]);
  return <EChart option={option} height={height} loading={loading} empty={items.length === 0} emptyLabel="No data" />;
}

interface DonutProps {
  items: { name: string; value: number }[];
  format?: (v: number) => string;
  height?: number;
  loading?: boolean;
}

export function DonutChart({ items, format = (v) => String(v), height, loading }: DonutProps) {
  const option = useMemo(
    () => ({
      tooltip: { trigger: "item", valueFormatter: (v: number) => format(Number(v)) },
      legend: { orient: "vertical", right: 0, top: "middle" },
      series: [
        {
          type: "pie",
          radius: ["55%", "78%"],
          center: ["34%", "50%"],
          label: { show: false },
          itemStyle: { borderRadius: 4, borderWidth: 2, borderColor: "transparent" },
          data: items,
        },
      ],
    }),
    [items, format],
  );
  return <EChart option={option} height={height} loading={loading} empty={items.length === 0 || items.every((i) => i.value === 0)} emptyLabel="No data" />;
}
