import React, { useState, useEffect } from "react";
import {
  ClusterHealthResponse,
  HealthAlert,
  HealthStats,
  PodHealth,
} from "../types/health";
import { healthService } from "../services/health";
import { metricsConfigService } from "../services/metricsConfig";
import { FiRefreshCw, FiAlertTriangle, FiSettings } from "react-icons/fi";
import "./HealthMonitoring.css";

export const HealthMonitoring: React.FC = () => {
  // Data states
  const [healthData, setHealthData] = useState<ClusterHealthResponse | null>(null);
  const [healthStats, setHealthStats] = useState<HealthStats | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [recentAlerts, setRecentAlerts] = useState<HealthAlert[]>([]);
  
  // Filter states
  const [selectedNode, setSelectedNode] = useState<string>("all");
  const [filterNamespace, setFilterNamespace] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchPod, setSearchPod] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);
  
  // Configuration states
  const [showConfig, setShowConfig] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [metricsConfig, setMetricsConfig] = useState({
    dns_latency_threshold: 20, // ms
    dns_latency_penalty: 20,
    tcp_retrans_threshold: 50,
    tcp_retrans_penalty: 20,
    packet_loss_threshold: 20,
    packet_loss_penalty: 20,
    rtt_threshold: 200, // ms
    rtt_penalty: 20,
    restart_count_threshold: 5,
    restart_count_penalty: 30,
  });

  useEffect(() => {
    // Load metrics config from backend
    const loadConfig = async () => {
      try {
        setConfigLoading(true);
        const config = await metricsConfigService.getConfig();
        setMetricsConfig(config);
        setConfigError(null);
        console.log('[HealthMonitoring] Loaded config from backend:', config);
      } catch (error) {
        console.error('[HealthMonitoring] Failed to load config from backend:', error);
        setConfigError('Failed to load configuration from backend');
        // Keep using default values on error
      } finally {
        setConfigLoading(false);
      }
    };

    healthService.onConnect(() => setIsConnected(true));
    healthService.onDisconnect(() => setIsConnected(false));
    healthService.onClusterHealthUpdate((data) => {
      setHealthData(data);
      setHealthStats(healthService.calculateHealthStats(data));
    });
    healthService.onAlert((alert) => {
      setRecentAlerts((prev) => [alert, ...prev.slice(0, 9)]);
    });

    loadConfig();
    healthService.connect();
    handleRefreshData();

    return () => healthService.disconnect();
  }, []);

  const handleRefreshData = async () => {
    setRefreshing(true);
    try {
      const data = await healthService.getClusterHealth();
      setHealthData(data);
      setHealthStats(healthService.calculateHealthStats(data));
      if (data.alerts) {
        setRecentAlerts(data.alerts.slice(0, 10));
      }
    } catch (error) {
      console.error("Failed to fetch health data:", error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveConfig = async () => {
    try {
      setConfigError(null);
      await metricsConfigService.updateConfig(metricsConfig);
      console.log('[HealthMonitoring] Configuration saved to backend:', metricsConfig);
      alert('Configuration saved successfully!');
      setShowConfig(false);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[HealthMonitoring] Failed to save config:', errorMsg);
      setConfigError(`Failed to save configuration: ${errorMsg}`);
      alert(`Error: ${errorMsg}`);
    }
  };

  // Get all pods across all nodes
  const getAllPods = (): { pod: PodHealth; node: string }[] => {
    if (!healthData) return [];
    const allPods: { pod: PodHealth; node: string }[] = [];
    Object.entries(healthData.nodes).forEach(([nodeName, nodeData]) => {
      (nodeData.pods || []).forEach((pod) => {
        allPods.push({ pod, node: nodeName });
      });
    });
    return allPods;
  };

  // Filter pods based on search and filters
  const getFilteredPods = (): { pod: PodHealth; node: string }[] => {
    let pods = getAllPods();
    
    // Filter by selected node
    if (selectedNode !== "all") {
      pods = pods.filter((p) => p.node === selectedNode);
    }
    
    if (filterNamespace !== "all") {
      pods = pods.filter((p) => p.pod.namespace === filterNamespace);
    }
    
    if (filterStatus !== "all") {
      pods = pods.filter((p) => {
        if (filterStatus === "healthy") return p.pod.healthy === true;
        if (filterStatus === "unhealthy") return p.pod.healthy === false;
        if (filterStatus === "ready") return p.pod.ready;
        if (filterStatus === "not-ready") return !p.pod.ready;
        return true;
      });
    }
    
    if (searchPod) {
      const search = searchPod.toLowerCase();
      pods = pods.filter((p) => p.pod.name.toLowerCase().includes(search));
    }
    
    return pods;
  };

  const getNamespaces = (): string[] => {
    const namespaces = new Set<string>();
    getAllPods().forEach((p) => namespaces.add(p.pod.namespace));
    return Array.from(namespaces).sort();
  };

  const getNodes = (): string[] => {
    if (!healthData) return [];
    return Object.keys(healthData.nodes).sort();
  };

  const filteredPods = getFilteredPods();
  const namespaces = getNamespaces();
  const nodes = getNodes();

  // Render config modal
  const renderConfigModal = () => {
    if (!showConfig) return null;

    return (
      <div className="modal-overlay" onClick={() => setShowConfig(false)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Metrics Thresholds Configuration</h2>
            <button className="modal-close" onClick={() => setShowConfig(false)}>✕</button>
          </div>
          
          <div className="config-grid">
            {/* DNS Latency */}
            <div className="config-section">
              <h3>DNS Latency</h3>
              <div className="config-item">
                <label>Threshold (ms):</label>
                <input 
                  type="number" 
                  value={metricsConfig.dns_latency_threshold}
                  onChange={(e) => setMetricsConfig({...metricsConfig, dns_latency_threshold: Number(e.target.value)})}
                />
              </div>
              <div className="config-item">
                <label>Score Penalty:</label>
                <input 
                  type="number" 
                  value={metricsConfig.dns_latency_penalty}
                  onChange={(e) => setMetricsConfig({...metricsConfig, dns_latency_penalty: Number(e.target.value)})}
                />
              </div>
            </div>

            {/* TCP Retransmissions */}
            <div className="config-section">
              <h3>TCP Retransmissions</h3>
              <div className="config-item">
                <label>Threshold:</label>
                <input 
                  type="number" 
                  value={metricsConfig.tcp_retrans_threshold}
                  onChange={(e) => setMetricsConfig({...metricsConfig, tcp_retrans_threshold: Number(e.target.value)})}
                />
              </div>
              <div className="config-item">
                <label>Score Penalty:</label>
                <input 
                  type="number" 
                  value={metricsConfig.tcp_retrans_penalty}
                  onChange={(e) => setMetricsConfig({...metricsConfig, tcp_retrans_penalty: Number(e.target.value)})}
                />
              </div>
            </div>

            {/* Packet Loss */}
            <div className="config-section">
              <h3>Packet Loss</h3>
              <div className="config-item">
                <label>Threshold (%):</label>
                <input 
                  type="number" 
                  value={metricsConfig.packet_loss_threshold}
                  onChange={(e) => setMetricsConfig({...metricsConfig, packet_loss_threshold: Number(e.target.value)})}
                />
              </div>
              <div className="config-item">
                <label>Score Penalty:</label>
                <input 
                  type="number" 
                  value={metricsConfig.packet_loss_penalty}
                  onChange={(e) => setMetricsConfig({...metricsConfig, packet_loss_penalty: Number(e.target.value)})}
                />
              </div>
            </div>

            {/* RTT */}
            <div className="config-section">
              <h3>Round-Trip Time (RTT)</h3>
              <div className="config-item">
                <label>Threshold (ms):</label>
                <input 
                  type="number" 
                  value={metricsConfig.rtt_threshold}
                  onChange={(e) => setMetricsConfig({...metricsConfig, rtt_threshold: Number(e.target.value)})}
                />
              </div>
              <div className="config-item">
                <label>Score Penalty:</label>
                <input 
                  type="number" 
                  value={metricsConfig.rtt_penalty}
                  onChange={(e) => setMetricsConfig({...metricsConfig, rtt_penalty: Number(e.target.value)})}
                />
              </div>
            </div>

            {/* Restart Count */}
            <div className="config-section">
              <h3>Restart Count</h3>
              <div className="config-item">
                <label>Threshold:</label>
                <input 
                  type="number" 
                  value={metricsConfig.restart_count_threshold}
                  onChange={(e) => setMetricsConfig({...metricsConfig, restart_count_threshold: Number(e.target.value)})}
                />
              </div>
              <div className="config-item">
                <label>Score Penalty:</label>
                <input 
                  type="number" 
                  value={metricsConfig.restart_count_penalty}
                  onChange={(e) => setMetricsConfig({...metricsConfig, restart_count_penalty: Number(e.target.value)})}
                />
              </div>
            </div>
          </div>

          {configError && (
            <div style={{ color: '#ef4444', padding: '10px', marginBottom: '10px', fontSize: '12px' }}>
              ⚠️ {configError}
            </div>
          )}

          <div className="modal-footer">
            <button className="btn-save" onClick={handleSaveConfig} disabled={configLoading}>
              {configLoading ? 'Saving...' : 'Save & Close'}
            </button>
            <button className="btn-reset" onClick={async () => {
              try {
                const config = await metricsConfigService.getConfig();
                setMetricsConfig(config);
                alert('Reset to backend configuration');
              } catch (error) {
                alert('Failed to reset configuration');
              }
            }}>Reset to Saved</button>
          </div>
        </div>
      </div>
    );
  };

  // Render stats cards with compact size
  const renderStatsCards = () => {
    if (!healthStats) return null;

    return (
      <div className="compact-stats">
        <div className="mini-stat">
          <div className="mini-stat-value">{healthStats.totalPods}</div>
          <div className="mini-stat-label">Total Pods</div>
          <div className="mini-stat-sub">{healthStats.healthyPods}✓ {healthStats.unhealthyPods}✕</div>
        </div>

        <div className="mini-stat">
          <div className="mini-stat-value">{healthStats.totalNodes}</div>
          <div className="mini-stat-label">Nodes</div>
          <div className="mini-stat-sub">{healthStats.healthyNodes}✓ {healthStats.unhealthyNodes}✕</div>
        </div>

        <div className="mini-stat">
          <div className="mini-stat-value">{healthStats.criticalAlerts + healthStats.warningAlerts}</div>
          <div className="mini-stat-label">Alerts</div>
          <div className="mini-stat-sub">{healthStats.criticalAlerts} Critical</div>
        </div>

        <div className="mini-stat">
          <div className={`mini-stat-value status-${isConnected ? "connected" : "disconnected"}`}>
            {isConnected ? "◉" : "○"}
          </div>
          <div className="mini-stat-label">Status</div>
          <div className="mini-stat-sub">{isConnected ? "Live" : "Offline"}</div>
        </div>
      </div>
    );
  };

  // Render pod item
  const renderPodItem = (podData: { pod: PodHealth; node: string }) => {
    const { pod, node } = podData;
    const healthIcon = healthService.getHealthIcon(pod.healthy);
    const healthColor = healthService.getHealthColor(pod.healthy);

    return (
      <div key={`${pod.namespace}/${pod.name}`} className="pod-item-compact">
        <div className="pod-compact-left">
          <span className="pod-health-icon">{healthIcon}</span>
          <div>
            <div className="pod-compact-name">{pod.name}</div>
            <div className="pod-compact-meta">{pod.namespace} • {node}</div>
          </div>
        </div>

        <div className="pod-compact-middle">
          <span className={`badge-mini phase-${pod.phase.toLowerCase()}`}>{pod.phase}</span>
          <span className={`badge-mini ready-${pod.ready ? "true" : "false"}`}>
            {pod.ready ? "Ready" : "NotReady"}
          </span>
        </div>

        <div className="pod-compact-right">
          {pod.restart_count > 0 && <span className="restart-badge">{pod.restart_count}↻</span>}
          {pod.health_score !== undefined && (
            <span className="score-badge" style={{ color: healthColor }}>
              {pod.health_score}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="health-monitoring-compact">
      {/* Header with Controls */}
      <div className="health-header-compact">
        <div className="header-left">
          <h1>⚕️ Cluster Health</h1>
        </div>
        <div className="header-right">
          <select 
            value={selectedNode} 
            onChange={(e) => setSelectedNode(e.target.value)}
            className="cluster-select"
          >
            <option value="all">All Nodes</option>
            {nodes.map((node) => (
              <option key={node} value={node}>{node}</option>
            ))}
          </select>

          <button 
            onClick={handleRefreshData} 
            className={`btn-icon ${refreshing ? "refreshing" : ""}`}
            disabled={refreshing}
            title="Refresh data"
          >
            <FiRefreshCw size={18} />
          </button>

          {/* <button 
            onClick={() => setShowConfig(!showConfig)} 
            className="btn-icon"
            title="Configure metrics"
          >
            <FiSettings size={18} />
          </button> */}
        </div>
      </div>

      {/* Compact Stats */}
      {renderStatsCards()}

      {/* Main Content - 2 Column Layout */}
      <div className="health-layout-2col">
        {/* Left: Pods List */}
        <div className="pods-container">
          {/* Filters */}
          <div className="filters-compact">
            <input
              type="text"
              placeholder="Search pods..."
              value={searchPod}
              onChange={(e) => setSearchPod(e.target.value)}
              className="search-tiny"
            />
            
            <select 
              value={filterNamespace} 
              onChange={(e) => setFilterNamespace(e.target.value)}
              className="filter-tiny"
            >
              <option value="all">All NS</option>
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
            </select>

            <select 
              value={filterStatus} 
              onChange={(e) => setFilterStatus(e.target.value)}
              className="filter-tiny"
            >
              <option value="all">All Status</option>
              <option value="healthy">Healthy</option>
              <option value="unhealthy">Issues</option>
              <option value="ready">Ready</option>
              <option value="not-ready">NotReady</option>
            </select>

            <div className="filter-count">
              {filteredPods.length} / {getAllPods().length}
            </div>
          </div>

          {/* Pods List */}
          {filteredPods.length === 0 ? (
            <div className="no-pods-msg">No pods found</div>
          ) : (
            <div className="pods-list-compact">
              {filteredPods.map((podData) => renderPodItem(podData))}
            </div>
          )}
        </div>

        {/* Right: Alerts */}
        <div className="alerts-container">
          <div className="alerts-header-compact">
            <FiAlertTriangle size={18} />
            <span>Recent Alerts ({recentAlerts.length})</span>
          </div>

          {recentAlerts.length === 0 ? (
            <div className="no-alerts-msg">✓ All systems operational</div>
          ) : (
            <div className="alerts-list-compact">
              {recentAlerts.slice(0, 12).map((alert, idx) => (
                <div key={idx} className={`alert-item-tiny alert-${alert.severity}`}>
                  <div className="alert-msg-tiny">{alert.message}</div>
                  <div className="alert-time-tiny">
                    {new Date(alert.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Configuration Modal */}
      {renderConfigModal()}
    </div>
  );
};

export default HealthMonitoring;
