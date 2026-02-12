package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type dnsResult struct {
	Domain    string   `json:"domain"`
	IPs       []string `json:"ips,omitempty"`
	LatencyMs float64  `json:"latency_ms,omitempty"`
	Error     string   `json:"error,omitempty"`
	Status    string   `json:"status"`
}

type callResult struct {
	Target      string      `json:"target"`
	StatusCode  int         `json:"status_code,omitempty"`
	LatencyMs   float64     `json:"latency_ms,omitempty"`
	Response    interface{} `json:"response,omitempty"`
	Error       string      `json:"error,omitempty"`
	Status      string      `json:"status"`
	ContentType string      `json:"content_type,omitempty"`
}

func main() {
	serviceBURL := getenv("SERVICE_B_URL", "http://service-b:5001")
	port := getenv("PORT", "5000")
	serviceName := getenv("SERVICE_NAME", "unknown")

	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]interface{}{
			"message":   "Hello from backend",
			"served_by": serviceName,
		})
	})

	mux.HandleFunc("/whoami", func(w http.ResponseWriter, r *http.Request) {
		hostname, _ := os.Hostname()
		if hostname == "" {
			hostname = "unknown"
		}
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintf(w, "Hi, I am service A (%s)\n", hostname)
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
	})

	mux.HandleFunc("/dns-test", func(w http.ResponseWriter, r *http.Request) {
		domains := []string{"google.com", "kubernetes.default.svc.cluster.local", "service-b"}
		results := make([]dnsResult, 0, len(domains))
		for _, domain := range domains {
			res := dnsLookup(domain)
			results = append(results, res)
		}
		writeJSON(w, map[string]interface{}{"dns_lookups": results})
	})

	mux.HandleFunc("/call-service-b", func(w http.ResponseWriter, r *http.Request) {
		res := callService(serviceBURL + "/")
		writeJSON(w, res)
	})

	mux.HandleFunc("/load-test/", func(w http.ResponseWriter, r *http.Request) {
		countStr := strings.TrimPrefix(r.URL.Path, "/load-test/")
		count, err := strconv.Atoi(countStr)
		if err != nil || count < 0 {
			http.Error(w, "count must be a positive integer", http.StatusBadRequest)
			return
		}

		dnsSuccess, dnsFailed := 0, 0
		httpSuccess, httpFailed := 0, 0

		for i := 0; i < count; i++ {
			if res := dnsLookup("kubernetes.default.svc.cluster.local"); res.Status == "success" {
				dnsSuccess++
			} else {
				dnsFailed++
			}

			if res := callService(serviceBURL + "/health"); res.Status == "success" {
				httpSuccess++
			} else {
				httpFailed++
			}
		}

		writeJSON(w, map[string]interface{}{
			"iterations":   count,
			"dns_success":  dnsSuccess,
			"dns_failed":   dnsFailed,
			"http_success": httpSuccess,
			"http_failed":  httpFailed,
		})
	})

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	log.Printf("service-a listening on :%s, calling service-b at %s", port, serviceBURL)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func writeJSON(w http.ResponseWriter, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("failed to encode response: %v", err)
	}
}

func dnsLookup(domain string) dnsResult {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	start := time.Now()
	ips, err := net.DefaultResolver.LookupHost(ctx, domain)
	elapsed := float64(time.Since(start).Milliseconds())

	if err != nil {
		return dnsResult{
			Domain: domain,
			Error:  err.Error(),
			Status: "failed",
		}
	}

	return dnsResult{
		Domain:    domain,
		IPs:       ips,
		LatencyMs: elapsed,
		Status:    "success",
	}
}

func callService(url string) callResult {
	client := &http.Client{Timeout: 5 * time.Second}
	start := time.Now()
	resp, err := client.Get(url) // #nosec G107 - simple test client, URL is controlled by env.
	elapsed := float64(time.Since(start).Milliseconds())

	if err != nil {
		return callResult{
			Target: url,
			Error:  err.Error(),
			Status: "failed",
		}
	}
	defer resp.Body.Close()

	var body interface{}
	contentType := resp.Header.Get("Content-Type")
	if strings.HasPrefix(strings.ToLower(contentType), "application/json") {
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			body = fmt.Sprintf("failed to decode JSON: %v", err)
		}
	} else {
		data, _ := io.ReadAll(resp.Body)
		body = string(data)
	}

	return callResult{
		Target:      url,
		Status:      "success",
		StatusCode:  resp.StatusCode,
		LatencyMs:   elapsed,
		Response:    body,
		ContentType: contentType,
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
