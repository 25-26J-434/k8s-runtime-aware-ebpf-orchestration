// peer_health.go
//
// Peer liveness tracking for the communication subsystem.
// A heartbeat loop probes every known peer's /api/comm/health endpoint, and
// message deliveries also feed the same table, so /api/comm/health can report
// per-peer status (up / degraded / down), latency and last-seen time.

package comm

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"
)

const (
	defaultHeartbeatInterval = 5 * time.Second
	downAfterFailures        = 3
)

type PeerStatus struct {
	IP                  string  `json:"ip"`
	Name                string  `json:"name,omitempty"`
	Status              string  `json:"status"` // up | degraded | down | unknown
	LatencyMs           float64 `json:"latency_ms"`
	LastSeen            string  `json:"last_seen,omitempty"`
	LastChecked         string  `json:"last_checked,omitempty"`
	ConsecutiveFailures int     `json:"consecutive_failures"`
	LastError           string  `json:"last_error,omitempty"`
}

var (
	peerHealthMu sync.RWMutex
	peerHealth   = make(map[string]*PeerStatus)
)

func heartbeatInterval() time.Duration {
	if raw := os.Getenv("HEARTBEAT_INTERVAL"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			return d
		}
	}
	return defaultHeartbeatInterval
}

// recordPeerResult updates liveness for a peer after a probe or delivery.
func recordPeerResult(ip string, latency time.Duration, err error) {
	if ip == "" {
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)

	peerHealthMu.Lock()
	defer peerHealthMu.Unlock()
	st, ok := peerHealth[ip]
	if !ok {
		st = &PeerStatus{IP: ip, Status: "unknown"}
		peerHealth[ip] = st
	}
	st.LastChecked = now
	if err == nil {
		st.Status = "up"
		st.ConsecutiveFailures = 0
		st.LastError = ""
		st.LastSeen = now
		st.LatencyMs = float64(latency.Microseconds()) / 1000
		return
	}
	st.ConsecutiveFailures++
	st.LastError = err.Error()
	if st.ConsecutiveFailures >= downAfterFailures {
		st.Status = "down"
	} else {
		st.Status = "degraded"
	}
}

// pruneAndNamePeers drops peers that left the cluster and attaches node names.
func pruneAndNamePeers() {
	current := listPeerIPs(true)
	keep := make(map[string]struct{}, len(current))
	for _, ip := range current {
		keep[ip] = struct{}{}
	}

	peersLock.RLock()
	names := make(map[string]string, len(ipMap))
	for ip, name := range ipMap {
		names[ip] = name
	}
	peersLock.RUnlock()

	peerHealthMu.Lock()
	defer peerHealthMu.Unlock()
	for ip := range peerHealth {
		if _, ok := keep[ip]; !ok {
			delete(peerHealth, ip)
		}
	}
	for _, ip := range current {
		st, ok := peerHealth[ip]
		if !ok {
			st = &PeerStatus{IP: ip, Status: "unknown"}
			peerHealth[ip] = st
		}
		st.Name = names[ip]
	}
}

func probePeer(ip string) {
	start := time.Now()
	resp, err := peerHTTPClient.Get(peerURL(ip, "/api/comm/health"))
	if err == nil {
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			err = statusError{code: resp.StatusCode}
		}
	}
	recordPeerResult(ip, time.Since(start), err)
}

func heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(heartbeatInterval())
	defer ticker.Stop()

	for {
		pruneAndNamePeers()
		var wg sync.WaitGroup
		for _, ip := range listPeerIPs(true) {
			wg.Add(1)
			go func(ip string) {
				defer wg.Done()
				probePeer(ip)
			}(ip)
		}
		wg.Wait()
		purgeSeen()

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// snapshotPeerHealth returns peer statuses sorted by IP.
func snapshotPeerHealth() []PeerStatus {
	peerHealthMu.RLock()
	defer peerHealthMu.RUnlock()
	out := make([]PeerStatus, 0, len(peerHealth))
	for _, st := range peerHealth {
		out = append(out, *st)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].IP < out[j].IP })
	return out
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	peers := snapshotPeerHealth()
	up := 0
	for _, p := range peers {
		if p.Status == "up" {
			up++
		}
	}

	status := "healthy"
	switch {
	case len(peers) > 0 && up == 0:
		status = "isolated"
	case up < len(peers):
		status = "degraded"
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":      status,
		"node":        nodeName,
		"ip":          nodeIP,
		"peer_count":  len(peers),
		"peers_up":    up,
		"peers":       peers,
		"checked_at":  time.Now().UTC().Format(time.RFC3339),
		"heartbeat_s": heartbeatInterval().Seconds(),
	})
}
