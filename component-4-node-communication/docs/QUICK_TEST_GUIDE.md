# Quick Test Guide - Node-to-Node Communication

## 🎯 Quick Commands

### Get Pod Names and IPs
```bash
kubectl get pods -n kube-system -l app=node-daemon -o wide
```

### 1️⃣ Test BROADCAST (send to all nodes)

From **Worker**:
```bash
POD_WORKER=$(kubectl get pods -n kube-system -l app=node-daemon -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it $POD_WORKER -n kube-system -- sh -c \
  'wget --post-data="{\"event\":\"DISCOVERY\",\"type\":\"BROADCAST\",\"payload\":{\"msg\":\"Hello from worker\"}}" \
  --header="Content-Type: application/json" -O - http://172.18.0.2:8080/broadcast 2>/dev/null'
```

Check logs:
```bash
kubectl logs -n kube-system -l app=node-daemon -f --all-containers=true
```

### 2️⃣ Test UNICAST (send to one node)

From **Worker** to **Control-Plane**:
```bash
POD_WORKER=$(kubectl get pods -n kube-system -l app=node-daemon -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it $POD_WORKER -n kube-system -- sh -c \
  'wget --post-data="{\"event\":\"DISCOVERY\",\"type\":\"UNICAST\",\"targets\":[\"172.18.0.3\"],\"payload\":{\"msg\":\"Hello control-plane\"}}" \
  --header="Content-Type: application/json" -O - http://172.18.0.2:8080/unicast 2>/dev/null'
```

### 3️⃣ Test MULTICAST (send to multiple nodes)

From **Control-Plane** to **both workers**:
```bash
POD_CP=$(kubectl get pods -n kube-system -l app=node-daemon -o jsonpath='{.items[2].metadata.name}')
kubectl exec -it $POD_CP -n kube-system -- sh -c \
  'wget --post-data="{\"event\":\"STATE_UPDATE\",\"type\":\"MULTICAST\",\"targets\":[\"172.18.0.2\",\"172.18.0.4\"],\"payload\":{\"msg\":\"Update from control-plane\"}}" \
  --header="Content-Type: application/json" -O - http://172.18.0.3:8080/multicast 2>/dev/null'
```

---

## 📋 Available Events

```
DISCOVERY      - Peer discovery announcement
STATE_UPDATE   - Node state change notification
METRIC_UPDATE  - Performance metrics update
HANDSHAKE      - Initial node handshake
SCHEDULING     - Task scheduling request
ERROR          - Error notification
```

## 📋 Available Actions

```
NONE           - No action required
UPDATE_STATE   - Receiver should update internal state
REROUTE        - Receiver should reroute traffic/tasks
```

---

## 🔍 Verify All Pods Have Correct Peers

```bash
kubectl exec -it $(kubectl get pods -n kube-system -l app=node-daemon -o jsonpath='{.items[0].metadata.name}') -n kube-system -- cat /etc/node-daemon/peers.txt
kubectl exec -it $(kubectl get pods -n kube-system -l app=node-daemon -o jsonpath='{.items[1].metadata.name}') -n kube-system -- cat /etc/node-daemon/peers.txt
kubectl exec -it $(kubectl get pods -n kube-system -l app=node-daemon -o jsonpath='{.items[2].metadata.name}') -n kube-system -- cat /etc/node-daemon/peers.txt
```

**Expected Output (all three should show):**
```
172.18.0.2
172.18.0.3
172.18.0.4
```

---

## 📊 Check Node IPs

```bash
kubectl get nodes -o wide | awk '{print $1, $6}'
```

**Typical output:**
```
NAME                 INTERNAL-IP
p2p-control-plane    172.18.0.3
p2p-worker           172.18.0.2
p2p-worker2          172.18.0.4
```

---

## 🛠️ Troubleshooting

### Logs not showing messages?
1. Check peer list: `cat /etc/node-daemon/peers.txt` (in pod)
2. Verify correct IP in send command
3. Check pod is running: `kubectl get pods -n kube-system -l app=node-daemon`
4. View logs: `kubectl logs -n kube-system <pod-name>`

### Connection refused?
1. Ensure target pod is running and has correct IP
2. Check peers.txt contains the target IP
3. Verify port 8080 is not blocked

### 172.18.0.x addresses not working?
- These are internal Kind cluster IPs
- Make sure you're sending from inside a pod or using Kind network
- For external testing, use port-forward:
  ```bash
  kubectl port-forward -n kube-system <pod-name> 8080:8080
  ```

---

## 📝 Full Message Example

```json
{
  "event": "DISCOVERY",
  "type": "BROADCAST",
  "sender": "p2p-worker",
  "sender_ip": "172.18.0.2",
  "targets": null,
  "payload": {
    "msg": "Hello all nodes",
    "node_status": "healthy",
    "metrics": {"cpu": 45, "memory": 62}
  },
  "timestamp": 1765307935,
  "action": "UPDATE_STATE"
}
```

---

## 🎯 Testing Workflow

1. **Deploy**: `kubectl apply -f peers-configmap.yaml && kubectl apply -f daemonset.yaml`
2. **Wait**: `kubectl wait --for=condition=ready pod -l app=node-daemon -n kube-system --timeout=30s`
3. **Test Broadcast**: Send from one node, verify all receive
4. **Test Unicast**: Send to specific node, verify others don't receive
5. **Test Multicast**: Send to subset of nodes, verify only targets receive
6. **Monitor**: Watch logs continuously: `kubectl logs -f -l app=node-daemon -n kube-system --all-containers=true`

---

## 🚀 Using Custom Payloads

You can add any custom fields to the `payload` object:

```bash
curl -X POST http://172.18.0.2:8080/broadcast \
  -H "Content-Type: application/json" \
  -d '{
    "event": "STATE_UPDATE",
    "type": "BROADCAST",
    "payload": {
      "node_status": "healthy",
      "cpu_usage": 45.2,
      "memory_usage": 62.1,
      "active_tasks": 3,
      "last_heartbeat": 1765307935
    }
  }'
```

The daemon will log everything for verification.

---

Made with ❤️ for distributed systems testing
