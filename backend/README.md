# Component 2 Backend (Express + MongoDB)

Stores telemetry-driven redirect rules for Component 2 so the frontend (or scripts) can persist/retrieve them.

## Prerequisites
- MongoDB available (default URI: `mongodb://localhost:27017/ebpf-routing`).
- Node.js 18+.

## Setup
```bash
cd backend
cp .env.example .env   # edit MONGODB_URI/PORT if needed
npm install
npm start              # or npm run dev for watch mode
```

## API — rules
- `GET /health` — health check.
- `GET /whoami` — plain identity (uses SERVICE_NAME or hostname) for quick in-cluster curls.
- `GET /api/rules` — list all rules.
- `GET /api/rules/:id` — fetch a rule by id.
- `GET /api/rules/by-policy/:policyName` — fetch by policy name.
- `GET /api/rules/:id/rule-file` — rule formatted for `apply-local-redirect.sh`.
- `GET /api/rules/by-policy/:policyName/rule-file` — same, by policy name.
- `POST /api/rules` — create or upsert a rule.
- `PUT /api/rules/:id` — update fields.
- `DELETE /api/rules/:id` — remove a rule.

## API — redirection events (new)
- `GET /api/redirections` — list events (filter with `?policy_name=...`).
- `GET /api/redirections/by-policy/:policyName` — list events for a policy.
- `POST /api/redirections` — append an event (see payload below).
- `POST /api/rules/by-policy/:policyName/expire` — record that a policy expired/was cleaned up.

## Sample payload (POST /api/rules)
```json
{
  "policy_name": "redirect-service-a-to-c",
  "namespace": "test-services",
  "frontend_service": "service-a",
  "frontend_service_port": "5000",
  "monitor_pod_contains": "service-a",
  "metric": "dns_us",
  "violation_threshold": 1000,
  "action": "redirect",
  "redirect_backend_label": "app=service-c",
  "redirect_backend_port": "5003",
  "redirect_backend_protocol": "TCP",
  "ttl_seconds": 300,
  "choose_best_pod": true,
  "backend_candidate_label": "app=service-c",
  "redirect_winner_label": "redirect-winner=yes",
  "notes": "example rule"
}
```

## Sample payload (POST /api/redirections)
```json
{
  "policy_name": "redirect-service-a-to-c",
  "frontend_service": "service-a",
  "planned_backend_service": "service-b",
  "planned_backend_label": "app=service-b",
  "planned_backend_port": "5001",
  "final_backend_service": "service-c",
  "final_backend_label": "app=service-c",
  "final_backend_port": "5003",
  "redirect_backend_label": "app=service-c",
  "redirect_backend_port": "5003",
  "violation_triggered": true,
  "accepted_service": "service-c",
  "status": "applied",
  "notes": "Hello I am service C (redirect winner)"
}
```
- `violation_triggered` is required (boolean). `status` can be `applied|expired|deleted|skipped|observed` (defaults to `applied`).
- `occurred_at` is optional; defaults to now.

## Typical flow to see results
```bash
# 1) Start backend (Mongo running, .env set)
cd backend && npm start

# 2) Save or update a rule
curl -X POST http://localhost:4000/api/rules \
  -H "Content-Type: application/json" \
  -d @k8s/component-2/redirect-rule.example.json

# 3) Export the rule and apply the redirect helper
curl -s http://localhost:4000/api/rules/by-policy/redirect-service-a-to-c/rule-file \
  -o /tmp/rule.json
./k8s/component-2/apply-local-redirect.sh /tmp/rule.json

# 4) When the helper applies/cleans up, post an event (hook this into your flow)
curl -X POST http://localhost:4000/api/redirections \
  -H "Content-Type: application/json" \
  -d '{"policy_name":"redirect-service-a-to-c","violation_triggered":true,"accepted_service":"service-c","status":"applied","notes":"Hello I am service C (redirect winner)"}'

# 5) Log expiry/cleanup
curl -X POST http://localhost:4000/api/rules/by-policy/redirect-service-a-to-c/expire \
  -H "Content-Type: application/json" \
  -d '{"notes":"TTL cleanup"}'

# 6) Inspect event history
curl -s "http://localhost:4000/api/redirections?policy_name=redirect-service-a-to-c" | jq .
```

## Feed the helper script
```bash
# Export the latest rule for a policy into a file and apply it
curl -s http://localhost:4000/api/rules/by-policy/redirect-service-a-to-c/rule-file \
  -o /tmp/rule.json
./k8s/component-2/apply-local-redirect.sh /tmp/rule.json
```

## Data model
- Stored fields match the `redirect-rule.example.json` keys (plus optional `notes`).
- `policy_name` is unique; POST will upsert by `policy_name`.
- `ttl_seconds` must be > 0; `choose_best_pod`/`redirect_winner_label`/`backend_candidate_label` support the best-pod routing mode.

    - Save or update a rule (upsert by policy_name):

      curl -X POST http://localhost:4000/api/rules \
      -H "Content-Type: application/json" \
      -d @k8s/component-2/redirect-rule.example.json
    - Export a rule for the helper and apply:

      curl -s http://localhost:4000/api/rules/by-policy/redirect-service-a-to-c/rule-file -o /tmp/rule.json
      ./k8s/component-2/apply-local-redirect.sh /tmp/rule.json

kubectl -n test-services port-forward svc/service-a 5000:5000