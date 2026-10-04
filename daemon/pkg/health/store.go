package health

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

const (
	historyCapacity = 360 // per node; 30 minutes at one point every 5s
	alertLogLimit   = 200
)

// Point is one sample in a node's health history.
type Point struct {
	Time  time.Time `json:"time"`
	Score float64   `json:"score"`
	Level Level     `json:"level"`
}

// Finding is a problem observed in the current evaluation cycle.
type Finding struct {
	Key      string // unique per node+problem, e.g. "node-1/dns_latency_ms"
	Node     string
	Metric   string
	Severity Level // warning or critical
	Message  string
	Value    float64
}

// Alert is a firing or resolved finding.
type Alert struct {
	ID         string     `json:"id"`
	Key        string     `json:"key"`
	Node       string     `json:"node"`
	Metric     string     `json:"metric"`
	Severity   Level      `json:"severity"`
	Message    string     `json:"message"`
	Value      float64    `json:"value"`
	Status     string     `json:"status"` // firing | resolved
	FiredAt    time.Time  `json:"fired_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
}

// Store keeps health history and the alert log. Safe for concurrent use.
type Store struct {
	mu      sync.RWMutex
	history map[string][]Point
	active  map[string]*Alert
	log     []Alert // resolved alerts, oldest first
	seq     int
}

func NewStore() *Store {
	return &Store{
		history: make(map[string][]Point),
		active:  make(map[string]*Alert),
	}
}

// Record appends one point per node and drops history for nodes that left.
func (s *Store) Record(nodes []NodeHealth, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	present := make(map[string]struct{}, len(nodes))
	for _, n := range nodes {
		present[n.Node] = struct{}{}
		pts := append(s.history[n.Node], Point{Time: now, Score: n.Score, Level: n.Level})
		if len(pts) > historyCapacity {
			pts = pts[len(pts)-historyCapacity:]
		}
		s.history[n.Node] = pts
	}
	for node := range s.history {
		if _, ok := present[node]; !ok {
			delete(s.history, node)
		}
	}
}

// History returns up to limit most recent points for a node (all if <= 0).
func (s *Store) History(node string, limit int) []Point {
	s.mu.RLock()
	defer s.mu.RUnlock()
	pts := s.history[node]
	if limit > 0 && len(pts) > limit {
		pts = pts[len(pts)-limit:]
	}
	return append([]Point(nil), pts...)
}

// HistoryAll returns history for every node.
func (s *Store) HistoryAll(limit int) map[string][]Point {
	s.mu.RLock()
	nodes := make([]string, 0, len(s.history))
	for n := range s.history {
		nodes = append(nodes, n)
	}
	s.mu.RUnlock()
	out := make(map[string][]Point, len(nodes))
	for _, n := range nodes {
		out[n] = s.History(n, limit)
	}
	return out
}

// Update diffs the current findings against active alerts: new findings fire,
// changed severities update, and findings that disappeared resolve.
func (s *Store) Update(findings []Finding, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()

	seen := make(map[string]struct{}, len(findings))
	for _, f := range findings {
		seen[f.Key] = struct{}{}
		if a, ok := s.active[f.Key]; ok {
			a.Severity, a.Message, a.Value, a.UpdatedAt = f.Severity, f.Message, f.Value, now
			continue
		}
		s.seq++
		s.active[f.Key] = &Alert{
			ID:  fmt.Sprintf("alert-%d", s.seq),
			Key: f.Key, Node: f.Node, Metric: f.Metric,
			Severity: f.Severity, Message: f.Message, Value: f.Value,
			Status: "firing", FiredAt: now, UpdatedAt: now,
		}
	}
	for key, a := range s.active {
		if _, ok := seen[key]; ok {
			continue
		}
		resolved := *a
		resolved.Status, resolved.UpdatedAt = "resolved", now
		resolved.ResolvedAt = &now
		s.log = append(s.log, resolved)
		delete(s.active, key)
	}
	if len(s.log) > alertLogLimit {
		s.log = s.log[len(s.log)-alertLogLimit:]
	}
}

// Alerts returns alerts newest first. status is "firing", "resolved" or ""
// for both.
func (s *Store) Alerts(status string) []Alert {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []Alert
	if status != "resolved" {
		for _, a := range s.active {
			out = append(out, *a)
		}
	}
	if status != "firing" {
		out = append(out, s.log...)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out
}
