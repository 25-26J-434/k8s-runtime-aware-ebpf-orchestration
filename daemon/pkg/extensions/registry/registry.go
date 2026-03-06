// Package registry registers all Component 01 extensions that participate in the application lifecycle.
//
// Contract: only extensions that implement the Service Provider Interface (spi.Extension) may be
// registered. The SPI is defined in daemon/pkg/spi/spi.go (Name() string and Run(ctx, params) error).
// All extensions must be derived from that interface; All() returns []spi.Extension so the type
// system enforces this at compile time.
//
// To add a new extension: create extensions/<name>/extension.go (implement spi.Extension),
// add extensions/<name>/ui.json, then append to the slice in All().
package registry

import (
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/extensions/notification"
	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/spi"
)

func init() {
	// Fail fast if any registered extension is nil or invalid (only SPI-derived extensions should be here).
	for _, ext := range All() {
		if ext == nil {
			panic("registry: extension must not be nil")
		}
		if ext.Name() == "" {
			panic("registry: extension must have a non-empty Name()")
		}
	}
}

// All returns every extension that should run in the application lifecycle.
// Only spi.Extension implementations may be included (enforced by return type).
func All() []spi.Extension {
	return []spi.Extension{
		notification.GetExtension(),
	}
}
