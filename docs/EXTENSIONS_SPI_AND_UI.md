# Extensions: SPI and UI (How the code works)

## Overview

Extensions are **SPI (Service Provider Interface) driven**. Each extension implements the interface in `daemon/pkg/spi/spi.go`, is registered in `daemon/pkg/extensions/registry/registry.go`, and can optionally provide a `ui.json` so the API and frontend can list it and show a UI.

- **Backend**: Extensions implement `spi.Extension`; the **registry** is the single source of truth for “what extensions exist”. The **API** uses the registry to list extensions and to serve each extension’s UI when the extension provides it.
- **UI**: The **notification** extension (and any future extension that wants a UI) ships a **`ui.json`** next to its code. The API does **not** hardcode extension names for list/UI; it uses the registry and an optional `UIJSON()` method.
- **Config / trigger / test**: These are still **per-extension**. The notification extension registers handlers for `config`, `trigger`, and `test` under `/api/extensions/notification/...`. A single **subpath handler** under `/api/extensions/` dispatches by extension name and path so the frontend can call `/api/extensions/${name}/config` generically.

## SPI (Service Provider Interface)

**Location:** `daemon/pkg/spi/spi.go`

- **`Extension`** interface:
  - `Name() string` – unique id (e.g. `"notification"`).
  - `Run(ctx context.Context, params ExtensionParams) error` – runs the extension (blocking until `ctx` is cancelled).
- **`ExtensionParams`** – config from the frontend (e.g. thresholds, webhooks). Keys align with the extension’s `ui.json` inputs.

Only types that implement `Extension` may be registered. The type system enforces this in the registry.

## Registry

**Location:** `daemon/pkg/extensions/registry/registry.go`

- **`All() []spi.Extension`** – returns every extension that runs in the app (e.g. notification).
- **Contract:** Only `spi.Extension` implementations are allowed. To add a new extension:
  1. Implement `spi.Extension` in `daemon/pkg/extensions/<name>/extension.go`.
  2. Add `daemon/pkg/extensions/<name>/ui.json` if the extension has a UI.
  3. Append the extension to the slice returned by `All()`.

No hardcoded switch on extension name in the registry; it’s a simple list of SPI implementations.

## Optional UI: `ui.json` and `UIJSON()`

- **`ui.json`** (e.g. `daemon/pkg/extensions/notification/ui.json`) defines:
  - `label`, `description`, `summary_keys`
  - `inputs`: list of form controls (key, label, type, options, default, hint, etc.)

- The **notification** extension (and any extension that wants a UI) exposes that JSON via an optional method **`UIJSON() []byte`** on the same struct that implements `spi.Extension`. The API uses this via a **type assertion**, not a switch on name.

- **API behaviour:**
  - **List** (`GET /api/extensions` or `GET /api/extensions/`): For each extension from `registry.All()`, if the extension implements `UIJSON() []byte`, the API unmarshals that JSON and fills `label`, `description`, `summary_keys`, `inputs` in the list response. Otherwise it uses `ext.Name()` as the label.
  - **UI** (`GET /api/extensions/:name/ui`): The API finds the extension by `name` in the registry; if it implements `UIJSON() []byte`, it responds with that JSON. No hardcoded extension names for list or UI.

So: **the UI is driven by each extension’s `ui.json`**, and the API serves it generically from the SPI/registry.

## API routes (SPI-driven and per-extension)

**Location:** `daemon/pkg/api/api.go`, `daemon/pkg/api/extensions.go`

- **`GET /api/extensions`** – list extensions (uses `registry.All()` and optional `UIJSON()`).
- **`GET /api/extensions/`** – same list; handled by the subpath handler when path is empty.
- **`/api/extensions/`** – one handler for all subpaths:
  - **`/api/extensions/:name/config`** – GET/POST config. Only **notification** has a handler today; others get 404. Frontend calls `/api/extensions/${name}/config` generically.
  - **`/api/extensions/:name/trigger`** – POST trigger (notification only for now).
  - **`/api/extensions/:name/test`** – POST test (notification only for now).
  - **`/api/extensions/:name/ui`** – GET raw `ui.json` (any extension that implements `UIJSON()`).

