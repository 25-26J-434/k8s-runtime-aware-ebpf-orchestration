package scheduler

import "sync"

var (
	rules []SchedulingRule
	mu    sync.RWMutex
)

func SetRules(newRules []SchedulingRule) {
	mu.Lock()
	defer mu.Unlock()
	rules = newRules
}

func GetRules() []SchedulingRule {
	mu.RLock()
	defer mu.RUnlock()
	return rules
}
