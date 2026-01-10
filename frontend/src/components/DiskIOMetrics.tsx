import React from 'react';
import './DiskIOMetrics.css';

interface DiskIOData {
  total_reads: number;
  avg_read_latency_ns: number;
  max_read_latency_ns: number;
  total_read_bytes: number;
  total_writes: number;
  avg_write_latency_ns: number;
  max_write_latency_ns: number;
  total_write_bytes: number;
  total_opens: number;
  total_closes: number;
  current_queue_depth: number;
  max_queue_depth: number;
  avg_queue_depth: number;
  total_io_operations: number;
  total_io_bytes: number;
  avg_io_latency_ns: number;
}

interface DiskIOMetricsProps {
  data?: DiskIOData;
  title?: string;
  compact?: boolean;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

const formatLatency = (ns: number): string => {
  if (ns < 1000) return `${ns.toFixed(0)} ns`;
  if (ns < 1000000) return `${(ns / 1000).toFixed(2)} μs`;
  if (ns < 1000000000) return `${(ns / 1000000).toFixed(2)} ms`;
  return `${(ns / 1000000000).toFixed(2)} s`;
};

const DiskIOMetrics: React.FC<DiskIOMetricsProps> = ({ data, title = "Disk I/O Metrics", compact = false }) => {
  if (!data) {
    return (
      <div className="disk-io-card">
        <h3>{title}</h3>
        <p className="no-data">No disk I/O data available</p>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="disk-io-card compact">
        <h4>{title}</h4>
        <div className="disk-io-summary">
          <div className="io-stat">
            <span className="label">Total I/O:</span>
            <span className="value">{data.total_io_operations.toLocaleString()}</span>
          </div>
          <div className="io-stat">
            <span className="label">Avg Latency:</span>
            <span className="value">{formatLatency(data.avg_io_latency_ns)}</span>
          </div>
          <div className="io-stat">
            <span className="label">Throughput:</span>
            <span className="value">{formatBytes(data.total_io_bytes)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="metrics-grid">
      <div className="stat-card disk-io">
        <div className="stat-header">
          <h3>Disk I/O Operations</h3>
        </div>
        <div className="stat-value">{data.total_io_operations.toLocaleString()}</div>
        <div className="stat-details">
          <span className="stat-label">Total Operations</span>
          <span className="stat-sublabel">
            Reads: {data.total_reads.toLocaleString()} | Writes: {data.total_writes.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="stat-card disk-io-latency">
        <div className="stat-header">
          <h3>I/O Latency</h3>
        </div>
        <div className="stat-value">{formatLatency(data.avg_io_latency_ns)}</div>
        <div className="stat-details">
          <span className="stat-label">Average Latency</span>
          <span className="stat-range">
            Read: {formatLatency(data.avg_read_latency_ns)} • Write: {formatLatency(data.avg_write_latency_ns)}
          </span>
        </div>
      </div>

      <div className="stat-card disk-io-throughput">
        <div className="stat-header">
          <h3>Throughput</h3>
        </div>
        <div className="stat-value" style={{fontSize: '1.2rem'}}>
          <div style={{marginBottom: '0.5rem'}}>Read: {formatBytes(data.total_read_bytes)}</div>
          <div>Write: {formatBytes(data.total_write_bytes)}</div>
        </div>
        <div className="stat-details">
          <span className="stat-label">Total Data Transferred</span>
          <span className="stat-range">Combined: {formatBytes(data.total_io_bytes)}</span>
        </div>
      </div>

      <div className="stat-card disk-io-queue">
        <div className="stat-header">
          <h3>Queue Depth</h3>
        </div>
        <div className="stat-value">{data.current_queue_depth}</div>
        <div className="stat-details">
          <span className="stat-label">Current Depth</span>
          <span className="stat-range">
            Avg: {data.avg_queue_depth.toFixed(1)} • Max: {data.max_queue_depth}
          </span>
        </div>
      </div>

      <div className="stat-card disk-io-files">
        <div className="stat-header">
          <h3>File Operations</h3>
        </div>
        <div className="stat-value" style={{fontSize: '1.2rem'}}>
          <div style={{marginBottom: '0.5rem'}}>Opens: {data.total_opens.toLocaleString()}</div>
          <div>Closes: {data.total_closes.toLocaleString()}</div>
        </div>
        <div className="stat-details">
          <span className="stat-label">File Activity</span>
        </div>
      </div>

      <div className="stat-card disk-io-max-latency">
        <div className="stat-header">
          <h3>Peak Latency</h3>
        </div>
        <div className="stat-value" style={{fontSize: '1.2rem'}}>
          <div style={{marginBottom: '0.5rem'}}>Read: {formatLatency(data.max_read_latency_ns)}</div>
          <div>Write: {formatLatency(data.max_write_latency_ns)}</div>
        </div>
        <div className="stat-details">
          <span className="stat-label">Maximum Observed</span>
        </div>
      </div>
    </div>
  );
};

const FullDiskIOCard: React.FC<DiskIOMetricsProps> = ({ data, title = "Disk I/O Metrics" }) => {
  if (!data) {
    return (
      <div className="disk-io-card">
        <h3>{title}</h3>
        <p className="no-data">No disk I/O data available</p>
      </div>
    );
  }

  return (
    <div className="disk-io-card">
      <h3>{title}</h3>
      
      <div className="disk-io-section">
        <h4>Read Operations</h4>
        <div className="metrics-grid">
          <div className="metric-item">
            <span className="metric-label">Total Reads</span>
            <span className="metric-value">{data.total_reads.toLocaleString()}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Avg Latency</span>
            <span className="metric-value">{formatLatency(data.avg_read_latency_ns)}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Max Latency</span>
            <span className="metric-value">{formatLatency(data.max_read_latency_ns)}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Bytes Read</span>
            <span className="metric-value">{formatBytes(data.total_read_bytes)}</span>
          </div>
        </div>
      </div>

      <div className="disk-io-section">
        <h4>Write Operations</h4>
        <div className="metrics-grid">
          <div className="metric-item">
            <span className="metric-label">Total Writes</span>
            <span className="metric-value">{data.total_writes.toLocaleString()}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Avg Latency</span>
            <span className="metric-value">{formatLatency(data.avg_write_latency_ns)}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Max Latency</span>
            <span className="metric-value">{formatLatency(data.max_write_latency_ns)}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Bytes Written</span>
            <span className="metric-value">{formatBytes(data.total_write_bytes)}</span>
          </div>
        </div>
      </div>

      <div className="disk-io-section">
        <h4>File Operations & Queue</h4>
        <div className="metrics-grid">
          <div className="metric-item">
            <span className="metric-label">Files Opened</span>
            <span className="metric-value">{data.total_opens.toLocaleString()}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Files Closed</span>
            <span className="metric-value">{data.total_closes.toLocaleString()}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Current Queue Depth</span>
            <span className="metric-value">{data.current_queue_depth}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Max Queue Depth</span>
            <span className="metric-value">{data.max_queue_depth}</span>
          </div>
        </div>
      </div>

      <div className="disk-io-summary-bar">
        <div className="summary-item">
          <span className="summary-label">Total I/O Operations</span>
          <span className="summary-value large">{data.total_io_operations.toLocaleString()}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Total Data Transferred</span>
          <span className="summary-value large">{formatBytes(data.total_io_bytes)}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Overall Avg Latency</span>
          <span className="summary-value large">{formatLatency(data.avg_io_latency_ns)}</span>
        </div>
      </div>
    </div>
  );
};

export default DiskIOMetrics;