So the **notification** extension works as an extension coming from the SPI: it’s in the registry, it implements `Extension` and optionally `UIJSON()`, and it registers config/trigger/test under its name. The API does not hardcode extension names for list or UI; only the dispatch for config/trigger/test is per-extension (and can be extended for new extensions later).

## Frontend

- **List:** Fetches `GET /api/extensions` and gets `extensions[]` with `name`, `label`, `description`, `inputs`, etc. (from each extension’s `ui.json` when available).
- **Config:** Uses **generic** `GET/POST /api/extensions/${name}/config` (works for `name === "notification"`; others get 404 until they add handlers).
- **Notification UI:** The **notification** tab is a **custom** React UI (cards, channels, rules, etc.), not a generic form generated from `inputs`. So:
  - **List and metadata** for the notification extension (and any other) **are** from the API, which in turn gets them from the extension’s `ui.json` via the SPI.
  - The **rendered** notification page is custom JSX; it does not currently render a generic form from `ext.inputs`. A future “generic” extension could be added that only has `ui.json` and no custom UI; then the frontend could render a form from `ext.inputs` for that extension.

## One extension = one folder (SPI)

**Notification** is one extension in its own folder. Any new extension is **another folder** next to it, same SPI.

```
daemon/pkg/extensions/
├── notification/          ← first extension (alerts, webhooks, email)
│   ├── extension.go       (implements spi.Extension + optional UIJSON())
│   ├── ui.json
│   ├── ui.go              (embeds ui.json)
│   └── store.go           (optional: MongoDB, etc.)
├── audit/                 ← second extension (example: another folder)
│   ├── extension.go       (implements spi.Extension, Name() "audit")
│   └── ui.json            (optional)
└── registry/
    └── registry.go        (imports both, All() returns [notification, audit])
```

Each folder is a separate package; each implements `spi.Extension`. The **registry** is the only place that knows about all of them: you import each extension and append it in `All()`. No switch on name inside the SPI or registry—just a list of extensions.

## Adding a new extension

1. **Create a folder:** e.g. `daemon/pkg/extensions/audit/` (same level as `notification/`).
2. **Implement SPI:** In `extension.go` implement `Name() string` and `Run(ctx, params) error`. Optionally add `UIJSON() []byte` if you have a UI.
3. **Add `ui.json`:** In that folder, add `ui.json` (label, description, inputs). Use `//go:embed ui.json` in a small `ui.go` if you use `UIJSON()`.
4. **Register:** In `daemon/pkg/extensions/registry/registry.go`, import your package and append your extension to the slice in `All()`:
   ```go
   return []spi.Extension{
       notification.GetExtension(),
       audit.GetExtension(),   // new extension, same SPI
   }
   ```
5. **Optional:** If the extension has config/trigger/test endpoints, add a case for its `name` in the API’s subpath handler in `daemon/pkg/api/extensions.go` (like notification).

After that, the new extension will appear in the list and its UI metadata will be served from `ui.json`; the frontend can show it in the extensions list. So: **yes, adding another extension as another folder works as SPI**—same pattern as notification.

## Summary

| Piece            | Role |
|------------------|------|
| **spi.Extension**| Contract: `Name()`, `Run(ctx, params)`. All extensions implement this. |
| **Registry**     | Single list of extensions; no name-based switch. |
| **ui.json**      | Defines label, description, inputs for the API and frontend. |
| **UIJSON()**     | Optional; API uses it to serve list + `/api/extensions/:name/ui` without hardcoding names. |
| **API list/UI**  | Fully SPI-driven from registry + optional `UIJSON()`. |
| **API config/trigger/test** | Dispatched by path under `/api/extensions/:name/...`; notification implements them; new extensions can add their own. |
| **Frontend**     | Uses generic `/api/extensions` and `/api/extensions/${name}/config`; notification page is custom UI; new extensions can use list + optional generic form from `inputs`. |

So: **the notification extension works as an extension from the SPI class; the UI is generated from the extension’s `ui.json` in the API and list; and adding a new extension (SPI + optional ui.json + optional config handler) will work as an extension in the same way.**
