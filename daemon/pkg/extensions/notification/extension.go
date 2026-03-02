// Package notification implements the notification extension: subscribe to node/pod/container
// metrics from Component 01 telemetry and send webhook alerts (Slack, Discord, Teams) when
// metrics exceed thresholds configured from the frontend.
package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/spi"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/telemetry"
)

const extensionName = "notification"

var (
	ext   *notificationExtension
	extMu sync.Once

	// configMu guards notificationConfig; allows frontend to update config via API.
	configMu           sync.RWMutex
	notificationConfig spi.ExtensionParams
)

type notificationExtension struct{}

// GetExtension returns the singleton notification extension instance.
func GetExtension() spi.Extension {
	extMu.Do(func() { ext = &notificationExtension{} })
	return ext
}

func (e *notificationExtension) Name() string { return extensionName }

// SetConfig updates the notification config (called by API when frontend posts config).
func SetConfig(params spi.ExtensionParams) {
	configMu.Lock()
	defer configMu.Unlock()
	notificationConfig = params
}

// GetConfig returns the current notification config.
func GetConfig() spi.ExtensionParams {
	configMu.RLock()
	defer configMu.RUnlock()
	return notificationConfig
}

// webhookSpec is one destination (Teams, Slack, or Discord). Alerts are sent to all enabled webhooks.
type webhookSpec struct {
	Type    string // "teams", "slack", "discord"
	URL     string
	Enabled bool
}

// getWebhooksFromConfig returns all webhook destinations. New format: config["webhooks"] array.
// Legacy: single webhook from webhook_type + webhook_url_teams / webhook_url_slack / webhook_url.
func getWebhooksFromConfig(cfg spi.ExtensionParams) []webhookSpec {
	if cfg.Config == nil {
		return nil
	}
	raw, ok := cfg.Config["webhooks"]
	sl, _ := raw.([]interface{})
	if ok && len(sl) > 0 {
		var out []webhookSpec
		for _, v := range sl {
			m, ok := v.(map[string]interface{})
			if !ok {
				continue
			}
			typ := ""
			if s, ok := m["type"].(string); ok {
				typ = strings.ToLower(strings.TrimSpace(s))
			}
			if typ == "" {
				typ = "discord"
			}
			url := ""
			if s, ok := m["url"].(string); ok {
				url = strings.TrimSpace(s)
			}
			enabled := true
			if b, ok := m["enabled"].(bool); ok {
				enabled = b
			}
			if url == "" || strings.Contains(strings.ToLower(url), "discord.com") && (typ == "teams" || typ == "slack") {
				continue
			}
			out = append(out, webhookSpec{Type: typ, URL: url, Enabled: enabled})
		}
		return out
	}
	// Legacy: single webhook from flat config
	typ := strings.ToLower(strings.TrimSpace(cfg.GetString("webhook_type")))
	if typ == "" {
		typ = "discord"
	}
	var url string
	switch typ {
	case "teams":
		url = cfg.GetString("webhook_url_teams")
		if strings.Contains(strings.ToLower(url), "discord.com") {
			url = ""
		}
	case "slack":
		url = cfg.GetString("webhook_url_slack")
		if strings.Contains(strings.ToLower(url), "discord.com") {
			url = ""
		}
	default:
		url = cfg.GetString("webhook_url")
	}
	if url == "" {
		return nil
	}
	return []webhookSpec{{Type: typ, URL: url, Enabled: true}}
}

// thresholdSpec is one entry from the config thresholds list or legacy single-threshold.
type thresholdSpec struct {
	MetricType string
	Level      string
	Threshold  float64
	NodeName   string
}

