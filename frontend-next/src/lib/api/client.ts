import { ApiError } from "./errors";

const BASE = "/api/v1";

type Options = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  /** Resolve plain-text endpoints (service probes, whoami). */
  text?: boolean;
};

function buildUrl(path: string, query?: Options["query"]) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== "") params.set(k, String(v));
  }
  const qs = params.toString();
  return `${BASE}/${path.replace(/^\//, "")}${qs ? `?${qs}` : ""}`;
}

/** The one browser-side HTTP client. Everything goes through the same-origin BFF. */
export async function apiRequest<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? "GET",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Network error", 0);
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let body: unknown = raw;
    try {
      body = JSON.parse(raw);
    } catch {}
    const detail =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : raw;
    throw new ApiError(detail || `${res.status} ${res.statusText}`, res.status, body);
  }

  if (opts.text) return (await res.text()) as T;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
