// Package spi defines the Service Provider Interface for Component 01 extensions.
// Extensions implement Extension and are registered in extensions/registry.
package spi

import "context"

// Extension is the interface all Component 01 extensions must implement.
// Extensions run in the application lifecycle and can subscribe to metrics,
// evaluate thresholds, and integrate with external systems (e.g. webhooks).
type Extension interface {
	// Name returns the unique extension name (e.g. "notification", "audit").
	Name() string
	// Run starts the extension. It should block until ctx is cancelled.
	// params contains configuration from the frontend (thresholds, webhooks, etc.).
	Run(ctx context.Context, params ExtensionParams) error
}

// ExtensionParams holds configuration passed to an extension (from frontend or defaults).
// Keys and structure should align with the extension's ui.json "inputs".
type ExtensionParams struct {
	// Config is the key-value config from the UI (e.g. threshold, webhook_url, webhook_type).
	Config map[string]interface{}
}

// GetString returns a string config value.
func (p ExtensionParams) GetString(key string) string {
	if v, ok := p.Config[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// GetFloat returns a float64 config value (from JSON/BSON number).
func (p ExtensionParams) GetFloat(key string) float64 {
	if v, ok := p.Config[key]; ok {
		switch n := v.(type) {
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
	}
	return 0
}

// GetBool returns a boolean config value.
func (p ExtensionParams) GetBool(key string) bool {
	if v, ok := p.Config[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}
