# 🎨 P2P Node Dashboard - Setup Guide

A real-time web dashboard to visualize and control node-to-node communication in your Kubernetes cluster.

## 📸 Features

- **Real-time Communication Visualization** - See messages flowing between nodes
- **Interactive Controls** - Send BROADCAST, UNICAST, and MULTICAST messages
- **Live Statistics** - Track message counts and node activity
- **Clean UI** - Modern, responsive interface with animations
- **Direct Kubernetes Integration** - Sends real messages to your cluster

---

## 🚀 Quick Start

### 1. Start the Dashboard Server

The dashboard server acts as a bridge between the web UI and your Kubernetes cluster.

```bash
cd /home/kavishka/Documents/p2p-go
go run dashboard-server.go
```

Expected output:
```
Dashboard server starting on :8000
Open http://localhost:8000 in your browser
```

### 2. Open Dashboard in Browser

Open your web browser and navigate to:
```
http://localhost:8000
```

You should see the P2P Node Dashboard with:
- 3 nodes displayed (Worker 1, Control Plane, Worker 2)
- Message controls
- Live statistics
- Communication logs

### 3. Send a Test Message

**Broadcast Example:**
1. Select **Sender Node**: Worker 1 (172.18.0.2)
2. Select **Event Type**: DISCOVERY
3. Keep default payload or modify it
4. Click **📡 Broadcast**
5. Watch the message flow to both other nodes!

**Unicast Example:**
1. Select **Sender Node**: Worker 1 (172.18.0.2)
2. Select **Event Type**: STATE_UPDATE
3. Check **ONE** target (e.g., Control Plane)
4. Click **📤 Unicast**
5. Only Control Plane will receive the message

**Multicast Example:**
1. Select **Sender Node**: Control Plane (172.18.0.3)
2. Select **Event Type**: METRIC_UPDATE
3. Check **MULTIPLE** targets (e.g., both workers)
4. Click **📮 Multicast**
5. Both selected nodes receive the message

---

## 📋 Dashboard Components

### Top Bar
- **Node Status**: Shows 3 nodes online
- **Message Counter**: Total messages sent
- **Auto-refresh Toggle**: Automatically updates stats every 5 seconds

### Node Cards
Each node card displays:
- Node name and IP address
- Messages sent count
- Messages received count
- Visual highlight when sending/receiving

### Control Panel
- **Sender Node**: Choose which node sends the message
- **Event Type**: Select message type (DISCOVERY, STATE_UPDATE, etc.)
- **Target Nodes**: Select recipients (for Unicast/Multicast)
- **Message Payload**: JSON data to send
- **Action Buttons**: Send via Broadcast, Unicast, or Multicast

### Statistics Panel
Real-time counters for:
- Total broadcasts sent
- Total unicasts sent
- Total multicasts sent
- Overall message count

### Logs Panel
Shows chronological log of:
- Messages sent (with sender and type)
- Messages received (simulated based on type)
- Success/error notifications
- Color-coded by message type

---

## 🔧 How It Works

### Architecture

```
┌─────────────────┐
│   Web Browser   │
│  (Dashboard UI) │
└────────┬────────┘
         │ HTTP POST /api/send
         ▼
┌─────────────────┐
│  Go HTTP Server │
│ dashboard-server│
└────────┬────────┘
         │ kubectl exec
         ▼
┌─────────────────┐
│  Kubernetes Pod │
│  (node-daemon)  │
└────────┬────────┘
         │ HTTP POST /broadcast|unicast|multicast
         ▼
┌─────────────────┐
│  Peer Nodes     │
│  (receive msgs) │
└─────────────────┘
```

### Flow

1. **User clicks button** → Dashboard sends JSON to `/api/send`
2. **Server receives request** → Builds kubectl command
3. **kubectl exec** → Runs wget inside target pod
4. **Pod sends message** → HTTP POST to /broadcast, /unicast, or /multicast endpoint
5. **Daemon forwards** → Sends to peer nodes based on type
6. **Peers receive** → Log the incoming message
7. **Dashboard updates** → Shows activity and statistics

---

## 🎯 Example Payloads

### Simple Discovery
```json
{
  "msg": "Hello from dashboard",
  "timestamp": "2025-12-10"
}
```

### State Update
```json
{
  "state": "healthy",
  "cpu": 45.2,
  "memory": 62.1,
  "uptime": 3600
}
```

### Metric Update
```json
{
  "node_id": "worker-1",
  "metrics": {
    "cpu_usage": 45.2,
    "memory_usage": 62.1,
    "disk_usage": 73.5
  },
  "collected_at": "2025-12-10T12:00:00Z"
}
```

### Scheduling Request
```json
{
  "task_id": "task-001",
  "priority": "high",
  "resources": {
    "cpu": 2,
    "memory": "4Gi"
  },
  "deadline": 1765311535
}
```

