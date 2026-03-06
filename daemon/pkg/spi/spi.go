// Package spi defines the Service Provider Interface for Component 01 extensions.
// Extensions implement Extension and are registered in extensions/registry.
package spi

import (
	"context"
	"fmt"
	"strings"
)

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

// GetString returns a string config value. Coerces non-string types via fmt.Sprintf
// so values loaded from MongoDB/BSON work (e.g. for email SMTP fields).
func (p ExtensionParams) GetString(key string) string {
	if p.Config == nil {
		return ""
	}
	v, ok := p.Config[key]
	if !ok || v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return strings.TrimSpace(fmt.Sprintf("%v", v))
}

// GetFloat returns a float64 config value (from JSON/BSON number).
func (p ExtensionParams) GetFloat(key string) float64 {
	if p.Config == nil {
		return 0
	}
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

// GetBool returns a boolean config value. Accepts bool, string "true"/"1"/"yes", or non-zero number
// so config from MongoDB (after BSON decode) works for email_enabled, enabled, etc.
func (p ExtensionParams) GetBool(key string) bool {
	if p.Config == nil {
		return false
	}
	v, ok := p.Config[key]
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
