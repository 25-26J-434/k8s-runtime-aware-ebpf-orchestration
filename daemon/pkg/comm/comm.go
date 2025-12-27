package comm

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

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

const (
	defaultPeersConfig     = "/etc/node-daemon/peers.txt"
	defaultRefreshInterval = 10 * time.Second
	maxCommLogs            = 200
)

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

// MessageHandler handles incoming communication events.
type MessageHandler func(Message)

type LogDirection string

const (
	DirectionSent     LogDirection = "SENT"
	DirectionReceived LogDirection = "RECEIVED"
)

type CommLogEntry struct {
	ID           string            `json:"id"`
	Timestamp    string            `json:"timestamp"`
	Node         string            `json:"node"`
	NodeIP       string            `json:"node_ip"`
	Direction    LogDirection      `json:"direction"`
	Mode         CommunicationType `json:"mode"`
	Event        EventType         `json:"event"`
	Action       ActionType        `json:"action"`
	Source       string            `json:"source"`
	SourceIP     string            `json:"source_ip"`
	Targets      []string          `json:"targets"`
	TargetIPs    []string          `json:"target_ips,omitempty"`
	Delivered    []string          `json:"delivered,omitempty"`
	DeliveredIPs []string          `json:"delivered_ips,omitempty"`
	Failed       []string          `json:"failed,omitempty"`
	FailedIPs    []string          `json:"failed_ips,omitempty"`
	Result       string            `json:"result,omitempty"`
	Payload      map[string]any    `json:"payload,omitempty"`
}

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

type NodeInfo struct {
	Name string `json:"name"`
	IP   string `json:"ip"`
}

type Config struct {
	NodeName        string
	NodeIP          string
	PeersConfig     string
	RefreshInterval time.Duration
}

var (
	nodeName string
	nodeIP   string

	peersConfig     = defaultPeersConfig
	refreshInterval = defaultRefreshInterval

	peersLock  sync.RWMutex
	allNodeIPs []string
	nodeMap    map[string]string
	ipMap      map[string]string

	statsLock sync.RWMutex
	commStats CommStats

	logsLock sync.RWMutex
	commLogs []CommLogEntry

	initOnce      sync.Once
	cancelMu      sync.Mutex
	cancelRefresh context.CancelFunc

	handlersMu sync.RWMutex
	handlers   = make(map[EventType][]MessageHandler)
)

func Init(cfg Config) func() {
	initOnce.Do(func() {
		if cfg.NodeName != "" {
			nodeName = cfg.NodeName
		} else if env := os.Getenv("NODE_NAME"); env != "" {
			nodeName = env
		} else {
			nodeName = "unknown"
		}

		if cfg.NodeIP != "" {
			nodeIP = cfg.NodeIP
		} else if env := os.Getenv("NODE_IP"); env != "" {
			nodeIP = env
		}

		if cfg.PeersConfig != "" {
			peersConfig = cfg.PeersConfig
		} else if env := os.Getenv("PEERS"); env != "" {
			peersConfig = env
		}

		if cfg.RefreshInterval > 0 {
			refreshInterval = cfg.RefreshInterval
		} else {
			refreshInterval = defaultRefreshInterval
		}

		commStats = CommStats{
			Node:       nodeName,
			NodeIP:     nodeIP,
			LastUpdate: time.Now().Format("2006-01-02 15:04:05"),
		}

		nodes, ips := discoverPeersFromK8s()
		if len(ips) == 0 {
			ips = loadPeersFromFileOrEnv(peersConfig)
		}
		setPeers(nodes, ips)

		statsLock.Lock()
		commStats.PeerCount = len(allNodeIPs)
		commStats.Peers = append([]string{}, allNodeIPs...)
		statsLock.Unlock()

		peersLock.RLock()
		logf("Initial peers: %v", allNodeIPs)
		peersLock.RUnlock()

		var ctx context.Context
		ctx, cancelRefresh = context.WithCancel(context.Background())
		go refreshPeers(ctx)
	})

	return func() {
		cancelMu.Lock()
		defer cancelMu.Unlock()
		if cancelRefresh != nil {
			cancelRefresh()
			cancelRefresh = nil
		}
	}

}

