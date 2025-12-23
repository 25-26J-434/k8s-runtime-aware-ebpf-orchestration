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

## API
- `GET /health` — health check.
- `GET /api/rules` — list all rules.
- `GET /api/rules/:id` — fetch a rule by id.
- `GET /api/rules/by-policy/:policyName` — fetch by policy name.
- `GET /api/rules/:id/rule-file` — rule formatted for `apply-local-redirect.sh`.
- `GET /api/rules/by-policy/:policyName/rule-file` — same, by policy name.
- `POST /api/rules` — create or upsert a rule.
- `PUT /api/rules/:id` — update fields.
- `DELETE /api/rules/:id` — remove a rule.

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
