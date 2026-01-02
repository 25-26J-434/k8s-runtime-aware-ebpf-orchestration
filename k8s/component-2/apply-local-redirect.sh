#!/usr/bin/env bash
set -euo pipefail

# Telemetry-aware helper that:
# - Reads a rule JSON (from CLI or sample).
# - Pulls telemetry for monitored pods.
# - If metric breaches threshold and action=redirect, applies a CiliumLocalRedirectPolicy.
# - Optional: picks the best backend pod (lowest latency), labels it, and targets only that pod.
# - TTL cleanup removes the LRP (and winner label) after the configured duration.
# Usage: ./k8s/component-2/apply-local-redirect.sh [rule.json]

RULE_FILE="${1:-k8s/component-2/redirect-rule.example.json}"
# Load rule (default sample)
if [[ ! -f "$RULE_FILE" ]]; then
  echo "Rule file not found: $RULE_FILE" >&2
  exit 1
fi

# Abort early unless the rule wants a redirect
action=$(jq -r '.action' "$RULE_FILE")
if [[ "$action" != "redirect" ]]; then
  echo "Rule action is not \"redirect\" (action=$action), nothing to apply."
  exit 0
fi

# Parse rule fields
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
ttl_seconds=$(jq -r '.ttl_seconds // empty' "$RULE_FILE")
choose_best_pod=$(jq -r '.choose_best_pod // false' "$RULE_FILE")
backend_candidate_label=$(jq -r '.backend_candidate_label // empty' "$RULE_FILE")
redirect_winner_label=$(jq -r '.redirect_winner_label // "redirect-winner=yes"' "$RULE_FILE")
strategy=$(jq -r '.strategy // empty' "$RULE_FILE")

# Normalize strategy (new field) with backward compatibility for choose_best_pod (legacy)
if [[ -z "$strategy" || "$strategy" == "null" ]]; then
  if [[ "$choose_best_pod" == "true" ]]; then
    strategy="best_pod"
  else
    strategy="all"
  fi
fi
case "$strategy" in
  all|best_pod) ;;
  *) echo "strategy must be one of: all, best_pod" >&2; exit 1 ;;
esac
# Drive legacy flag from strategy for existing code paths below
if [[ "$strategy" == "best_pod" ]]; then
  choose_best_pod="true"
else
  choose_best_pod="false"
fi

# Validate required fields
if [[ -z "$policy_name" || "$policy_name" == "null" ]]; then
  echo "policy_name is required in the rule file." >&2
  exit 1
fi
if [[ -z "$ttl_seconds" || "$ttl_seconds" == "null" ]]; then
  echo "ttl_seconds is required in the rule file and must be a positive integer (seconds)." >&2
  exit 1
fi
if ! [[ "$ttl_seconds" =~ ^[0-9]+$ ]] || (( ttl_seconds <= 0 )); then
  echo "ttl_seconds must be a positive integer (seconds)." >&2
  exit 1
fi
policy_slug=$(echo "$policy_name" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9-' '-' | sed 's/^-*//;s/-*$//')

# Ensure LRP CRD is present
if ! kubectl get crd ciliumlocalredirectpolicies.cilium.io >/dev/null 2>&1; then
  echo "CiliumLocalRedirectPolicy CRD not found. Install/enable it (Cilium >=1.14, or apply the CRD manifest) before running this script." >&2
  exit 1
fi

TELEMETRY_BASE_URL="${TELEMETRY_BASE_URL:-http://127.0.0.1:8080}"

resolve_metric_source() {
  case "$metric" in
    dns_us)
      # Priority: per-metric override -> legacy API_URL -> base + path
      TELEMETRY_URL="${TELEMETRY_API_URL_DNS:-${API_URL:-${TELEMETRY_BASE_URL}/api/dns/pods}}"
      VALUE_FIELD="avg_latency_us"
      ;;
    rtt_us|rtt)
      TELEMETRY_URL="${TELEMETRY_API_URL_RTT:-${API_URL:-${TELEMETRY_BASE_URL}/api/rtt/pods}}"
      VALUE_FIELD="avg_rtt_us"
      ;;
    sched_latency_us|sched_us)
      TELEMETRY_URL="${TELEMETRY_API_URL_SCHED:-${TELEMETRY_BASE_URL}/api/sched/pods}"
      VALUE_FIELD="avg_runqueue_latency_us"
      ;;
    *)
      echo "Unsupported metric \"$metric\". Supported: dns_us, rtt_us, sched_latency_us." >&2
      exit 1
      ;;
  esac
}

resolve_metric_source

if [[ "$backend_label" != *"="* ]]; then
  echo "redirect_backend_label must be in key=value form." >&2
  exit 1