// RegisterMessageHandler registers a handler for a given event type. Handlers execute asynchronously.
func RegisterMessageHandler(event EventType, handler MessageHandler) {
	if handler == nil {
		return
	}

	handlersMu.Lock()
	defer handlersMu.Unlock()
	handlers[event] = append(handlers[event], handler)
}

func RegisterHandlers(mux *http.ServeMux, wrap func(http.HandlerFunc) http.HandlerFunc) {
	register := func(pattern string, handler http.HandlerFunc) {
		if wrap != nil {
			handler = wrap(handler)
		}
		if mux != nil {
			mux.HandleFunc(pattern, handler)
		} else {
			http.HandleFunc(pattern, handler)
		}
	}

	register("/receive", receiveHandler)
	register("/broadcast", broadcastHandler)
	register("/unicast", unicastHandler)
	register("/multicast", multicastHandler)
	register("/stats", statsHandler)
	register("/logs", logsHandler)
	register("/api/comm/broadcast", broadcastHandler)
	register("/api/comm/unicast", unicastHandler)
	register("/api/comm/multicast", multicastHandler)
	register("/api/comm/stats", statsHandler)
	register("/api/comm/logs", logsHandler)
	register("/api/comm/health", healthHandler)
}

func dispatchMessage(msg Message) {
	handlersMu.RLock()
	registered := append([]MessageHandler{}, handlers[msg.Event]...)
	handlersMu.RUnlock()
	if len(registered) == 0 {
		return
	}

	for _, handler := range registered {
		handler := handler
		go func(copy Message) {
			defer func() {
				if r := recover(); r != nil {
					logf("panic in message handler: %v", r)
				}
			}()
			handler(copy)
		}(cloneMessage(msg))
	}
}

func loadPeersFromFileOrEnv(cfg string) []string {
	if cfg == "" {
		return nil
	}

	if _, err := os.Stat(cfg); err == nil {
		data, _ := os.ReadFile(cfg)
		lines := strings.Split(string(data), "\n")
		peers := make([]string, 0, len(lines))
		for _, line := range lines {
			if ip := strings.TrimSpace(line); ip != "" {
				peers = append(peers, ip)
			}
		}
		return peers
	}

	parts := strings.Split(cfg, ",")
	peers := make([]string, 0, len(parts))
	for _, part := range parts {
		if ip := strings.TrimSpace(part); ip != "" {
			peers = append(peers, ip)
		}
	}
	return peers
}

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

	nodes := make([]NodeInfo, 0, len(data.Items))
	ips := make([]string, 0, len(data.Items))
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

func setPeers(nodes []NodeInfo, ips []string) {
	peersLock.Lock()
	defer peersLock.Unlock()

	allNodeIPs = uniqueStrings(ips)
	nodeMap = make(map[string]string, len(nodes))
	ipMap = make(map[string]string, len(nodes))
	for _, node := range nodes {
		nodeMap[node.Name] = node.IP
		if node.IP != "" {
			ipMap[node.IP] = node.Name
		}
	}
}

func sendToNode(ip string, body []byte) error {
	url := "http://" + ip + ":8080/receive"
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewBuffer(body))
	if err != nil {
		logf("ERROR sending to %s: %v", ip, err)
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	if resp.StatusCode >= 400 {
		err = fmt.Errorf("received status %d", resp.StatusCode)
		logf("ERROR sending to %s: %v", ip, err)
		return err
	}
	logf("Sent to node %s", ip)
	return nil
}

func resolveTargets(targets []string) []string {
	peersLock.RLock()
	defer peersLock.RUnlock()

	resolved := make([]string, 0, len(targets))
	for _, target := range targets {
		target = strings.TrimSpace(target)
		if target == "" {
			continue
		}
		if strings.Count(target, ".") == 3 {
			resolved = append(resolved, target)
			continue
		}
		if ip, ok := nodeMap[target]; ok {
			resolved = append(resolved, ip)
		}
	}
	return resolved
}

