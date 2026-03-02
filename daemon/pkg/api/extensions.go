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

// handleExtensionsListSlash handles GET /api/extensions/ (trailing slash); only responds for exact path.
func handleExtensionsListSlash(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/extensions/" {
		http.NotFound(w, r)
		return
	}
	handleExtensionsList(w, r)
}

// handleExtensionsList returns all registered extensions with their UI spec.
func handleExtensionsList(w http.ResponseWriter, r *http.Request) {
	all := registry.All()
	list := make([]ExtensionInfo, 0, len(all))
	for _, ext := range all {
		info := ExtensionInfo{Name: ext.Name()}
		switch ext.Name() {
		case "notification":
			var ui uiJSONSchema
			if err := json.Unmarshal(notification.UIJSON, &ui); err != nil {
				log.Printf("[API] extensions: parse notification ui.json: %v", err)
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
		default:
			info.Label = ext.Name()
		}
		list = append(list, info)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"extensions": list})
}

// handleExtensionUI returns the raw ui.json for an extension by name.
func handleExtensionUI(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/extensions/")
	name := strings.TrimSuffix(path, "/ui")
	if name == "" {
		http.Error(w, "extension name required", http.StatusBadRequest)
		return
	}
	switch name {
	case "notification":
		w.Header().Set("Content-Type", "application/json")
		w.Write(notification.UIJSON)
	default:
		http.NotFound(w, r)
	}
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
