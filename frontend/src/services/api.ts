import type { MetricsResponse, ClusterTopology, Service } from '../types/api';

const API_BASE = '';  // Proxy handles routing

export const api = {
    async getMetrics(): Promise<MetricsResponse> {
        const response = await fetch(`${API_BASE}/metrics/json`);
        if (!response.ok) throw new Error('Failed to fetch metrics');
        return response.json();
    },

    async getClusterTopology(): Promise<ClusterTopology> {
        const response = await fetch(`${API_BASE}/api/cluster/topology`);
        if (!response.ok) throw new Error('Failed to fetch cluster topology');
        return response.json();
    },

    async getServices(): Promise<Service[]> {
        const response = await fetch(`${API_BASE}/api/cluster/services`);
        if (!response.ok) throw new Error('Failed to fetch services');
        const data = await response.json();
        return data.services || [];
    },

    async getPodDNSMetrics() {
        const response = await fetch(`${API_BASE}/api/dns/pods`);
        if (!response.ok) throw new Error('Failed to fetch pod DNS metrics');
        return response.json();
    },
};
