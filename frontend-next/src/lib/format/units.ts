/**
 * Unit conversion and formatting. The daemon reports DNS/RTT in nanoseconds and TCP in
 * microseconds; every conversion happens here so units are never mixed implicitly.
 */
export const nsToUs = (ns: number) => ns / 1_000;
export const usToMs = (us: number) => us / 1_000;

const num = (n: number, digits: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);

const ok = (v: number | undefined | null): v is number => v != null && Number.isFinite(v);

export function formatMicros(us: number | undefined | null): string {
  if (!ok(us)) return "—";
  if (us >= 1_000_000) return `${num(us / 1_000_000, 2)} s`;
  if (us >= 1_000) return `${num(us / 1_000, 2)} ms`;
  return `${num(us, 1)} µs`;
}

export function formatNanos(ns: number | undefined | null): string {
  return ok(ns) ? formatMicros(nsToUs(ns)) : "—";
}

export function formatPercent(v: number | undefined | null, digits = 1): string {
  return ok(v) ? `${num(v, digits)}%` : "—";
}

export function formatCount(v: number | undefined | null): string {
  if (!ok(v)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: v >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(v);
}

export function formatMegabytes(mb: number | undefined | null): string {
  if (!ok(mb)) return "—";
  return mb >= 1024 ? `${num(mb / 1024, 2)} GB` : `${num(mb, 0)} MB`;
}

export function formatBytes(bytes: number | undefined | null): string {
  if (!ok(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${num(v, i === 0 ? 0 : 1)} ${units[i]}`;
}
