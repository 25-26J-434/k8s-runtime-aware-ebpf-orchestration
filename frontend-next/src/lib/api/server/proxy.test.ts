import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxyRequest } from "./proxy";
import { resolveUpstream } from "./upstream";

describe("resolveUpstream (BFF allowlist)", () => {
  it("sends routing endpoints to the routing service", () => {
    for (const p of ["policies", "policies/x/evaluate", "rules", "redirections", "probe/svc", "cluster/summary"]) {
      expect(resolveUpstream(p)?.upstream, p).toBe("routing");
    }
  });
  it("sends rule CRUD, namespaces, deployments and placement to the scaling service", () => {
    for (const p of ["scaling/rules", "scaling/rules/abc", "scaling/namespaces", "scaling/deployments", "scaling/pods"]) {
      expect(resolveUpstream(p)?.upstream, p).toBe("scaling");
    }
  });
  it("keeps scaling/metrics on the core daemon, as the legacy console did", () => {
    expect(resolveUpstream("scaling/metrics/latest")?.upstream).toBe("backend");
  });
  it("keeps cluster endpoints other than summary on the core daemon", () => {
    expect(resolveUpstream("cluster/node-health")?.upstream).toBe("backend");
    expect(resolveUpstream("cluster/topology")?.target).toBe("/api/cluster/topology");
  });
  it("rejects anything that is not listed", () => {
    for (const p of ["secrets", "admin", "scaling", "policiesx", ""]) expect(resolveUpstream(p), p).toBeNull();
  });
});

describe("proxyRequest", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    process.env.BACKEND_API_URL = "http://backend.test";
    process.env.ROUTING_API_URL = "http://routing.test";
    delete process.env.SCALING_API_URL;
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("forwards method, query string, body and content type to the right upstream", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 201, headers: { "content-type": "application/json" } }));
    const req = new Request("http://app/api/v1/policies?x=1&y=a%20b", { method: "POST", headers: { "content-type": "application/json", cookie: "secret=1" }, body: '{"a":1}' });
    const res = await proxyRequest(req, ["policies"]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://routing.test/api/policies?x=1&y=a%20b");
    expect(init.method).toBe("POST");
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"a":1}');
    expect((init.headers as Headers).get("content-type")).toBe("application/json");
    expect((init.headers as Headers).get("cookie")).toBeNull(); // browser cookies never reach the daemon
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("passes upstream error statuses through unchanged", async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"nope"}', { status: 418, headers: { "content-type": "application/json" } }));
    const res = await proxyRequest(new Request("http://app/api/v1/dns/pods"), ["dns", "pods"]);
    expect(res.status).toBe(418);
  });

  it("returns 204 without a body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await proxyRequest(new Request("http://app/api/v1/policies/x", { method: "DELETE" }), ["policies", "x"]);
    expect(res.status).toBe(204);
  });

  it("404s unknown routes without calling the daemon", async () => {
    const res = await proxyRequest(new Request("http://app/api/v1/secrets"), ["secrets"]);
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects path traversal, including encoded", async () => {
    for (const segs of [["metrics", ".."], ["metrics", "%2e%2e"], [".", "metrics"]]) {
      const res = await proxyRequest(new Request("http://app/api/v1/x"), segs);
      expect(res.status, segs.join("/")).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 502 when the daemon is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await proxyRequest(new Request("http://app/api/v1/metrics"), ["metrics"]);
    expect(res.status).toBe(502);
  });

  it("answers 504 on timeout", async () => {
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const res = await proxyRequest(new Request("http://app/api/v1/metrics"), ["metrics"]);
    expect(res.status).toBe(504);
  });
});