func sendData(commType CommunicationType, msg Message, targets []string) {
	msg.Type = commType
	msg.Sender = nodeName
	msg.SenderIP = nodeIP
	msg.Timestamp = time.Now().Unix()

	body, err := json.Marshal(msg)
	if err != nil {
		logf("ERROR marshaling message: %v", err)
		return
	}

	statsLock.Lock()
	commStats.Total++
	commStats.LastUpdate = time.Now().Format("2006-01-02 15:04:05")
	switch commType {
	case Unicast:
		commStats.Unicast++
	case Broadcast:
		commStats.Broadcast++
	case Multicast:
		commStats.Multicast++
	}
	statsLock.Unlock()

	var attempted []string
	switch commType {
	case Unicast:
		attempted = uniqueStrings(targets)
		if len(attempted) != 1 {
			logf("Unicast requires exactly 1 target")
			attempted = nil
		}
	case Broadcast:
		attempted = listPeerIPs(true)
	case Multicast:
		attempted = uniqueStrings(targets)
	}

	var delivered, failed []string
	if len(attempted) > 0 {
		var wg sync.WaitGroup
		var mu sync.Mutex
		for _, ip := range attempted {
			ip := strings.TrimSpace(ip)
			if ip == "" || ip == nodeIP {
				continue
			}
			wg.Add(1)
			go func(targetIP string) {
				defer wg.Done()
				if err := sendToNode(targetIP, body); err != nil {
					mu.Lock()
					failed = append(failed, targetIP)
					mu.Unlock()
					return
				}
				mu.Lock()
				delivered = append(delivered, targetIP)
				mu.Unlock()
			}(ip)
		}
		wg.Wait()
	}

	result := "delivered"
	switch {
	case len(attempted) == 0:
		if commType == Broadcast {
			result = "no_peers"
		} else {
			result = "no_targets"
		}
	case len(failed) > 0 && len(delivered) == 0:
		result = "failed"
	case len(failed) > 0:
		result = "partial"
	}

	recordLog(CommLogEntry{
		ID:           fmt.Sprintf("%d-%s-%s", time.Now().UnixNano(), nodeName, commType),
		Timestamp:    time.Now().UTC().Format(time.RFC3339Nano),
		Node:         nodeName,
		NodeIP:       nodeIP,
		Direction:    DirectionSent,
		Mode:         commType,
		Event:        msg.Event,
		Action:       msg.Action,
		Source:       nodeName,
		SourceIP:     nodeIP,
		Targets:      formatTargets(attempted),
		TargetIPs:    copyStringSlice(attempted),
		Delivered:    formatTargets(delivered),
		DeliveredIPs: copyStringSlice(delivered),
		Failed:       formatTargets(failed),
		FailedIPs:    copyStringSlice(failed),
		Result:       result,
		Payload:      copyPayloadMap(msg.Payload),
	})
}

// BroadcastMessage sends a message to all known peers.
func BroadcastMessage(msg Message) {
	sendData(Broadcast, msg, nil)
}

func receiveHandler(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var msg Message
	json.Unmarshal(body, &msg)

	logf("\n[COMM] RECEIVED on %s (%s):", nodeName, nodeIP)
	out, _ := json.MarshalIndent(msg, "", "  ")
	fmt.Println(string(out))

	statsLock.Lock()
	commStats.Received++
	commStats.Total++
	commStats.LastUpdate = time.Now().Format("2006-01-02 15:04:05")
	statsLock.Unlock()

	targetLabels := uniqueStrings(append([]string{}, msg.TargetNodes...))
	if len(msg.Targets) > 0 {
		targetLabels = uniqueStrings(append(targetLabels, formatTargets(msg.Targets)...))
	}
	targetIPs := uniqueStrings(append([]string{}, msg.Targets...))
	if len(msg.TargetNodes) > 0 {
		targetIPs = uniqueStrings(append(targetIPs, resolveTargets(msg.TargetNodes)...))
	}

	recordLog(CommLogEntry{
		ID:        fmt.Sprintf("%d-%s-received", time.Now().UnixNano(), nodeName),
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Node:      nodeName,
		NodeIP:    nodeIP,
		Direction: DirectionReceived,
		Mode:      msg.Type,
		Event:     msg.Event,
		Action:    msg.Action,
		Source:    msg.Sender,
		SourceIP:  msg.SenderIP,
		Targets:   targetLabels,
		TargetIPs: copyStringSlice(targetIPs),
		Result:    "received",
		Payload:   copyPayloadMap(msg.Payload),
	})

	dispatchMessage(msg)

	w.Write([]byte("OK"))
}

