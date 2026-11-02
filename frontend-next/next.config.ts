import path from "node:path";
import type { NextConfig } from "next";

const backend = process.env.BACKEND_API_URL ?? "http://localhost:8080";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: path.resolve(__dirname) },
  // Self-hosted WebSocket pass-through to the daemon. Next's node server forwards upgrade
  // requests for rewrites; behind a CDN/serverless host use a reverse proxy instead
  // (see README). Browser-facing paths are same-origin and carry no backend URL.
  async rewrites() {
    return [
      { source: "/ws/cluster-metrics", destination: `${backend}/api/metrics/ws` },
      { source: "/ws/node-health", destination: `${backend}/ws/node-health` },
      { source: "/ws/topology", destination: `${backend}/ws/topology` },
      { source: "/ws/pod-details", destination: `${backend}/ws/pod-details` },
    ];
  },
};

export default config;
