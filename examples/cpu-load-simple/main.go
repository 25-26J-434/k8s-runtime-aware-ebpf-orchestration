package main

import (
	"fmt"
	"log"
	"math"
	"net/http"
	"time"
)

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

func main() {
	log.Println("CPU Load Generator - Simple Version")
	
	// Generate continuous CPU load
	go func() {
		for {
			computePrimes(50000)
			time.Sleep(100 * time.Millisecond)
		}
	}()
	
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, "OK")
	})
	
	port := ":8080"
	log.Printf("Starting on %s\n", port)
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

