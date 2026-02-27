package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"time"
)

func main() {
	port := getenv("PORT", "5003")
	rand.Seed(time.Now().UnixNano())

	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		delay := randomDelay(1, 50)
		time.Sleep(delay)

		writeJSON(w, map[string]interface{}{
			"service":            "service-c",
			"status":             "running",
			"simulated_delay_ms": float64(delay.Microseconds()) / 1000,
			"message":            "Hi, I am service C (alternate backend)",
		})
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
	})

	mux.HandleFunc("/slow", func(w http.ResponseWriter, r *http.Request) {
		delay := randomDelay(100, 500)
		time.Sleep(delay)
		writeJSON(w, map[string]interface{}{
			"service":  "service-c",
			"endpoint": "slow",
			"delay_ms": float64(delay.Microseconds()) / 1000,
		})
	})

	mux.HandleFunc("/data", func(w http.ResponseWriter, r *http.Request) {
		items := make([]string, 10)
		for i := 0; i < 10; i++ {
			items[i] = "item_" + strconv.Itoa(i)
		}
		writeJSON(w, map[string]interface{}{
			"service": "service-c",
			"data": map[string]interface{}{
				"timestamp":    time.Now().Unix(),
				"items":        items,
				"random_value": rand.Float64(),
			},
		})
	})

	mux.HandleFunc("/whoami", func(w http.ResponseWriter, r *http.Request) {
	    hostname, err := os.Hostname()
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintln(w, "Hi, I am service C (pod=%s)\n", host)")
	})

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	log.Printf("service-c listening on :%s", port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func randomDelay(minMs, maxMs int) time.Duration {
	span := maxMs - minMs
	return time.Duration(minMs+rand.Intn(span+1)) * time.Millisecond
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