// getThresholdsFromConfig returns all threshold rules: from config["thresholds"] array, or legacy single from top-level.
func getThresholdsFromConfig(cfg spi.ExtensionParams) []thresholdSpec {
	if cfg.Config == nil {
		return nil
	}
	raw, ok := cfg.Config["thresholds"]
	sl, _ := raw.([]interface{})
	if !ok || len(sl) == 0 {
		// Legacy: single threshold from top-level
		mt := cfg.GetString("metric_type")
		if mt == "" {
			mt = "dns_latency"
		}
		lv := cfg.GetString("level")
		if lv == "" {
			lv = "pod"
		}
		th := cfg.GetFloat("threshold_value")
		node := cfg.GetString("node_name")
		return []thresholdSpec{{MetricType: mt, Level: lv, Threshold: th, NodeName: node}}
	}
	var out []thresholdSpec
	for _, v := range sl {
		m, ok := v.(map[string]interface{})
		if !ok {
			continue
		}
		mt := ""
		if s, ok := m["metric_type"].(string); ok {
			mt = s
		}
		if mt == "" {
			mt = "dns_latency"
		}
		lv := ""
		if s, ok := m["level"].(string); ok {
			lv = s
		}
		if lv == "" {
			lv = "pod"
		}
		th := 0.0
		switch n := m["threshold_value"].(type) {
		case float64:
			th = n
		case float32:
			th = float64(n)
		case int:
			th = float64(n)
		case int32:
			th = float64(n)
		case int64:
			th = float64(n)
		}
		node := ""
		if s, ok := m["node_name"].(string); ok {
			node = s
		}
		out = append(out, thresholdSpec{MetricType: mt, Level: lv, Threshold: th, NodeName: node})
	}
	return out
}

// TriggerNow runs one threshold evaluation and sends alerts to all enabled webhooks (no cooldown).
func TriggerNow() {
	e := &notificationExtension{}
	cfg := GetConfig()
	if cfg.Config == nil || !cfg.GetBool("enabled") {
		log.Printf("[Notification] TriggerNow skipped: no config or disabled")
		return
	}
	webhooks := getWebhooksFromConfig(cfg)
	if len(webhooks) == 0 {
		log.Printf("[Notification] TriggerNow skipped: no webhooks (check config has webhooks with url and type)")
		return
	}
	thresholds := getThresholdsFromConfig(cfg)
	if len(thresholds) == 0 {
		log.Printf("[Notification] TriggerNow skipped: no thresholds")
		return
	}
	var allAlerts []alert
	for _, t := range thresholds {
		alerts := e.evaluateThresholds(t.MetricType, t.Level, t.Threshold, t.NodeName)
		allAlerts = append(allAlerts, alerts...)
	}
	if len(allAlerts) == 0 {
		log.Printf("[Notification] TriggerNow: %d webhooks, %d thresholds, 0 alerts (no metrics exceeded threshold or no telemetry data)", len(webhooks), len(thresholds))
		return
	}
	for _, a := range allAlerts {
		for _, wh := range webhooks {
			if !wh.Enabled || wh.URL == "" {
				continue
			}
			body := e.buildWebhookBody(wh.Type, a)
			if err := e.sendWebhook(wh.URL, wh.Type, body); err != nil {
				log.Printf("[Notification] TriggerNow webhook send failed (%s): %v", wh.Type, err)
			}
		}
	}
	log.Printf("[Notification] TriggerNow sent %d alert(s) to %d webhook(s)", len(allAlerts), len(webhooks))
}

// SendTestToAllWebhooks sends one test message to every enabled webhook so the user can verify Discord/Teams/Slack receive it.
func SendTestToAllWebhooks() {
	e := &notificationExtension{}
	cfg := GetConfig()
	if cfg.Config == nil {
		log.Printf("[Notification] Test skipped: no config")
		return
	}
	webhooks := getWebhooksFromConfig(cfg)
	if len(webhooks) == 0 {
		log.Printf("[Notification] Test skipped: no webhooks")
		return
	}
	testAlert := alert{
		Key:       "test",
		Message:   "Test notification from Kernel Eye – webhooks are working.",
		Level:     "pod",
		Metric:    "test",
		Value:     0,
		Threshold: 0,
		NodeName:  currentNodeName(),
		PodName:   "",
	}
	sent := 0
	for _, wh := range webhooks {
		if !wh.Enabled || wh.URL == "" {
			continue
		}
		body := e.buildWebhookBody(wh.Type, testAlert)
		if err := e.sendWebhook(wh.URL, wh.Type, body); err != nil {
			log.Printf("[Notification] Test webhook failed (%s): %v", wh.Type, err)
		} else {
			sent++
		}
	}
	log.Printf("[Notification] Test sent to %d/%d webhook(s)", sent, len(webhooks))
}

