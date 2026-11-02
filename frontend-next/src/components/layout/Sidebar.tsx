"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, Layout, Menu, Tooltip, Typography, theme } from "antd";
import type { MenuProps } from "antd";
import { BulbOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { useColorMode } from "@/app/providers";
import { useMetricsStore } from "@/features/dashboard/hooks/metrics-store";
import { layout } from "@/lib/theme/tokens";
import { dashboardLink, dashboardSections, extensionsLink, fallbackExtension, navLinks } from "@/config/navigation";

interface ExtensionInfo {
  name: string;
  label?: string;
}

type Item = NonNullable<MenuProps["items"]>[number];

interface SidebarProps {
  collapsed: boolean;
  onCollapse: (v: boolean) => void;
}

export function Sidebar({ collapsed, onCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { token } = theme.useToken();
  const { mode, toggle } = useColorMode();
  const status = useMetricsStore((s) => s.status);

  // Same source the legacy menu used for its Extensions submenu.
  const extensions = useQuery({
    queryKey: ["extensions", "menu"],
    queryFn: async ({ signal }) => {
      try {
        const res = await apiRequest<{ extensions?: ExtensionInfo[] }>(endpoints.extensions, { signal });
        return res.extensions ?? [];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  const items = useMemo<Item[]>(() => {
    const exts = extensions.data?.length ? extensions.data : [{ name: fallbackExtension.name, label: fallbackExtension.label }];
    const DashIcon = dashboardLink.icon;
    const ExtIcon = extensionsLink.icon;
    return [
      {
        key: dashboardLink.href,
        icon: <DashIcon />,
        label: <Link href={dashboardLink.href}>{dashboardLink.label}</Link>,
        children: dashboardSections.map((s) => {
          const Icon = s.icon;
          return { key: `/dashboard#${s.id}`, icon: <Icon />, label: <Link href={`/dashboard#${s.id}`} scroll>{s.label}</Link> };
        }),
      },
      ...navLinks.map((n): Item => {
        const Icon = n.icon;
        return {
          key: n.href,
          icon: <Icon />,
          label: (
            <Tooltip title={n.tooltip} placement="right" mouseEnterDelay={0.8}>
              <Link href={n.href}>{n.label}</Link>
            </Tooltip>
          ),
        };
      }),
      {
        key: extensionsLink.href,
        icon: <ExtIcon />,
        label: <Link href={extensionsLink.href}>{extensionsLink.label}</Link>,
        children: exts.map((e) => ({ key: `/extensions/${e.name}`, label: <Link href={`/extensions/${e.name}`}>{e.label || e.name}</Link> })),
      },
    ];
  }, [extensions.data]);

  const selectedKey = pathname.startsWith("/extensions") ? pathname : pathname;
  const openKey = pathname.startsWith("/extensions") ? [extensionsLink.href] : pathname === "/dashboard" ? [dashboardLink.href] : undefined;

  const live = status === "live";

  return (
    <Layout.Sider
      width={layout.siderWidth}
      collapsedWidth={layout.siderCollapsed}
      collapsed={collapsed}
      onCollapse={onCollapse}
      breakpoint="lg"
      theme="light"
      style={{ background: token.colorBgContainer, borderRight: `1px solid ${token.colorBorderSecondary}`, position: "sticky", top: 0, height: "100vh", overflow: "auto" }}
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ height: 60, display: "flex", alignItems: "center", gap: 10, padding: collapsed ? 0 : "0 20px", justifyContent: collapsed ? "center" : "flex-start", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <span style={{ width: 24, height: 24, borderRadius: 6, background: token.colorPrimary, display: "inline-block", flexShrink: 0 }} aria-hidden />
          {!collapsed && <Typography.Text strong style={{ fontSize: 16 }}>Kernel Eye</Typography.Text>}
        </div>

        <Menu
          mode="inline"
          items={items}
          selectedKeys={[selectedKey]}
          defaultOpenKeys={openKey}
          style={{ flex: 1, borderInlineEnd: 0, paddingTop: 12, background: "transparent" }}
        />

        <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, padding: collapsed ? "8px 0" : "8px 12px", display: "flex", flexDirection: collapsed ? "column" : "row", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
          <Tooltip title={live ? "Metrics stream connected" : status === "connecting" ? "Connecting to metrics stream" : "Metrics stream down, retrying"} placement="right">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: token.colorTextSecondary, fontSize: 12 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: live ? token.colorSuccess : status === "connecting" ? token.colorTextQuaternary : token.colorWarning }} />
              {!collapsed && (live ? "Live" : status === "connecting" ? "Connecting" : "Offline")}
            </span>
          </Tooltip>
          <span style={{ display: "inline-flex", flexDirection: collapsed ? "column" : "row", gap: 2 }}>
            <Tooltip title={mode === "dark" ? "Light theme" : "Dark theme"} placement="right">
              <Button type="text" size="small" icon={<BulbOutlined />} onClick={toggle} aria-label="Toggle theme" />
            </Tooltip>
            <Button type="text" size="small" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => onCollapse(!collapsed)} aria-label={collapsed ? "Expand menu" : "Collapse menu"} />
          </span>
        </div>
      </div>
    </Layout.Sider>
  );
}
