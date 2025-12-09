package api

import (
	"log"
	"net/http"
)

// RegisterRoutes wires HTTP endpoints for the daemon.
func RegisterRoutes(mux *http.ServeMux) {
	healthHandler := func(w http.ResponseWriter, _ *http.Request) {
		if _, err := w.Write([]byte(`{"status":"ok"}`)); err != nil {
			log.Printf("failed to write health response: %v", err)
		}
	}

	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		if _, err := w.Write([]byte("App is running")); err != nil {
			log.Printf("failed to write root response: %v", err)
		}
	})
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/healthz", healthHandler)
}
