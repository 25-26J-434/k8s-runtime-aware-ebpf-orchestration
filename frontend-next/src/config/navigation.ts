import {
  ApartmentOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  BellOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  HeartOutlined,
  RiseOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { ComponentType } from "react";

type Icon = ComponentType<{ className?: string }>;

/**
 * Mirrors the legacy console's side menu (frontend/src/components/Navigation.tsx):
 * a flat list, Dashboard with scroll-to sections, Extensions with a dynamic submenu.
 */
export interface DashboardSection {
  id: string;
  label: string;
  icon: Icon;
}

/** Same ids and labels the legacy dashboard submenu scrolled to. */
export const dashboardSections: DashboardSection[] = [
  { id: "health", label: "System Health", icon: HeartOutlined },
  { id: "node-metrics", label: "Node Metrics", icon: CloudServerOutlined },
  { id: "system", label: "Node System Metrics", icon: ToolOutlined },
  { id: "dns", label: "DNS Metrics", icon: GlobalOutlined },
  { id: "tcp", label: "TCP Metrics", icon: SwapOutlined },
  { id: "disk-io", label: "Disk I/O", icon: DatabaseOutlined },
  { id: "cpu-scheduling", label: "CPU Scheduling", icon: ClockCircleOutlined },
  { id: "performance", label: "Performance", icon: ThunderboltOutlined },
  { id: "pod-metrics", label: "Pod Metrics", icon: AppstoreOutlined },
  { id: "services", label: "Service Health", icon: ApartmentOutlined },
];

export interface NavLinkItem {
  label: string;
  href: string;
  icon: Icon;
  tooltip: string;
}

export const navLinks: NavLinkItem[] = [
  { label: "Health", href: "/health", icon: HeartOutlined, tooltip: "Health Monitoring with Real-time Alerts" },
  { label: "Topology", href: "/topology", icon: ApartmentOutlined, tooltip: "Network Topology with eBPF Actions" },
  { label: "Routing", href: "/routing", icon: SwapOutlined, tooltip: "Routing Optimization" },
  { label: "Scaling", href: "/scaling", icon: RiseOutlined, tooltip: "Autoscaling Rules" },
  { label: "Federation", href: "/federation", icon: GlobalOutlined, tooltip: "Multi-Cluster Federation" },
];

export const dashboardLink = { label: "Dashboard", href: "/dashboard", icon: BarChartOutlined, tooltip: "eBPF Metrics Dashboard" };
export const extensionsLink = { label: "Extensions", href: "/extensions", icon: AppstoreOutlined, tooltip: "SPI Extensions" };

/** Shown when /api/extensions returns nothing, as the legacy menu did. */
export const fallbackExtension = { name: "notification", label: "Notification", icon: BellOutlined };

export const routeTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/health": "Health",
  "/topology": "Topology",
  "/routing": "Routing",
  "/scaling": "Scaling",
  "/federation": "Federation",
  "/extensions": "Extensions",
  "/deployments": "Deployments",
  "/scheduling": "Scheduling",
};
