package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// -------- ENUMS --------
type EventType string
type CommunicationType string
type ActionType string

const (
	Unicast   CommunicationType = "UNICAST"
	Broadcast CommunicationType = "BROADCAST"
	Multicast CommunicationType = "MULTICAST"
	Received  CommunicationType = "RECEIVED"

	EventScheduling   EventType = "SCHEDULING"
	EventStateUpdate  EventType = "STATE_UPDATE"
	EventMetricUpdate EventType = "METRIC_UPDATE"
	EventHandshake    EventType = "HANDSHAKE"
	EventDiscovery    EventType = "DISCOVERY"
	EventError        EventType = "ERROR"

	ActionNone        ActionType = "NONE"
	ActionUpdateState ActionType = "UPDATE_STATE"
	ActionReroute     ActionType = "REROUTE"
)

// -------- MESSAGE FORMAT --------
type Message struct {
	Event       EventType         `json:"event"`
	Type        CommunicationType `json:"type"`
	Sender      string            `json:"sender"`
	SenderIP    string            `json:"sender_ip"`
	Targets     []string          `json:"targets"`
	TargetNodes []string          `json:"target_nodes"`
	Payload     map[string]any    `json:"payload"`
	Timestamp   int64             `json:"timestamp"`
	Action      ActionType        `json:"action"`
}

// -------- COMMUNICATION STATS --------
type CommStats struct {
	Broadcast  int      `json:"broadcast"`
	Unicast    int      `json:"unicast"`
	Multicast  int      `json:"multicast"`
	Received   int      `json:"received"`
	Total      int      `json:"total"`
	LastUpdate string   `json:"last_update"`
	Node       string   `json:"node"`
	NodeIP     string   `json:"node_ip"`
	PeerCount  int      `json:"peer_count"`
	Peers      []string `json:"peers"`
}

// NodeInfo holds discovered node name and IP
type NodeInfo struct {
	Name string `json:"name"`
	IP   string `json:"ip"`
}

// Global variables
var (
	NODE_NAME string
	NODE_IP   string

	peersLock  sync.RWMutex
	allNodeIPs []string
	nodeMap    map[string]string // nodeName -> IP

	statsLock sync.RWMutex
	commStats CommStats

	peersConfig     string
	refreshInterval = 10 * time.Second
)

// Utility logging
func logf(format string, a ...any) {
	fmt.Printf(format+"\n", a...)
}

// -------- PEER LOADING (CONFIGMAP or ENV) --------
func loadPeersFromFileOrEnv(cfg string) []string {
	if cfg == "" {
		return nil
	}

	// If file is present
	if _, err := os.Stat(cfg); err == nil {
		data, _ := os.ReadFile(cfg)
		lines := strings.Split(string(data), "\n")
		ips := []string{}
		for _, line := range lines {
			ip := strings.TrimSpace(line)
			if ip != "" {
				ips = append(ips, ip)
			}
		}
		return ips
	}

	// else treat as comma separated list
	parts := strings.Split(cfg, ",")
	out := []string{}
	for _, p := range parts {
		if ip := strings.TrimSpace(p); ip != "" {
			out = append(out, ip)
		}
	}
	return out
}

// -------- K8S NODE DISCOVERY --------
func discoverPeersFromK8s() ([]NodeInfo, []string) {
	token, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/token")
	if err != nil {
		return nil, nil
	}

	caCert, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
	if err != nil {
		return nil, nil
	}

	caPool := x509.NewCertPool()
	if ok := caPool.AppendCertsFromPEM(caCert); !ok {
		return nil, nil
	}

	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: caPool}}
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}

	req, err := http.NewRequest("GET", "https://kubernetes.default.svc/api/v1/nodes", nil)
	if err != nil {
		return nil, nil
	}
	req.Header.Set("Authorization", "Bearer "+string(token))

	resp, err := client.Do(req)
	if err != nil {
		return nil, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil
	}

	var data struct {
		Items []struct {
			Metadata struct {
				Name string `json:"name"`
			} `json:"metadata"`
			Status struct {
				Addresses []struct {
					Type    string `json:"type"`
					Address string `json:"address"`
				} `json:"addresses"`
			} `json:"status"`
		} `json:"items"`
	}

	body, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, nil
	}

	var nodes []NodeInfo
	var ips []string
	for _, item := range data.Items {
		var ip string
		for _, addr := range item.Status.Addresses {
			if addr.Type == "InternalIP" && addr.Address != "" {
				ip = addr.Address
				break
			}
		}
		if ip == "" {
			continue
		}
		nodes = append(nodes, NodeInfo{Name: item.Metadata.Name, IP: ip})
		ips = append(ips, ip)
	}

	return nodes, ips
}

