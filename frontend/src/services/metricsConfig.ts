const API_BASE = 'http://localhost:8080';

export interface MetricsConfig {
  dns_latency_threshold: number;
  dns_latency_penalty: number;
  tcp_retrans_threshold: number;
  tcp_retrans_penalty: number;
  packet_loss_threshold: number;
  packet_loss_penalty: number;
  rtt_threshold: number;
  rtt_penalty: number;
  restart_count_threshold: number;
  restart_count_penalty: number;
}

export const metricsConfigService = {
  /**
   * Fetch the current metrics configuration from the backend
   */
  async getConfig(): Promise<MetricsConfig> {
    try {
      const response = await fetch(`${API_BASE}/api/metrics-config`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Failed to fetch metrics config:', error);
      throw error;
    }
  },

  /**
   * Update the metrics configuration on the backend
   */
  async updateConfig(config: MetricsConfig): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/api/metrics-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
    } catch (error) {
      console.error('Failed to update metrics config:', error);
      throw error;
    }
  }
};
