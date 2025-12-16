#!/usr/bin/env bash
set -euo pipefail

# Apply intent-based weights to the CiliumEnvoyConfig using telemetry from Component 1.
# Requirements:
# - Port-forward to the telemetry API is running (default: http://127.0.0.1:8080).
# - CiliumEnvoyConfig CRD installed.
# - CEC object name and cluster order match the sample manifest
#   (cluster index 0 = service-a, index 1 = service-b).
#
# Usage: ./apply-intent.sh [policy.json]

POLICY_FILE="${1:-k8s/component-2/intent-policy.example.json}"
if [[ ! -f "$POLICY_FILE" ]]; then
  echo "Policy file not found: $POLICY_FILE" >&2
  exit 1
fi

metric=$(jq -r '.metric' "$POLICY_FILE")
if [[ "$metric" == "dns_us" ]]; then
  API_URL="${API_URL:-http://127.0.0.1:8080/api/dns/pods}"
  VALUE_FIELD="avg_latency_us"
else
  API_URL="${API_URL:-http://127.0.0.1:8080/api/rtt/pods}"
  VALUE_FIELD="avg_rtt_us"
fi

prefer_below=$(jq -r '.thresholds.prefer_below' "$POLICY_FILE")
degrade_above=$(jq -r '.thresholds.degrade_above' "$POLICY_FILE")

backend_a=$(jq -r '.backends[0].name' "$POLICY_FILE")
backend_b=$(jq -r '.backends[1].name' "$POLICY_FILE")

weight_a_pref=$(jq -r '.backends[0].weight_if_preferred' "$POLICY_FILE")
weight_a_deg=$(jq -r '.backends[0].weight_if_degraded' "$POLICY_FILE")
weight_b_pref=$(jq -r '.backends[1].weight_if_preferred' "$POLICY_FILE")
weight_b_deg=$(jq -r '.backends[1].weight_if_degraded' "$POLICY_FILE")

telemetry_json=$(curl -sf "$API_URL")

# Compute average metric for pods whose pod_name contains the backend name.
avg_for_backend() {
  local backend="$1"
  jq --arg b "$backend" --arg field "$VALUE_FIELD" '
    (.pods // {}) as $pods
    | [ $pods[] | select(.pod_name | contains($b)) | .[$field] ]
    | if length == 0 then null else (add / length) end
  ' <<<"$telemetry_json"
}

avg_a=$(avg_for_backend "$backend_a")
avg_b=$(avg_for_backend "$backend_b")

echo "Telemetry ($VALUE_FIELD): $backend_a=${avg_a:-null}, $backend_b=${avg_b:-null}"

# Simple validity check: must be non-null, >0, and not absurdly large (>1e9 us ~ 1000s).
is_valid() {
  local v="$1"
  if [[ "$v" == "null" ]]; then return 1; fi
  awk -v val="$v" 'BEGIN { if (val > 0 && val < 1e9) exit 0; else exit 1 }'
}

valid_a=0
valid_b=0
is_valid "$avg_a" && valid_a=1 || true
is_valid "$avg_b" && valid_b=1 || true

# Decide preferred backend; if data missing/invalid, fall back to 50/50.
if [[ $valid_a -eq 1 && $valid_b -eq 1 ]]; then
  awk_cmp=$(awk -v a="$avg_a" -v b="$avg_b" 'BEGIN {if (a < b) print "a"; else print "b"}')
  preferred=$([[ "$awk_cmp" == "b" ]] && echo "$backend_b" || echo "$backend_a")
elif [[ $valid_a -eq 1 && $valid_b -eq 0 ]]; then
  preferred="$backend_a"
elif [[ $valid_a -eq 0 && $valid_b -eq 1 ]]; then
  preferred="$backend_b"
else
  echo "No valid telemetry for either backend (null/zero/absurd). Falling back to 50/50."
  preferred="none"
fi

# Choose weights based on preferred backend
if [[ "$preferred" == "$backend_a" ]]; then
  weight_a="$weight_a_pref"
  weight_b="$weight_b_deg"
elif [[ "$preferred" == "$backend_b" ]]; then
  weight_a="$weight_a_deg"
  weight_b="$weight_b_pref"
else
  weight_a=50
  weight_b=50
fi

echo "Preferred backend: $preferred (thresholds prefer<$prefer_below, degrade>$degrade_above)"
echo "Applying weights: $backend_a=$weight_a, $backend_b=$weight_b"

# Patch the CiliumEnvoyConfig (assumes cluster index 0=service-a, 1=service-b)
kubectl -n test-services patch ciliumenvoyconfig service-a-intelligent \
  --type=json \
  -p="[
    {\"op\":\"replace\",\"path\":\"/spec/resources/0/filter_chains/0/filters/0/typed_config/route_config/virtual_hosts/0/routes/0/route/weighted_clusters/clusters/0/weight\",\"value\":$weight_a},
    {\"op\":\"replace\",\"path\":\"/spec/resources/0/filter_chains/0/filters/0/typed_config/route_config/virtual_hosts/0/routes/0/route/weighted_clusters/clusters/1/weight\",\"value\":$weight_b}
  ]"

echo "Done."
