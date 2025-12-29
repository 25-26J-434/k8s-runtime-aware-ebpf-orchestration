package main

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

var (
	requestCount uint64
	cpuTaskCount uint64
	uptime       = time.Now()
)

// CPU-intensive computation functions
func computePrimes(limit int) []int {
	primes := []int{}
	for n := 2; n < limit; n++ {
		isPrime := true
		for i := 2; i <= int(math.Sqrt(float64(n))); i++ {
			if n%i == 0 {
				isPrime = false
				break
			}
		}
		if isPrime {
			primes = append(primes, n)
		}
	}
	return primes
}

func computeHash(data string, iterations int) string {
	result := data
	for i := 0; i < iterations; i++ {
		hash := sha256.Sum256([]byte(result))
		result = hex.EncodeToString(hash[:])
		
		// Mix in MD5 for extra CPU work
		if i%10 == 0 {
			md5hash := md5.Sum([]byte(result))
			result = hex.EncodeToString(md5hash[:])
		}
	}
	return result
}

func fibonacciRecursive(n int) int {
	if n <= 1 {
		return n
	}
	return fibonacciRecursive(n-1) + fibonacciRecursive(n-2)
}

func matrixMultiplication(size int) [][]float64 {
	// Create two random matrices
	a := make([][]float64, size)
	b := make([][]float64, size)
	result := make([][]float64, size)
	
	for i := 0; i < size; i++ {
		a[i] = make([]float64, size)
		b[i] = make([]float64, size)
		result[i] = make([]float64, size)
		for j := 0; j < size; j++ {
			a[i][j] = rand.Float64()
			b[i][j] = rand.Float64()
		}
	}
	
	// Matrix multiplication
	for i := 0; i < size; i++ {
		for j := 0; j < size; j++ {
			for k := 0; k < size; k++ {
				result[i][j] += a[i][k] * b[k][j]
			}
		}
	}
	
	return result
}

// Handlers
func handleRoot(w http.ResponseWriter, r *http.Request) {
	atomic.AddUint64(&requestCount, 1)
	
	fmt.Fprintf(w, `<!DOCTYPE html>
<html>
<head>
    <title>CPU Stress Test Service</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f0f0f0; }
        .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #333; }
        .endpoint { background: #e8f4f8; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .endpoint a { color: #0066cc; text-decoration: none; font-weight: bold; }
        .endpoint a:hover { text-decoration: underline; }
        .stats { background: #f8f8f8; padding: 15px; margin: 20px 0; border-radius: 5px; }
        code { background: #272822; color: #f8f8f2; padding: 2px 6px; border-radius: 3px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔥 CPU Stress Test Service</h1>
        <p>This service provides various CPU-intensive endpoints to generate scheduling latency.</p>
        
        <div class="stats">
            <strong>Stats:</strong><br>
            Uptime: %v<br>
            Total Requests: %d<br>
            CPU Tasks Completed: %d<br>
            Go Routines: %d
        </div>
        
        <h2>Available Endpoints:</h2>
        
        <div class="endpoint">
            <a href="/cpu/light">/cpu/light</a> - Light CPU load (primes up to 10,000)
        </div>
        
        <div class="endpoint">
            <a href="/cpu/medium">/cpu/medium</a> - Medium CPU load (primes up to 50,000 + hash computation)
        </div>
        
        <div class="endpoint">
            <a href="/cpu/heavy">/cpu/heavy</a> - Heavy CPU load (matrix multiplication + recursive fibonacci)
        </div>
        
        <div class="endpoint">
            <a href="/cpu/burst">/cpu/burst</a> - Burst load (spawns 10 parallel CPU tasks)
        </div>
        
        <div class="endpoint">
            <a href="/cpu/sustained?duration=10">/cpu/sustained</a> - Sustained CPU load (duration in seconds, default 10s)
        </div>
        
        <div class="endpoint">
            <a href="/health">/health</a> - Health check
        </div>
        
        <div class="endpoint">
            <a href="/metrics">/metrics</a> - Service metrics
        </div>
    </div>
</body>
</html>`, time.Since(uptime).Round(time.Second), requestCount, cpuTaskCount, runtime.NumGoroutine())
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprintln(w, "OK")
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprintf(w, `{
  "uptime_seconds": %d,
  "request_count": %d,
  "cpu_task_count": %d,
  "goroutines": %d
}`, int(time.Since(uptime).Seconds()), requestCount, cpuTaskCount, runtime.NumGoroutine())
}