// -------- SENDER FUNCTION --------
func sendToNode(ip string, body []byte) {
	url := "http://" + ip + ":8080/receive"
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewBuffer(body))
	if err != nil {
		logf("ERROR sending to %s: %v", ip, err)
		return
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	logf("Sent to node %s", ip)
}

// resolveTargets converts node names or IPs into IPs using discovered node map.
func resolveTargets(targets []string) []string {
	peersLock.RLock()
	defer peersLock.RUnlock()

	resolved := []string{}
	for _, t := range targets {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		// If already an IP, use directly
		if strings.Count(t, ".") == 3 {
			resolved = append(resolved, t)
			continue
		}
		if ip, ok := nodeMap[t]; ok {
			resolved = append(resolved, ip)
		}
	}
	return resolved
}

func sendData(comm CommunicationType, msg Message, targets []string) {
	msg.Type = comm
	msg.Sender = NODE_NAME
	msg.SenderIP = NODE_IP
	msg.Timestamp = time.Now().Unix()

	body, _ := json.Marshal(msg)

	// Update stats
	statsLock.Lock()
	commStats.Total++
	commStats.LastUpdate = time.Now().Format("2006-01-02 15:04:05")
	statsLock.Unlock()

	switch comm {
	case Unicast:
		if len(targets) != 1 {
			logf("Unicast requires exactly 1 target")
			return
		}
		statsLock.Lock()
		commStats.Unicast++
		statsLock.Unlock()
		sendToNode(targets[0], body)

	case Broadcast:
		statsLock.Lock()
		commStats.Broadcast++
		statsLock.Unlock()
		peersLock.RLock()
		peers := append([]string{}, allNodeIPs...)
		peersLock.RUnlock()
		for _, ip := range peers {
			if ip != NODE_IP {
				go sendToNode(ip, body)
			}
		}

	case Multicast:
		statsLock.Lock()
		commStats.Multicast++
		statsLock.Unlock()
		for _, ip := range targets {
			if ip != NODE_IP {
				go sendToNode(ip, body)
			}
		}
	}
}

// -------- RECEIVE HANDLER --------
func receiveHandler(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var msg Message
	json.Unmarshal(body, &msg)

	logf("\n📥 RECEIVED on %s (%s):", NODE_NAME, NODE_IP)
	out, _ := json.MarshalIndent(msg, "", "  ")
	fmt.Println(string(out))

	// Update stats
	statsLock.Lock()
	commStats.Received++
	commStats.Total++
	commStats.LastUpdate = time.Now().Format("2006-01-02 15:04:05")
	statsLock.Unlock()

	w.Write([]byte("OK"))
}

// -------- BROADCAST HANDLER (FOR TESTING) --------
func broadcastHandler(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var msg Message
	json.Unmarshal(body, &msg)

	if msg.Event == "" {
		http.Error(w, "event is required", http.StatusBadRequest)
		return
	}

	logf("\n📤 BROADCASTING from %s (%s):", NODE_NAME, NODE_IP)
	out, _ := json.MarshalIndent(msg, "", "  ")
	fmt.Println(string(out))

	sendData(Broadcast, msg, nil)
	w.Write([]byte("OK"))
}

// -------- UNICAST HANDLER (FOR TESTING) --------
func unicastHandler(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var msg Message
	json.Unmarshal(body, &msg)

	if msg.Event == "" {
		http.Error(w, "event is required", http.StatusBadRequest)
		return
	}

	targets := msg.Targets
	if len(targets) == 0 && len(msg.TargetNodes) > 0 {
		targets = msg.TargetNodes
	}

	resolved := resolveTargets(targets)
	if len(resolved) != 1 {
		http.Error(w, "unicast requires exactly 1 valid target", http.StatusBadRequest)
		return
	}

	logf("\n📤 UNICASTING to %s from %s (%s):", resolved[0], NODE_NAME, NODE_IP)
	out, _ := json.MarshalIndent(msg, "", "  ")
	fmt.Println(string(out))

	sendData(Unicast, msg, resolved)
	w.Write([]byte("OK"))
}