// Run subscribes to metrics via the telemetry package, evaluates thresholds, and sends webhooks.
// Config can be set at startup via params or later via SetConfig (from frontend API).
func (e *notificationExtension) Run(ctx context.Context, params spi.ExtensionParams) error {
	// Merge initial params into store so GetConfig returns something at first
	if params.Config != nil {
		SetConfig(params)
	}

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	lastAlert := make(map[string]time.Time)
	var lastMu sync.Mutex
	cooldown := 5 * time.Minute

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			cfg := GetConfig()
			if cfg.Config == nil || !cfg.GetBool("enabled") {
				continue
			}
			webhooks := getWebhooksFromConfig(cfg)
			if len(webhooks) == 0 {
				continue
			}
			thresholds := getThresholdsFromConfig(cfg)
			if len(thresholds) == 0 {
				continue
			}
			intervalSec := cfg.GetFloat("interval_seconds")
			if intervalSec <= 0 {
				intervalSec = 15
			}

			var allAlerts []alert
			for _, t := range thresholds {
				alerts := e.evaluateThresholds(t.MetricType, t.Level, t.Threshold, t.NodeName)
				allAlerts = append(allAlerts, alerts...)
			}
			if len(allAlerts) > 0 {
				log.Printf("[Notification] Run: %d alert(s), sending to %d webhook(s)", len(allAlerts), len(webhooks))
			}
			for _, a := range allAlerts {
				key := a.Key
				lastMu.Lock()
				if t, ok := lastAlert[key]; ok && time.Since(t) < cooldown {
					lastMu.Unlock()
					continue
				}
				lastAlert[key] = time.Now()
				lastMu.Unlock()

				for _, wh := range webhooks {
					if !wh.Enabled || wh.URL == "" {
						continue
					}
					body := e.buildWebhookBody(wh.Type, a)
					if err := e.sendWebhook(wh.URL, wh.Type, body); err != nil {
						log.Printf("[Notification] Webhook send failed (%s): %v", wh.Type, err)
					}
				}
			}
		}
	}
}

type alert struct {
	Key       string
	Message   string
	Level     string
	Metric    string
	Value     float64
	Threshold float64
	NodeName  string
	PodName   string
}

func currentNodeName() string {
	n := os.Getenv("NODE_NAME")
	if n == "" {
		n = "unknown"
	}
	return n
}

// matchesNodeFilter returns true if we should include this alert (node filter from config).
func matchesNodeFilter(configNodeName, alertNodeName string) bool {
	configNodeName = strings.TrimSpace(configNodeName)
	if configNodeName == "" {
		return true
	}
	return alertNodeName == configNodeName
}

