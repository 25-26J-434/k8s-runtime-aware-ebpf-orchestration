import { Link, useLocation } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import {
  FiGitMerge,
  FiGrid,
  FiClock,
  FiGlobe,
  FiChevronLeft,
  FiChevronRight,
  FiBarChart2,
  FiActivity,
  FiZap,
  FiServer,
  FiCpu,
  FiRadio,
  FiPackage,
  FiDownload,
  FiSettings,
  FiRefreshCw,
  FiTrendingUp,
  FiHeart,
  FiLayers,
  FiBell,
  FiShuffle,
} from "react-icons/fi";
import { api, type ExtensionInfo } from "../services/api";
import "./Navigation.css";

const extensionIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  notification: FiBell,
};
function getExtensionIcon(name: string) {
  return extensionIconMap[name] ?? FiLayers;
}

export function Navigation() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("kernel-eye-nav-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [submenuStyle, setSubmenuStyle] = useState<React.CSSProperties>({});
  const [extensionsSubmenuStyle, setExtensionsSubmenuStyle] = useState<React.CSSProperties>({});
  const dashboardLinkRef = useRef<HTMLDivElement>(null);
  const extensionsLinkRef = useRef<HTMLDivElement>(null);
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);

  const isActive = (path: string) => location.pathname === path;

  useEffect(() => {
    api.getExtensions()
      .then((res) => setExtensions(res.extensions ?? []))
      .catch(() => setExtensions([]));
  }, []);

  useEffect(() => {
    const navWidth = collapsed ? "88px" : "280px";
    document.documentElement.style.setProperty("--side-nav-width", navWidth);
    try {
      localStorage.setItem("kernel-eye-nav-collapsed", String(collapsed));
    } catch {
      // Ignore storage failures in restricted contexts.
    }
  }, [collapsed]);

  const dashboardSubItems = [
    { id: "health", label: "System Health", icon: FiActivity },
    { id: "node-metrics", label: "Node Metrics", icon: FiServer },
    { id: "system", label: "Node System Metrics", icon: FiCpu },
    { id: "dns", label: "DNS Metrics", icon: FiGlobe },
    { id: "tcp", label: "TCP Metrics", icon: FiRadio },
    { id: "disk-io", label: "Disk I/O", icon: FiDownload },
    { id: "cpu-scheduling", label: "CPU Scheduling", icon: FiClock },
    { id: "performance", label: "Performance", icon: FiZap },
    { id: "pod-metrics", label: "Pod Metrics", icon: FiPackage },
    { id: "services", label: "Service Health", icon: FiSettings },
  ];

  const scrollToSection = (sectionId: string) => {
    if (location.pathname === "/dashboard") {
      const element = document.getElementById(sectionId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  };

  // Update submenu position
  useEffect(() => {
    const updateSubmenuPosition = () => {
      if (dashboardLinkRef.current) {
        const rect = dashboardLinkRef.current.getBoundingClientRect();
        setSubmenuStyle({ top: `${rect.top - 10}px` });
      }
      if (extensionsLinkRef.current) {
        const rect = extensionsLinkRef.current.getBoundingClientRect();
        setExtensionsSubmenuStyle({ top: `${rect.top - 10}px` });
      }
    };

    updateSubmenuPosition();

    // Update on any scroll or resize
    const handleUpdate = () => {
      requestAnimationFrame(updateSubmenuPosition);
    };

    window.addEventListener("resize", handleUpdate);
    window.addEventListener("scroll", handleUpdate, true);

    return () => {
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("scroll", handleUpdate, true);
    };
  }, [location]);

  return (
    <nav className={`side-navigation ${collapsed ? "collapsed" : ""}`}>
      <div className="side-nav-header">
        <div className="brand-identity">
          <img src="/kerneleye-favicon.svg" alt="Kernel Eye logo" className="brand-logo" />
          <div className="brand-text">
            <div className="brand-title">Kernel Eye</div>
          </div>
        </div>
        <button
          type="button"
          className="side-nav-toggle"
          onClick={() => setCollapsed((current) => !current)}
          aria-label={collapsed ? "Expand side navigation" : "Collapse side navigation"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <FiChevronRight /> : <FiChevronLeft />}
        </button>
      </div>

      <div className="side-nav-links">
        <div className="side-nav-item-wrapper" ref={dashboardLinkRef}>
        <Link
          to="/dashboard"
          className={`side-nav-link ${isActive("/dashboard") ? "active" : ""}`}
          title="eBPF Metrics Dashboard"
        >
          <FiBarChart2 className="nav-icon" />
          <span className="nav-link-text">Dashboard</span>
          <FiChevronRight className="nav-arrow" />
        </Link>

          {/* Dashboard Submenu */}
          <div className="submenu" style={submenuStyle}>
            <div className="submenu-header">Dashboard Sections</div>
            <div className="submenu-items-container">
              {dashboardSubItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => scrollToSection(item.id)}
                    className="submenu-item"
                    title={item.label}
                  >
                    <Icon className="submenu-icon" />
                    <span className="submenu-text">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <Link
          to="/health"
          className={`side-nav-link ${isActive("/health") ? "active" : ""}`}
          title="Health Monitoring with Real-time Alerts"
        >
          <FiActivity className="nav-icon" />
          <span className="nav-link-text">Health</span>
        </Link>

        <Link
          to="/topology"
          className={`side-nav-link ${isActive("/topology") ? "active" : ""}`}
          title="Network Topology with eBPF Actions"
        >
          <FiGitMerge className="nav-icon" />
          <span className="nav-link-text">Topology</span>
        </Link>

        <Link
          to="/routing"
          className={`side-nav-link ${isActive("/routing") ? "active" : ""}`}
          title="Routing Optimization"
        >
          <FiShuffle className="nav-icon" />
          <span className="nav-link-text">Routing</span>
        </Link>

        <Link
          to="/scaling"
          className={`side-nav-link ${isActive("/scaling") ? "active" : ""}`}
          title="Autoscaling Rules"
        >
          <FiTrendingUp className="nav-icon" />
          <span className="nav-link-text">Scaling</span>
        </Link>

        <Link
          to="/federation"
          className={`side-nav-link ${isActive("/federation") ? "active" : ""}`}
          title="Multi-Cluster Federation"
        >
          <FiGlobe className="nav-icon" />
          <span className="nav-link-text">Federation</span>
        </Link>

        <div className="side-nav-item-wrapper" ref={extensionsLinkRef}>
          <Link
            to="/extensions"
            className={`side-nav-link ${location.pathname.startsWith("/extensions") ? "active" : ""}`}
            title="SPI Extensions"
          >
            <FiPackage className="nav-icon" />
            <span className="nav-link-text">Extensions</span>
            <FiChevronRight className="nav-arrow" />
          </Link>
          <div className="submenu" style={extensionsSubmenuStyle}>
            <div className="submenu-header">Extensions</div>
            <div className="submenu-items-container">
              {extensions.length === 0 ? (
                <Link
                  to="/extensions/notification"
                  className={`submenu-item submenu-item-link ${location.pathname === "/extensions/notification" ? "active" : ""}`}
                >
                  <FiBell className="submenu-icon" />
                  <span className="submenu-text">Notification</span>
                </Link>
              ) : (
                extensions.map((ext) => {
                  const Icon = getExtensionIcon(ext.name);
                  return (
                    <Link
                      key={ext.name}
                      to={`/extensions/${ext.name}`}
                      className={`submenu-item submenu-item-link ${location.pathname === `/extensions/${ext.name}` ? "active" : ""}`}
                    >
                      <Icon className="submenu-icon" />
                      <span className="submenu-text">{ext.label || ext.name}</span>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="side-nav-footer">
        <div className="status-indicator-container">
          <div className="status-indicator"></div>
          <span className="status-text">Live</span>
        </div>
      </div>
    </nav>
  );
}