fi
backend_label_key=${backend_label%%=*}
backend_label_value=${backend_label#*=}
candidate_selector=${backend_candidate_label:-$backend_label}
if [[ "$choose_best_pod" == "true" ]]; then
  # Best-pod mode: ensure selectors and winner label are key=value
  if [[ "$candidate_selector" != *"="* ]]; then
    echo "When choose_best_pod=true, backend_candidate_label or redirect_backend_label must be key=value." >&2
    exit 1
  fi
  if [[ "$redirect_winner_label" != *"="* ]]; then
    echo "redirect_winner_label must be key=value (example: redirect-winner=yes)." >&2
    exit 1
  fi
  winner_label_key=${redirect_winner_label%%=*}
  winner_label_value=${redirect_winner_label#*=}
fi

telemetry_json=$(curl -sf "$TELEMETRY_URL" || true)
if [[ -z "$telemetry_json" ]]; then
  echo "Telemetry API response empty/unreachable at $TELEMETRY_URL; skipping redirect. (Check API endpoint and port-forward.)"
  exit 0
fi
if ! jq empty <<<"$telemetry_json" >/dev/null 2>&1; then
  echo "Telemetry API returned invalid JSON from $TELEMETRY_URL; skipping redirect. (Inspect telemetry service output.)"
  exit 0
fi

# Compute average metric for monitored pods (supports shapes: {pods:{...}}, {pod_metrics:{...}}, or plain map)
avg_value=$(jq --arg ns "$namespace" --arg contains "$monitor_pod_contains" --arg field "$VALUE_FIELD" '
  ( .pods // .pod_metrics // . ) as $pods
  | (if ($pods|type) == "object" then
       [ $pods[]
         | select(.namespace == $ns and ((.pod_name // "") | contains($contains)))
         | select(.[$field] != null)
         | .[$field]
       ]
     else [] end)
  | if length == 0 then null else (add / length) end
' <<<"$telemetry_json")

if [[ "$avg_value" == "null" ]]; then
  echo "No usable telemetry for namespace=$namespace pods containing \"$monitor_pod_contains\"; skipping redirect. (Ensure telemetry API has data and labels/pod names match.)"
  exit 0
fi

violation=$(awk -v avg="$avg_value" -v th="$threshold" 'BEGIN {if (avg >= th) print 1; else print 0}')
echo "Telemetry ($VALUE_FIELD) average for \"$monitor_pod_contains\": $avg_value (threshold=$threshold)"

if [[ "$violation" -ne 1 ]]; then
  echo "No violation detected; not applying CiliumLocalRedirectPolicy."
  exit 0
fi

echo "Violation detected and action=redirect -> applying CiliumLocalRedirectPolicy \"$policy_slug\"..."

# Optional best-pod selection: pick the lowest-latency pod from candidates and mark it with redirect_winner_label
if [[ "$choose_best_pod" == "true" ]]; then
  # List candidate pods via selector
  mapfile -t candidate_pods < <(kubectl -n "$namespace" get pod -l "$candidate_selector" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')
  if (( ${#candidate_pods[@]} == 0 )); then
    echo "No candidate pods found with label selector \"$candidate_selector\"; skipping redirect."
    exit 0
  fi

  # Find lowest-latency pod
  best_pod=""
  best_value=""
  for pod in "${candidate_pods[@]}"; do
    value=$(jq --arg ns "$namespace" --arg name "$pod" --arg field "$VALUE_FIELD" '
      (.pods // {}) as $pods
      | [ $pods[]
          | select(.namespace == $ns and .pod_name == $name)
          | select(.[$field] != null)
          | .[$field]
        ]
      | if length == 0 then null else .[0] end
    ' <<<"$telemetry_json")
    if [[ "$value" == "null" ]]; then
      continue
    fi
    if [[ -z "$best_pod" ]]; then
      best_pod="$pod"
      best_value="$value"
      continue
    fi
    if awk -v cur="$value" -v best="$best_value" 'BEGIN {exit !(cur+0 < best+0)}'; then
      best_pod="$pod"
      best_value="$value"
    fi
  done

  if [[ -z "$best_pod" ]]; then
    echo "No telemetry values available for candidate pods; falling back to all pods with selector $candidate_selector without winner labeling."
    # Fall back to the broader redirect_backend_label (or candidate selector) instead of aborting
    backend_label_key=${candidate_selector%%=*}
    backend_label_value=${candidate_selector#*=}
  else
    # Label winner and clear label from others
    echo "Best pod selected (lowest $VALUE_FIELD): $best_pod ($best_value)"
    for pod in "${candidate_pods[@]}"; do
      if [[ "$pod" == "$best_pod" ]]; then
        kubectl -n "$namespace" label pod "$pod" "${redirect_winner_label}" --overwrite
      else
        kubectl -n "$namespace" label pod "$pod" "${winner_label_key}-" --overwrite
      fi
    done

    backend_label_key=$winner_label_key
    backend_label_value=$winner_label_value
  fi
fi

# Apply LRP with selected backend label
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
        ${backend_label_key}: "${backend_label_value}"
    toPorts:
      - name: redirect-${backend_port}
        port: "${backend_port}"
        protocol: ${backend_protocol}
  loadBalancerMode: localized
EOF

# TTL cleanup: delete policy (and winner label if used) after ttl_seconds
if (( ttl_seconds > 0 )); then
  (
    sleep "$ttl_seconds"
    echo "TTL (${ttl_seconds}s) expired; removing CiliumLocalRedirectPolicy \"${policy_slug}\" in namespace \"${namespace}\"..."
    kubectl -n "${namespace}" delete ciliumlocalredirectpolicy "${policy_slug}" --ignore-not-found
    if [[ "$choose_best_pod" == "true" ]]; then
      mapfile -t ttl_candidates < <(kubectl -n "$namespace" get pod -l "$candidate_selector" -o name 2>/dev/null || true)
      for p in "${ttl_candidates[@]}"; do
        kubectl -n "$namespace" label "$p" "${winner_label_key}-" --overwrite || true
      done
      echo "Removed winner label ${winner_label_key} from candidate pods."
    fi
  ) &
  echo "Redirect applied with TTL=${ttl_seconds}s. A background cleanup will delete the policy after the TTL elapses."
else
  echo "Redirect applied without TTL cleanup (ttl_seconds=0)."
fi

echo "You can also remove the redirect manually with: kubectl -n ${namespace} delete ciliumlocalredirectpolicy ${policy_slug}"
