
package health

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
)

// Standard returns the built-in thresholds. A fresh copy is returned each call.
func Standard() map[string]Band {
	return map[string]Band{
		MetricDNSLatency:       {Excellent: 5, Good: 10, Warning: 50},
		MetricTCPSrtt:          {Excellent: 50, Good: 100, Warning: 500},
		MetricRunQueue:         {Excellent: 5, Good: 10, Warning: 50},
		MetricCPUStarvation:    {Excellent: 1, Good: 6, Warning: 21},
		MetricTCPRetransRate:   {Excellent: 0.5, Good: 1, Warning: 5},
		MetricTCPLossRate:      {Excellent: 0.1, Good: 0.5, Warning: 2},
		MetricTCPBadHSRate:     {Excellent: 0.05, Good: 0.2, Warning: 1},
		MetricCPUUsage:         {Excellent: 50, Good: 70, Warning: 85},
		MetricMemoryUsage:      {Excellent: 60, Good: 75, Warning: 90},
		MetricServiceUnhealthy: {Excellent: 1, Good: 10, Warning: 30},
	}
}

// ValidateBand checks a band is usable: non-negative and non-decreasing.
func ValidateBand(b Band) error {
	if b.Excellent < 0 || b.Good < 0 || b.Warning < 0 {
		return fmt.Errorf("thresholds must be non-negative")
	}
	if b.Excellent > b.Good || b.Good > b.Warning {
		return fmt.Errorf("thresholds must satisfy excellent <= good <= warning")
	}
	if b.Warning == 0 {
		return fmt.Errorf("warning threshold must be greater than zero")
	}
	return nil
}

// ThresholdStore holds the user's custom overrides on top of Standard().
// Overrides are persisted to a JSON file when a path is configured.
type ThresholdStore struct {
	mu     sync.RWMutex
	custom map[string]Band
	path   string
}

// NewThresholdStore loads overrides from path (if it exists). An empty path
// keeps overrides in memory only.
func NewThresholdStore(path string) *ThresholdStore {
	s := &ThresholdStore{custom: make(map[string]Band), path: path}
	if path == "" {
		return s
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return s
	}
	var loaded map[string]Band
	if err := json.Unmarshal(data, &loaded); err != nil {
		log.Printf("[Health] Ignoring unreadable thresholds file %s: %v", path, err)
		return s
	}
	for id, band := range loaded {
		if _, ok := metricInfo(id); ok && ValidateBand(band) == nil {
			s.custom[id] = band
		}
	}
	return s
}

// Active returns the thresholds in effect: standard values with custom
// overrides applied.
func (s *ThresholdStore) Active() map[string]Band {
	active := Standard()
	s.mu.RLock()
	defer s.mu.RUnlock()
	for id, band := range s.custom {
		active[id] = band
	}
	return active
}

// Custom returns a copy of the user's overrides.
func (s *ThresholdStore) Custom() map[string]Band {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]Band, len(s.custom))
	for id, band := range s.custom {
		out[id] = band
	}
	return out
}

// Set applies overrides for the given metrics. The whole update is rejected
// if any entry is invalid.
func (s *ThresholdStore) Set(update map[string]Band) error {
	for id, band := range update {
		if _, ok := metricInfo(id); !ok {
			return fmt.Errorf("unknown metric %q", id)
		}
		if err := ValidateBand(band); err != nil {
			return fmt.Errorf("%s: %w", id, err)
		}
	}
	s.mu.Lock()
	for id, band := range update {
		s.custom[id] = band
	}
	s.mu.Unlock()
	s.persistOrLog()
	return nil
}

// Reset removes the override for one metric, or all overrides when id is "".
func (s *ThresholdStore) Reset(id string) error {
	s.mu.Lock()
	if id == "" {
		s.custom = make(map[string]Band)
	} else {
		delete(s.custom, id)
	}
	s.mu.Unlock()
	s.persistOrLog()
	return nil
}

// persistOrLog saves overrides; a failed write (e.g. read-only filesystem)
// must not undo the in-memory change, so it is logged instead of returned.
func (s *ThresholdStore) persistOrLog() {
	if err := s.persist(); err != nil {
		log.Printf("[Health] Could not persist thresholds to %s: %v", s.path, err)
	}
}

func (s *ThresholdStore) persist() error {
	if s.path == "" {
		return nil
	}
	data, err := json.MarshalIndent(s.Custom(), "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o644)
}
