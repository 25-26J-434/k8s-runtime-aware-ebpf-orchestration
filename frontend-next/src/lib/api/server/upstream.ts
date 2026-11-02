import "server-only";

export type Upstream = "backend" | "routing" | "scaling";

const backend = () => process.env.BACKEND_API_URL ?? "http://localhost:8080";

export function upstreamBase(upstream: Upstream): string {
  switch (upstream) {
    case "routing":
      return process.env.ROUTING_API_URL || backend();
    case "scaling":
      return process.env.SCALING_API_URL || backend();
    default:
      return backend();
  }
}

/**
 * Maps a BFF path (the part after /api/v1/) to the upstream that serves it and the
 * daemon path. Mirrors the split the legacy frontend used (API_BASE / ROUTING_API_BASE /
 * SCALING_API_BASE). Anything not listed here is rejected: the BFF is an allowlist,
 * not an open proxy.
 */
const ROUTING_PREFIXES = ["policies", "rules", "redirections", "probe", "cluster/summary"];
const SCALING_PREFIXES = [
  "scaling/rules",
  "scaling/namespaces",
  "scaling/deployments",
  "scaling/pods",
];
const BACKEND_PREFIXES = [
  "metrics",
  "metrics-config",
  "disk",
  "dns",
  "sched",
  "connections",
  "pod",
  "cluster",
  "scaling/metrics",
  "comm",
  "extensions",
];

const startsWith = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

export function resolveUpstream(path: string): { upstream: Upstream; target: string } | null {
  if (startsWith(path, ROUTING_PREFIXES)) return { upstream: "routing", target: `/api/${path}` };
  if (startsWith(path, SCALING_PREFIXES)) return { upstream: "scaling", target: `/api/${path}` };
  if (startsWith(path, BACKEND_PREFIXES)) return { upstream: "backend", target: `/api/${path}` };
  return null;
}
