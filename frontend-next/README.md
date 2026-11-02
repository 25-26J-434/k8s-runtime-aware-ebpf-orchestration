# Kernel Eye console (Next.js)

A rebuild of the `frontend/` console on Next.js App Router, Ant Design, TanStack Query and ECharts. The legacy `frontend/` app is untouched and keeps working; this app lives beside it and talks to the same daemon.

## Run

```bash
cd frontend-next
cp .env.example .env.local      # set BACKEND_API_URL
npm install
npm run dev                     # http://localhost:3100
```

Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Environment

| Variable | Scope | Purpose |
|---|---|---|
| `BACKEND_API_URL` | server only | Daemon base URL. Read at runtime by the REST BFF **and at build time** by the WebSocket rewrites (see below). |
| `ROUTING_API_URL` | server only | Routing service; defaults to `BACKEND_API_URL`. |
| `SCALING_API_URL` | server only | Scaling service; defaults to `BACKEND_API_URL`. |
| `BACKEND_TIMEOUT_MS` | server only | BFF upstream timeout, default 15000. |
| `NEXT_PUBLIC_WS_ORIGIN` | public | Optional WebSocket gateway origin (`wss://host`). Empty = same origin. |

No internal backend URL reaches the browser bundle.

## Architecture

```
Browser ──REST──► /api/v1/*  (Route Handler, BFF) ──► daemon /api/*
        ──WS────► /ws/*      (Next rewrite or reverse proxy) ──► daemon WS paths
```

- **BFF** — `src/app/api/v1/[...path]/route.ts` is one thin catch-all over `src/lib/api/server/proxy.ts`. It is an **allowlist** (`upstream.ts`), not an open proxy: unknown prefixes return 404. It forwards method, query string, body, content type and status, enforces a timeout, and returns 502/504 when the daemon is unreachable. Routing, scaling and core endpoints are split across `ROUTING_API_URL` / `SCALING_API_URL` / `BACKEND_API_URL` the same way the legacy app split them.
- **Client** — `src/lib/api/client.ts` is the only browser HTTP client; errors are `ApiError` with a `retryable` flag that drives TanStack Query retries.
- **Server state** — TanStack Query, one client per browser, key factories next to each feature (`health.keys.ts`, `federationKeys`).
- **Real time** — `ManagedSocket` (`src/lib/websocket/managed-socket.ts`): backoff reconnect, silence watchdog, safe JSON parsing. Metrics use a single shared connection mounted in the app shell and a small Zustand store, so no chart opens its own socket. Health and topology stream into the query cache, with REST polling while the socket is down. Health drops snapshots whose `seq` is older than the cached one and keeps the alert relay to federation.
- **Units** — `src/lib/metrics/transform.ts` is the only raw→view-model conversion (DNS/RTT ns→µs; TCP already µs); `src/lib/format/units.ts` is the only formatting. Scaling metrics are nanoseconds (`daemon/pkg/scaling/metrics.go`).
- **UI** — Ant Design 6 with a compact, neutral theme (`src/lib/theme/theme.ts`, light and dark; one muted blue, 4px radii, no shadows). Structure over decoration: titled sections with a rule instead of cards, one stat strip per section instead of KPI card grids, status as dot + text instead of chips. `src/app/antd-registry.tsx` injects antd's SSR styles once; toasts go through `src/lib/notify.ts`.
- **Menu** — mirrors the legacy console (`frontend/src/components/Navigation.tsx`): Dashboard (10 scroll-to sections, same ids), Health, Topology, Routing, Scaling, Federation, Extensions (submenu from `GET /api/extensions`, falling back to Notification). Routing, Scaling and Extensions show a "legacy" marker and an in-app notice. `/deployments` and `/scheduling` exist as routes but, like the legacy app, are not in the menu.

## Deployment

REST works anywhere Next runs. **WebSockets are the constraint:** the `/ws/*` paths are forwarded by `rewrites()` in `next.config.ts`. Verified against a stand-in WebSocket server on `next start` (self-hosted Node), including `/ws/cluster-metrics` → `/api/metrics/ws`. Two consequences:

1. Rewrite destinations are fixed **at build time**: build with `BACKEND_API_URL` set (`BACKEND_API_URL=http://daemon:8080 npm run build`). Changing it later needs a rebuild; the REST BFF does not.
2. Serverless or CDN hosts generally do not proxy WebSocket upgrades. There, route `/ws/*` at a reverse proxy instead (or set `NEXT_PUBLIC_WS_ORIGIN`). Example nginx:

```nginx
location /ws/cluster-metrics { proxy_pass http://daemon:8080/api/metrics/ws; proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
location /ws/ { proxy_pass http://daemon:8080/ws/; proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
location / { proxy_pass http://127.0.0.1:3100; }
```

The daemon has no authentication today and neither does this app. If the daemon gains auth, add it in the BFF (it already forwards `Authorization`).

## Migration status

| Area | Status |
|---|---|
| Foundation (Next, Ant Design theme, shell, Query, BFF, WS, units) | done |
| Dashboard | done — the legacy ten sections (health, node, system, DNS, TCP incl. recent events, disk I/O, CPU scheduling, performance, pod metrics, service health with endpoints) |
| Health | done — nodes, pods (filter/sort/paginate), alerts (active/history, severity), thresholds form, pod drawer, confirmed restart |
| Topology | done — React Flow, each node a container with its pods, search, detail panel, logs, confirmed restart. Live connection edges (`/api/connections/topology`) are not drawn |
| Deployments | done |
| Federation | done — stats, validated compose (broadcast/unicast/multicast), history with filter and detail drawer |
| Scheduling | placeholder, labelled "Not available yet" (no backend exists) |
| Routing | done — policy table with search, view/edit/create drawer (namespace, service and selector suggestions from the cluster summary, backend port auto-fill), evaluate-and-apply with a `/whoami` probe that shows which pod answers, delete, and a redirection history tab. Request bodies are built by `features/routing/lib/policy.ts`, ported from the legacy builders and unit-tested |
| Scaling | done — trigger-node picker, rules table (search, status filter, enable switch, edit, delete), validated create/edit drawer, selected-rule detail with the legacy "last action" staleness check, pod placement per node |
| Extensions | done — menu built from `GET /api/extensions`. Notification: webhook channels, SMTP email, alert rules (node/pod choices from the live metrics stream), monitoring interval, and "run check now" (saves, then triggers). Legacy flat configs are migrated on load. Any other extension renders a form from its own `inputs` metadata |

## Theme

Light by default. The choice is stored in a `console-theme` cookie that the root layout reads on the server, so the first paint is already the right theme (no flash, and no mismatch between antd's server styles and the client). It is toggled from the sidebar footer.

## Known gaps

- Charts on the dashboard are **rolling samples taken in this browser session** (labelled as such); the daemon exposes no time-series history endpoint.
- Tests: `npm test` runs 46 unit tests over the logic most likely to break silently: routing payload builders and resolvers, notification config migration, the BFF allowlist and proxy (routing to the right upstream, forwarding, traversal, 404/502/504), and metric unit conversion. There are no component or end-to-end tests. Beyond that, verification was strict `tsc`, ESLint, the production build, WebSocket pass-through against a stand-in server, and headless-Edge runs (light and dark) of every page against a fixture daemon with zero console errors, including apply, enable-toggle and theme persistence. It has not been run against a real daemon.
- Routing: the redirect threshold unit is not shown, because the legacy form did not state one and the daemon source for it was not checked.
- Extensions: the legacy "current metrics" preview beside each alert rule is not ported.
- No authentication layer.
