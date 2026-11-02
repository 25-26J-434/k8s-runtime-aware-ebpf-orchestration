"use client";

import { useState } from "react";
import { Layout } from "antd";
import { layout } from "@/lib/theme/tokens";
import { useMetricsSocket } from "@/features/dashboard/hooks/use-metrics-socket";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  // The one shared metrics connection for the whole app.
  useMetricsSocket();

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sidebar collapsed={collapsed} onCollapse={setCollapsed} />
      <Layout.Content style={{ minWidth: 0, padding: "28px 36px 48px" }}>
        <div style={{ maxWidth: layout.contentMaxWidth, margin: "0 auto" }}>{children}</div>
      </Layout.Content>
    </Layout>
  );
}
