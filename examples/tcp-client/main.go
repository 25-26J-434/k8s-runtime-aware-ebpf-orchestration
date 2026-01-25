package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

type connectionResult struct {
	URL       string  `json:"url"`
	Status    int     `json:"status,omitempty"`
	LatencyMs float64 `json:"latency_ms,omitempty"`
	Success   bool    `json:"success"`
	Error     string  `json:"error,omitempty"`
}

var targetServices = []string{
	"http://service-a.test-services.svc.cluster.local:5000",
	"http://service-b.test-services.svc.cluster.local:5001",
	"http://www.google.com",
	"http://www.github.com",
}

func main() {
	port := getenv("PORT", "5002")
	if envTargets := os.Getenv("TARGET_SERVICES"); envTargets != "" {
		targetServices = strings.Split(envTargets, ",")
	}

	go continuousConnections()

	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]interface{}{
			"service":     "tcp-client",
			"description": "Makes TCP connections to test RTT measurement",
			"targets":     targetServices,
		})
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]interface{}{"status": "healthy"})
	})

	mux.HandleFunc("/test", func(w http.ResponseWriter, r *http.Request) {
		results := make([]connectionResult, 0, len(targetServices))
		for _, url := range targetServices {
			results = append(results, makeTCPConnection(url))
		}
		writeJSON(w, map[string]interface{}{"connections": results})
	})

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	log.Printf("tcp-client listening on :%s, targets=%v", port, targetServices)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func continuousConnections() {
	for {
		for _, url := range targetServices {
			res := makeTCPConnection(url)
			if res.Success {
				log.Printf("[TCP] %s - %.2fms", res.URL, res.LatencyMs)
			} else {
				log.Printf("[TCP] %s - Error: %s", res.URL, res.Error)
			}
			time.Sleep(2 * time.Second)
		}
	}
}

func makeTCPConnection(url string) connectionResult {
	client := &http.Client{Timeout: 5 * time.Second}
	start := time.Now()
	resp, err := client.Get(url) // #nosec G107 - used for test traffic generation.
	latency := float64(time.Since(start).Milliseconds())

	if err != nil {
		return connectionResult{
			URL:     url,
			Error:   err.Error(),
			Success: false,
		}
	}
	defer resp.Body.Close()

	return connectionResult{
		URL:       url,
		Status:    resp.StatusCode,
		LatencyMs: latency,
		Success:   true,
	}
}

func writeJSON(w http.ResponseWriter, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("failed to encode response: %v", err)
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
