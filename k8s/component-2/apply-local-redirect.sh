#!/usr/bin/env bash
set -euo pipefail

# Telemetry-aware helper that applies a CiliumLocalRedirectPolicy when a rule
# says "action: redirect" and the measured metric crosses the threshold.
# Assumptions:
# - Port-forward to the telemetry API is running (default http://127.0.0.1:8080).
# - Cilium with the LocalRedirectPolicy CRD is installed on the cluster.
# - The backend pods you want to redirect to share a label (redirect_backend_label).
#
# Usage: ./k8s/component-2/apply-local-redirect.sh [rule.json]

RULE_FILE="${1:-k8s/component-2/redirect-rule.example.json}"
if [[ ! -f "$RULE_FILE" ]]; then
  echo "Rule file not found: $RULE_FILE" >&2
  exit 1
fi

action=$(jq -r '.action' "$RULE_FILE")
if [[ "$action" != "redirect" ]]; then
  echo "Rule action is not \"redirect\" (action=$action), nothing to apply."
  exit 0
fi

policy_name=$(jq -r '.policy_name' "$RULE_FILE")
namespace=$(jq -r '.namespace' "$RULE_FILE")
frontend_service=$(jq -r '.frontend_service' "$RULE_FILE")
frontend_service_port=$(jq -r '.frontend_service_port' "$RULE_FILE")
monitor_pod_contains=$(jq -r '.monitor_pod_contains' "$RULE_FILE")
metric=$(jq -r '.metric' "$RULE_FILE")
threshold=$(jq -r '.violation_threshold' "$RULE_FILE")
backend_label=$(jq -r '.redirect_backend_label' "$RULE_FILE")
backend_port=$(jq -r '.redirect_backend_port' "$RULE_FILE")
backend_protocol=$(jq -r '.redirect_backend_protocol' "$RULE_FILE")

if [[ -z "$policy_name" || "$policy_name" == "null" ]]; then
  echo "policy_name is required in the rule file." >&2
  exit 1
fi
policy_slug=$(echo "$policy_name" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9-' '-' | sed 's/^-*//;s/-*$//')

# Ensure LRP CRD is present
if ! kubectl get crd ciliumlocalredirectpolicies.cilium.io >/dev/null 2>&1; then
  echo "CiliumLocalRedirectPolicy CRD not found. Install/enable it (Cilium >=1.14, or apply the CRD manifest) before running this script." >&2
  exit 1
fi

case "$metric" in
  dns_us)
    API_URL="${API_URL:-http://127.0.0.1:8080/api/dns/pods}"
    VALUE_FIELD="avg_latency_us"
    ;;
  *)
    API_URL="${API_URL:-http://127.0.0.1:8080/api/rtt/pods}"
    VALUE_FIELD="avg_rtt_us"
    ;;
esac

if [[ "$backend_label" != *"="* ]]; then
  echo "redirect_backend_label must be in key=value form." >&2
  exit 1
fi
backend_label_key=${backend_label%%=*}
backend_label_value=${backend_label#*=}

telemetry_json=$(curl -sf "$API_URL")

avg_value=$(jq --arg ns "$namespace" --arg contains "$monitor_pod_contains" --arg field "$VALUE_FIELD" '
  (.pods // {}) as $pods
  | [ $pods[] | select(.namespace == $ns and (.pod_name | contains($contains))) | .[$field] ]
  | if length == 0 then null else (add / length) end
' <<<"$telemetry_json")

if [[ "$avg_value" == "null" ]]; then
  echo "No telemetry found for namespace=$namespace pods containing \"$monitor_pod_contains\"; skipping redirect."
  exit 0
fi

violation=$(awk -v avg="$avg_value" -v th="$threshold" 'BEGIN {if (avg >= th) print 1; else print 0}')
echo "Telemetry ($VALUE_FIELD) average for \"$monitor_pod_contains\": $avg_value (threshold=$threshold)"

if [[ "$violation" -ne 1 ]]; then
  echo "No violation detected; not applying CiliumLocalRedirectPolicy."
  exit 0
fi

echo "Violation detected and action=redirect -> applying CiliumLocalRedirectPolicy \"$policy_slug\"..."

kubectl apply --validate=false -f - <<EOF
apiVersion: cilium.io/v2
kind: CiliumLocalRedirectPolicy
metadata:
  name: ${policy_slug}
  namespace: ${namespace}
spec:
  redirectFrontend:
    serviceMatcher:
      serviceName: ${frontend_service}
      namespace: ${namespace}
  redirectBackend:
    localEndpointSelector:
      matchLabels:
        ${backend_label_key}: ${backend_label_value}
    toPorts:
      - name: redirect-${backend_port}
        port: "${backend_port}"
        protocol: ${backend_protocol}
  loadBalancerMode: localized
EOF

echo "Done. You can remove the redirect with: kubectl -n ${namespace} delete ciliumlocalredirectpolicy ${policy_slug}"
