import React, { useState, useEffect } from "react";
import {
  ClusterHealthResponse,
  HealthAlert,
  HealthStats,
  NodeHealthUpdate,
  PodHealth,
} from "../types/health";
import { healthService } from "../services/health";
import "./HealthMonitoring.css";

export const HealthMonitoring: React.FC = () => {
  const [healthData, setHealthData] = useState<ClusterHealthResponse | null>(
    null,
  );
  const [healthStats, setHealthStats] = useState<HealthStats | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [recentAlerts, setRecentAlerts] = useState<HealthAlert[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    // Set up WebSocket connection
    healthService.onConnect(() => {
      setIsConnected(true);
    });

    healthService.onDisconnect(() => {
      setIsConnected(false);
    });

    healthService.onClusterHealthUpdate((data) => {
      setHealthData(data);
      setHealthStats(healthService.calculateHealthStats(data));
    });

    healthService.onAlert((alert) => {
      setRecentAlerts((prev) => [alert, ...prev.slice(0, 9)]); // Keep last 10 alerts
    });

    healthService.connect();

    // Initial data fetch
    handleRefreshData();

    return () => {
      healthService.disconnect();
    };
  }, []);

  const handleRefreshData = async () => {
    try {
      const data = await healthService.getClusterHealth();
      setHealthData(data);
      setHealthStats(healthService.calculateHealthStats(data));

      if (data.alerts) {
        setRecentAlerts(data.alerts.slice(0, 10));
      }
    } catch (error) {
      console.error("Failed to fetch health data:", error);
    }
  };

  const renderStatsOverview = () => {
    if (!healthStats) return null;

    return (
      <div className="health-stats-grid">
        <div className="stat-card nodes">
          <h3>🖥️ Nodes</h3>
          <div className="stat-number">{healthStats.totalNodes}</div>
          <div className="stat-breakdown">
            <span className="healthy">🟢 {healthStats.healthyNodes}</span>
            <span className="degraded">🟡 {healthStats.degradedNodes}</span>
            <span className="unhealthy">🔴 {healthStats.unhealthyNodes}</span>
          </div>
        </div>

        <div className="stat-card pods">
          <h3>📦 Pods</h3>
          <div className="stat-number">{healthStats.totalPods}</div>
          <div className="stat-breakdown">
            <span className="healthy">🟢 {healthStats.healthyPods}</span>
            <span className="unhealthy">🔴 {healthStats.unhealthyPods}</span>
            <span className="unknown">⚪ {healthStats.unknownPods}</span>
          </div>
        </div>

        <div className="stat-card alerts">
          <h3>🚨 Active Alerts</h3>
          <div className="stat-number">
            {healthStats.criticalAlerts + healthStats.warningAlerts}
          </div>
          <div className="stat-breakdown">
            <span className="critical">
              🔴 {healthStats.criticalAlerts} Critical
            </span>
            <span className="warning">
              🟡 {healthStats.warningAlerts} Warning
            </span>
          </div>
        </div>

        <div className="stat-card connection">
          <h3>🔗 Connection</h3>
          <div
            className={`connection-status ${isConnected ? "connected" : "disconnected"}`}
          >
            {isConnected ? "🟢 Connected" : "🔴 Disconnected"}
          </div>
          <div className="last-update">
            {healthData
              ? `Updated: ${new Date(healthData.timestamp).toLocaleTimeString()}`
              : "No data"}
          </div>
        </div>
      </div>
    );
  };

  const renderNodeHealth = (nodeName: string, nodeData: NodeHealthUpdate) => {
    const healthIcon = healthService.getHealthLevelIcon(nodeData.health_level);
    const healthColor = healthService.getHealthLevelColor(
      nodeData.health_level,
    );

    return (
      <div
        key={nodeName}
        className={`node-card ${selectedNode === nodeName ? "selected" : ""}`}
        onClick={() =>
          setSelectedNode(selectedNode === nodeName ? null : nodeName)
        }
      >
        <div className="node-header">
          <div className="node-title">
            <span className="node-icon">{healthIcon}</span>
            <strong>{nodeName}</strong>
            {nodeData.health_score !== undefined && (
              <span className="health-score" style={{ color: healthColor }}>
                ({nodeData.health_score}/100)
              </span>
            )}
          </div>
          <div className="node-status" style={{ color: healthColor }}>
            {nodeData.health_level || nodeData.status}
          </div>
        </div>

        <div className="node-stats">
          <span>📦 Pods: {nodeData.total_pods}</span>
          <span>✅ Healthy: {nodeData.healthy_pods}</span>
          <span>❌ Unhealthy: {nodeData.unhealthy_pods}</span>
          {nodeData.unknown_pods > 0 && (
            <span>⚪ Unknown: {nodeData.unknown_pods}</span>
          )}
        </div>

        {nodeData.health_reasons && nodeData.health_reasons.length > 0 && (
          <div className="health-reasons">
            <strong>Issues:</strong>
            {nodeData.health_reasons.map((reason, idx) => (
              <div key={idx} className="health-reason">
                ⚠️ {reason}
              </div>
            ))}
          </div>
        )}

        {nodeData.error && (
          <div className="node-error">
            <strong>Error:</strong> {nodeData.error}
          </div>
        )}
      </div>
    );
  };

  const renderPodDetails = () => {
    if (!selectedNode || !healthData?.nodes[selectedNode]) {
      return (
        <div className="pod-details-placeholder">
          <h3>📦 Pod Details</h3>
          <p>Select a node to view pod details</p>
        </div>
      );
    }

    const nodeData = healthData.nodes[selectedNode];
    const pods = nodeData.pods || [];

    return (
      <div className="pod-details">
        <h3>
          📦 Pods on {selectedNode} ({pods.length})
        </h3>
        <div className="pods-grid">
          {pods.map((pod: PodHealth) => (
            <div key={`${pod.namespace}/${pod.name}`} className="pod-card">
              <div className="pod-header">
                <span className="pod-icon">
                  {healthService.getHealthLevelIcon(pod.health_level)}
                </span>
                <div className="pod-info">
                  <strong>{pod.name}</strong>
                  <span className="pod-namespace">📁 {pod.namespace}</span>
                </div>
                {pod.health_score !== undefined && (
                  <span
                    className="pod-score"
                    style={{
                      color: healthService.getHealthLevelColor(
                        pod.health_level,
                      ),
                    }}
                  >
                    {pod.health_score}/100
                  </span>
                )}
              </div>

              <div className="pod-status">
                <span className={`phase-badge ${pod.phase.toLowerCase()}`}>
                  {pod.phase}
                </span>
                <span
                  className={`ready-badge ${pod.ready ? "ready" : "not-ready"}`}
                >
                  {pod.ready ? "Ready" : "Not Ready"}
                </span>
              </div>

              {pod.restart_count > 0 && (
                <div className="restart-count">
                  🔄 Restarts: {pod.restart_count}
                </div>
              )}

              {pod.health_reasons && pod.health_reasons.length > 0 && (
                <div className="pod-health-reasons">
                  {pod.health_reasons.map((reason, idx) => (
                    <div key={idx} className="pod-reason">
                      ⚠️ {reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderRecentAlerts = () => {
    return (
      <div className="recent-alerts">
        <div className="alerts-header">
          <h3>🚨 Recent Alerts</h3>
          {recentAlerts.length === 0 && (
            <span className="no-alerts">No recent alerts</span>
          )}
        </div>

        <div className="alerts-list">
          {recentAlerts.map((alert, idx) => (
            <div key={idx} className={`alert-item ${alert.severity}`}>
              <div className="alert-header">
                <span className="alert-icon">
                  {healthService.getSeverityIcon(alert.severity)}
                </span>
                <strong>{alert.severity.toUpperCase()}</strong>
                <span className="alert-source">({alert.source})</span>
                <span className="alert-time">
                  {new Date(alert.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="alert-message">{alert.message}</div>
              {alert.node_name && (
                <div className="alert-location">
                  🖥️ {alert.node_name}
                  {alert.pod_name &&
                    ` → 📦 ${alert.namespace}/${alert.pod_name}`}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="health-monitoring">
      <div className="health-header">
        <h1>🏥 Cluster Health Monitoring</h1>
        <div className="health-controls">
          <button onClick={handleRefreshData} className="refresh-btn">
            🔄 Refresh
          </button>
          <label className="auto-refresh">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <span
            className={`connection-indicator ${isConnected ? "connected" : "disconnected"}`}
          >
            {isConnected ? "🟢 Live" : "🔴 Offline"}
          </span>
        </div>
      </div>

      {renderStatsOverview()}

      <div className="health-content">
        <div className="left-panel">
          <div className="nodes-section">
            <h2>🖥️ Nodes Health</h2>
            <div className="nodes-grid">
              {healthData &&
                Object.entries(healthData.nodes).map(([nodeName, nodeData]) =>
                  renderNodeHealth(nodeName, nodeData),
                )}
            </div>
          </div>
        </div>

        <div className="right-panel">
          {renderPodDetails()}
          {renderRecentAlerts()}
        </div>
      </div>
    </div>
  );
};

export default HealthMonitoring;
