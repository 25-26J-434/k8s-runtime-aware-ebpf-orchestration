package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type LogEntry struct {
	Timestamp string `json:"timestamp"`
	Node      string `json:"node"`
	NodeIP    string `json:"node_ip"`
	Type      string `json:"type"`
	Event     string `json:"event"`
	Message   string `json:"message"`
	Targets   string `json:"targets"`
}

type NodeInfo struct {
	Name string `json:"name"`
	IP   string `json:"ip"`
}

type Stats struct {
	Broadcast int            `json:"broadcast"`
	Unicast   int            `json:"unicast"`
	Multicast int            `json:"multicast"`
	Total     int            `json:"total"`
	NodesSent map[string]int `json:"nodes_sent"`
	NodesRecv map[string]int `json:"nodes_recv"`
}

var (
	logs       []LogEntry
	logsMutex  sync.RWMutex
	stats      Stats
	statsMutex sync.RWMutex
	nodes      []NodeInfo
	nodesMutex sync.RWMutex
)

func init() {
	stats = Stats{
		NodesSent: make(map[string]int),
		NodesRecv: make(map[string]int),
	}
}

func refreshNodeList() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		cmd := exec.Command("kubectl", "get", "pods", "-n", "kube-system",
			"-l", "app=node-daemon", "-o", "json")
		output, err := cmd.Output()
		if err != nil {
			log.Printf("Failed to get pods: %v", err)
			continue
		}

		var result map[string]interface{}
		if err := json.Unmarshal(output, &result); err != nil {
			continue
		}

		items, ok := result["items"].([]interface{})
		if !ok {
			continue
		}

		var newNodes []NodeInfo
		newNodesSent := make(map[string]int)
		newNodesRecv := make(map[string]int)

		for _, item := range items {
			pod := item.(map[string]interface{})
			status, ok := pod["status"].(map[string]interface{})
			if !ok {
				continue
			}

			podIP, ok := status["podIP"].(string)
			if !ok {
				continue
			}

			metadata, ok := pod["metadata"].(map[string]interface{})
			if !ok {
				continue
			}

			podName, ok := metadata["name"].(string)
			if !ok {
				continue
			}

			newNodes = append(newNodes, NodeInfo{Name: podName, IP: podIP})

			// Initialize stats for new nodes if not present
			if _, exists := stats.NodesSent[podIP]; !exists {
				newNodesSent[podIP] = 0
				newNodesRecv[podIP] = 0
			} else {
				newNodesSent[podIP] = stats.NodesSent[podIP]
				newNodesRecv[podIP] = stats.NodesRecv[podIP]
			}
		}

		nodesMutex.Lock()
		nodes = newNodes
		nodesMutex.Unlock()

		statsMutex.Lock()
		stats.NodesSent = newNodesSent
		stats.NodesRecv = newNodesRecv
		statsMutex.Unlock()
	}
}

func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

func getPodName(nodeIP string) (string, error) {
	cmd := exec.Command("kubectl", "get", "pods", "-n", "kube-system",
		"-l", "app=node-daemon", "-o", "json")
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}

	var result map[string]interface{}
	if err := json.Unmarshal(output, &result); err != nil {
		return "", err
	}

	items, ok := result["items"].([]interface{})
	if !ok || len(items) == 0 {
		return "", fmt.Errorf("no pods found")
	}

	for _, item := range items {
		pod := item.(map[string]interface{})
		status := pod["status"].(map[string]interface{})
		podIP := status["podIP"].(string)

		if podIP == nodeIP {
			metadata := pod["metadata"].(map[string]interface{})
			return metadata["name"].(string), nil
		}
	}

	return "", fmt.Errorf("pod not found for IP %s", nodeIP)
}

func sendMessageHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		SenderIP string                 `json:"sender_ip"`
		Type     string                 `json:"type"`
		Event    string                 `json:"event"`
		Targets  []string               `json:"targets"`
		Payload  map[string]interface{} `json:"payload"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Get pod name for sender
	podName, err := getPodName(req.SenderIP)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get pod: %v", err), http.StatusInternalServerError)
		return
	}

	// Build message
	message := map[string]interface{}{
		"event":   req.Event,
		"type":    req.Type,
		"targets": req.Targets,
		"payload": req.Payload,
	}

	messageJSON, _ := json.Marshal(message)

	// Determine endpoint
	endpoint := "/broadcast"
	if req.Type == "UNICAST" {
		endpoint = "/unicast"
	} else if req.Type == "MULTICAST" {
		endpoint = "/multicast"
	}

	// Execute kubectl command
	url := fmt.Sprintf("http://%s:8080%s", req.SenderIP, endpoint)
	cmdStr := fmt.Sprintf(
		`wget --post-data='%s' --header="Content-Type: application/json" -O - %s 2>/dev/null`,
		string(messageJSON), url,
	)

	cmd := exec.Command("kubectl", "exec", "-it", podName, "-n", "kube-system", "--", "sh", "-c", cmdStr)
	output, err := cmd.CombinedOutput()

	if err != nil {
		log.Printf("Command failed: %v, Output: %s", err, string(output))
		http.Error(w, fmt.Sprintf("Failed to send: %v", err), http.StatusInternalServerError)
		return
	}

	// Update stats
	statsMutex.Lock()
	stats.Total++
	stats.NodesSent[req.SenderIP]++

	switch req.Type {
	case "BROADCAST":
		stats.Broadcast++
	case "UNICAST":
		stats.Unicast++
	case "MULTICAST":
		stats.Multicast++
	}
	statsMutex.Unlock()

	// Add log entry
	logsMutex.Lock()
	logs = append([]LogEntry{{
		Timestamp: time.Now().Format("2006-01-02 15:04:05"),
		Node:      podName,
		NodeIP:    req.SenderIP,
		Type:      req.Type,
		Event:     req.Event,
		Message:   fmt.Sprintf("Sent %s", req.Event),
		Targets:   strings.Join(req.Targets, ", "),
	}}, logs...)

	// Keep only last 100 logs
	if len(logs) > 100 {
		logs = logs[:100]
	}
	logsMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Message sent successfully",
		"output":  string(output),
	})
}

func getLogsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	logsMutex.RLock()
	defer logsMutex.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(logs)
}

func getStatsHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	statsMutex.RLock()
	defer statsMutex.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func getNodesHandler(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	nodesMutex.RLock()
	defer nodesMutex.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(nodes)
}

func fetchPodLogs() {
	// This function periodically fetches logs from pods and parses them
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		cmd := exec.Command("kubectl", "get", "pods", "-n", "kube-system",
			"-l", "app=node-daemon", "-o", "name")
		output, err := cmd.Output()
		if err != nil {
			log.Printf("Failed to get pods: %v", err)
			continue
		}

		pods := strings.Split(strings.TrimSpace(string(output)), "\n")

		for _, pod := range pods {
			podName := strings.TrimPrefix(pod, "pod/")
			if podName == "" {
				continue
			}

			// Get recent logs
			logCmd := exec.Command("kubectl", "logs", "--tail=10", "-n", "kube-system", podName)
			logOutput, err := logCmd.Output()
			if err != nil {
				continue
			}

			// Parse logs and update stats
			lines := strings.Split(string(logOutput), "\n")
			for _, line := range lines {
				if strings.Contains(line, "📥 RECEIVED") {
					// Update receive stats
					// Parse node IP from the log
					// This is a simplified parser
				}
			}
		}
	}
}

func main() {
	// Start background services
	go refreshNodeList()
	go fetchPodLogs()

	// Serve static files from client directory
	fs := http.FileServer(http.Dir("./client"))
	http.Handle("/", fs)

	// API endpoints
	http.HandleFunc("/api/send", sendMessageHandler)
	http.HandleFunc("/api/logs", getLogsHandler)
	http.HandleFunc("/api/stats", getStatsHandler)
	http.HandleFunc("/api/nodes", getNodesHandler)

	addr := ":8000"
	log.Printf("Dashboard server starting on %s", addr)
	log.Printf("Serving files from ./client directory")
	log.Printf("Open http://localhost:8000 in your browser")

	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatal(err)
	}
}