// -------- MULTICAST HANDLER (FOR TESTING) --------
func multicastHandler(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var msg Message
	json.Unmarshal(body, &msg)

	if msg.Event == "" {
		http.Error(w, "event is required", http.StatusBadRequest)
		return
	}

	targets := msg.Targets
	if len(targets) == 0 && len(msg.TargetNodes) > 0 {
		targets = msg.TargetNodes
	}

	resolved := resolveTargets(targets)
	if len(resolved) == 0 {
		http.Error(w, "multicast requires at least 1 valid target", http.StatusBadRequest)
		return
	}

	logf("\n📤 MULTICASTING to %v from %s (%s):", resolved, NODE_NAME, NODE_IP)
	out, _ := json.MarshalIndent(msg, "", "  ")
	fmt.Println(string(out))

	sendData(Multicast, msg, resolved)
	w.Write([]byte("OK"))
}

// -------- STATS HANDLER --------
func statsHandler(w http.ResponseWriter, r *http.Request) {
	statsLock.RLock()
	defer statsLock.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(commStats)
}

// -------- HEALTH CHECK --------
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "healthy",
		"node":   NODE_NAME,
		"ip":     NODE_IP,
	})
}

// -------- PEER REFRESHER --------
func refreshPeers(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(refreshInterval):
			nodes, peers := discoverPeersFromK8s()
			if len(peers) == 0 {
				peers = loadPeersFromFileOrEnv(peersConfig)
			}
			if peers != nil {
				peersLock.Lock()
				allNodeIPs = peers
				nodeMap = map[string]string{}
				for _, n := range nodes {
					nodeMap[n.Name] = n.IP
				}
				peersLock.Unlock()

				statsLock.Lock()
				commStats.PeerCount = len(peers)
				commStats.Peers = peers
				commStats.LastUpdate = time.Now().Format("2006-01-02 15:04:05")
				statsLock.Unlock()
			}
		}
	}
}

// -------- MAIN --------
func main() {
	flag.StringVar(&peersConfig, "peers", "/etc/node-daemon/peers.txt", "peer IP list")
	flag.Parse()

	NODE_NAME = os.Getenv("NODE_NAME")
	NODE_IP = os.Getenv("NODE_IP")

	// Initialize stats
	commStats = CommStats{
		Node:       NODE_NAME,
		NodeIP:     NODE_IP,
		LastUpdate: time.Now().Format("2006-01-02 15:04:05"),
	}

	logf("Starting daemon on %s (%s)", NODE_NAME, NODE_IP)

	// Prefer K8s discovery, fallback to peers file
	nodes, ips := discoverPeersFromK8s()
	if len(ips) == 0 {
		// Allow env override for peers config path
		if envPeers := os.Getenv("PEERS"); envPeers != "" {
			peersConfig = envPeers
		}
		ips = loadPeersFromFileOrEnv(peersConfig)
	}
	allNodeIPs = ips
	nodeMap = map[string]string{}
	for _, n := range nodes {
		nodeMap[n.Name] = n.IP
	}
	logf("Initial peers: %v", allNodeIPs)

	// Initialize stats with peers
	statsLock.Lock()
	commStats.PeerCount = len(allNodeIPs)
	commStats.Peers = allNodeIPs
	statsLock.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go refreshPeers(ctx)

	// HTTP Handlers
	http.HandleFunc("/receive", receiveHandler)
	http.HandleFunc("/broadcast", broadcastHandler)
	http.HandleFunc("/unicast", unicastHandler)
	http.HandleFunc("/multicast", multicastHandler)
	http.HandleFunc("/stats", statsHandler)
	http.HandleFunc("/health", healthHandler)

	logf("Listening on node network :8080")
	http.ListenAndServe(":8080", nil)
}