func handleLightCPU(w http.ResponseWriter, r *http.Request) {
	atomic.AddUint64(&requestCount, 1)
	start := time.Now()
	
	primes := computePrimes(10000)
	atomic.AddUint64(&cpuTaskCount, 1)
	
	duration := time.Since(start)
	fmt.Fprintf(w, "Light CPU task completed!\nFound %d primes in %v\n", len(primes), duration)
}

func handleMediumCPU(w http.ResponseWriter, r *http.Request) {
	atomic.AddUint64(&requestCount, 1)
	start := time.Now()
	
	primes := computePrimes(50000)
	hash := computeHash("cpu-stress-test", 1000)
	atomic.AddUint64(&cpuTaskCount, 1)
	
	duration := time.Since(start)
	fmt.Fprintf(w, "Medium CPU task completed!\nFound %d primes and computed hash %s... in %v\n", 
		len(primes), hash[:16], duration)
}

func handleHeavyCPU(w http.ResponseWriter, r *http.Request) {
	atomic.AddUint64(&requestCount, 1)
	start := time.Now()
	
	// Matrix multiplication
	matrix := matrixMultiplication(100)
	
	// Recursive fibonacci
	fib := fibonacciRecursive(30)
	
	atomic.AddUint64(&cpuTaskCount, 1)
	
	duration := time.Since(start)
	fmt.Fprintf(w, "Heavy CPU task completed!\nMatrix: %dx%d, Fibonacci(30)=%d in %v\n", 
		len(matrix), len(matrix[0]), fib, duration)
}

func handleBurstCPU(w http.ResponseWriter, r *http.Request) {
	atomic.AddUint64(&requestCount, 1)
	start := time.Now()
	
	var wg sync.WaitGroup
	tasksCompleted := 0
	
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			computePrimes(20000)
			computeHash(fmt.Sprintf("task-%d", id), 500)
			atomic.AddUint64(&cpuTaskCount, 1)
			tasksCompleted++
		}(i)
	}
	
	wg.Wait()
	duration := time.Since(start)
	
	fmt.Fprintf(w, "Burst CPU load completed!\nExecuted %d parallel tasks in %v\n", 
		tasksCompleted, duration)
}

func handleSustainedCPU(w http.ResponseWriter, r *http.Request) {
	atomic.AddUint64(&requestCount, 1)
	
	durationStr := r.URL.Query().Get("duration")
	duration := 10 // default 10 seconds
	if durationStr != "" {
		if parsed, err := strconv.Atoi(durationStr); err == nil && parsed > 0 && parsed <= 60 {
			duration = parsed
		}
	}
	
	start := time.Now()
	endTime := start.Add(time.Duration(duration) * time.Second)
	iterations := 0
	
	for time.Now().Before(endTime) {
		computePrimes(5000)
		computeHash(fmt.Sprintf("iteration-%d", iterations), 100)
		iterations++
		atomic.AddUint64(&cpuTaskCount, 1)
	}
	
	elapsed := time.Since(start)
	fmt.Fprintf(w, "Sustained CPU load completed!\nRan for %v with %d iterations\n", 
		elapsed, iterations)
}

func main() {
	rand.Seed(time.Now().UnixNano())
	
	log.Println("========================================")
	log.Println("  CPU Stress Test Service")
	log.Println("  Generate Scheduling Latency Metrics")
	log.Println("========================================")
	
	http.HandleFunc("/", handleRoot)
	http.HandleFunc("/health", handleHealth)
	http.HandleFunc("/metrics", handleMetrics)
	http.HandleFunc("/cpu/light", handleLightCPU)
	http.HandleFunc("/cpu/medium", handleMediumCPU)
	http.HandleFunc("/cpu/heavy", handleHeavyCPU)
	http.HandleFunc("/cpu/burst", handleBurstCPU)
	http.HandleFunc("/cpu/sustained", handleSustainedCPU)
	
	port := ":8080"
	log.Printf("Starting server on %s...\n", port)
	log.Println("Ready to stress CPUs! 🔥")
	
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

