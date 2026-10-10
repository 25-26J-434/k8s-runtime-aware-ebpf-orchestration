package api

import (
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	alertStateFiring   = "firing"
	alertStateResolved = "resolved"

	// One-shot (edge) alerts such as restarts or disappeared pods stay visible this long.
	eventAlertTTL = 10 * time.Minute

	maxActiveAlerts = 200
	maxAlertHistory = 200
)

type managedAlert struct {
	alert   HealthAlert
	nodeKey string
	expires time.Time // zero = level-triggered (resolves when condition clears)
}

var (
	alertMgrMu   sync.Mutex
	alertMgr     = make(map[string]*managedAlert)
	alertHistory []HealthAlert // resolved + expired alerts, newest last
)

func severityRank(s AlertSeverity) int {
	switch s {
	case AlertCritical:
		return 0
	case AlertWarning:
		return 1
	default:
		return 2
	}
}

// slugify turns a metric reason such as "high packet loss: 12" into "high-packet-loss".
func slugify(reason string) string {
	if i := strings.Index(reason, ":"); i >= 0 {
		reason = reason[:i]
	}
	reason = strings.ToLower(strings.TrimSpace(reason))
	return strings.Join(strings.Fields(reason), "-")
}

func recordHistoryLocked(a HealthAlert) {
	alertHistory = append(alertHistory, a)
	if len(alertHistory) > maxAlertHistory {
		alertHistory = alertHistory[len(alertHistory)-maxAlertHistory:]
	}
}

// reconcileNodeAlerts compares the conditions that currently hold for a node (desired,
// level-triggered) and the one-shot events observed this cycle against the active set.
// It returns alerts that newly fired or changed severity, and alerts that resolved.
func reconcileNodeAlerts(nodeKey string, desired, events []HealthAlert) (fired, resolved []HealthAlert) {
	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339)

	alertMgrMu.Lock()
	defer alertMgrMu.Unlock()

	seen := make(map[string]struct{}, len(desired))
	for _, a := range desired {
		seen[a.ID] = struct{}{}
		if cur, ok := alertMgr[a.ID]; ok {
			sevChanged := cur.alert.Severity != a.Severity
			a.Timestamp = cur.alert.Timestamp
			a.LastSeen = nowStr
			a.State = alertStateFiring
			cur.alert = a
			cur.expires = time.Time{}
			if sevChanged {
				fired = append(fired, a)
			}
			continue
		}
		a.Timestamp = nowStr
		a.LastSeen = nowStr
		a.State = alertStateFiring
		alertMgr[a.ID] = &managedAlert{alert: a, nodeKey: nodeKey}
		fired = append(fired, a)
	}

	for _, a := range events {
		seen[a.ID] = struct{}{}
		a.Timestamp = nowStr
		a.LastSeen = nowStr
		a.State = alertStateFiring
		alertMgr[a.ID] = &managedAlert{alert: a, nodeKey: nodeKey, expires: now.Add(eventAlertTTL)}
		fired = append(fired, a)
	}

	for id, m := range alertMgr {
		if m.nodeKey != nodeKey {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		if !m.expires.IsZero() && now.Before(m.expires) {
			continue // event alert still within its TTL
		}
		m.alert.State = alertStateResolved
		m.alert.ResolvedAt = nowStr
		delete(alertMgr, id)
		recordHistoryLocked(m.alert)
		resolved = append(resolved, m.alert)
	}

	for _, a := range fired {
		recordHistoryLocked(a)
	}
	return fired, resolved
}

// addManualAlert registers a one-shot alert that is not tied to node evaluation (test alerts).
func addManualAlert(a HealthAlert) HealthAlert {
	nowStr := time.Now().UTC().Format(time.RFC3339)
	a.Timestamp, a.LastSeen, a.State = nowStr, nowStr, alertStateFiring
	alertMgrMu.Lock()
	alertMgr[a.ID] = &managedAlert{alert: a, nodeKey: "manual", expires: time.Now().Add(eventAlertTTL)}
	recordHistoryLocked(a)
	alertMgrMu.Unlock()
	return a
}

// resolveNodeAlerts drops every alert belonging to a node (used when a node is pruned).
func resolveNodeAlerts(nodeKey string) []HealthAlert {
	nowStr := time.Now().UTC().Format(time.RFC3339)
	alertMgrMu.Lock()
	defer alertMgrMu.Unlock()
	var out []HealthAlert
	for id, m := range alertMgr {
		if m.nodeKey == nodeKey {
			m.alert.State, m.alert.ResolvedAt = alertStateResolved, nowStr
			delete(alertMgr, id)
			recordHistoryLocked(m.alert)
			out = append(out, m.alert)
		}
	}
	return out
}

// expireEventAlerts removes one-shot alerts whose TTL passed; returns whether anything changed.
func expireEventAlerts() bool {
	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339)
	alertMgrMu.Lock()
	defer alertMgrMu.Unlock()
	changed := false
	for id, m := range alertMgr {
		if !m.expires.IsZero() && !now.Before(m.expires) {
			m.alert.State, m.alert.ResolvedAt = alertStateResolved, nowStr
			delete(alertMgr, id)
			recordHistoryLocked(m.alert)
			changed = true
		}
	}
	return changed
}

func sortAlerts(list []HealthAlert) {
	sort.SliceStable(list, func(i, j int) bool {
		if ri, rj := severityRank(list[i].Severity), severityRank(list[j].Severity); ri != rj {
			return ri < rj
		}
		return list[i].Timestamp > list[j].Timestamp
	})
}

// activeAlertsSnapshot returns firing alerts, most severe then newest first, capped.
func activeAlertsSnapshot() []HealthAlert {
	alertMgrMu.Lock()
	out := make([]HealthAlert, 0, len(alertMgr))
	for _, m := range alertMgr {
		out = append(out, m.alert)
	}
	alertMgrMu.Unlock()
	sortAlerts(out)
	if len(out) > maxActiveAlerts {
		out = out[:maxActiveAlerts]
	}
	return out
}

// alertHistorySnapshot returns recent alert events, newest first.
func alertHistorySnapshot() []HealthAlert {
	alertMgrMu.Lock()
	out := make([]HealthAlert, len(alertHistory))
	for i, a := range alertHistory {
		out[len(alertHistory)-1-i] = a
	}
	alertMgrMu.Unlock()
	return out
}

func countAlertsBySeverity(list []HealthAlert) (critical, warning, info int) {
	for _, a := range list {
		switch a.Severity {
		case AlertCritical:
			critical++
		case AlertWarning:
			warning++
		default:
			info++
		}
	}
	return
}
