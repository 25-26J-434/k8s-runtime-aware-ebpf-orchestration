package comm

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestMarkSeenDeduplicates(t *testing.T) {
	if markSeen("") {
		t.Fatal("empty id must never be a duplicate")
	}
	if markSeen("abc-1") {
		t.Fatal("first sighting must not be a duplicate")
	}
	if !markSeen("abc-1") {
		t.Fatal("second sighting must be a duplicate")
	}
}

func TestDecodeMessageValidation(t *testing.T) {
	cases := []struct {
		name   string
		method string
		body   string
		status int
	}{
		{"wrong method", http.MethodGet, "", http.StatusMethodNotAllowed},
		{"bad json", http.MethodPost, "{nope", http.StatusBadRequest},
		{"missing event", http.MethodPost, `{"payload":{}}`, http.StatusBadRequest},
		{"valid", http.MethodPost, `{"event":"HANDSHAKE"}`, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, "/receive", strings.NewReader(tc.body))
			_, ok := decodeMessage(rec, req)
			if ok != (tc.status == http.StatusOK) {
				t.Fatalf("ok=%v, want %v", ok, tc.status == http.StatusOK)
			}
			if !ok && rec.Code != tc.status {
				t.Fatalf("status=%d, want %d", rec.Code, tc.status)
			}
		})
	}
}

func TestRecordPeerResultTransitions(t *testing.T) {
	const ip = "10.0.0.99"
	defer func() {
		peerHealthMu.Lock()
		delete(peerHealth, ip)
		peerHealthMu.Unlock()
	}()

	status := func() PeerStatus {
		for _, p := range snapshotPeerHealth() {
			if p.IP == ip {
				return p
			}
		}
		t.Fatal("peer missing")
		return PeerStatus{}
	}

	recordPeerResult(ip, 5*time.Millisecond, nil)
	if s := status(); s.Status != "up" || s.LatencyMs <= 0 {
		t.Fatalf("expected up with latency, got %+v", s)
	}

	boom := errors.New("boom")
	recordPeerResult(ip, 0, boom)
	if s := status(); s.Status != "degraded" {
		t.Fatalf("expected degraded after 1 failure, got %s", s.Status)
	}
	for i := 1; i < downAfterFailures; i++ {
		recordPeerResult(ip, 0, boom)
	}
	if s := status(); s.Status != "down" {
		t.Fatalf("expected down after %d failures, got %s", downAfterFailures, s.Status)
	}

	recordPeerResult(ip, time.Millisecond, nil)
	if s := status(); s.Status != "up" || s.ConsecutiveFailures != 0 {
		t.Fatalf("expected recovery to up, got %+v", s)
	}
}

func TestPostWithRetry(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if atomic.AddInt32(&calls, 1) < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	if _, err := postWithRetry(srv.URL, []byte(`{}`)); err != nil {
		t.Fatalf("expected success on 3rd attempt, got %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 3 {
		t.Fatalf("calls=%d, want 3", got)
	}
}

func TestPostWithRetryDoesNotRetryClientErrors(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	if _, err := postWithRetry(srv.URL, []byte(`{}`)); err == nil {
		t.Fatal("expected error for 400")
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("calls=%d, want 1 (no retry on 4xx)", got)
	}
}
