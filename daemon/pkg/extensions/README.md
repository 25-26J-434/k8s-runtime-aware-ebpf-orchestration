# Component 01 Extensions (SPI)

This document describes the extension system: the **Service Provider Interface (SPI)**, the **extension registry**, how to **use** extensions (including the Notification extension from the UI and API), and how to **add** new extensions.

---

## 1. Overview

Extensions run inside the eBPF daemon and use a single **Service Provider Interface (SPI)**. They can subscribe to node, pod, and container metrics and react (e.g. send webhook alerts when thresholds are exceeded). Only extensions that implement the SPI are registered and started; the registry enforces this at compile time.

---

## 2. Service Provider Interface (SPI)

**Location:** `daemon/pkg/spi/spi.go`

There is **one** SPI in the system.

### Extension interface

All extensions must implement:

```go
type Extension interface {
    Name() string
    Run(ctx context.Context, params ExtensionParams) error
}
```

- **Name()** – Unique extension name (e.g. `"notification"`, `"audit"`).
- **Run(ctx, params)** – Starts the extension. It should block until `ctx` is cancelled. Configuration from the frontend is passed in `params`.

### ExtensionParams

Configuration passed to extensions (from frontend or defaults):

- **Config** – `map[string]interface{}` (keys align with the extension’s `ui.json` inputs).
- Helpers: **GetString(key)**, **GetFloat(key)**, **GetBool(key)** for typed access.

---

## 3. Extension Registry

**Location:** `daemon/pkg/extensions/registry/registry.go`

- **Contract:** Only extensions that implement `spi.Extension` may be registered. `All()` returns `[]spi.Extension`, so the type system enforces this at compile time.
- **init()** validates at startup that every registered extension is non-nil and has a non-empty `Name()`.
- **All()** returns the list of extensions that are started by `main` and listed by the API.

To add a new extension: implement `spi.Extension`, add `extensions/<name>/ui.json` if the frontend should configure it, then append the extension to the slice in `All()` (e.g. `notification.GetExtension()`).

---

## 4. How to Use Extensions

### 4.1 From the frontend (Extensions page)

1. Open the dashboard and go to **Extensions** in the sidebar.
2. Click an extension (e.g. **Notification**) to view its description and configuration.
3. **Saved configuration** – Shown in tables: global settings (enabled, webhook type, URL, interval) and **Saved thresholds** (metric, level, threshold, node, with Edit/Delete).
4. **Add threshold** – Use the form (Metric, Level, Threshold value, optional Node name) and click **Add threshold** to add a row. Use **Edit** / **Delete** in the table to change or remove rows.
5. **Configuration** – Set **Webhook type** (Slack, Discord, Microsoft Teams), paste the **Webhook URL** for that type, set **Enable notifications** and **Check interval (seconds)**.
6. Click **Save** to persist config and thresholds to the backend (and MongoDB for the notification extension). A trigger runs once after save so you can verify alerts immediately.

### 4.2 From the API

- **List extensions:** `GET /api/extensions` – Returns all registered extensions with `name`, `label`, `description`, `inputs`, and optional `summary_keys`.
- **Extension UI spec:** `GET /api/extensions/<name>/ui` – Returns the raw `ui.json` for that extension.
- **Notification config:**  
  - `GET /api/extensions/notification/config` – Returns the saved config (from MongoDB), including `thresholds` and webhook settings.  
  - `POST /api/extensions/notification/config` – Saves the config (JSON body) to MongoDB and updates the in-memory config.
- **Trigger notification check:** `POST /api/extensions/notification/trigger` – Runs one threshold evaluation and sends webhooks for any exceeded alerts (no cooldown).

---

## 5. Notification Extension (Detailed)

**Location:** `daemon/pkg/extensions/notification/`

### 5.1 What it does

