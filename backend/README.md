# Component 2 Backend (Express + MongoDB)

Stores telemetry-driven redirect rules for Component 2 so the frontend (or scripts) can persist/retrieve them.

## Prerequisites
- MongoDB available (default URI: `mongodb://localhost:27017/ebpf-routing`).
- Node.js 18+.

## Deploy to Kubernetes (Component 2 backend)
Steps assume you are in `backend/` and the namespace is `test-services`. Deploy Mongo first, then the backend.

1) Deploy MongoDB:
```bash
kubectl apply -f ../k8s/component-2/mongo.yaml
```
2) Build the backend image:
```bash
docker build -t component2-backend:latest .
```
3) Load into a local kind cluster (skip if you push to a registry; replace `kind` if your cluster name differs):
```bash
kind load docker-image component2-backend:latest --name ebpf-cluster
```
4) Apply the backend Deployment/Service:
```bash
kubectl apply -f ../k8s/component-2/component2-backend.yaml
```
5) Watch it come up:
```bash
kubectl get pods -n test-services -w
```
6) If you rebuilt the image after applying, restart to pick up the new build:
```bash
kubectl rollout restart deployment/component2-backend -n test-services
```

7) To start port-forwarding to test locally:
```bash
#Backend
kubectl port-forward svc/component2-backend 4000:4000 -n test-services

#MongoDB
kubectl -n test-services port-forward svc/mongodb 27017:27017 -n test-services
```

8) Optional checks:
```bash
kubectl logs -f deploy/component2-backend -n test-services
kubectl port-forward svc/component2-backend 4000:4000 -n test-services &
curl -i http://localhost:4000/health
curl -i http://localhost:4000/whoami
```

## Local Setup
```bash
cd backend
cp .env.example .env   # edit MONGODB_URI/PORT if needed
npm install
npm start              # or npm run dev for watch mode
```

## API — policies and rules
- `GET /health` — health check.
- `GET /whoami` — plain identity (uses SERVICE_NAME or hostname) for quick in-cluster curls.
- `GET /api/policies` — list policies.
- `GET /api/policies/by-name/:policyName` — fetch a policy by name.
- `GET /api/policies/:id` — fetch a policy by id.
- `POST /api/policies` — create or upsert a policy (redirection template).
- `PUT /api/policies/:id` — update policy fields.
- `DELETE /api/policies/:id` — remove a policy and its rule.
- `GET /api/policies/:policyName/rule` — fetch the rule (metric/threshold) attached to a policy.
- `POST /api/policies/:policyName/rule` — upsert a rule for a policy.
- `POST /api/policies/:policyName/apply` — apply the stored policy+rule via the helper script.
- `GET /api/policies/:policyName/rule-file` — policy+rule formatted for `apply-local-redirect.sh`.
- `POST /api/policies/:policyName/expire` — record that a policy expired/was cleaned up.

## API — rules (legacy combined)
- `GET /api/rules` — list all policies merged with their rules.
- `GET /api/rules/:id` — fetch by policy id.
- `GET /api/rules/by-policy/:policyName` — fetch combined view by policy name.
- `GET /api/rules/:id/rule-file` — combined view formatted for `apply-local-redirect.sh`.
- `GET /api/rules/by-policy/:policyName/rule-file` — same, by policy name.
- `POST /api/rules` — create or upsert policy + rule in one payload (compatibility).
- `PUT /api/rules/:id` — update policy/rule fields (compatibility).
- `DELETE /api/rules/:id` — remove a policy and its rule.
- `POST /api/rules/by-policy/:policyName/apply` — apply combined policy+rule (compatibility).
- `POST /api/rules/by-policy/:policyName/expire` — record expiry (compatibility).

## API — redirection events
- `GET /api/redirections` — list events (filter with `?policy_name=...`).
- `GET /api/redirections/by-policy/:policyName` — list events for a policy.
- `POST /api/redirections` — append an event (see payload below).
- `POST /api/policies/:policyName/expire` — record that a policy expired/was cleaned up.

## Sample payloads

### Policy (POST /api/policies)
```json
{
  "policy_name": "redirect-service-a-to-c",
  "namespace": "test-services",
  "frontend_service": "service-a",
  "frontend_service_port": "5000",
  "monitor_pod_contains": "service-a",
  "action": "redirect",
  "redirect_backend_label": "app=service-c",
  "redirect_backend_port": "5003",
  "redirect_backend_protocol": "TCP",
  "ttl_seconds": 300,
  "choose_best_pod": true,
  "backend_candidate_label": "app=service-c",
  "redirect_winner_label": "redirect-winner=yes",
  "notes": "example policy"
}
```

### Rule (POST /api/policies/:policyName/rule)
```json
{
  "metric": "dns_us",
  "violation_threshold": 1000,
  "notes": "example rule"
}
```

### Combined legacy rule (POST /api/rules)
If you prefer the single payload used previously, the legacy `/api/rules` endpoint still accepts the combined object (policy + rule):
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

### Sample payload (POST /api/redirections)
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

# 2) Save or update a policy
curl -X POST http://localhost:4000/api/policies \
  -H "Content-Type: application/json" \
  -d @k8s/component-2/redirect-rule.example.json

# 3) Attach the rule to the policy (metric/threshold)
curl -X POST http://localhost:4000/api/policies/redirect-service-a-to-c/rule \
  -H "Content-Type: application/json" \
  -d '{"metric":"dns_us","violation_threshold":1000}'

# 4) Export the combined rule-file and apply the redirect helper
curl -s http://localhost:4000/api/policies/redirect-service-a-to-c/rule-file -o /tmp/rule.json
./k8s/component-2/apply-local-redirect.sh /tmp/rule.json
# or trigger the helper via the backend:
curl -X POST http://localhost:4000/api/policies/redirect-service-a-to-c/apply

# 5) When the helper applies/cleans up, post an event (hook this into your flow)
curl -X POST http://localhost:4000/api/redirections \
  -H "Content-Type: application/json" \
  -d '{"policy_name":"redirect-service-a-to-c","violation_triggered":true,"accepted_service":"service-c","status":"applied","notes":"Hello I am service C (redirect winner)"}'

# 6) Log expiry/cleanup
curl -X POST http://localhost:4000/api/policies/redirect-service-a-to-c/expire \
  -H "Content-Type: application/json" \
  -d '{"notes":"TTL cleanup"}'

# 7) Inspect event history
curl -s "http://localhost:4000/api/redirections?policy_name=redirect-service-a-to-c" | jq .
```

## Feed the helper script
```bash
# Export the latest policy+rule for a policy into a file and apply it
curl -s http://localhost:4000/api/policies/redirect-service-a-to-c/rule-file -o /tmp/rule.json
./k8s/component-2/apply-local-redirect.sh /tmp/rule.json
```

## Data model
- Policy documents store the redirection intent (frontend/backend wiring, TTL, labels, etc).
- Rule documents store the evaluation logic (`metric` + `violation_threshold`).
- `policy_name` is unique and binds a policy to exactly one rule.
- `ttl_seconds` must be > 0; `choose_best_pod`/`redirect_winner_label`/`backend_candidate_label` support the best-pod routing mode.
- Legacy `/api/rules` endpoints still return the merged view for compatibility.
