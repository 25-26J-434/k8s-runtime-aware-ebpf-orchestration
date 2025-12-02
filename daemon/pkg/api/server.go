package api

import (
    "log"
    "net/http"
)

func StartServer() {
    log.Println("[API] HTTP server running on :8080")

    http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte(`{"status":"ok"}`))
    })

    http.ListenAndServe(":8080", nil)
}
