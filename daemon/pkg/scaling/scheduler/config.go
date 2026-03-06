package scheduler

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultSchedulerName   = "kerneleye-scheduler"
	defaultMetricsWSURL    = "ws://ebpf-daemon.ebpf-telemetry.svc.cluster.local:8080/api/metrics/ws"
	defaultWorkerCount     = 2
	defaultMetricsStaleFor = 10 * time.Second
	defaultUnknownScore    = 50.0
)

type Config struct {
	SchedulerName        string
	MetricsWSURL         string
	WorkerCount          int
	MetricsStaleAfter    time.Duration
	UnknownScore         float64
	FilterDiskPressure   bool
	FilterMemoryPressure bool
	FilterPIDPressure    bool
}

func LoadConfigFromEnv() (Config, error) {
	cfg := Config{
		SchedulerName:        getenvDefault("SCHEDULER_NAME", defaultSchedulerName),
		MetricsWSURL:         getenvDefault("METRICS_WS_URL", defaultMetricsWSURL),
		WorkerCount:          defaultWorkerCount,
		MetricsStaleAfter:    defaultMetricsStaleFor,
		UnknownScore:         defaultUnknownScore,
		FilterDiskPressure:   getenvBool("FILTER_DISK_PRESSURE", true),
		FilterMemoryPressure: getenvBool("FILTER_MEMORY_PRESSURE", true),
		FilterPIDPressure:    getenvBool("FILTER_PID_PRESSURE", true),
	}

	if workers := strings.TrimSpace(os.Getenv("SCHEDULER_WORKERS")); workers != "" {
		v, err := strconv.Atoi(workers)
		if err != nil || v < 1 {
			return Config{}, fmt.Errorf("invalid SCHEDULER_WORKERS: %q", workers)
		}
		cfg.WorkerCount = v
	}

	if stale := strings.TrimSpace(os.Getenv("METRICS_STALE_AFTER")); stale != "" {
		v, err := time.ParseDuration(stale)
		if err != nil || v <= 0 {
			return Config{}, fmt.Errorf("invalid METRICS_STALE_AFTER: %q", stale)
		}
		cfg.MetricsStaleAfter = v
	}

	if score := strings.TrimSpace(os.Getenv("UNKNOWN_SCORE")); score != "" {
		v, err := strconv.ParseFloat(score, 64)
		if err != nil {
			return Config{}, fmt.Errorf("invalid UNKNOWN_SCORE: %q", score)
		}
		cfg.UnknownScore = clamp(v, 0, 100)
	}

	return cfg, nil
}

func getenvDefault(key, fallback string) string {
	if val := strings.TrimSpace(os.Getenv(key)); val != "" {
		return val
	}
	return fallback
}

func getenvBool(key string, fallback bool) bool {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}

	switch strings.ToLower(raw) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
