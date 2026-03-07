// Package notification implements the notification extension: subscribe to node/pod/container
// metrics from Component 01 telemetry and send webhook alerts (Slack, Discord, Teams) when
// metrics exceed thresholds configured from the frontend.
package notification

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/smtp"
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

	// clusterMetricsProvider is set by the api package at startup so the notification
	// extension can evaluate thresholds against ALL nodes, not just the local one.
	clusterProviderMu      sync.RWMutex
	clusterMetricsProvider func() []ClusterNodeSnapshot
)

// ClusterNodeSnapshot is a plain-Go-type snapshot of one node's cached metrics from the
// api layer's clusterMetrics map. Using only basic types avoids a circular import
// (api imports notification, so notification cannot import api).
type ClusterNodeSnapshot struct {
	NodeName   string
	Node       map[string]interface{}
	Pods       map[string]map[string]interface{}
	Containers map[string]map[string]interface{}
}

// SetClusterMetricsProvider registers a callback (called by the api package after
// initMetricsStreaming) that returns a current snapshot of all nodes' cached metrics.
// The notification extension calls this on every evaluation pass to cover remote nodes.
func SetClusterMetricsProvider(fn func() []ClusterNodeSnapshot) {
	clusterProviderMu.Lock()
	defer clusterProviderMu.Unlock()
	clusterMetricsProvider = fn
}

func getClusterSnapshots() []ClusterNodeSnapshot {
	clusterProviderMu.RLock()
	defer clusterProviderMu.RUnlock()
	if clusterMetricsProvider == nil {
		return nil
	}
	return clusterMetricsProvider()
}

type notificationExtension struct{}

// GetExtension returns the singleton notification extension instance.
func GetExtension() spi.Extension {
	extMu.Do(func() { ext = &notificationExtension{} })
	return ext
}

func (e *notificationExtension) Name() string { return extensionName }

// UIJSON returns the extension's ui.json so the API can serve it without hardcoding the extension name.
// Extensions that provide a UI implement this; the API uses it for GET /api/extensions and /api/extensions/:name/ui.
func (e *notificationExtension) UIJSON() []byte { return UIJSON }

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

// emailSpec holds SMTP settings for sending alert emails when thresholds are exceeded.
type emailSpec struct {
	Enabled  bool
	SMTPHost string
	SMTPPort int
	UseTLS   bool
	Username string
	Password string
	From     string
	To       []string
}

// getStringFromMap gets a string from a map (handles JSON/BSON decoding where type may vary).
func getStringFromMap(m map[string]interface{}, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	return strings.TrimSpace(fmt.Sprintf("%v", v))
}

