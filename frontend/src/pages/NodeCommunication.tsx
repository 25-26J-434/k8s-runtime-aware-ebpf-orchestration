import React, { useState, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import '../pages/Page.css';

interface CommunicationStats {
  broadcast: number;
  unicast: number;
  multicast: number;
  total: number;
  nodes_sent: Record<string, number>;
  nodes_recv: Record<string, number>;
}

interface LogEntry {
  timestamp: string;
  node: string;
  node_ip: string;
  type: string;
  event: string;
  message: string;
  targets: string;
}

interface NodeInfo {
  name: string;
  ip: string;
}

const NodeCommunication: React.FC = () => {
  const [stats, setStats] = useState<CommunicationStats>({
    broadcast: 0,
    unicast: 0,
    multicast: 0,
    total: 0,
    nodes_sent: {},
    nodes_recv: {},
  });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [selectedSender, setSelectedSender] = useState<string>('');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [communicationType, setCommunicationType] = useState<'BROADCAST' | 'UNICAST' | 'MULTICAST'>('BROADCAST');
  const [eventType, setEventType] = useState<string>('DISCOVERY');
  const [loading, setLoading] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const COMM_TYPES = [
    { value: 'BROADCAST', label: '📡 Broadcast', color: '#3b82f6' },
    { value: 'UNICAST', label: '🎯 Unicast', color: '#10b981' },
    { value: 'MULTICAST', label: '🔄 Multicast', color: '#f59e0b' },
  ];

  const EVENT_TYPES = [
    'DISCOVERY',
    'HANDSHAKE',
    'SCHEDULING',
    'STATE_UPDATE',
    'METRIC_UPDATE',
    'ERROR',
  ];

  // Fetch nodes
  useEffect(() => {
    fetchNodes();
  }, []);

  // Fetch stats and logs
  useEffect(() => {
    fetchStats();
    fetchLogs();

    const interval = setInterval(() => {
      fetchStats();
      fetchLogs();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const fetchNodes = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/nodes');
      if (response.ok) {
        const data = await response.json();
        setNodes(data || []);
        if (data && data.length > 0) {
          setSelectedSender(data[0].ip);
        }
      }
    } catch (error) {
      console.error('Failed to fetch nodes:', error);
      // Fallback to hardcoded nodes
      const fallbackNodes: NodeInfo[] = [
        { name: 'node-1', ip: '172.18.0.2' },
        { name: 'node-2', ip: '172.18.0.3' },
        { name: 'node-3', ip: '172.18.0.4' },
      ];
      setNodes(fallbackNodes);
      setSelectedSender(fallbackNodes[0].ip);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/stats');
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const fetchLogs = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/logs');
      if (response.ok) {
        const data = await response.json();
        setLogs(data || []);
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedSender) {
      alert('Please select a sender');
      return;
    }

    if (communicationType === 'UNICAST' && selectedRecipients.length !== 1) {
      alert('Unicast requires exactly 1 recipient');
      return;
    }

    if (communicationType === 'MULTICAST' && selectedRecipients.length === 0) {
      alert('Multicast requires at least 1 recipient');
      return;
    }

    setLoading(true);
    try {
      setStatusMessage(null);
      const response = await fetch('http://localhost:8000/api/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender_ip: selectedSender,
          type: communicationType,
          event: eventType,
          targets: selectedRecipients.length > 0 ? selectedRecipients : undefined,
          payload: {
            timestamp: new Date().toISOString(),
          },
        }),
      });

      if (response.ok) {
        setStatusMessage('Message sent successfully.');
        fetchStats();
        fetchLogs();
      } else {
        const error = await response.json();
        setStatusMessage(`Error: ${error.message}`);
      }
    } catch (error) {
      setStatusMessage(`Failed to send message: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBroadcastAllData = async () => {
    if (!selectedSender) {
      alert('Please select a sender');
      return;
    }

    setBroadcasting(true);
    setStatusMessage(null);

    try {
      const response = await fetch('http://localhost:8000/api/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender_ip: selectedSender,
          type: 'BROADCAST',
          event: eventType,
          payload: {
            timestamp: new Date().toISOString(),
            nodes,
            stats,
            note: 'Cluster-wide broadcast triggered from dashboard',
          },
        }),
      });

      if (response.ok) {
        setStatusMessage('Broadcast sent to all nodes.');
        setCommunicationType('BROADCAST');
        setSelectedRecipients([]);
        fetchStats();
        fetchLogs();
      } else {
        const error = await response.json();
        setStatusMessage(`Broadcast failed: ${error.message}`);
      }
    } catch (error) {
      setStatusMessage(`Broadcast failed: ${error}`);
    } finally {
      setBroadcasting(false);
    }
  };

  const toggleRecipient = (ip: string) => {
    if (communicationType === 'UNICAST') {
      setSelectedRecipients(selectedRecipients[0] === ip ? [] : [ip]);
    } else {
      setSelectedRecipients((prev) =>
        prev.includes(ip) ? prev.filter((x) => x !== ip) : [...prev, ip]
      );
    }
  };

  const commTypeObj = COMM_TYPES.find((c) => c.value === communicationType);

  // Chart data for communication types
  const chartData = [
    { name: 'Broadcast', value: stats.broadcast, fill: '#3b82f6' },
    { name: 'Unicast', value: stats.unicast, fill: '#10b981' },
    { name: 'Multicast', value: stats.multicast, fill: '#f59e0b' },
  ];

  // Bar chart data for nodes
  const nodeData = Object.entries(stats.nodes_sent || {}).map(([ip, sent]) => ({
    node: ip,
    sent,
    received: stats.nodes_recv?.[ip] || 0,
  }));

  return (
    <div className="page-container">
      <style>{`
        .comm-page {
          display: grid;
          grid-template-columns: 1fr;
          gap: 24px;
          padding: 24px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
        }

        .comm-header {
          color: white;
          text-align: center;
          margin-bottom: 12px;
        }

        .comm-header h1 {
          font-size: 32px;
          margin: 0 0 8px 0;
          font-weight: bold;
        }

        .comm-header p {
          font-size: 14px;
          opacity: 0.9;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }

        .stat-card {
          background: white;
          padding: 20px;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          text-align: center;
        }

        .stat-card h3 {
          font-size: 12px;
          color: #666;
          margin: 0 0 8px 0;
          text-transform: uppercase;
          font-weight: 600;
        }

        .stat-card .value {
          font-size: 32px;
          font-weight: bold;
          color: #333;
          margin: 0;
        }

        .control-panel {
          background: white;
          padding: 24px;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        .control-panel h2 {
          margin-top: 0;
          color: #333;
          font-size: 20px;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          margin-bottom: 8px;
          color: #333;
          font-weight: 600;
          font-size: 14px;
        }

        .form-group select,
        .form-group input {
          width: 100%;
          padding: 10px;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          font-size: 14px;
          transition: border-color 0.2s;
        }

        .form-group select:focus,
        .form-group input:focus {
          outline: none;
          border-color: #667eea;
        }

        .comm-type-selector {
          display: flex;
          gap: 12px;
          margin-bottom: 20px;
        }

        .comm-type-btn {
          flex: 1;
          padding: 12px;
          border: 2px solid #e5e7eb;
          background: white;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
          transition: all 0.2s;
        }

        .comm-type-btn.active {
          background: ${commTypeObj?.color};
          color: white;
          border-color: ${commTypeObj?.color};
        }

        .recipients-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }

        .recipient-btn {
          padding: 12px;
          border: 2px solid #e5e7eb;
          background: white;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          transition: all 0.2s;
          text-align: center;
        }

        .recipient-btn.selected {
          background: #667eea;
          color: white;
          border-color: #667eea;
        }

        .send-btn {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s;
        }

        .send-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 12px rgba(102, 126, 234, 0.4);
        }

        .send-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .charts-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 20px;
          margin: 24px 0;
        }

        .chart-card {
          background: white;
          padding: 20px;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        .chart-card h3 {
          margin-top: 0;
          color: #333;
          font-size: 16px;
          margin-bottom: 16px;
        }

        .logs-panel {
          background: white;
          padding: 20px;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        .logs-panel h2 {
          margin-top: 0;
          color: #333;
          font-size: 20px;
        }

        .logs-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        .logs-table th {
          background: #f3f4f6;
          padding: 12px;
          text-align: left;
          color: #333;
          font-weight: 600;
          border-bottom: 2px solid #e5e7eb;
        }

        .logs-table td {
          padding: 12px;
          border-bottom: 1px solid #e5e7eb;
          color: #666;
        }

        .log-type-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-weight: 600;
          font-size: 11px;
        }

        .type-broadcast {
          background: #dbeafe;
          color: #0369a1;
        }

        .type-unicast {
          background: #dcfce7;
          color: #166534;
        }

        .type-multicast {
          background: #fef3c7;
          color: #92400e;
        }

        .logs-empty {
          text-align: center;
          color: #999;
          padding: 40px 20px;
        }
      `}</style>

      <div className="comm-page">
        <div className="comm-header">
          <h1>📡 Node Communication Center</h1>
          <p>Real-time inter-node communication monitoring and control</p>
        </div>

        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <h3>Total Messages</h3>
            <p className="value">{stats.total}</p>
          </div>
          <div className="stat-card">
            <h3>Broadcasts</h3>
            <p className="value" style={{ color: '#3b82f6' }}>{stats.broadcast}</p>
          </div>
          <div className="stat-card">
            <h3>Unicasts</h3>
            <p className="value" style={{ color: '#10b981' }}>{stats.unicast}</p>
          </div>
          <div className="stat-card">
            <h3>Multicasts</h3>
            <p className="value" style={{ color: '#f59e0b' }}>{stats.multicast}</p>
          </div>
        </div>

        {/* Control Panel */}
        <div className="control-panel">
          <h2>Send Message</h2>

          {/* Sender Selection */}
          <div className="form-group">
            <label>Sender Node</label>
            <select value={selectedSender} onChange={(e) => setSelectedSender(e.target.value)}>
              <option value="">-- Select Sender --</option>
              {nodes.map((node) => (
                <option key={node.ip} value={node.ip}>
                  {node.name} ({node.ip})
                </option>
              ))}
            </select>
          </div>

          {/* Communication Type */}
          <div className="form-group">
            <label>Communication Type</label>
            <div className="comm-type-selector">
              {COMM_TYPES.map((type) => (
                <button
                  key={type.value}
                  className={`comm-type-btn ${communicationType === type.value ? 'active' : ''}`}
                  onClick={() => {
                    setCommunicationType(type.value as typeof communicationType);
                    setSelectedRecipients([]);
                  }}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Recipients (for Unicast/Multicast) */}
          {(communicationType === 'UNICAST' || communicationType === 'MULTICAST') && (
            <div className="form-group">
              <label>
                {communicationType === 'UNICAST' ? 'Select Recipient' : 'Select Recipients'}
              </label>
              <div className="recipients-grid">
                {nodes.map((node) => (
                  <button
                    key={node.ip}
                    className={`recipient-btn ${selectedRecipients.includes(node.ip) ? 'selected' : ''}`}
                    onClick={() => toggleRecipient(node.ip)}
                    disabled={node.ip === selectedSender}
                  >
                    {node.name}
                    <br />
                    <small>{node.ip}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Event Type */}
          <div className="form-group">
            <label>Event Type</label>
            <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
              {EVENT_TYPES.map((event) => (
                <option key={event} value={event}>
                  {event}
                </option>
              ))}
            </select>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'grid', gap: '12px' }}>
            <button
              className="send-btn"
              onClick={handleSendMessage}
              disabled={!selectedSender || loading}
            >
              {loading ? 'Sending...' : 'Send Message'}
            </button>
            <button
              className="send-btn"
              style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)' }}
              onClick={handleBroadcastAllData}
              disabled={!selectedSender || broadcasting}
            >
              {broadcasting ? 'Broadcasting…' : 'Broadcast Cluster Data'}
            </button>
            {statusMessage && (
              <div
                style={{
                  background: 'rgba(255,255,255,0.85)',
                  color: '#1f2937',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  fontSize: '13px',
                  textAlign: 'center',
                  border: '1px solid rgba(31,41,55,0.1)',
                }}
              >
                {statusMessage}
              </div>
            )}
          </div>
        </div>

        {/* Charts */}
        <div className="charts-grid">
          <div className="chart-card">
            <h3>Communication Type Distribution</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card">
            <h3>Messages per Node</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={nodeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="node" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="sent" fill="#3b82f6" name="Sent" />
                <Bar dataKey="received" fill="#10b981" name="Received" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Logs */}
        <div className="logs-panel">
          <h2>Communication Logs</h2>
          {logs.length === 0 ? (
            <div className="logs-empty">No logs yet. Send a message to see logs appear here.</div>
          ) : (
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Node</th>
                  <th>Type</th>
                  <th>Event</th>
                  <th>Message</th>
                  <th>Targets</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, index) => (
                  <tr key={index}>
                    <td>{log.timestamp}</td>
                    <td>{log.node}</td>
                    <td>
                      <span
                        className={`log-type-badge type-${log.type.toLowerCase()}`}
                      >
                        {log.type}
                      </span>
                    </td>
                    <td>{log.event}</td>
                    <td>{log.message}</td>
                    <td>{log.targets || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default NodeCommunication;