- Evaluates **multiple thresholds** (configurable per metric, level, value, and optional node).
- Sends alerts to **Slack**, **Discord**, or **Microsoft Teams** when any threshold is exceeded.
- Uses a **separate webhook URL per type** (`webhook_url`, `webhook_url_slack`, `webhook_url_teams`). The URL used is determined by **Webhook type**; no fallback to another type (e.g. Teams never gets the Discord URL).
- Persists config (including all thresholds) in **MongoDB** so it survives daemon restarts.

### 5.2 Metrics and levels

- **Metrics:** DNS latency (avg µs), RTT (avg µs), Node CPU/memory %, Scheduling latency, Disk I/O.
- **Levels:** Node, Pod, Container.
- **Optional node filter:** Per-threshold optional `node_name`; if set, only that node is evaluated for that rule.

### 5.3 Webhook types and URLs

- **Webhook type** (one of Slack, Discord, Microsoft Teams) selects which URL is used.
- **URLs:**  
  - Discord: `webhook_url`  
  - Slack: `webhook_url_slack`  
  - Microsoft Teams: `webhook_url_teams`  
- Only the URL for the selected type is used. If you choose Teams, you must set **Webhook URL (Microsoft Teams)**; otherwise no notification is sent.

### 5.4 Multiple thresholds

- Config can include a **thresholds** array. Each entry: `metric_type`, `level`, `threshold_value`, optional `node_name`.
- The daemon evaluates **every** threshold on each run; alerts are sent for any that are exceeded (with per-alert cooldown in the periodic loop).
- If `thresholds` is missing or empty, a single legacy threshold is read from top-level `metric_type`, `level`, `threshold_value`, `node_name`.

### 5.5 Persistence (MongoDB)

- **Collection:** `extension_notification_config` (default; overridable via env).
- **Database:** `kerneleye` (default).
- **Env:** `EXTENSION_MONGO_URI` or `MONGODB_URI`; optional `EXTENSION_MONGO_DB`, `EXTENSION_MONGO_COLLECTION`.
- Same connection pattern as `pkg/redirection/store.go`. One document with `key: "default"` holds the full config (including `thresholds`).
- On daemon startup, `LoadConfigFromStore` loads this config into memory so the extension and API use the same saved values.

#### Checking MongoDB from your machine (port-forward and queries)

If MongoDB runs in Kubernetes (e.g. in namespace `mongo`), from your laptop run one of these:

**Option 1 – Forward the service (default port 27017)**

```bash
kubectl port-forward -n mongo svc/mongo 27017:27017
```

**Option 2 – Forward a specific pod (e.g. use local port 27018, good if 27017 is in use)**

```bash
kubectl -n mongo port-forward pod/mongo-0 27018:27017
```

Then connect with **directConnection=true** when talking to a single pod:

```bash
mongosh "mongodb://127.0.0.1:27018/kerneleye?directConnection=true"
```

Leave the port-forward running, then in another terminal connect and query:

```bash
# If using Option 1 (svc on 27017):
mongosh "mongodb://localhost:27017/kerneleye"

# If using Option 2 (pod mongo-0 on 27018):
mongosh "mongodb://127.0.0.1:27018/kerneleye?directConnection=true"

# Or if you have older mongo shell:
# mongo "mongodb://localhost:27017/kerneleye"
```

In `mongosh`:

```javascript
// Use the extension database
use kerneleye

// List collections
show collections

// See the notification extension config (saved thresholds, webhook type, URLs, etc.)
db.extension_notification_config.find().pretty()

// One-liner from shell (no mongosh interactive)
// Use 27017 or 27018 + directConnection=true depending on your port-forward:
mongosh "mongodb://localhost:27017/kerneleye" --eval 'db.extension_notification_config.find().pretty()'
mongosh "mongodb://127.0.0.1:27018/kerneleye?directConnection=true" --eval 'db.extension_notification_config.find().pretty()'
```

To see only the `config` field (thresholds, webhook_type, etc.):

```javascript
db.extension_notification_config.findOne({ key: "default" }, { config: 1, updated_at: 1 })
```

### 5.6 ui.json