// getBoolFromMap gets a bool from a map (handles JSON/BSON where value may be bool, string "true"/"1", or number 1).
func getBoolFromMap(m map[string]interface{}, key string) bool {
	v, ok := m[key]
	if !ok || v == nil {
		return false
	}
	if b, ok := v.(bool); ok {
		return b
	}
	if s, ok := v.(string); ok {
		switch strings.ToLower(strings.TrimSpace(s)) {
		case "true", "1", "yes":
			return true
		}
		return false
	}
	switch n := v.(type) {
	case float64:
		return n != 0
	case float32:
		return n != 0
	case int:
		return n != 0
	case int32:
		return n != 0
	case int64:
		return n != 0
	}
	return false
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
			typ := getStringFromMap(m, "type")
			if typ == "" {
				typ = "discord"
			}
			typ = strings.ToLower(typ)
			url := getStringFromMap(m, "url")
			enabled := true
			if b, ok := m["enabled"].(bool); ok {
				enabled = b
			}
			if url == "" {
				continue
			}
			// Don't use a Discord URL for Teams/Slack
			if strings.Contains(strings.ToLower(url), "discord.com") && (typ == "teams" || typ == "slack") {
				continue
			}
			out = append(out, webhookSpec{Type: typ, URL: url, Enabled: enabled})
		}
		if len(out) == 0 {
			log.Printf("[Notification] webhooks array had %d entries but none had valid url (or all skipped)", len(sl))
		} else {
			log.Printf("[Notification] found %d webhook(s) from config", len(out))
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

// getEmailConfigFromConfig reads email (SMTP) settings from config. Returns nil if email is disabled or missing required fields.
// Uses SPI GetBool/GetString so values loaded from MongoDB (BSON decode) work regardless of exact type.
func getEmailConfigFromConfig(cfg spi.ExtensionParams) *emailSpec {
	if cfg.Config == nil {
		log.Printf("[Notification] [EMAIL] getEmailConfig: skipped — no config")
		return nil
	}
	if !cfg.GetBool("email_enabled") {
		log.Printf("[Notification] [EMAIL] getEmailConfig: skipped — email_enabled false or missing")
		return nil
	}
	host := strings.TrimSpace(cfg.GetString("smtp_host"))
	if host == "" {
		log.Printf("[Notification] [EMAIL] getEmailConfig: skipped — smtp_host empty")
		return nil
	}
	port := int(cfg.GetFloat("smtp_port"))
	if port <= 0 {
		port = 587
	}
	from := strings.TrimSpace(cfg.GetString("email_from"))
	toStr := strings.TrimSpace(cfg.GetString("email_to"))
	if from == "" || toStr == "" {
		log.Printf("[Notification] [EMAIL] getEmailConfig: skipped — email_from or email_to empty (from=%q to=%q)", from, toStr)
		return nil
	}
	var to []string
	for _, s := range strings.Split(toStr, ",") {
		s = strings.TrimSpace(s)
		if s != "" {
			to = append(to, s)
		}
	}
	if len(to) == 0 {
		log.Printf("[Notification] [EMAIL] getEmailConfig: skipped — no valid email_to addresses")
		return nil
	}
	// Gmail App Passwords are often pasted with spaces (e.g. "abcd efgh ijkl mnop"); SMTP expects no spaces.
	rawPass := strings.TrimSpace(cfg.GetString("smtp_password"))
	password := strings.ReplaceAll(rawPass, " ", "")

	log.Printf("[Notification] [EMAIL] getEmailConfig: OK — host=%s port=%d from=%s to=%d recipient(s)", host, port, from, len(to))
	return &emailSpec{
		Enabled:  true,
		SMTPHost: host,
		SMTPPort: port,
		UseTLS:   cfg.GetBool("smtp_use_tls"),
		Username: strings.TrimSpace(cfg.GetString("smtp_username")),
		Password: password,
		From:     from,
		To:       to,
	}
}

// thresholdSpec is one entry from the config thresholds list or legacy single-threshold.
type thresholdSpec struct {
	MetricType string
	Level      string
	Threshold  float64
	NodeName   string
}

// getThresholdsFromConfig returns all threshold rules: from config["thresholds"] array, or legacy single from top-level.
// Thresholds with value <= 0 are always skipped — a zero threshold would match every metric reading.
func getThresholdsFromConfig(cfg spi.ExtensionParams) []thresholdSpec {
	if cfg.Config == nil {
		return nil
	}
	raw, ok := cfg.Config["thresholds"]
	sl, _ := raw.([]interface{})
	if !ok || len(sl) == 0 {
		// Legacy: single threshold from top-level config keys (pre-drawer UI).
		// Only use it if threshold_value was explicitly set to a positive number.
		th := cfg.GetFloat("threshold_value")
		if th <= 0 {
			// No valid legacy threshold — user has not configured any rules yet.
			return nil
		}
		mt := cfg.GetString("metric_type")
		if mt == "" {
			mt = "dns_latency"
		}
		lv := cfg.GetString("level")
		if lv == "" {
			lv = "pod"
		}
		node := cfg.GetString("node_name")
		return []thresholdSpec{{MetricType: mt, Level: lv, Threshold: th, NodeName: node}}
	}
	var out []thresholdSpec
	for _, v := range sl {
		m, ok := v.(map[string]interface{})
		if !ok {
			continue
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
		// Skip rules with no meaningful threshold — they would match every metric value.
		if th <= 0 {
			log.Printf("[Notification] skipping threshold rule with value <= 0")
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
		node := ""
		if s, ok := m["node_name"].(string); ok {
			node = s
		}
		out = append(out, thresholdSpec{MetricType: mt, Level: lv, Threshold: th, NodeName: node})
	}
	return out
}

// TriggerNow runs one threshold evaluation and sends alerts to all enabled webhooks and email (no cooldown).
func TriggerNow() {
	LoadConfigFromStore(context.Background())
	e := &notificationExtension{}
	cfg := GetConfig()
	if cfg.Config == nil || !cfg.GetBool("enabled") {
		log.Printf("[Notification] TriggerNow skipped: no config or disabled")
		return
	}
	webhooks := getWebhooksFromConfig(cfg)
	emailSpec := getEmailConfigFromConfig(cfg)
	log.Printf("[Notification] [EMAIL] TriggerNow: webhooks=%d email_configured=%v", len(webhooks), emailSpec != nil)
	if len(webhooks) == 0 && emailSpec == nil {
		log.Printf("[Notification] TriggerNow skipped: no webhooks or email configured")
		return
	}
	thresholds := getThresholdsFromConfig(cfg)
	if len(thresholds) == 0 {
		log.Printf("[Notification] TriggerNow skipped: no thresholds")
		return
	}
	allAlerts := e.collectAllAlerts(thresholds)
	if len(allAlerts) == 0 {
		log.Printf("[Notification] TriggerNow: no alerts (metrics did not exceed thresholds)")
		return
	}
	if len(webhooks) > 0 {
		e.dispatchAlerts(allAlerts, webhooks, nil, nil, 0)
		log.Printf("[Notification] TriggerNow sent %d alert(s) to %d webhook(s)", len(allAlerts), len(webhooks))
	}
	if emailSpec != nil {
		log.Printf("[Notification] [EMAIL] TriggerNow: dispatching %d alert(s) by email to %s:%d", len(allAlerts), emailSpec.SMTPHost, emailSpec.SMTPPort)
		e.dispatchEmails(allAlerts, emailSpec, nil, nil, 0)
		log.Printf("[Notification] [EMAIL] TriggerNow: email dispatch done for %d alert(s)", len(allAlerts))
	}
}

// SendTestToAllWebhooks sends one test message to every enabled webhook and to email (if configured).
func SendTestToAllWebhooks() {
	LoadConfigFromStore(context.Background())
	e := &notificationExtension{}
	cfg := GetConfig()
	if cfg.Config == nil {
		log.Printf("[Notification] Test skipped: no config")
		return
	}
	webhooks := getWebhooksFromConfig(cfg)
	emailSpec := getEmailConfigFromConfig(cfg)
	if len(webhooks) == 0 && emailSpec == nil {
		log.Printf("[Notification] Test skipped: no webhooks or email configured")
		return
	}
	testAlert := alert{
		Key:       "test",
		Message:   "Test notification from Kernel Eye – webhooks and email are working.",
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
	if emailSpec != nil {
		log.Printf("[Notification] [EMAIL] Test: sending to %s via %s:%d", strings.Join(emailSpec.To, ", "), emailSpec.SMTPHost, emailSpec.SMTPPort)
		if err := e.sendConsolidatedEmail(emailSpec, []alert{testAlert}); err != nil {
			log.Printf("[Notification] [EMAIL] Test FAILED: %v", err)
		} else {
			sent++
			log.Printf("[Notification] [EMAIL] Test: sent successfully to %d recipient(s)", len(emailSpec.To))
		}
	} else {
		log.Printf("[Notification] [EMAIL] Test: email not configured (getEmailConfig returned nil)")
	}
	log.Printf("[Notification] Test sent to %d destination(s) (webhooks + email)", sent)
}

// dispatchAlerts sends ALL alert-webhook combinations concurrently in a single goroutine
// pool, then waits for every HTTP call to finish before returning. This means:
//   - 3 alerts × 2 webhooks = 6 goroutines launched at once; total time = slowest HTTP call.
//   - No alert blocks any other alert or any other webhook destination.
//
// When lastAlert is non-nil, the per-key 5-minute cooldown is enforced (sequentially, since
// map writes must be serialised) before launching the goroutines for that alert.
func (e *notificationExtension) dispatchAlerts(
	alerts []alert,
	webhooks []webhookSpec,
	lastAlert map[string]time.Time,
	lastMu *sync.Mutex,
	cooldown time.Duration,
) {
	var wg sync.WaitGroup
	for _, a := range alerts {
		if lastAlert != nil {
			lastMu.Lock()
			if t, ok := lastAlert[a.Key]; ok && time.Since(t) < cooldown {
				lastMu.Unlock()
				continue
			}
			lastAlert[a.Key] = time.Now()
			lastMu.Unlock()
		}
		for _, wh := range webhooks {
			if !wh.Enabled || wh.URL == "" {
				continue
			}
			wh, a := wh, a
			body := e.buildWebhookBody(wh.Type, a)
			wg.Add(1)
			go func() {
				defer wg.Done()
				if err := e.sendWebhook(wh.URL, wh.Type, body); err != nil {
					log.Printf("[Notification] Webhook send failed (%s): %v", wh.Type, err)
				}
			}()
		}
	}
	wg.Wait() // waits for every HTTP call across all alerts and destinations
}

// dispatchEmails sends ONE consolidated email per dispatch cycle containing all alerts.
// Uses a single cooldown key ("email-batch") so at most 1 email is sent per cooldown period
// regardless of how many individual alerts fired. This prevents Gmail daily limit exhaustion.
func (e *notificationExtension) dispatchEmails(
	alerts []alert,
	spec *emailSpec,
	lastAlert map[string]time.Time,
	lastMu *sync.Mutex,
	cooldown time.Duration,
) {
	if spec == nil || !spec.Enabled {
		log.Printf("[Notification] [EMAIL] dispatchEmails: no-op (spec nil or disabled)")
		return
	}
	if len(alerts) == 0 {
		return
	}
	// Single batch cooldown: only one email per cooldown window regardless of alert count.
	const batchKey = "email-batch"
	if lastAlert != nil {
		lastMu.Lock()
		if t, ok := lastAlert[batchKey]; ok && time.Since(t) < cooldown {
			lastMu.Unlock()
			log.Printf("[Notification] [EMAIL] dispatchEmails: skipped (within %v cooldown, last sent %v ago)", cooldown, time.Since(t).Round(time.Second))
			return
		}
		lastAlert[batchKey] = time.Now()
		lastMu.Unlock()
	}
	log.Printf("[Notification] [EMAIL] dispatchEmails: sending 1 consolidated email (%d alert(s)) to %d recipient(s) via %s:%d", len(alerts), len(spec.To), spec.SMTPHost, spec.SMTPPort)
	if err := e.sendConsolidatedEmail(spec, alerts); err != nil {
		log.Printf("[Notification] [EMAIL] send failed: %v (SMTP %s:%d)", err, spec.SMTPHost, spec.SMTPPort)
	} else {
		log.Printf("[Notification] [EMAIL] dispatchEmails: sent consolidated email with %d alert(s)", len(alerts))
	}
}

// intervalDur reads interval_seconds from config, applies a minimum, and returns a duration.
func intervalDur(cfg spi.ExtensionParams, defaultSec, minSec float64) time.Duration {
	sec := defaultSec
	if cfg.Config != nil {
		if v := cfg.GetFloat("interval_seconds"); v > 0 {
			sec = v
		}
	}
	if sec < minSec {
		sec = minSec
	}
	return time.Duration(sec * float64(time.Second))
}

// Run is the SPI entrypoint. Key behaviour:
//   - Evaluates all thresholds immediately at startup (no idle wait before the first check).
//   - Timer is started BEFORE evaluation so the configured interval is wall-clock accurate;
//     slow webhook calls never push the next check past the deadline.
//   - All webhook HTTP calls for a given alert are issued concurrently.
//   - Config is re-read from MongoDB on every tick so live changes take effect within one interval.
func (e *notificationExtension) Run(ctx context.Context, params spi.ExtensionParams) error {
	if params.Config != nil {
		SetConfig(params)
	}

	lastAlert := make(map[string]time.Time)
	lastEmailAlert := make(map[string]time.Time)
	var lastMu sync.Mutex
	cooldown := 5 * time.Minute
	const minIntervalSec = 5.0
	const defaultIntervalSec = 15.0

	runPass := func(ctx context.Context) {
		cfg := GetConfig()
		if cfg.Config == nil || !cfg.GetBool("enabled") {
			return
		}
		webhooks := getWebhooksFromConfig(cfg)
		emailSpec := getEmailConfigFromConfig(cfg)
		log.Printf("[Notification] [EMAIL] Run pass: webhooks=%d email_configured=%v", len(webhooks), emailSpec != nil)
		hasDest := len(webhooks) > 0 || emailSpec != nil
		if !hasDest {
			log.Printf("[Notification] Run skipped: no alert channel configured (add a webhook or email)")
			return
		}
		thresholds := getThresholdsFromConfig(cfg)
		if len(thresholds) == 0 {
			log.Printf("[Notification] Run skipped: no alert rules configured (add at least one threshold rule with value > 0)")
			return
		}
		alerts := e.collectAllAlerts(thresholds)
		if len(alerts) == 0 {
			return
		}
		if len(webhooks) > 0 {
			log.Printf("[Notification] Run: %d alert(s), sending to %d webhook(s)", len(alerts), len(webhooks))
		}
		e.dispatchAlerts(alerts, webhooks, lastAlert, &lastMu, cooldown)
		if emailSpec != nil {
			log.Printf("[Notification] [EMAIL] Run: dispatching %d alert(s) by email to %s:%d (%d recipients)", len(alerts), emailSpec.SMTPHost, emailSpec.SMTPPort, len(emailSpec.To))
			e.dispatchEmails(alerts, emailSpec, lastEmailAlert, &lastMu, cooldown)
		}
	}

	// Evaluate immediately at startup — no idle wait before the first check.
	LoadConfigFromStore(ctx)
	runPass(ctx)

	for {
		// Start the timer FIRST, then do the work so that the configured interval is
		// wall-clock accurate: the next tick fires at (start + interval) regardless of
		// how long LoadConfigFromStore + runPass + HTTP calls take.
		// Actual period = max(work_duration, interval); never less, never inflated by work.
		dur := intervalDur(GetConfig(), defaultIntervalSec, minIntervalSec)
		timer := time.NewTimer(dur)

		LoadConfigFromStore(ctx)
		runPass(ctx)

		// Block until the timer fires (or context is cancelled).
		// If the work above already took longer than dur, timer.C is already readable
		// and this select returns immediately with zero extra delay.
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
			// timer fired — start next iteration
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

// collectAllAlerts evaluates every threshold rule against the local node (live eBPF telemetry)
// AND every other node in the cluster metrics cache. This gives cluster-wide coverage even
// when a single daemon instance is running.
// The local node is handled by evaluateThresholds; remote nodes skip it to avoid duplicates.
func (e *notificationExtension) collectAllAlerts(thresholds []thresholdSpec) []alert {
	var all []alert
	localNode := currentNodeName()

	for _, t := range thresholds {
		all = append(all, e.evaluateThresholds(t.MetricType, t.Level, t.Threshold, t.NodeName)...)
	}

	for _, snap := range getClusterSnapshots() {
		if snap.NodeName == localNode || snap.NodeName == "" {
			continue // already covered by the local eBPF telemetry path
		}
		for _, t := range thresholds {
			all = append(all, e.evaluateClusterNodeThresholds(snap, t.MetricType, t.Level, t.Threshold, t.NodeName)...)
		}
	}

	if len(all) > 0 {
		log.Printf("[Notification] collectAllAlerts: %d alert(s) across local+cluster nodes", len(all))
	}
	return all
}

// snapFloat extracts a float64 from a map[string]interface{}, handling all common numeric types.
func snapFloat(m map[string]interface{}, key string) float64 {
	if m == nil {
		return 0
	}
	switch n := m[key].(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int32:
		return float64(n)
	case int64:
		return float64(n)
	}
	return 0
}

// snapSubMap extracts a nested map[string]interface{} from a parent map.
func snapSubMap(m map[string]interface{}, key string) map[string]interface{} {
	if m == nil {
		return nil
	}
	sub, _ := m[key].(map[string]interface{})
	return sub
}

// evaluateClusterNodeThresholds mirrors evaluateThresholds but reads from the pre-aggregated
// JSON map data stored in clusterMetrics (UnifiedMetricsResponse) rather than local eBPF
// telemetry. Only called for nodes other than the local daemon's own node.
// Alert keys are prefixed with the node name so the cooldown map never confuses two nodes'
// pods that share the same namespace/name.
func (e *notificationExtension) evaluateClusterNodeThresholds(snap ClusterNodeSnapshot, metricType, level string, threshold float64, nodeFilter string) []alert {
	if nodeFilter != "" && snap.NodeName != nodeFilter {
		return nil
	}
	nodeName := snap.NodeName
	keyPfx := nodeName + ":"
	var alerts []alert

	switch metricType {
	case "dns_latency":
		if level == "pod" {
			for podKey, pm := range snap.Pods {
				d := snapSubMap(pm, "dns_latency")
				if d == nil || snapFloat(d, "total_events") == 0 {
					continue
				}
				avgUs := snapFloat(d, "avg_latency_ns")
				if avgUs == 0 {
					avgUs = snapFloat(d, "total_latency_ns") / snapFloat(d, "total_events")
				}
				avgUs /= 1000
				if avgUs >= threshold {
					alerts = append(alerts, alert{Key: keyPfx + "dns_pod_" + podKey, Message: fmt.Sprintf("Node %s Pod %s: DNS avg latency %.2f µs exceeds threshold %.2f µs", nodeName, podKey, avgUs, threshold), Level: "pod", Metric: "dns_latency", Value: avgUs, Threshold: threshold, NodeName: nodeName, PodName: podKey})
				}
			}
		} else if level == "container" {
			for cKey, cm := range snap.Containers {
				d := snapSubMap(cm, "dns_latency")
				if d == nil || snapFloat(d, "total_events") == 0 {
					continue
				}
				avgUs := snapFloat(d, "avg_latency_ns")
				if avgUs == 0 {
					avgUs = snapFloat(d, "total_latency_ns") / snapFloat(d, "total_events")
				}
				avgUs /= 1000
				if avgUs >= threshold {
					alerts = append(alerts, alert{Key: keyPfx + "dns_container_" + cKey, Message: fmt.Sprintf("Node %s Container %s: DNS avg latency %.2f µs exceeds threshold %.2f µs", nodeName, cKey, avgUs, threshold), Level: "container", Metric: "dns_latency", Value: avgUs, Threshold: threshold, NodeName: nodeName, PodName: cKey})
				}
			}
		} else {
			d := snapSubMap(snap.Node, "dns_latency")
			if d != nil && snapFloat(d, "total_events") > 0 {
				avgUs := snapFloat(d, "avg_latency_ns")
				if avgUs == 0 {
					avgUs = snapFloat(d, "total_latency_ns") / snapFloat(d, "total_events")
				}
				avgUs /= 1000
				if avgUs >= threshold {
					alerts = append(alerts, alert{Key: keyPfx + "dns_node", Message: fmt.Sprintf("Node %s: DNS avg latency %.2f µs exceeds threshold %.2f µs", nodeName, avgUs, threshold), Level: "node", Metric: "dns_latency", Value: avgUs, Threshold: threshold, NodeName: nodeName})
				}
			}
		}

	case "rtt":
		if level == "pod" {
			for podKey, pm := range snap.Pods {
				d := snapSubMap(pm, "rtt")
				if d == nil || snapFloat(d, "total_events") == 0 {
					continue
				}
				avgUs := snapFloat(d, "avg_rtt_ns")
				if avgUs == 0 {
					avgUs = snapFloat(d, "total_rtt_ns") / snapFloat(d, "total_events")
				}
				avgUs /= 1000
				if avgUs >= threshold {
					alerts = append(alerts, alert{Key: keyPfx + "rtt_pod_" + podKey, Message: fmt.Sprintf("Node %s Pod %s: RTT avg %.2f µs exceeds threshold %.2f µs", nodeName, podKey, avgUs, threshold), Level: "pod", Metric: "rtt", Value: avgUs, Threshold: threshold, NodeName: nodeName, PodName: podKey})
				}
			}
		} else if level == "container" {
			for cKey, cm := range snap.Containers {
				d := snapSubMap(cm, "tcp_metrics")
				if d == nil {
					continue
				}
				rttUs := snapFloat(d, "min_rtt_us")
				if rttUs == 0 {
					rttUs = snapFloat(d, "smoothed_rtt_us")
				}
				if rttUs >= threshold {
					alerts = append(alerts, alert{Key: keyPfx + "rtt_container_" + cKey, Message: fmt.Sprintf("Node %s Container %s: RTT %.2f µs exceeds threshold %.2f µs", nodeName, cKey, rttUs, threshold), Level: "container", Metric: "rtt", Value: rttUs, Threshold: threshold, NodeName: nodeName, PodName: cKey})
				}
			}
		} else {
			d := snapSubMap(snap.Node, "rtt")
			if d != nil && snapFloat(d, "total_events") > 0 {
				avgUs := snapFloat(d, "avg_rtt_ns")
				if avgUs == 0 {
					avgUs = snapFloat(d, "total_rtt_ns") / snapFloat(d, "total_events")
				}
				avgUs /= 1000
				if avgUs >= threshold {
					alerts = append(alerts, alert{Key: keyPfx + "rtt_node", Message: fmt.Sprintf("Node %s: RTT avg %.2f µs exceeds threshold %.2f µs", nodeName, avgUs, threshold), Level: "node", Metric: "rtt", Value: avgUs, Threshold: threshold, NodeName: nodeName})
				}
			}
		}

	case "node_system":
		if level == "node" {
			d := snapSubMap(snap.Node, "node_system")
			if d != nil {
				if cpu := snapFloat(d, "cpu_usage_percent"); cpu >= threshold {
					alerts = append(alerts, alert{Key: keyPfx + "node_cpu", Message: fmt.Sprintf("Node %s: CPU %.2f%% exceeds threshold %.2f%%", nodeName, cpu, threshold), Level: "node", Metric: "node_system_cpu", Value: cpu, Threshold: threshold, NodeName: nodeName})
				}
				if mem := snapFloat(d, "memory_usage_percent"); mem >= threshold {
					alerts = append(alerts, alert{Key: keyPfx + "node_memory", Message: fmt.Sprintf("Node %s: memory %.2f%% exceeds threshold %.2f%%", nodeName, mem, threshold), Level: "node", Metric: "node_system_memory", Value: mem, Threshold: threshold, NodeName: nodeName})
				}
			}
		}

	case "sched_latency":
		if level == "pod" {
			for podKey, pm := range snap.Pods {
				d := snapSubMap(pm, "sched_latency")
				if d == nil || snapFloat(d, "event_count") == 0 {
					continue
				}
				if avgUs := snapFloat(d, "avg_runqueue_latency_us"); avgUs >= threshold {
					alerts = append(alerts, alert{Key: keyPfx + "sched_pod_" + podKey, Message: fmt.Sprintf("Node %s Pod %s: sched latency avg %.2f µs exceeds threshold %.2f µs", nodeName, podKey, avgUs, threshold), Level: "pod", Metric: "sched_latency", Value: avgUs, Threshold: threshold, NodeName: nodeName, PodName: podKey})
				}
			}
		} else if level == "container" {
			for cKey, cm := range snap.Containers {
				d := snapSubMap(cm, "sched_latency")
				if d == nil || snapFloat(d, "event_count") == 0 {
					continue
				}
				if avgUs := snapFloat(d, "avg_runqueue_latency_us"); avgUs >= threshold {
					alerts = append(alerts, alert{Key: keyPfx + "sched_container_" + cKey, Message: fmt.Sprintf("Node %s Container %s: sched latency avg %.2f µs exceeds threshold %.2f µs", nodeName, cKey, avgUs, threshold), Level: "container", Metric: "sched_latency", Value: avgUs, Threshold: threshold, NodeName: nodeName, PodName: cKey})
				}
			}
		} else {
			d := snapSubMap(snap.Node, "sched_latency")
			if d != nil && snapFloat(d, "total_events") > 0 {
				if avgUs := snapFloat(d, "avg_runqueue_latency_us"); avgUs >= threshold {
					alerts = append(alerts, alert{Key: keyPfx + "sched_node", Message: fmt.Sprintf("Node %s: sched latency avg %.2f µs exceeds threshold %.2f µs", nodeName, avgUs, threshold), Level: "node", Metric: "sched_latency", Value: avgUs, Threshold: threshold, NodeName: nodeName})
				}
			}
		}

	case "disk_io":
		if level == "pod" {
			for podKey, pm := range snap.Pods {
				d := snapSubMap(pm, "disk_io")
				if d == nil {
					continue
				}
				total := snapFloat(d, "total_read_bytes") + snapFloat(d, "total_write_bytes")
				if threshold > 0 && total >= threshold {
					alerts = append(alerts, alert{Key: keyPfx + "disk_pod_" + podKey, Message: fmt.Sprintf("Node %s Pod %s: disk I/O total bytes %.0f exceeds threshold %.0f", nodeName, podKey, total, threshold), Level: "pod", Metric: "disk_io", Value: total, Threshold: threshold, NodeName: nodeName, PodName: podKey})
				}
			}
		} else if level == "container" {
			for cKey, cm := range snap.Containers {
				d := snapSubMap(cm, "disk_io")
				if d == nil {
					continue
				}
				total := snapFloat(d, "total_read_bytes") + snapFloat(d, "total_write_bytes")
				if threshold > 0 && total >= threshold {
					alerts = append(alerts, alert{Key: keyPfx + "disk_container_" + cKey, Message: fmt.Sprintf("Node %s Container %s: disk I/O total bytes %.0f exceeds threshold %.0f", nodeName, cKey, total, threshold), Level: "container", Metric: "disk_io", Value: total, Threshold: threshold, NodeName: nodeName, PodName: cKey})
				}
			}
		} else {
			var total float64
			for _, pm := range snap.Pods {
				d := snapSubMap(pm, "disk_io")
				if d != nil {
					total += snapFloat(d, "total_read_bytes") + snapFloat(d, "total_write_bytes")
				}
			}
			if threshold > 0 && total >= threshold {
				alerts = append(alerts, alert{Key: keyPfx + "disk_node", Message: fmt.Sprintf("Node %s: disk I/O total bytes %.0f exceeds threshold %.0f", nodeName, total, threshold), Level: "node", Metric: "disk_io", Value: total, Threshold: threshold, NodeName: nodeName})
			}
		}
	}
	return alerts
}

func (e *notificationExtension) buildWebhookBody(webhookType string, a alert) []byte {
	const alertTitle = "eBPF Daemon – Threshold Exceeded"

	switch webhookType {
	case "slack":
		text := "*" + alertTitle + "*\n" + a.Message
		payload := map[string]interface{}{"text": text}
		b, _ := json.Marshal(payload)
		return b

	case "discord":
		podVal := a.PodName
		if podVal == "" {
			podVal = "—"
		}
		fields := []map[string]interface{}{
			{"name": "Node", "value": a.NodeName, "inline": true},
			{"name": "Pod", "value": podVal, "inline": true},
			{"name": "Metric", "value": a.Metric, "inline": true},
			{"name": "Level", "value": a.Level, "inline": true},
			{"name": "Current value", "value": fmt.Sprintf("%.2f", a.Value), "inline": true},
			{"name": "Threshold", "value": fmt.Sprintf("%.2f", a.Threshold), "inline": true},
		}
		embed := map[string]interface{}{
			"title":       alertTitle,
			"description": a.Message,
			"color":       0xE74C3C,
			"fields":      fields,
			"footer":      map[string]interface{}{"text": "Kernel Eye · Notification Alert"},
		}
		payload := map[string]interface{}{
			"embeds": []map[string]interface{}{embed},
		}
		b, _ := json.Marshal(payload)
		return b

	case "teams":
		podVal := a.PodName
		if podVal == "" {
			podVal = "—"
		}
		facts := []map[string]string{
			{"name": "Node", "value": a.NodeName},
			{"name": "Pod", "value": podVal},
			{"name": "Metric", "value": a.Metric},
			{"name": "Level", "value": a.Level},
			{"name": "Current value", "value": fmt.Sprintf("%.2f", a.Value)},
			{"name": "Threshold", "value": fmt.Sprintf("%.2f", a.Threshold)},
		}
		payload := map[string]interface{}{
			"@type":      "MessageCard",
			"@context":   "http://schema.org/extensions",
			"summary":    alertTitle,
			"themeColor": "E74C3C",
			"sections": []map[string]interface{}{
				{
					"activityTitle":    alertTitle,
					"activitySubtitle": "Kernel Eye · Notification Alert",
					"text":             a.Message,
					"facts":            facts,
				},
			},
		}
		b, _ := json.Marshal(payload)
		return b

	default:
		payload := map[string]interface{}{"text": alertTitle + "\n" + a.Message}
		b, _ := json.Marshal(payload)
		return b
	}
}

var webhookHTTPClient = &http.Client{Timeout: 15 * time.Second}

func (e *notificationExtension) sendWebhook(url, webhookType string, body []byte) error {
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		log.Printf("[Notification] Webhook request build failed (%s): %v", webhookType, err)
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := webhookHTTPClient.Do(req)
	if err != nil {
		log.Printf("[Notification] Webhook request failed (%s): %v", webhookType, err)
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodySlurp, _ := io.ReadAll(resp.Body)
		err := fmt.Errorf("webhook returned %d: %s", resp.StatusCode, strings.TrimSpace(string(bodySlurp)))
		log.Printf("[Notification] %s webhook error: %v", webhookType, err)
		return err
	}
	log.Printf("[Notification] Alert sent to %s webhook", webhookType)
	return nil
}

// defaultEmailBodyTemplate is used when no custom body template is set (matches ui.json default).
const defaultEmailBodyTemplate = "Kernel Eye · Notification Alert\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n{{message}}\n\nDetails\n• Node:     {{node_name}}\n• Pod:      {{pod_name}}\n• Metric:   {{metric}}\n• Level:    {{level}}\n• Current:  {{value}}\n• Threshold: {{threshold}}"

// defaultEmailSubjectTemplate is used when no custom subject template is set.
const defaultEmailSubjectTemplate = "Kernel Eye · Notification Alert: {{metric}} exceeded on {{node_name}}"

// applyEmailTemplate replaces placeholders in template with alert fields. Used for subject and body.
func applyEmailTemplate(template string, a alert) string {
	podName := a.PodName
	if podName == "" {
		podName = "—"
	}
	s := template
	s = strings.ReplaceAll(s, "{{message}}", a.Message)
	s = strings.ReplaceAll(s, "{{node_name}}", a.NodeName)
	s = strings.ReplaceAll(s, "{{pod_name}}", podName)
	s = strings.ReplaceAll(s, "{{metric}}", a.Metric)
	s = strings.ReplaceAll(s, "{{level}}", a.Level)
	s = strings.ReplaceAll(s, "{{value}}", fmt.Sprintf("%.2f", a.Value))
	s = strings.ReplaceAll(s, "{{threshold}}", fmt.Sprintf("%.2f", a.Threshold))
	return s
}

// buildEmailBody returns a plain-text email body for the alert (fixed template; see defaultEmailBodyTemplate).
func (e *notificationExtension) buildEmailBody(a alert) string {
	body := applyEmailTemplate(defaultEmailBodyTemplate, a)
	// Normalize line endings for RFC 822
	return strings.ReplaceAll(body, "\n", "\r\n")
}

// htmlEscape escapes HTML specials for use inside HTML body.
func htmlEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	return s
}

// buildEmailHTML returns an HTML email body with inline CSS for Gmail (professional template).
func (e *notificationExtension) buildEmailHTML(a alert) string {
	msg := htmlEscape(a.Message)
	node := htmlEscape(a.NodeName)
	pod := htmlEscape(a.PodName)
	if pod == "" {
		pod = "—"
	}
	metric := htmlEscape(a.Metric)
	level := htmlEscape(a.Level)
	value := htmlEscape(fmt.Sprintf("%.2f", a.Value))
	threshold := htmlEscape(fmt.Sprintf("%.2f", a.Threshold))
	return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kernel Eye · Notification Alert</title></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',system-ui,-apple-system,BlinkMacSystemFont,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#e2e8f0;background:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 20px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#1e293b;border:1px solid #334155;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.3);">
<tr>
<td style="padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(90deg,#3b82f6 0%,#06b6d4 100%);border-radius:8px 8px 0 0;">
<tr><td style="padding:24px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td><span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Kernel Eye</span></td>
<td align="right"><span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.9);">Notification Alert</span></td>
</tr></table>
<p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Threshold exceeded · eBPF telemetry</p>
</td></tr>
</table>
</td>
</tr>
<tr>
<td style="padding:28px 28px 24px;border-left:4px solid #3b82f6;">
<p style="margin:0 0 20px;font-size:15px;color:#cbd5e1;line-height:1.6;">` + msg + `</p>
<p style="margin:0 0 16px;font-size:12px;font-weight:600;color:#60a5fa;text-transform:uppercase;letter-spacing:0.05em;">Alert details</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
<tr><td style="padding:12px 0;border-bottom:1px solid #334155;color:#94a3b8;width:110px;">Node</td><td style="padding:12px 0;border-bottom:1px solid #334155;color:#e2e8f0;font-weight:500;">` + node + `</td></tr>
<tr><td style="padding:12px 0;border-bottom:1px solid #334155;color:#94a3b8;">Pod</td><td style="padding:12px 0;border-bottom:1px solid #334155;color:#e2e8f0;">` + pod + `</td></tr>
<tr><td style="padding:12px 0;border-bottom:1px solid #334155;color:#94a3b8;">Metric</td><td style="padding:12px 0;border-bottom:1px solid #334155;color:#60a5fa;font-weight:600;">` + metric + `</td></tr>
<tr><td style="padding:12px 0;border-bottom:1px solid #334155;color:#94a3b8;">Level</td><td style="padding:12px 0;border-bottom:1px solid #334155;color:#e2e8f0;">` + level + `</td></tr>
<tr><td style="padding:12px 0;border-bottom:1px solid #450a0a;color:#94a3b8;">Current value</td><td style="padding:12px 0;border-bottom:1px solid #450a0a;color:#fca5a5;font-weight:600;">` + value + `</td></tr>
<tr><td style="padding:12px 0;color:#94a3b8;">Threshold</td><td style="padding:12px 0;color:#e2e8f0;">` + threshold + `</td></tr>
</table>
</td>
</tr>
<tr>
<td style="padding:16px 28px;background:#0f172a;border-top:1px solid #334155;border-radius:0 0 8px 8px;">
<p style="margin:0;font-size:12px;color:#64748b;">Kernel Eye · Notification Alert for thresholds · eBPF telemetry</p>
</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

// sendConsolidatedEmail sends all alerts in a single email so we never send more than
// one email per dispatch cycle, keeping well within Gmail's daily sending limits.
func (e *notificationExtension) sendConsolidatedEmail(spec *emailSpec, alerts []alert) error {
	if spec == nil || !spec.Enabled || len(spec.To) == 0 || len(alerts) == 0 {
		return nil
	}
	log.Printf("[Notification] [EMAIL] sendConsolidatedEmail: connecting to %s:%d for %d alert(s)", spec.SMTPHost, spec.SMTPPort, len(alerts))

	subject := fmt.Sprintf("⚠ Kernel Eye Alert — %d threshold(s) exceeded", len(alerts))
	if len(alerts) == 1 {
		subject = fmt.Sprintf("⚠ Kernel Eye Alert — %s on %s", alerts[0].Metric, alerts[0].NodeName)
	}
	subject = strings.ReplaceAll(subject, "\r\n", " ")
	subject = strings.ReplaceAll(subject, "\n", " ")

	// Build plain text body
	var plain strings.Builder
	plain.WriteString(fmt.Sprintf("Kernel Eye — %d threshold alert(s) at %s\n\n", len(alerts), time.Now().UTC().Format("2006-01-02 15:04:05 UTC")))
	for i, a := range alerts {
		plain.WriteString(fmt.Sprintf("%d. %s\n   Node: %s | Pod: %s\n   Value: %.2f > Threshold: %.2f\n\n", i+1, a.Message, a.NodeName, a.PodName, a.Value, a.Threshold))
	}
	plain.WriteString("--\nKernel Eye · eBPF Cluster Telemetry\n")

	// Build HTML body with table of all alerts
	var rows strings.Builder
	for _, a := range alerts {
		metricLabel := strings.ReplaceAll(a.Metric, "_", " ")
		rows.WriteString(fmt.Sprintf(`<tr>
<td style="padding:10px 12px;border-bottom:1px solid #1e293b;color:#e2e8f0;font-size:13px;">%s</td>
<td style="padding:10px 12px;border-bottom:1px solid #1e293b;color:#60a5fa;font-size:13px;">%s</td>
<td style="padding:10px 12px;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px;">%s</td>
<td style="padding:10px 12px;border-bottom:1px solid #1e293b;color:#fca5a5;font-weight:600;font-size:13px;">%.2f</td>
<td style="padding:10px 12px;border-bottom:1px solid #1e293b;color:#e2e8f0;font-size:13px;">%.2f</td>
</tr>`, metricLabel, a.NodeName, a.PodName, a.Value, a.Threshold))
	}
	htmlBody := `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:24px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#1e293b;border:1px solid #334155;border-radius:8px;overflow:hidden;">
<tr><td style="padding:20px 28px;background:linear-gradient(135deg,#1e3a5f,#0f172a);border-bottom:1px solid #334155;">
<h1 style="margin:0;font-size:20px;color:#38bdf8;letter-spacing:0.5px;">⚠ Kernel Eye Alert</h1>
<p style="margin:6px 0 0;font-size:13px;color:#94a3b8;">` + fmt.Sprintf("%d threshold(s) exceeded · %s", len(alerts), time.Now().UTC().Format("2006-01-02 15:04:05 UTC")) + `</p>
</td></tr>
<tr><td style="padding:20px 28px;">
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #334155;border-radius:6px;overflow:hidden;">
<thead><tr style="background:#0f172a;">
<th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Metric</th>
<th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Node</th>
<th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Pod</th>
<th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Value</th>
<th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Threshold</th>
</tr></thead>
<tbody>` + rows.String() + `</tbody>
</table>
</td></tr>
<tr><td style="padding:14px 28px;background:#0f172a;border-top:1px solid #334155;">
<p style="margin:0;font-size:12px;color:#64748b;">Kernel Eye · eBPF Cluster Telemetry · Notification Alert</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`

	boundary := "kernel-eye-boundary-" + fmt.Sprintf("%d", time.Now().UnixNano())
	msg := "From: " + spec.From + "\r\n" +
		"To: " + strings.Join(spec.To, ",") + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n" +
		"\r\n" +
		"--" + boundary + "\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n" +
		"Content-Transfer-Encoding: 7bit\r\n" +
		"\r\n" + plain.String() + "\r\n" +
		"--" + boundary + "\r\n" +
		"Content-Type: text/html; charset=UTF-8\r\n" +
		"Content-Transfer-Encoding: 7bit\r\n" +
		"\r\n" + htmlBody + "\r\n" +
		"--" + boundary + "--\r\n"

	return e.sendRawEmail(spec, subject, msg)
}

// sendRawEmail sends a pre-built RFC 5322 message via SMTP.
func (e *notificationExtension) sendRawEmail(spec *emailSpec, subject, msg string) error {
	addr := fmt.Sprintf("%s:%d", spec.SMTPHost, spec.SMTPPort)
	var conn net.Conn
	var err error
	if spec.UseTLS && spec.SMTPPort == 465 {
		tlsConfig := &tls.Config{ServerName: spec.SMTPHost}
		conn, err = tls.Dial("tcp", addr, tlsConfig)
	} else {
		conn, err = net.DialTimeout("tcp", addr, 15*time.Second)
	}
	if err != nil {
		return fmt.Errorf("smtp dial %s:%d: %w", spec.SMTPHost, spec.SMTPPort, err)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, spec.SMTPHost)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer client.Close()

	if spec.UseTLS && spec.SMTPPort != 465 {
		if err = client.StartTLS(&tls.Config{ServerName: spec.SMTPHost}); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}
	if spec.Username != "" && spec.Password != "" {
		auth := smtp.PlainAuth("", spec.Username, spec.Password, spec.SMTPHost)
		if err = client.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth (user=%s): %w", spec.Username, err)
		}
	}
	if err = client.Mail(spec.From); err != nil {
		return fmt.Errorf("smtp mail: %w", err)
	}
	for _, to := range spec.To {
		if err = client.Rcpt(to); err != nil {
			return fmt.Errorf("smtp rcpt %s: %w", to, err)
		}
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err = w.Write([]byte(msg)); err != nil {
		w.Close()
		return fmt.Errorf("smtp write: %w", err)
	}
	if err = w.Close(); err != nil {
		return fmt.Errorf("smtp close: %w", err)
	}
	if err = client.Quit(); err != nil {
		return fmt.Errorf("smtp quit: %w", err)
	}
	log.Printf("[Notification] [EMAIL] sendRawEmail: sent to %d recipient(s): %s", len(spec.To), subject)
	return nil
}

// sendEmail sends one alert to all configured email recipients via SMTP.
func (e *notificationExtension) sendEmail(spec *emailSpec, a alert) error {
	if spec == nil || !spec.Enabled || len(spec.To) == 0 {
		return nil
	}
	log.Printf("[Notification] [EMAIL] sendEmail: connecting to %s:%d for alert %s", spec.SMTPHost, spec.SMTPPort, a.Key)
	subject := applyEmailTemplate(defaultEmailSubjectTemplate, a)
	// RFC 5322: subject should not contain raw newlines
	subject = strings.ReplaceAll(subject, "\r\n", " ")
	subject = strings.ReplaceAll(subject, "\n", " ")
	plainBody := e.buildEmailBody(a)
	htmlBody := e.buildEmailHTML(a)
	boundary := "kernel-eye-boundary-" + fmt.Sprintf("%d", time.Now().UnixNano())
	// Multipart/alternative: plain first, then HTML (Gmail uses HTML when present)
	msg := "From: " + spec.From + "\r\n" +
		"To: " + strings.Join(spec.To, ",") + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"MIME-Version: 1.0\r\n" +
		"Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n" +
		"\r\n" +
		"--" + boundary + "\r\n" +
		"Content-Type: text/plain; charset=UTF-8\r\n" +
		"Content-Transfer-Encoding: 7bit\r\n" +
		"\r\n" + plainBody + "\r\n" +
		"--" + boundary + "\r\n" +
		"Content-Type: text/html; charset=UTF-8\r\n" +
		"Content-Transfer-Encoding: 7bit\r\n" +
		"\r\n" + htmlBody + "\r\n" +
		"--" + boundary + "--\r\n"

	addr := fmt.Sprintf("%s:%d", spec.SMTPHost, spec.SMTPPort)
	var conn net.Conn
	var err error
	if spec.UseTLS && spec.SMTPPort == 465 {
		tlsConfig := &tls.Config{ServerName: spec.SMTPHost}
		conn, err = tls.Dial("tcp", addr, tlsConfig)
	} else {
		conn, err = net.DialTimeout("tcp", addr, 15*time.Second)
	}
	if err != nil {
		return fmt.Errorf("smtp dial %s:%d: %w", spec.SMTPHost, spec.SMTPPort, err)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, spec.SMTPHost)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer client.Close()

	if spec.UseTLS && spec.SMTPPort != 465 {
		if err = client.StartTLS(&tls.Config{ServerName: spec.SMTPHost}); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}
	if spec.Username != "" && spec.Password != "" {
		auth := smtp.PlainAuth("", spec.Username, spec.Password, spec.SMTPHost)
		if err = client.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth (user=%s): %w", spec.Username, err)
		}
	}
	if err = client.Mail(spec.From); err != nil {
		return fmt.Errorf("smtp mail: %w", err)
	}
	for _, to := range spec.To {
		if err = client.Rcpt(to); err != nil {
			return fmt.Errorf("smtp rcpt %s: %w", to, err)
		}
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err = w.Write([]byte(msg)); err != nil {
		w.Close()
		return fmt.Errorf("smtp write: %w", err)
	}
	if err = w.Close(); err != nil {
		return fmt.Errorf("smtp close: %w", err)
	}
	if err = client.Quit(); err != nil {
		return fmt.Errorf("smtp quit: %w", err)
	}
	log.Printf("[Notification] [EMAIL] sendEmail: sent alert %s to %d recipient(s)", a.Key, len(spec.To))
	return nil
}