---

## 🔍 Monitoring Real Messages

To verify messages are actually sent to the cluster, open a terminal and watch the pod logs:

```bash
# Watch all daemon logs in real-time
kubectl logs -f -l app=node-daemon -n kube-system --all-containers=true
```

When you send a message from the dashboard, you'll see output like:

```
📤 BROADCASTING from p2p-worker (172.18.0.2):
{
  "event": "DISCOVERY",
  "type": "BROADCAST",
  "payload": {"msg": "Hello from dashboard"}
}
Sent to node 172.18.0.3
Sent to node 172.18.0.4

📥 RECEIVED on p2p-control-plane (172.18.0.3):
{
  "event": "DISCOVERY",
  "type": "BROADCAST",
  "sender": "p2p-worker",
  "sender_ip": "172.18.0.2",
  "payload": {"msg": "Hello from dashboard"}
}
```

---

## 🛠️ Troubleshooting

### Dashboard won't start
```bash
# Check if port 8000 is already in use
lsof -i :8000

# Kill existing process if needed
kill -9 <PID>
```

### Can't send messages
```bash
# Verify kubectl is working
kubectl get pods -n kube-system -l app=node-daemon

# Verify pods are running
NAME                READY   STATUS    RESTARTS   AGE
node-daemon-xxxxx   1/1     Running   0          10m
node-daemon-yyyyy   1/1     Running   0          10m
node-daemon-zzzzz   1/1     Running   0          10m
```

### Messages not reaching pods
```bash
# Check if daemons are listening on port 8080
kubectl exec -it <pod-name> -n kube-system -- netstat -tlnp | grep 8080

# Test locally from within pod
kubectl exec -it <pod-name> -n kube-system -- sh -c \
  'wget -O - http://172.18.0.2:8080/receive 2>/dev/null'
```

### Browser shows "Failed to fetch"
- Make sure the dashboard server is running (`go run dashboard-server.go`)
- Check browser console for detailed error messages
- Verify you're accessing `http://localhost:8000` (not a different port)

---

## 📊 Advanced Usage

### Custom Message Types

You can create custom event types by editing the dropdown in `dashboard.html`:

```html
<select id="eventType">
    <option value="DISCOVERY">DISCOVERY</option>
    <option value="STATE_UPDATE">STATE_UPDATE</option>
    <option value="CUSTOM_EVENT">CUSTOM_EVENT</option> <!-- Add this -->
</select>
```

### Modify Refresh Interval

In `dashboard.html`, find the `setInterval` call:

```javascript
// Change from 5000ms (5 seconds) to 2000ms (2 seconds)
setInterval(() => {
    if (document.getElementById('autoRefresh').checked) {
        fetchStats();
    }
}, 2000); // <-- Change this value
```

### Add More Nodes

If you scale your cluster to more than 3 nodes:

1. Update the HTML to add more node cards
2. Update the JavaScript to include new IPs
3. Update `dashboard-server.go` to recognize new nodes

---

## 🎨 Customization

### Change Color Scheme

Edit the CSS gradient in `dashboard.html`:

```css
body {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    /* Change to your preferred colors */
}
```

### Modify Node Colors

```css
.node {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    /* Customize node card appearance */
}
```

---

## 📚 File Structure

```
p2p-go/
├── dashboard.html          # Frontend web interface
├── dashboard-server.go     # Backend API server
├── main.go                 # Node daemon source
├── daemonset.yaml          # Kubernetes deployment
├── peers-configmap.yaml    # Peer configuration
└── README.md               # Project documentation
```

---

## 🎉 Tips & Tricks

1. **Use Chrome DevTools** - Open Network tab to see API calls in real-time
2. **Monitor kubectl** - Keep `kubectl logs -f` running in another terminal
3. **Test scenarios** - Try different combinations of sender/receiver
4. **Watch animations** - Nodes glow when sending/receiving messages
5. **Check stats** - Statistics update automatically with auto-refresh enabled

---

## 🚀 Next Steps

Once you're comfortable with the dashboard:

1. **Implement state sync** - Use BROADCAST for periodic heartbeats
2. **Build leader election** - Use UNICAST for voting
3. **Create task distribution** - Use MULTICAST to assign work
4. **Add monitoring** - Integrate with Prometheus/Grafana
5. **Enable TLS** - Secure inter-node communication

---

## 📞 Support

If you encounter issues:

1. Check the browser console for errors
2. Check the server logs from `go run dashboard-server.go`
3. Verify pods are running: `kubectl get pods -n kube-system -l app=node-daemon`
4. Check pod logs: `kubectl logs -n kube-system <pod-name>`

---

**Enjoy your real-time P2P communication dashboard! 🎊**
