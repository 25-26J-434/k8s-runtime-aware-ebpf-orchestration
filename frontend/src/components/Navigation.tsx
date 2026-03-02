import { Link, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { FiHome, FiGitBranch, FiGrid, FiClock, FiGlobe, FiChevronRight, FiBarChart2, FiActivity, FiZap, FiServer, FiCpu, FiRadio, FiPackage, FiDownload, FiSettings, FiRefreshCw, FiTrendingUp, FiLayers, FiBell } from 'react-icons/fi';
import './Navigation.css';

export function Navigation() {
    const location = useLocation();
    const [submenuStyle, setSubmenuStyle] = useState<React.CSSProperties>({});
    const [extensionsSubmenuStyle, setExtensionsSubmenuStyle] = useState<React.CSSProperties>({});
    const dashboardLinkRef = useRef<HTMLDivElement>(null);
    const extensionsLinkRef = useRef<HTMLDivElement>(null);

    const isActive = (path: string) => location.pathname === path;

    const dashboardSubItems = [
        { id: 'health', label: 'System Health', icon: FiActivity },
        { id: 'node-metrics', label: 'Node Metrics', icon: FiServer },
        { id: 'system', label: 'Node System Metrics', icon: FiCpu },
        { id: 'dns', label: 'DNS Metrics', icon: FiGlobe },
        { id: 'tcp', label: 'TCP Metrics', icon: FiRadio },
        { id: 'disk-io', label: 'Disk I/O', icon: FiDownload },
        { id: 'cpu-scheduling', label: 'CPU Scheduling', icon: FiClock },
        { id: 'performance', label: 'Performance', icon: FiZap },
        { id: 'pod-metrics', label: 'Pod Metrics', icon: FiPackage },
        { id: 'services', label: 'Service Health', icon: FiSettings },
    ];

    const scrollToSection = (sectionId: string) => {
        if (location.pathname === '/dashboard') {
            const element = document.getElementById(sectionId);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    };

    // Update submenu positions
    useEffect(() => {
        const updateSubmenuPositions = () => {
            if (dashboardLinkRef.current) {
                const rect = dashboardLinkRef.current.getBoundingClientRect();
                setSubmenuStyle({ top: `${rect.top - 10}px` });
            }
            if (extensionsLinkRef.current) {
                const rect = extensionsLinkRef.current.getBoundingClientRect();
                setExtensionsSubmenuStyle({ top: `${rect.top - 10}px` });
            }
        };

        updateSubmenuPositions();
        const handleUpdate = () => requestAnimationFrame(updateSubmenuPositions);
        window.addEventListener('resize', handleUpdate);
        window.addEventListener('scroll', handleUpdate, true);
        return () => {
            window.removeEventListener('resize', handleUpdate);
            window.removeEventListener('scroll', handleUpdate, true);
        };
    }, [location]);

    return (
        <nav className="side-navigation">
            <div className="side-nav-header">
                <div className="brand-text">
                    <div className="brand-title">Kernel Eye</div>
                    <div className="brand-subtitle">eBPF Telemetry</div>
                </div>
            </div>

            <div className="side-nav-links">
                <div className="side-nav-item-wrapper" ref={dashboardLinkRef}>
                    <Link 
                        to="/dashboard" 
                        className={`side-nav-link ${isActive('/dashboard') ? 'active' : ''}`}
                        title="eBPF Metrics Dashboard"
                    >
                        <FiHome className="nav-icon" />
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
                    to="/topology" 
                    className={`side-nav-link ${isActive('/topology') ? 'active' : ''}`}
                    title="Network Topology with eBPF Actions"
                >
                    <FiGitBranch className="nav-icon" />
                    <span className="nav-link-text">Topology</span>
                </Link>
                
                <Link 
                    to="/routing" 
                    className={`side-nav-link ${isActive('/routing') ? 'active' : ''}`}
                    title="Routing Optimization"
                >
                    <FiGrid className="nav-icon" />
                    <span className="nav-link-text">Routing</span>
                </Link>
                
                <Link 
                    to="/scheduling" 
                    className={`side-nav-link ${isActive('/scheduling') ? 'active' : ''}`}
                    title="Scheduling Intelligence"
                >
                    <FiClock className="nav-icon" />
                    <span className="nav-link-text">Scheduling</span>
                </Link>

                <Link 
                    to="/scaling" 
                    className={`side-nav-link ${isActive('/scaling') ? 'active' : ''}`}
                    title="Autoscaling Rules"
                >
                    <FiTrendingUp className="nav-icon" />
                    <span className="nav-link-text">Scaling</span>
                </Link>
                
                <Link 
                    to="/federation" 
                    className={`side-nav-link ${isActive('/federation') ? 'active' : ''}`}
                    title="Multi-Cluster Federation"
                >
                    <FiGlobe className="nav-icon" />
                    <span className="nav-link-text">Federation</span>
                </Link>

                <div className="side-nav-item-wrapper" ref={extensionsLinkRef}>
                    <Link 
                        to="/extensions" 
                        className={`side-nav-link ${location.pathname.startsWith('/extensions') ? 'active' : ''}`}
                        title="SPI Extensions"
                    >
                        <FiLayers className="nav-icon" />
                        <span className="nav-link-text">Extensions</span>
                        <FiChevronRight className="nav-arrow" />
                    </Link>
                    <div className="submenu" style={extensionsSubmenuStyle}>
                        <div className="submenu-header">Extensions</div>
                        <div className="submenu-items-container">
                            <Link 
                                to="/extensions/notification" 
                                className={`submenu-item submenu-item-link ${location.pathname === '/extensions/notification' ? 'active' : ''}`}
                            >
                                <FiBell className="submenu-icon" />
                                <span className="submenu-text">Notification</span>
                            </Link>
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
