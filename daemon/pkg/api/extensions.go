package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/extensions/notification"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/extensions/registry"
)

// ExtensionInfo is returned in the list of extensions.
type ExtensionInfo struct {
	Name        string      `json:"name"`
	Label       string      `json:"label,omitempty"`
	Description string      `json:"description,omitempty"`
	Inputs      []UIControl `json:"inputs,omitempty"`
	SummaryKeys []string    `json:"summary_keys,omitempty"`
}

// UIControl describes one input from ui.json.
type UIControl struct {
	Key      string      `json:"key"`
	Label    string      `json:"label"`
	Type     string      `json:"type"`
	Required bool        `json:"required,omitempty"`
	Default  interface{} `json:"default,omitempty"`
	Options  []UIOption  `json:"options,omitempty"`
}

// UIOption is one option for a select input.
type UIOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// uiJSONSchema matches the structure of extensions/*/ui.json.
type uiJSONSchema struct {
	Label       string    `json:"label"`
	Description string    `json:"description"`
	SummaryKeys []string  `json:"summary_keys"`
	Inputs      []uiInput `json:"inputs"`
}

type uiInput struct {
	Key      string      `json:"key"`
	Label    string      `json:"label"`
	Type     string      `json:"type"`
	Required bool        `json:"required,omitempty"`
	Default  interface{} `json:"default,omitempty"`
	Options  []struct {
		Value string `json:"value"`
		Label string `json:"label"`
	} `json:"options,omitempty"`
}

// handleExtensionsSubpath dispatches /api/extensions/:name/config, :name/trigger, :name/test, :name/ui (SPI-driven).
// This allows the frontend to call GET/POST /api/extensions/${name}/config generically; only extensions that
// register config/trigger handlers (e.g. notification) respond.
func handleExtensionsSubpath(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/extensions/")
	if path == "" {
		handleExtensionsList(w, r)
		return
	}
	parts := strings.SplitN(path, "/", 2)
	name := parts[0]
	if name == "" {
		http.NotFound(w, r)
		return
	}
	rest := ""
	if len(parts) == 2 {
		rest = strings.TrimSuffix(parts[1], "/")
	}
	switch rest {
	case "config":
		if name == "notification" {
			handleNotificationConfig(w, r)
			return
		}
		http.NotFound(w, r)
	case "trigger":
		if name == "notification" {
			handleNotificationTrigger(w, r)
			return
		}
		http.NotFound(w, r)
	case "test":
		if name == "notification" {
			handleNotificationTest(w, r)
			return
		}
		http.NotFound(w, r)
	case "ui":
		handleExtensionUI(w, r)
	default:
		http.NotFound(w, r)
	}
}

// extensionWithUI is the optional interface for extensions that provide ui.json (SPI-driven UI).
type extensionWithUI interface {
	UIJSON() []byte
}

// handleExtensionsList returns all registered extensions with their UI spec from ui.json (SPI-driven).
// Each extension that implements UIJSON() has its label, description, and inputs filled from that JSON.
func handleExtensionsList(w http.ResponseWriter, r *http.Request) {
	all := registry.All()
	list := make([]ExtensionInfo, 0, len(all))
	for _, ext := range all {
		info := ExtensionInfo{Name: ext.Name()}
		if uiExt, ok := ext.(extensionWithUI); ok {
			var ui uiJSONSchema
			if err := json.Unmarshal(uiExt.UIJSON(), &ui); err != nil {
				log.Printf("[API] extensions: parse ui.json for %s: %v", ext.Name(), err)
			} else {
				info.Label = ui.Label
				info.Description = ui.Description
				info.SummaryKeys = ui.SummaryKeys
				for _, in := range ui.Inputs {
					ctrl := UIControl{Key: in.Key, Label: in.Label, Type: in.Type, Required: in.Required, Default: in.Default}
					for _, o := range in.Options {
						ctrl.Options = append(ctrl.Options, UIOption{Value: o.Value, Label: o.Label})
					}
					info.Inputs = append(info.Inputs, ctrl)
				}
			}
		} else {
			info.Label = ext.Name()
		}
		list = append(list, info)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"extensions": list})
}

// handleExtensionUI returns the raw ui.json for an extension by name (SPI-driven: lookup from registry).
func handleExtensionUI(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/extensions/")
	name := strings.TrimSuffix(path, "/ui")
	if name == "" {
		http.Error(w, "extension name required", http.StatusBadRequest)
		return
	}
	for _, ext := range registry.All() {
		if ext.Name() != name {
			continue
		}
		if uiExt, ok := ext.(extensionWithUI); ok {
			w.Header().Set("Content-Type", "application/json")
			w.Write(uiExt.UIJSON())
			return
		}
		break
	}
	http.NotFound(w, r)
}

// handleNotificationConfig gets or sets the notification extension config (persisted in MongoDB).
// GET loads from store then returns config so user sees saved thresholds and can edit.
// POST/PUT saves to store and updates in-memory config.
func handleNotificationConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	ctx := r.Context()
	if ctx == nil {
		ctx = context.Background()
	}
	switch r.Method {
	case http.MethodGet:
		notification.LoadConfigFromStore(ctx)
		cfg := notification.GetConfig()
		if cfg.Config == nil {
			cfg.Config = make(map[string]interface{})
		}
		// Ensure webhooks and thresholds are always arrays so the frontend never gets undefined
		if cfg.Config["webhooks"] == nil {
			cfg.Config["webhooks"] = []interface{}{}
		}
		if cfg.Config["thresholds"] == nil {
			cfg.Config["thresholds"] = []interface{}{}
		}
		json.NewEncoder(w).Encode(cfg.Config)
		return
	case http.MethodPost, http.MethodPut:
		var config map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		if err := notification.SaveConfigToStore(ctx, config); err != nil {
			log.Printf("[API] notification SaveConfigToStore: %v", err)
			http.Error(w, "failed to save config", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		return
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
}

// handleNotificationTrigger runs one threshold check and sends webhooks immediately (e.g. after user saves config).
func handleNotificationTrigger(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	notification.TriggerNow()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// handleNotificationTest sends a test message to all configured webhooks so the user can verify Discord/Teams/Slack receive it.
func handleNotificationTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	log.Printf("[API] POST /api/extensions/notification/test – sending test to all webhooks")
	notification.SendTestToAllWebhooks()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