// evaluateThresholds gathers node/pod/container metrics from telemetry and returns alerts where value > threshold.
// nodeFilter: if non-empty, only include alerts for this node name.
func (e *notificationExtension) evaluateThresholds(metricType, level string, threshold float64, nodeFilter string) []alert {
	nodeName := currentNodeName()
	if nodeFilter != "" && nodeName != nodeFilter {
		return nil
	}
	var alerts []alert

	switch metricType {
	case "dns_latency":
		if level == "pod" {
			for podKey, m := range telemetry.GetPodDNSMetrics() {
				if m.TotalEvents == 0 {
					continue
				}
				avgUs := float64(m.TotalLatencyNs) / float64(m.TotalEvents) / 1000
				if avgUs >= threshold {
					alerts = append(alerts, alert{
						Key:       "dns_pod_" + podKey,
						Message:   fmt.Sprintf("Node %s Pod %s: DNS avg latency %.2f µs exceeds threshold %.2f µs", nodeName, podKey, avgUs, threshold),
						Level:     "pod",
						Metric:    "dns_latency",
						Value:     avgUs,
						Threshold: threshold,
						NodeName:  nodeName,
						PodName:   podKey,
					})
				}
			}
		} else if level == "container" {
			for cKey, m := range telemetry.GetContainerDNSMetrics() {
				if m.TotalEvents == 0 {
					continue
				}
				avgUs := float64(m.TotalLatencyNs) / float64(m.TotalEvents) / 1000
				if avgUs >= threshold {
					podKey := m.Namespace + "/" + m.PodName
					alerts = append(alerts, alert{
						Key:       "dns_container_" + cKey,
						Message:   fmt.Sprintf("Node %s Pod %s Container %s: DNS avg latency %.2f µs exceeds threshold %.2f µs", nodeName, podKey, m.ContainerName, avgUs, threshold),
						Level:     "container",
						Metric:    "dns_latency",
						Value:     avgUs,
						Threshold: threshold,
						NodeName:  nodeName,
						PodName:   podKey,
					})
				}
			}
		} else {
			nm := telemetry.GetDNSMetrics()
			if nm.TotalEvents > 0 {
				avgUs := float64(nm.TotalLatencyNs) / float64(nm.TotalEvents) / 1000
				if avgUs >= threshold {
					alerts = append(alerts, alert{
						Key:       "dns_node",
						Message:   fmt.Sprintf("Node %s: DNS avg latency %.2f µs exceeds threshold %.2f µs", nodeName, avgUs, threshold),
						Level:     "node",
						Metric:    "dns_latency",
						Value:     avgUs,
						Threshold: threshold,
						NodeName:  nodeName,
						PodName:   "",
					})
				}
			}
		}
	case "rtt":
		if level == "pod" {
			for podKey, m := range telemetry.GetPodRTTMetrics() {
				if m.TotalEvents == 0 {
					continue
				}
				avgUs := float64(m.TotalRTTNs) / float64(m.TotalEvents) / 1000
				if avgUs >= threshold {
					alerts = append(alerts, alert{
						Key:       "rtt_pod_" + podKey,
						Message:   fmt.Sprintf("Node %s Pod %s: RTT avg %.2f µs exceeds threshold %.2f µs", nodeName, podKey, avgUs, threshold),
						Level:     "pod",
						Metric:    "rtt",
						Value:     avgUs,
						Threshold: threshold,
						NodeName:  nodeName,
						PodName:   podKey,
					})
				}
			}
		} else if level == "container" {
			for cKey, m := range telemetry.GetContainerTCPMetrics() {
				// Use SmoothedRTTUs or MinRTTUs (already in µs) as RTT indicator
				var rttUs float64
				if m.MinRTTUs > 0 {
					rttUs = float64(m.MinRTTUs)
				} else {
					rttUs = float64(m.SmoothedRTTUs)
				}
				if rttUs >= threshold {
					alerts = append(alerts, alert{
						Key:       "rtt_container_" + cKey,
						Message:   fmt.Sprintf("Node %s Pod %s: RTT %.2f µs exceeds threshold %.2f µs", nodeName, cKey, rttUs, threshold),
						Level:     "container",
						Metric:    "rtt",
						Value:     rttUs,
						Threshold: threshold,
						NodeName:  nodeName,
						PodName:   cKey,
					})
				}
			}
		} else {
			nm := telemetry.GetRTTMetrics()
			if nm.TotalEvents > 0 {
				avgUs := float64(nm.TotalRTTNs) / float64(nm.TotalEvents) / 1000
				if avgUs >= threshold {
					alerts = append(alerts, alert{
						Key:       "rtt_node",
						Message:   fmt.Sprintf("Node %s: RTT avg %.2f µs exceeds threshold %.2f µs", nodeName, avgUs, threshold),
						Level:     "node",
						Metric:    "rtt",
						Value:     avgUs,
						Threshold: threshold,
						NodeName:  nodeName,
						PodName:   "",
					})
				}
			}
		}
	case "node_system":
		nm := telemetry.GetNodeSystemMetrics()
		if level == "node" {
			if nm.CPUUsagePercent >= threshold {
				alerts = append(alerts, alert{
					Key:       "node_cpu",
					Message:   fmt.Sprintf("Node %s: CPU %.2f%% exceeds threshold %.2f%%", nodeName, nm.CPUUsagePercent, threshold),
					Level:     "node",
					Metric:    "node_system_cpu",
					Value:     nm.CPUUsagePercent,
					Threshold: threshold,
					NodeName:  nodeName,
					PodName:   "",
				})
			}
			if nm.MemoryUsagePercent >= threshold {
				alerts = append(alerts, alert{
					Key:       "node_memory",
					Message:   fmt.Sprintf("Node %s: memory %.2f%% exceeds threshold %.2f%%", nodeName, nm.MemoryUsagePercent, threshold),
					Level:     "node",
					Metric:    "node_system_memory",
					Value:     nm.MemoryUsagePercent,
					Threshold: threshold,
					NodeName:  nodeName,
					PodName:   "",
				})
			}
		}
	case "sched_latency":
		if level == "pod" {
			for podKey, m := range telemetry.GetPodSchedLatencyMetrics() {
				if m.EventCount == 0 {
					continue
				}
				avgUs := m.AvgRunqueueLatencyUs
				if avgUs >= threshold {
					alerts = append(alerts, alert{
						Key:       "sched_pod_" + podKey,
						Message:   fmt.Sprintf("Node %s Pod %s: sched latency avg %.2f µs exceeds threshold %.2f µs", nodeName, podKey, avgUs, threshold),
						Level:     "pod",
						Metric:    "sched_latency",
						Value:     avgUs,
						Threshold: threshold,
						NodeName:  nodeName,
						PodName:   podKey,
					})
				}
			}
		} else if level == "container" {
			for cKey, m := range telemetry.GetContainerSchedLatencyMetrics() {
				if m.EventCount == 0 {
					continue
				}
				avgUs := m.AvgRunqueueLatencyUs
				if avgUs >= threshold {
					alerts = append(alerts, alert{
						Key:       "sched_container_" + cKey,
						Message:   fmt.Sprintf("Node %s Pod %s: sched latency avg %.2f µs exceeds threshold %.2f µs", nodeName, cKey, avgUs, threshold),
						Level:     "container",
						Metric:    "sched_latency",
						Value:     avgUs,
						Threshold: threshold,
						NodeName:  nodeName,
						PodName:   cKey,
					})
				}
			}
		} else {
			metrics := telemetry.GetSchedLatencyMetrics()
			if metrics.TotalEvents > 0 {
				avgUs := metrics.AvgRunqueueLatencyUs
				if avgUs >= threshold {
					alerts = append(alerts, alert{
						Key:       "sched_node",
						Message:   fmt.Sprintf("Node %s: sched latency avg %.2f µs exceeds threshold %.2f µs", nodeName, avgUs, threshold),
						Level:     "node",
						Metric:    "sched_latency",
						Value:     avgUs,
						Threshold: threshold,
						NodeName:  nodeName,
						PodName:   "",
					})
				}
			}
		}
	case "disk_io":
		if level == "pod" {
			for podKey, m := range telemetry.GetPodDiskIOMetrics() {
				if m == nil {
					continue
				}
				// Use total read+write bytes as a simple scalar
				totalBytes := m.TotalReadBytes + m.TotalWriteBytes
				val := float64(totalBytes)
				if threshold > 0 && val >= threshold {
					alerts = append(alerts, alert{
						Key:       "disk_pod_" + podKey,
						Message:   fmt.Sprintf("Node %s Pod %s: disk I/O total bytes %.0f exceeds threshold %.0f", nodeName, podKey, val, threshold),
						Level:     "pod",
						Metric:    "disk_io",
						Value:     val,
						Threshold: threshold,
						NodeName:  nodeName,
						PodName:   podKey,
					})
				}
			}
		} else if level == "container" {
			for cKey, m := range telemetry.GetContainerDiskIOMetrics() {
				if m == nil {
					continue
				}
				totalBytes := m.TotalReadBytes + m.TotalWriteBytes
				val := float64(totalBytes)
				if threshold > 0 && val >= threshold {
					alerts = append(alerts, alert{
						Key:       "disk_container_" + cKey,
						Message:   fmt.Sprintf("Node %s Pod %s: disk I/O total bytes %.0f exceeds threshold %.0f", nodeName, cKey, val, threshold),
						Level:     "container",
						Metric:    "disk_io",
						Value:     val,
						Threshold: threshold,
						NodeName:  nodeName,
						PodName:   cKey,
					})
				}
			}
		} else {
			nm := telemetry.GetPodDiskIOMetrics()
			var total uint64
			for _, m := range nm {
				if m != nil {
					total += m.TotalReadBytes + m.TotalWriteBytes
				}
			}
			val := float64(total)
			if threshold > 0 && val >= threshold {
				alerts = append(alerts, alert{
					Key:       "disk_node",
					Message:   fmt.Sprintf("Node %s: disk I/O total bytes %.0f exceeds threshold %.0f", nodeName, val, threshold),
					Level:     "node",
					Metric:    "disk_io",
					Value:     val,
					Threshold: threshold,
					NodeName:  nodeName,
					PodName:   "",
				})
			}
		}
	}

	// Filter by node_name config if set
	if nodeFilter != "" {
		filtered := alerts[:0]
		for _, a := range alerts {
			if matchesNodeFilter(nodeFilter, a.NodeName) {
				filtered = append(filtered, a)
			}
		}
		alerts = filtered
	}
	return alerts
}

