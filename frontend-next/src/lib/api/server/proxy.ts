import "server-only";
import { resolveUpstream, upstreamBase } from "./upstream";

const TIMEOUT_MS = Number(process.env.BACKEND_TIMEOUT_MS) || 15000;
const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", "authorization"];
const FORWARDED_RESPONSE_HEADERS = ["content-type", "cache-control"];

function problem(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

/** Forwards a BFF request to the daemon, preserving method, query, body, status and content type. */
export async function proxyRequest(req: Request, segments: string[]): Promise<Response> {
  const path = segments.map(decodeURIComponent).join("/");
  if (path.split("/").some((s) => s === ".." || s === ".")) return problem(400, "Invalid path");

  const resolved = resolveUpstream(path);
  if (!resolved) return problem(404, `Unknown API route: ${path}`);

  const url = new URL(req.url);
  const target = `${upstreamBase(resolved.upstream)}${resolved.target}${url.search}`;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)]);

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: "no-store",
      signal,
    });
    const out = new Headers();
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    // 204/304 must not carry a body.
    const noBody = upstream.status === 204 || upstream.status === 304;
    return new Response(noBody ? null : upstream.body, { status: upstream.status, headers: out });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return problem(504, "Backend request timed out");
    }
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return problem(502, "Backend unavailable");
  }
}
