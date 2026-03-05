package redirection

import (
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// HistoryEvent captures a short event log for a policy.
type HistoryEvent struct {
	TS      time.Time              `bson:"ts" json:"ts"`
	Event   string                 `bson:"event" json:"event"`
	Message string                 `bson:"message,omitempty" json:"message,omitempty"`
	Data    map[string]interface{} `bson:"data,omitempty" json:"data,omitempty"`
}

// Frontend describes the service we monitor and potentially redirect.
type Frontend struct {
	Service string `bson:"service" json:"service"`
	Port    int    `bson:"port" json:"port"`
}

// TelemetryConfig controls how violations are detected.
type TelemetryConfig struct {
	Metric             string  `bson:"metric" json:"metric"`
	ViolationThreshold float64 `bson:"violation_threshold" json:"violation_threshold"`
	MonitorPodContains string  `bson:"monitor_pod_contains,omitempty" json:"monitor_pod_contains,omitempty"`
}

// ActionConfig drives how redirection should be applied.
type ActionConfig struct {
	Type                      string `bson:"type" json:"type"`
	BackendSelector           string `bson:"backend_selector" json:"backend_selector"`
	BackendService            string `bson:"backend_service,omitempty" json:"backend_service,omitempty"`
	BackendPort               int    `bson:"backend_port" json:"backend_port"`
	Protocol                  string `bson:"protocol" json:"protocol"`
	TTLSeconds                int    `bson:"ttl_seconds" json:"ttl_seconds"`
	Strategy                  string `bson:"strategy,omitempty" json:"strategy,omitempty"`
	BackendCandidatesSelector string `bson:"backend_candidates_selector,omitempty" json:"backend_candidates_selector,omitempty"`
	WinnerLabel               string `bson:"winner_label,omitempty" json:"winner_label,omitempty"`
	TargetNamespace           string `bson:"target_namespace,omitempty" json:"target_namespace,omitempty"`
}

// PolicyStatus mirrors the runtime state fields used by the old Node backend.
type PolicyStatus struct {
	LastEvaluatedAt  *time.Time `bson:"last_evaluated_at,omitempty" json:"last_evaluated_at,omitempty"`
	LastAppliedAt    *time.Time `bson:"last_applied_at,omitempty" json:"last_applied_at,omitempty"`
	LastExpiredAt    *time.Time `bson:"last_expired_at,omitempty" json:"last_expired_at,omitempty"`
	LastDecision     string     `bson:"last_decision,omitempty" json:"last_decision,omitempty"`
	LastError        string     `bson:"last_error,omitempty" json:"last_error,omitempty"`
	LastHelperStdout string     `bson:"last_helper_stdout,omitempty" json:"last_helper_stdout,omitempty"`
	LastHelperStderr string     `bson:"last_helper_stderr,omitempty" json:"last_helper_stderr,omitempty"`
	LastLRPName      string     `bson:"last_lrp_name,omitempty" json:"last_lrp_name,omitempty"`
	LastAvgValue     float64    `bson:"last_avg_value,omitempty" json:"last_avg_value,omitempty"`
	LastViolation    bool       `bson:"last_violation,omitempty" json:"last_violation,omitempty"`
}

// Policy captures the persisted state for Component 2 rules.
type Policy struct {
	ID         primitive.ObjectID `bson:"_id,omitempty" json:"id,omitempty"`
	PolicyName string             `bson:"policy_name" json:"policy_name"`
	Namespace  string             `bson:"namespace" json:"namespace"`
	Scope      string             `bson:"scope,omitempty" json:"scope,omitempty"`

	Frontend  Frontend        `bson:"frontend" json:"frontend"`
	Telemetry TelemetryConfig `bson:"telemetry" json:"telemetry"`
	Action    ActionConfig    `bson:"action" json:"action"`

	Status  PolicyStatus   `bson:"status,omitempty" json:"status,omitempty"`
	History []HistoryEvent `bson:"history,omitempty" json:"history,omitempty"`

	CreatedAt time.Time `bson:"createdAt,omitempty" json:"createdAt,omitempty"`
	UpdatedAt time.Time `bson:"updatedAt,omitempty" json:"updatedAt,omitempty"`
}

// AddHistory prepends a new history entry keeping at most 50 records.
func (p *Policy) AddHistory(event, message string, data map[string]interface{}) {
	p.History = append([]HistoryEvent{{
		TS:      time.Now().UTC(),
		Event:   event,
		Message: message,
		Data:    data,
	}}, p.History...)

	if len(p.History) > 50 {
		p.History = p.History[:50]
	}
}

// Slug returns a DNS-safe name for the CiliumLocalRedirectPolicy.
func (p *Policy) Slug() string {
	s := strings.ToLower(p.PolicyName)
	var out strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			out.WriteRune(r)
		} else {
			out.WriteRune('-')
		}
	}
	result := strings.Trim(out.String(), "-")
	if result == "" {
		return "lrp"
	}
	return result
}
