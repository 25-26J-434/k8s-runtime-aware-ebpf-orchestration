#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   Apply mode:
#     ./apply-local-redirect.sh rule.json
#
#   Delete mode:
#     ./apply-local-redirect.sh --delete <namespace> <policy_name>

if [[ "${1:-}" == "--delete" ]]; then
  ns="${2:-}"
  name="${3:-}"
  if [[ -z "$ns" || -z "$name" ]]; then
    echo "Usage: ./apply-local-redirect.sh --delete <namespace> <policy_name>" >&2
    exit 1
  fi

  policy_slug=$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9-' '-' | sed 's/^-*//;s/-*$//')
  kubectl -n "$ns" delete ciliumlocalredirectpolicy "$policy_slug" --ignore-not-found
  echo "Deleted CiliumLocalRedirectPolicy $policy_slug in namespace $ns (if existed)."
  exit 0
fi

RULE_FILE="${1:-}"
if [[ -z "$RULE_FILE" ]]; then
  echo "Usage: ./apply-local-redirect.sh <rule.json>" >&2
  exit 1
fi
if [[ ! -f "$RULE_FILE" ]]; then
  echo "Rule file not found: $RULE_FILE" >&2
  exit 1
fi

# Check CRD exists
if ! kubectl get crd ciliumlocalredirectpolicies.cilium.io >/dev/null 2>&1; then
  echo "CiliumLocalRedirectPolicy CRD not found. Install/enable it before running." >&2
  exit 1
fi

action=$(jq -r '.action' "$RULE_FILE")
if [[ "$action" != "redirect" ]]; then
  echo "Rule action is not redirect; nothing to apply."
  exit 0
fi

policy_name=$(jq -r '.policy_name' "$RULE_FILE")
namespace=$(jq -r '.namespace' "$RULE_FILE")
frontend_service=$(jq -r '.frontend_service' "$RULE_FILE")
frontend_service_port=$(jq -r '.frontend_service_port' "$RULE_FILE")
monitor_pod_contains=$(jq -r '.monitor_pod_contains' "$RULE_FILE")
metric=$(jq -r '.metric' "$RULE_FILE")
threshold=$(jq -r '.violation_threshold' "$RULE_FILE")

backend_label=$(jq -r '.redirect_backend_label' "$RULE_FILE")   # key=value
backend_port=$(jq -r '.redirect_backend_port' "$RULE_FILE")
backend_protocol=$(jq -r '.redirect_backend_protocol' "$RULE_FILE")

ttl_seconds=$(jq -r '.ttl_seconds' "$RULE_FILE")
strategy=$(jq -r '.strategy // "all"' "$RULE_FILE")
choose_best_pod=$(jq -r '.choose_best_pod // false' "$RULE_FILE")
backend_candidate_label=$(jq -r '.backend_candidate_label // empty' "$RULE_FILE")
redirect_winner_label=$(jq -r '.redirect_winner_label // "redirect-winner=yes"' "$RULE_FILE")

if [[ -z "$policy_name" || "$policy_name" == "null" ]]; then
  echo "policy_name is required" >&2; exit 1
fi
if [[ -z "$namespace" || "$namespace" == "null" ]]; then
  echo "namespace is required" >&2; exit 1
fi
if [[ -z "$ttl_seconds" || "$ttl_seconds" == "null" ]]; then
  echo "ttl_seconds is required" >&2; exit 1
fi
if ! [[ "$ttl_seconds" =~ ^[0-9]+$ ]] || (( ttl_seconds <= 0 )); then
  echo "ttl_seconds must be a positive integer" >&2; exit 1
fi

# Normalize strategy
if [[ "$strategy" == "best_pod" ]]; then
  choose_best_pod="true"
else
  choose_best_pod="false"
  strategy="all"
fi

policy_slug=$(echo "$policy_name" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9-' '-' | sed 's/^-*//;s/-*$//')

TELEMETRY_BASE_URL="${TELEMETRY_BASE_URL:-http://127.0.0.1:8080}"

resolve_metric_source() {
  case "$metric" in
    dns_us)
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
      echo "Unsupported metric $metric" >&2; exit 1 ;;
  esac
}
resolve_metric_source

if [[ "$backend_label" != *"="* ]]; then
  echo "redirect_backend_label must be key=value" >&2; exit 1
fi

