package api

import (
	"log"
	"net/http"
)

// StartServer boots the HTTP server with the registered routes.
func StartServer(addr string) error {
	mux := http.NewServeMux()
	RegisterRoutes(mux)

	log.Printf("[API] HTTP server running on %s", addr)
	return http.ListenAndServe(addr, mux)
}