func broadcastHandler(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var msg Message
	json.Unmarshal(body, &msg)

	if msg.Event == "" {
		http.Error(w, "event is required", http.StatusBadRequest)
		return
	}

	logf("\n[COMM] BROADCAST from %s (%s):", nodeName, nodeIP)
	out, _ := json.MarshalIndent(msg, "", "  ")
	fmt.Println(string(out))

	sendData(Broadcast, msg, nil)
	w.Write([]byte("OK"))
}

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

	logf("\n[COMM] UNICAST to %s from %s (%s):", resolved[0], nodeName, nodeIP)
	out, _ := json.MarshalIndent(msg, "", "  ")
	fmt.Println(string(out))

	sendData(Unicast, msg, resolved)
	w.Write([]byte("OK"))
}

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

	logf("\n[COMM] MULTICAST to %v from %s (%s):", resolved, nodeName, nodeIP)
	out, _ := json.MarshalIndent(msg, "", "  ")
	fmt.Println(string(out))

	sendData(Multicast, msg, resolved)
	w.Write([]byte("OK"))
}

func statsHandler(w http.ResponseWriter, r *http.Request) {
	statsLock.RLock()
	defer statsLock.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(commStats)
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "healthy",
		"node":   nodeName,
		"ip":     nodeIP,
	})
}

func logsHandler(w http.ResponseWriter, r *http.Request) {
	limit := maxCommLogs
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed < limit {
				limit = parsed
			}
		}
	}

	scope := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope")))
	entries := getLocalLogs(limit)

	if scope == "cluster" {
		peers := listPeerIPs(true)
		var wg sync.WaitGroup
		var mu sync.Mutex
		for _, ip := range peers {
			ip := ip
			if ip == "" {
				continue
			}
			wg.Add(1)
			go func(peerIP string) {
				defer wg.Done()
				remote, err := fetchLogsFromPeer(peerIP, limit)
				if err != nil {
					logf("ERROR fetching logs from %s: %v", peerIP, err)
					return
				}
				if len(remote) == 0 {
					return
				}
				mu.Lock()
				entries = append(entries, remote...)
				mu.Unlock()
			}(ip)
		}
		wg.Wait()

		sort.Slice(entries, func(i, j int) bool {
			return entries[i].Timestamp > entries[j].Timestamp
		})
		if limit > 0 && len(entries) > limit {
			entries = entries[:limit]
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"node":    nodeName,
		"node_ip": nodeIP,
		"logs":    entries,
	})
}

func recordLog(entry CommLogEntry) {
	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if entry.Node == "" {
		entry.Node = nodeName
	}
	if entry.NodeIP == "" {
		entry.NodeIP = nodeIP
	}
	entry.Targets = copyStringSlice(entry.Targets)
	entry.TargetIPs = copyStringSlice(entry.TargetIPs)
	entry.Delivered = copyStringSlice(entry.Delivered)
	entry.DeliveredIPs = copyStringSlice(entry.DeliveredIPs)
	entry.Failed = copyStringSlice(entry.Failed)
	entry.FailedIPs = copyStringSlice(entry.FailedIPs)
	if entry.Payload != nil {
		entry.Payload = copyPayloadMap(entry.Payload)
	}

	logsLock.Lock()
	defer logsLock.Unlock()
	commLogs = append(commLogs, entry)
	if len(commLogs) > maxCommLogs {
		commLogs = commLogs[len(commLogs)-maxCommLogs:]
	}
}

func getLocalLogs(limit int) []CommLogEntry {
	logsLock.RLock()
	defer logsLock.RUnlock()

	if len(commLogs) == 0 {
		return nil
	}

	start := 0
	if limit > 0 && len(commLogs) > limit {
		start = len(commLogs) - limit
	}

	entries := make([]CommLogEntry, 0, len(commLogs)-start)
	for _, entry := range commLogs[start:] {
		entries = append(entries, cloneLogEntry(entry))
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Timestamp > entries[j].Timestamp
	})

	return entries
}

