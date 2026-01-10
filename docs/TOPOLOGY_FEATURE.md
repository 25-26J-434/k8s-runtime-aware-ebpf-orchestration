# 🌐 Network Topology Feature - Interactive Pod Management

## Overview
A real-time, interactive network topology visualization that allows you to **view AND control** your Kubernetes pods directly from the dashboard.

## Features Implemented

### 1. **Live Network Topology Graph** ✅
- Real-time visualization of pod connections
- Physics-based layout (nodes repel each other, attract to center)
- Animated data flow particles showing traffic between pods
- Color-coded health status:
  - 🟢 **Green**: Healthy (latency < 5ms)
  - 🟡 **Yellow**: Warning (5ms < latency < 10ms, or minor issues)
  - 🔴 **Red**: Critical (latency > 10ms, or TCP issues)

### 2. **Interactive Controls** ✅
- **Click** on any pod to see detailed metrics
- **Hover** to see pod name
- **Pause/Resume** animation
- **Filter** by namespace or health status
- **Export** capability (ready for implementation)
- **Fullscreen** mode (ready for implementation)

### 3. **Pod Action Panel** ✅
When you click on a pod, you can perform real actions:

#### Available Actions:
1. **Restart Pod** 🔄
   - Deletes the pod (Kubernetes recreates it)
   - Use when: Pod is misbehaving or needs a fresh start

2. **Scale Deployment** ⚡
   - Scales the deployment to specified replicas
   - Use when: Need more/fewer instances

3. **Isolate Pod** 🚫
   - Creates network policy to isolate the pod
   - Use when: Security incident or debugging

4. **Health Check** ✅
   - Performs comprehensive health check
   - Returns: Pod status, conditions, container status
   - Use when: Investigating issues

5. **Download Logs** 📥
   - Fetches last 50 lines of pod logs
   - Use when: Debugging or troubleshooting

### 4. **Real-time Metrics Display** ✅
Each selected pod shows:
- Health status badge
- DNS latency
- TCP retransmissions
- Packet loss count

### 5. **Action Log** ✅
- Real-time log of actions performed
- Shows success/failure status
- Displays API response data

## Backend API Endpoints

### POST `/api/pod/action`
Performs actions on pods.

**Request Body:**
```json
{
  "action": "restart|scale|isolate|health|logs",
  "namespace": "pod-namespace",
  "pod_name": "pod-name",
  "replicas": 2  // Optional, for scale action
}
```

**Response:**
```json
{
  "success": true,
  "message": "Action completed successfully",
  "data": {}  // Optional additional data
}
```

## How to Use

### 1. Access the Topology Page
```
http://localhost:5000/topology
```

### 2. Navigate to Topology
Click "Topology" in the navigation menu (between Dashboard and Routing)

### 3. Interact with the Graph
- **View pods**: They appear as colored circles
- **See connections**: Lines between pods show relationships
- **Watch traffic**: Animated particles flow along connections
- **Hover**: See pod names
- **Click**: Open action panel

### 4. Perform Actions
1. Click on any pod
2. Select an action from the right panel
3. Watch the action log for results

### 5. Filter and Control
- Use filters to show specific namespaces or health statuses
- Pause animation to freeze the view
- Resume to continue live updates

## File Structure

### Frontend Files
```
frontend/src/
├── components/
│   ├── NetworkTopology.tsx      # Main topology component
│   └── NetworkTopology.css      # Styling
├── pages/
│   └── Topology.tsx             # Topology page wrapper
└── App.tsx                       # Added /topology route
```

### Backend Files
```
daemon/pkg/api/
├── pod_actions.go                # Pod action handlers
└── api.go                        # Added /api/pod/action endpoint
```

## Architecture

### Frontend
```
NetworkTopology Component
├── Canvas rendering (800x600)
├── Physics simulation (60fps)
├── Node management
├── Connection tracking
└── NodeActionPanel
    ├── Metrics display
    ├── Action buttons
    └── Action log
```

### Backend
```
API Handler (pod_actions.go)
├── handleRestartPod()        - Deletes pod
├── handleScaleDeployment()   - Scales deployment
├── handleIsolatePod()        - Creates network policy
├── handleHealthCheck()       - Returns pod health
└── handleGetLogs()           - Fetches pod logs
```

## Permissions Required

The daemon needs these Kubernetes RBAC permissions:
- `get`, `list`, `watch` on pods
- `delete` on pods (for restart)
- `get`, `update` on deployments (for scale)
- `create` on network policies (for isolate)
- `get` logs from pods

These should already be configured in your `k8s/daemonset.yaml`.

## Demo Workflow

1. **Start your cluster and services**
   ```bash
   ./rebuild-and-start.sh
   ```

2. **Navigate to Topology**
   - Open http://localhost:5000/topology

3. **Explore the graph**
   - See all your pods visualized
   - Watch the animated connections

4. **Try an action**
   - Click on a pod
   - Click "Health Check"
   - See detailed health info in the log

5. **Restart a pod**
   - Click on a pod
   - Click "Restart Pod"
   - Watch it disappear and recreate

## Future Enhancements (Easy to add)

### Short term:
- [ ] Pod-to-pod traffic volume (line thickness)
- [ ] Click connections to see traffic details
- [ ] Search/find specific pods
- [ ] Save/load topology layouts
- [ ] Compare metrics between pods

### Medium term:
- [ ] Service mesh visualization
- [ ] Real-time alerts on topology
- [ ] Trace packet paths
- [ ] Historical playback
- [ ] Custom action scripts

### Advanced:
- [ ] 3D topology view
- [ ] Multi-cluster topology
- [ ] AI-powered anomaly detection
- [ ] Automated remediation workflows

## Troubleshooting

### Pod actions fail with "Kubernetes client not initialized"
**Solution**: Check if the daemon has proper RBAC permissions and can connect to the K8s API.

### Topology shows no pods
**Solution**: Make sure you have pods running with eBPF metrics. Deploy test pods:
```bash
kubectl apply -f k8s/simple-test-pods.yaml
```

### Actions succeed but nothing happens
**Solution**: Some pods (like DaemonSets) are immediately recreated. Check `kubectl get pods -A` to verify.

### Can't see connections
**Solution**: Connections are simulated based on namespace and random factors. In future versions, this will use actual eBPF connection tracking data.

## Technical Details

### Physics Simulation
- Uses velocity-based physics
- Center attraction force: `0.0001`
- Node repulsion: `0.5` at distance < 150px
- Damping factor: `0.9`
- Bounded to canvas: `50px to 750px (x), 50px to 550px (y)`

### Performance
- Canvas rendering: 60fps
- Node updates: Real-time from metrics API (3s interval)
- Physics: RequestAnimationFrame loop
- No heavy libraries required

### Connection Algorithm
Currently connects pods that:
1. Are in the same namespace (guaranteed)
2. Or have 30% random connection probability

In production, this should use real eBPF connection tracking data.

## Summary

You now have a **fully interactive network topology viewer** that goes beyond just displaying data - you can actually **control your cluster** through it! This is a significant step towards runtime-aware orchestration with a modern, intuitive interface.

Next steps for your research:
1. Connect the topology to real eBPF connection data
2. Add automated remediation based on health thresholds
3. Implement service mesh visualization
4. Build intelligent routing decisions based on topology + metrics

Enjoy exploring your cluster! 🚀