backend_label_key=${backend_label%%=*}
backend_label_value=${backend_label#*=}

candidate_selector="${backend_candidate_label:-$backend_label}"

if [[ "$choose_best_pod" == "true" ]]; then
  if [[ "$candidate_selector" != *"="* ]]; then
    echo "backend_candidate_label must be key=value when best_pod mode" >&2; exit 1
  fi
  if [[ "$redirect_winner_label" != *"="* ]]; then
    echo "redirect_winner_label must be key=value" >&2; exit 1
  fi
  winner_label_key=${redirect_winner_label%%=*}
  winner_label_value=${redirect_winner_label#*=}
fi

telemetry_json=$(curl -sf "$TELEMETRY_URL" || true)
if [[ -z "$telemetry_json" ]]; then
  echo "Telemetry API empty/unreachable at $TELEMETRY_URL; skipping."
  exit 0
fi
if ! jq empty <<<"$telemetry_json" >/dev/null 2>&1; then
  echo "Telemetry API returned invalid JSON; skipping."
  exit 0
fi

avg_value=$(jq --arg ns "$namespace" --arg contains "$monitor_pod_contains" --arg field "$VALUE_FIELD" '
  ( .pods // .pod_metrics // . ) as $src
  | (if ($src|type) == "object" then
       [ $src[]
         | select((.namespace // .ns) == $ns and ((.pod_name // .name // .pod // "") | contains($contains)))
         | select(.[$field] != null)
         | .[$field]
       ]
     elif ($src|type) == "array" then
       [ $src[]
         | select((.namespace // .ns) == $ns and ((.pod_name // .name // .pod // "") | contains($contains)))
         | select(.[$field] != null)
         | .[$field]
       ]
     else [] end)
  | if length == 0 then null else (add / length) end
' <<<"$telemetry_json")

if [[ "$avg_value" == "null" ]]; then
  echo "No usable telemetry for ns=$namespace pods containing \"$monitor_pod_contains\"; skipping."
  exit 0
fi

violation=$(awk -v avg="$avg_value" -v th="$threshold" 'BEGIN {if (avg >= th) print 1; else print 0}')
echo "Telemetry ($VALUE_FIELD) avg for \"$monitor_pod_contains\": $avg_value (threshold=$threshold)"

if [[ "$violation" -ne 1 ]]; then
  echo "No violation detected; not applying LRP."
  exit 0
fi

echo "Violation detected -> applying CiliumLocalRedirectPolicy \"$policy_slug\"..."

# best-pod: label the best candidate and select it using winner_label
if [[ "$choose_best_pod" == "true" ]]; then
  mapfile -t candidate_pods < <(kubectl -n "$namespace" get pod -l "$candidate_selector" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')
  if (( ${#candidate_pods[@]} == 0 )); then
    echo "No candidate pods found with selector \"$candidate_selector\"; skipping."
    exit 0
  fi

  best_pod=""
  best_value=""
  for pod in "${candidate_pods[@]}"; do
    value=$(jq --arg ns "$namespace" --arg name "$pod" --arg field "$VALUE_FIELD" '
      ( .pods // {} ) as $pods
      | [ $pods[]
          | select(.namespace == $ns and .pod_name == $name)
          | select(.[$field] != null)
          | .[$field]
        ]
      | if length == 0 then null else .[0] end
    ' <<<"$telemetry_json")
    [[ "$value" == "null" ]] && continue

    if [[ -z "$best_pod" ]]; then
      best_pod="$pod"; best_value="$value"; continue
    fi
    if awk -v cur="$value" -v best="$best_value" 'BEGIN {exit !(cur+0 < best+0)}'; then
      best_pod="$pod"; best_value="$value"
    fi
  done

  if [[ -z "$best_pod" ]]; then
    echo "No per-pod telemetry for candidates; falling back to selector=$candidate_selector"
    backend_label_key=${candidate_selector%%=*}
    backend_label_value=${candidate_selector#*=}
  else
    echo "Best pod: $best_pod ($best_value)"
    for pod in "${candidate_pods[@]}"; do
      if [[ "$pod" == "$best_pod" ]]; then
        kubectl -n "$namespace" label pod "$pod" "${redirect_winner_label}" --overwrite
      else
        kubectl -n "$namespace" label pod "$pod" "${winner_label_key}-" --overwrite || true
      fi
    done
    backend_label_key="$winner_label_key"
    backend_label_value="$winner_label_value"
  fi
fi

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

(
  sleep "$ttl_seconds"
  echo "TTL expired; removing LRP ${policy_slug} in ${namespace}..."
  kubectl -n "${namespace}" delete ciliumlocalredirectpolicy "${policy_slug}" --ignore-not-found
  if [[ "$choose_best_pod" == "true" ]]; then
    mapfile -t ttl_candidates < <(kubectl -n "$namespace" get pod -l "$candidate_selector" -o name 2>/dev/null || true)
    for p in "${ttl_candidates[@]}"; do
      kubectl -n "$namespace" label "$p" "${winner_label_key}-" --overwrite || true
    done
  fi
) &

echo "Redirect applied with TTL=${ttl_seconds}s."
