// reliability.go
//
// Delivery-reliability helpers for the communication subsystem:
//   - shared, pooled HTTP client and configurable peer port
//   - message ID generation and duplicate suppression on receive
//   - bounded retry with backoff for peer deliveries
//   - strict request-body decoding with JSON error responses

package comm

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	defaultPeerPort    = "8080"
	maxBodyBytes       = 1 << 20 // 1 MiB
	seenMessageTTL     = 2 * time.Minute
	sendAttempts       = 3
	sendRetryBaseDelay = 150 * time.Millisecond
)

var (
	peerHTTPClient = &http.Client{
		Timeout: 3 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        64,
			MaxIdleConnsPerHost: 4,
			IdleConnTimeout:     60 * time.Second,
		},
	}

	seenMu       sync.Mutex
	seenMessages = make(map[string]time.Time)
)

// peerPort returns the port peers listen on (PEER_PORT env, default 8080).
func peerPort() string {
	if p := strings.TrimSpace(os.Getenv("PEER_PORT")); p != "" {
		return p
	}
	return defaultPeerPort
}

func peerURL(ip, path string) string {
	return fmt.Sprintf("http://%s:%s%s", ip, peerPort(), path)
}

// newMessageID returns a random 16-hex-char identifier.
func newMessageID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

// markSeen records an ID and reports whether it had already been seen.
// An empty ID is never treated as a duplicate.
func markSeen(id string) bool {
	if id == "" {
		return false
	}
	seenMu.Lock()
	defer seenMu.Unlock()
	if _, ok := seenMessages[id]; ok {
		return true
	}
	seenMessages[id] = time.Now()
	return false
}

func purgeSeen() {
	cutoff := time.Now().Add(-seenMessageTTL)
	seenMu.Lock()
	defer seenMu.Unlock()
	for id, at := range seenMessages {
		if at.Before(cutoff) {
			delete(seenMessages, id)
		}
	}
}

// retryable reports whether a failed delivery is worth another attempt.
type statusError struct{ code int }

func (e statusError) Error() string { return fmt.Sprintf("received status %d", e.code) }

func retryable(err error) bool {
	var se statusError
	if errors.As(err, &se) {
		return se.code >= 500
	}
	return err != nil
}

// postWithRetry POSTs body to url, retrying transient failures with backoff.
func postWithRetry(url string, body []byte) (time.Duration, error) {
	var lastErr error
	start := time.Now()
	for attempt := 0; attempt < sendAttempts; attempt++ {
		if attempt > 0 {
			time.Sleep(sendRetryBaseDelay << (attempt - 1))
		}
		resp, err := peerHTTPClient.Post(url, "application/json", strings.NewReader(string(body)))
		if err != nil {
			lastErr = err
		} else {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if resp.StatusCode < 400 {
				return time.Since(start), nil
			}
			lastErr = statusError{code: resp.StatusCode}
		}
		if !retryable(lastErr) {
			break
		}
	}
	return time.Since(start), lastErr
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// decodeMessage reads and validates a Message from the request body.
// On failure it writes the error response and returns false.
func decodeMessage(w http.ResponseWriter, r *http.Request) (Message, bool) {
	var msg Message
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "POST required")
		return msg, false
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "failed to read request body")
		return msg, false
	}
	if err := json.Unmarshal(body, &msg); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return msg, false
	}
	if msg.Event == "" {
		writeJSONError(w, http.StatusBadRequest, "event is required")
		return msg, false
	}
	return msg, true
}