func (e *notificationExtension) buildWebhookBody(webhookType string, a alert) []byte {
	msg := a.Message
	switch webhookType {
	case "slack":
		// Slack: https://api.slack.com/messaging/webhooks
		payload := map[string]interface{}{
			"text": msg,
		}
		b, _ := json.Marshal(payload)
		return b
	case "discord":
		// Discord: https://discord.com/developers/docs/resources/webhook
		// Use embeds for rich alert (title, description, color, fields) with Node and Pod
		fields := []map[string]interface{}{
			{"name": "Node", "value": a.NodeName, "inline": true},
			{"name": "Pod", "value": a.PodName, "inline": true},
			{"name": "Metric", "value": a.Metric, "inline": true},
			{"name": "Level", "value": a.Level, "inline": true},
			{"name": "Current value", "value": fmt.Sprintf("%.2f", a.Value), "inline": true},
			{"name": "Threshold", "value": fmt.Sprintf("%.2f", a.Threshold), "inline": true},
		}
		if a.PodName == "" {
			fields[1]["value"] = "—"
		}
		embed := map[string]interface{}{
			"title":       "eBPF Daemon – Threshold Exceeded",
			"description": msg,
			"color":       0xE74C3C, // red
			"fields":      fields,
			"footer":      map[string]interface{}{"text": "Kernel Eye · Component 1"},
		}
		payload := map[string]interface{}{
			"embeds": []map[string]interface{}{embed},
		}
		b, _ := json.Marshal(payload)
		return b
	case "teams":
		// Microsoft Teams / Power Automate: message card payload (POST, JSON).
		// https://learn.microsoft.com/en-us/outlook/actionable-messages/message-card-reference
		// Power Automate "When a HTTP request is received" accepts this; workflow can post to Teams.
		potVal := a.PodName
		if potVal == "" {
			potVal = "—"
		}
		facts := []map[string]string{
			{"name": "Node", "value": a.NodeName},
			{"name": "Pod", "value": potVal},
			{"name": "Metric", "value": a.Metric},
			{"name": "Level", "value": a.Level},
			{"name": "Current value", "value": fmt.Sprintf("%.2f", a.Value)},
			{"name": "Threshold", "value": fmt.Sprintf("%.2f", a.Threshold)},
		}
		payload := map[string]interface{}{
			"@type":      "MessageCard",
			"@context":   "http://schema.org/extensions",
			"summary":    "eBPF Daemon – Threshold Exceeded",
			"themeColor": "E74C3C",
			"sections": []map[string]interface{}{
				{
					"activityTitle":    "eBPF Daemon – Threshold Exceeded",
					"activitySubtitle": "Kernel Eye · Component 1",
					"text":             msg,
					"facts":            facts,
				},
			},
		}
		b, _ := json.Marshal(payload)
		return b
	default:
		payload := map[string]interface{}{"text": msg}
		b, _ := json.Marshal(payload)
		return b
	}
}

func (e *notificationExtension) sendWebhook(url, webhookType string, body []byte) error {
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodySlurp, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("webhook returned %d: %s", resp.StatusCode, strings.TrimSpace(string(bodySlurp)))
	}
	log.Printf("[Notification] Alert sent to %s webhook", webhookType)
	return nil
}
