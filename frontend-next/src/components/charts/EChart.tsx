"use client";

import { useEffect, useRef } from "react";
import { Skeleton, Typography, theme } from "antd";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import { series } from "@/lib/theme/tokens";

echarts.use([LineChart, BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);

interface EChartProps {
  option: EChartsCoreOption;
  height?: number;
  loading?: boolean;
  /** Shown instead of the chart when there is nothing to plot. */
  empty?: boolean;
  emptyLabel?: string;
}

/** Thin ECharts host: theming, resize, loading and no-data states in one place. */
export function EChart({ option, height = 240, loading, empty, emptyLabel = "No data yet" }: EChartProps) {
  const { token } = theme.useToken();
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current || empty || loading) return;
    const instance = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.current = instance;
    const ro = new ResizeObserver(() => instance.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, [empty, loading]);

  useEffect(() => {
    chart.current?.setOption(
      {
        color: [...series],
        backgroundColor: "transparent",
        textStyle: { fontFamily: token.fontFamily, color: token.colorTextSecondary, fontSize: 13 },
        animation: false,
        grid: { left: 4, right: 10, top: 24, bottom: 4, containLabel: true },
        tooltip: {
          trigger: "axis",
          backgroundColor: token.colorBgElevated,
          borderColor: token.colorBorderSecondary,
          textStyle: { color: token.colorText, fontSize: 12 },
        },
        legend: { top: 0, right: 0, textStyle: { color: token.colorTextSecondary, fontSize: 12 }, icon: "rect", itemWidth: 10, itemHeight: 3 },
        ...option,
      },
      { notMerge: true },
    );
  }, [option, token]);

  if (loading) return <Skeleton.Node active style={{ width: "100%", height }}>{" "}</Skeleton.Node>;
  if (empty) {
    return (
      <div style={{ height, display: "grid", placeItems: "center" }}>
        <Typography.Text type="secondary">{emptyLabel}</Typography.Text>
      </div>
    );
  }
  return <div ref={ref} role="img" style={{ height, width: "100%" }} />;
}