- **Location:** `daemon/pkg/extensions/notification/ui.json`
- Defines **label**, **description**, **inputs** (enabled, webhook_type, webhook_url, webhook_url_slack, webhook_url_teams, interval_seconds, etc.) and optional **summary_keys** for the order of fields in the saved-config summary.
- The frontend builds the Configuration form and Saved configuration from this and from the API response.

---

## 6. Adding a New Extension

1. **Create `extensions/<name>/extension.go`**  
   Implement `spi.Extension`: define a type with `Name() string` and `Run(ctx context.Context, params spi.ExtensionParams) error`. Use telemetry APIs (e.g. `telemetry.GetPodDNSMetrics()`, `telemetry.GetRTTMetrics()`, or `telemetry.GlobalRegistry.Get(metricType).Subscribe()`).

2. **Create `extensions/<name>/ui.json`** (optional)  
   Define `label`, `description`, and `inputs` (and optionally `summary_keys`). The frontend uses this to render configuration and saved-config layout.

3. **Register in `extensions/registry/registry.go`**  
   Append your extension to the slice in `All()`, e.g. `mymod.GetExtension()`. Only types that implement `spi.Extension` can be added (return type is `[]spi.Extension`).

4. **Expose config via API (optional)**  
   If the frontend must configure the extension at runtime, add handlers in `pkg/api/extensions.go` (e.g. GET/POST for ` /api/extensions/<name>/config`) and call your extension’s config setter from the POST handler. For listing, extend `handleExtensionsList` so your extension’s `name` is handled and its `ui.json` (and `summary_keys`) are attached to the response.

---

## 7. API Reference (Summary)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/extensions` | List all extensions (name, label, description, inputs, summary_keys). |
| GET | `/api/extensions/` | Same as above (trailing slash). |
| GET | `/api/extensions/<name>/ui` | Raw `ui.json` for the extension. |
| GET | `/api/extensions/notification/config` | Get saved notification config (from MongoDB). |
| POST / PUT | `/api/extensions/notification/config` | Save notification config (body: JSON with thresholds, webhook_*, etc.). |
| POST | `/api/extensions/notification/trigger` | Run one notification check and send webhooks for exceeded thresholds. |

---

## 8. Frontend Extensions Page (Summary)

- **Available extensions** – List of registered extensions (from `GET /api/extensions`). Selecting one loads its config and UI.
- **Saved configuration** (notification) – Two tables: (1) Global settings (Enabled, Webhook type, Webhook URL in use, Interval). (2) Saved thresholds (Metric, Level, Threshold, Node, Actions: Edit, Delete). Edit fills the “Add threshold” form; Delete removes the row. Click **Save** to persist.
- **Add threshold** – Form: Metric, Level, Threshold value, Node name (optional). **Add threshold** adds a row; when editing, **Update threshold** / **Cancel** apply or cancel the edit.
- **Configuration** – Webhook type, single Webhook URL field (bound to the selected type), Enable notifications, Check interval. **Save** sends full config (including `thresholds`) to the API and triggers one check.
- **Pods on node** – When a node is selected in the Add threshold form, the list of pods on that node is shown (for notification).
- **Live metrics preview** – Shows current metrics for the selected metric/level to help choose a threshold.

---

## 9. Summary of What We Implemented

- **Single SPI** in `pkg/spi/spi.go`: `Extension` (Name, Run) and `ExtensionParams` (Config + GetString/GetFloat/GetBool).
- **Registry** in `pkg/extensions/registry`: only SPI-derived extensions; `All() []spi.Extension`; init() validation.
- **Notification extension**: multiple thresholds (array in config), separate webhook URLs per type (Discord/Slack/Teams), no cross-type fallback, MongoDB persistence, TriggerNow and periodic Run loop.
- **Frontend**: Extensions page with saved-config **tables** (global + thresholds with Edit/Delete), **Add threshold** section, single Webhook URL field by type, success message and validation so Teams/Slack use the correct URL.
- **API**: List extensions (with summary_keys), get/set notification config, trigger notification check.

All extensions in the system are derived from the SPI and registered in the extension registry; they are started from `main` and listed via the API and Extensions UI.