func cloneLogEntry(entry CommLogEntry) CommLogEntry {
	clone := entry
	clone.Targets = copyStringSlice(entry.Targets)
	clone.TargetIPs = copyStringSlice(entry.TargetIPs)
	clone.Delivered = copyStringSlice(entry.Delivered)
	clone.DeliveredIPs = copyStringSlice(entry.DeliveredIPs)
	clone.Failed = copyStringSlice(entry.Failed)
	clone.FailedIPs = copyStringSlice(entry.FailedIPs)
	if entry.Payload != nil {
		clone.Payload = copyPayloadMap(entry.Payload)
	}
	return clone
}

func cloneMessage(msg Message) Message {
	clone := msg
	clone.Targets = copyStringSlice(msg.Targets)
	clone.TargetNodes = copyStringSlice(msg.TargetNodes)
	if msg.Payload != nil {
		clone.Payload = copyPayloadMap(msg.Payload)
	}
	return clone
}

func copyStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	dup := make([]string, len(values))
	copy(dup, values)
	return dup
}

func copyPayloadMap(payload map[string]any) map[string]any {
	if payload == nil {
		return nil
	}
	clone := make(map[string]any, len(payload))
	for k, v := range payload {
		clone[k] = v
	}
	return clone
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func formatTargets(ips []string) []string {
	if len(ips) == 0 {
		return nil
	}
	peersLock.RLock()
	defer peersLock.RUnlock()
	formatted := make([]string, 0, len(ips))
	for _, ip := range ips {
		ip = strings.TrimSpace(ip)
		if ip == "" {
			continue
		}
		if name, ok := ipMap[ip]; ok && name != "" {
			formatted = append(formatted, fmt.Sprintf("%s (%s)", name, ip))
		} else {
			formatted = append(formatted, ip)
		}
	}
	return formatted
}

func listPeerIPs(excludeSelf bool) []string {
	peersLock.RLock()
	defer peersLock.RUnlock()
	if len(allNodeIPs) == 0 {
		return nil
	}
	peers := make([]string, 0, len(allNodeIPs))
	seen := make(map[string]struct{}, len(allNodeIPs))
	for _, ip := range allNodeIPs {
		ip = strings.TrimSpace(ip)
		if ip == "" {
			continue
		}
		if excludeSelf && ip == nodeIP {
			continue
		}
		if _, ok := seen[ip]; ok {
			continue
		}
		seen[ip] = struct{}{}
		peers = append(peers, ip)
	}
	return peers
}

func fetchLogsFromPeer(ip string, limit int) ([]CommLogEntry, error) {
	client := &http.Client{Timeout: 4 * time.Second}
	url := fmt.Sprintf("http://%s:8080/api/comm/logs?scope=local", ip)
	if limit > 0 {
		url = fmt.Sprintf("%s&limit=%d", url, limit)
	}

	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("peer %s returned status %d", ip, resp.StatusCode)
	}

	var payload struct {
		Logs []CommLogEntry `json:"logs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if len(payload.Logs) == 0 {
		return nil, nil
	}
	return cloneLogEntries(payload.Logs), nil
}

func cloneLogEntries(entries []CommLogEntry) []CommLogEntry {
	if len(entries) == 0 {
		return nil
	}
	cloned := make([]CommLogEntry, 0, len(entries))
	for _, entry := range entries {
		cloned = append(cloned, cloneLogEntry(entry))
	}
	return cloned
}

func refreshPeers(ctx context.Context) {
	ticker := time.NewTicker(refreshInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			nodes, peers := discoverPeersFromK8s()
			if len(peers) == 0 {
				peers = loadPeersFromFileOrEnv(peersConfig)
			}
			if peers != nil {
				setPeers(nodes, peers)

				statsLock.Lock()
				commStats.PeerCount = len(peers)
				commStats.Peers = append([]string{}, peers...)
				commStats.LastUpdate = time.Now().Format("2006-01-02 15:04:05")
				statsLock.Unlock()
			}
		}
	}
}

func logf(format string, a ...any) {
	fmt.Printf(format+"\n", a...)
}
