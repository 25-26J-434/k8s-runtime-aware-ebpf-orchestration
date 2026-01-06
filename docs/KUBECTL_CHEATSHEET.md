# Kubectl Cheatsheet - Kind Cluster & Component 4 Deployment

## KIND Cluster Setup

### Create/Recreate Cluster
```bash
# Create 4-node cluster (1 control-plane + 3 workers)
kind create cluster --name ebpf-cluster --config k8s/kind-config.yaml

# Delete cluster
kind delete cluster --name ebpf-cluster

# List all Kind clusters
kind get clusters
```

### Inspect Cluster
```bash
# Get cluster info
kubectl cluster-info
kubectl cluster-info dump

# Get nodes
kubectl get nodes
kubectl get nodes -o wide
kubectl describe nodes

# Get node IPs
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.addresses[?(@.type=="InternalIP")].address}{"\n"}{end}'
```

---

## Namespace & RBAC

### Manage Namespaces
```bash
# Create namespace
kubectl create namespace ebpf-telemetry
kubectl apply -f k8s/namespace.yaml

# List namespaces
kubectl get namespaces

# Use namespace by default
kubectl config set-context --current --namespace=ebpf-telemetry

# Get current namespace
kubectl config view --minify | grep namespace
```

---

## Component 4 - Node Communication Deployment

### Deploy Component 4
```bash
# Deploy peers ConfigMap
kubectl apply -f component-4-node-communication/peers-configmap.yaml

# Deploy DaemonSet
kubectl apply -f component-4-node-communication/daemonset.yaml

# Deploy all resources
kubectl apply -f component-4-node-communication/

# Or use Makefile
cd component-4-node-communication
make deploy
```

### Update Peers ConfigMap Dynamically
```bash
# Auto-discover and update peers from live nodes
bash component-4-node-communication/update-peers.sh

# Manual: Collect node IPs
kubectl get nodes -o jsonpath='{range .items[*]}{.status.addresses[?(@.type=="InternalIP")].address}{"\n"}{end}' > /tmp/peers.txt

# Create/update ConfigMap
kubectl -n kube-system delete configmap node-daemon-peers 2>/dev/null || true
kubectl -n kube-system create configmap node-daemon-peers --from-file=peers.txt=/tmp/peers.txt

# View ConfigMap
kubectl -n kube-system get configmap node-daemon-peers -o yaml
```

---

## Pod & Container Management

### List & Inspect Pods
```bash
# List all pods in namespace
kubectl get pods
kubectl get pods -n kube-system
kubectl get pods -A (all namespaces)

# Detailed pod info
kubectl get pods -o wide
kubectl describe pod <pod-name>
kubectl describe pods -l app=node-communication-daemon

# Get pod IPs
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.podIP}{"\n"}{end}'
```

### Access Pods
```bash
# Execute command in pod
kubectl exec -it <pod-name> -- /bin/bash
kubectl exec -it <pod-name> -c <container-name> -- bash

# View logs
kubectl logs <pod-name>
kubectl logs <pod-name> -f (follow)
kubectl logs <pod-name> -n kube-system
kubectl logs -l app=node-communication-daemon -n kube-system

# Copy files
kubectl cp <pod-name>:/path/in/pod /path/on/host
kubectl cp /local/file <pod-name>:/path/in/pod
```

### Port Forward & Debug
```bash
# Port forward
kubectl port-forward pod/<pod-name> 8080:8080
kubectl port-forward svc/<service-name> 8080:8080

# Run debug pod
kubectl run -it --rm debug --image=busybox --restart=Never -- sh

# Execute in running pod
kubectl exec -it <pod-name> -- curl http://localhost:8080/health
```

---

## DaemonSet & Deployment Management

### DaemonSet Operations
```bash
# Get daemonsets
kubectl get daemonsets -n kube-system
kubectl describe daemonset node-communication-daemon -n kube-system

# Restart daemonset
kubectl rollout restart daemonset/node-communication-daemon -n kube-system

# View rollout status
kubectl rollout status daemonset/node-communication-daemon -n kube-system

# Check pod distribution
kubectl get pods -l app=node-communication-daemon -n kube-system -o wide
```

### Deployment Operations
```bash
# Get deployments
kubectl get deployments -n ebpf-telemetry

# Restart deployment
kubectl rollout restart deployment/dashboard -n ebpf-telemetry

# View rollout history
kubectl rollout history deployment/dashboard -n ebpf-telemetry

# Rollback to previous version
kubectl rollout undo deployment/dashboard -n ebpf-telemetry
```

---

## Services & Networking

### Service Management
```bash
# List services
kubectl get svc
kubectl get svc -n ebpf-telemetry
kubectl get svc -A

# Get service details
kubectl describe svc <service-name>

# Get service endpoints
kubectl get endpoints
kubectl get endpoints <service-name> -o jsonpath='{.subsets[*].addresses[*].targetRef.name}'
```

### Port Forwarding to Services
```bash
# Forward to service
kubectl port-forward svc/dashboard 3000:3000 -n ebpf-telemetry

# Access NodePort (Kind exposes via localhost)
http://localhost:30000 (if NodePort 30000 is configured)
```

### Test Connectivity Between Pods
```bash
# DNS resolution
kubectl run -it --rm debug --image=busybox --restart=Never -- nslookup kubernetes.default

# Curl service within cluster
kubectl exec -it <pod-name> -- curl http://service-name:port

# Curl peer node daemon
kubectl exec -it <pod-name> -n kube-system -- curl http://<peer-ip>:30080/health
```

---

## ConfigMaps & Secrets

### ConfigMap Management
```bash
# Create ConfigMap from file
kubectl create configmap my-config --from-file=config.txt
kubectl create configmap peers --from-file=peers.txt=/tmp/peers.txt

# View ConfigMap
kubectl get configmap
kubectl get configmap node-daemon-peers -n kube-system -o yaml

# Edit ConfigMap
kubectl edit configmap node-daemon-peers -n kube-system

# Delete ConfigMap
kubectl delete configmap node-daemon-peers -n kube-system
```

### Secrets (if needed)
```bash
# Create secret
kubectl create secret generic db-creds --from-literal=password=secret123

# View secrets
kubectl get secrets
kubectl get secret <secret-name> -o yaml
```

---

## Resource Viewing & Debugging

### Get Resource YAML
```bash
# Get resource definition
kubectl get pod <pod-name> -o yaml
kubectl get daemonset node-communication-daemon -n kube-system -o yaml
kubectl get configmap node-daemon-peers -n kube-system -o yaml

# Export resource
kubectl get daemonset node-communication-daemon -n kube-system -o yaml > daemonset-backup.yaml
```

### Events & Troubleshooting
```bash
# View events
kubectl get events
kubectl get events -n kube-system
kubectl get events --all-namespaces --sort-by='.lastTimestamp'

# Check resource status
kubectl status pod <pod-name>

# Describe for debugging
kubectl describe pod <pod-name> -n kube-system
kubectl describe node <node-name>
```

### Resource Usage
```bash
# Resource metrics (requires metrics-server)
kubectl top nodes
kubectl top pods
kubectl top pods -n kube-system

# Get resource requests/limits
kubectl get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].resources}{"\n"}{end}'
```

---

## Context & Configuration

### Manage Contexts
```bash
# View current context
kubectl config current-context

# List all contexts
kubectl config get-contexts

# Switch context
kubectl config use-context kind-ebpf-cluster

# View kubeconfig
kubectl config view
```

### Apply & Delete Resources
```bash
# Apply resource
kubectl apply -f file.yaml
kubectl apply -f directory/
kubectl apply -k . (kustomize)

# Delete resource
kubectl delete -f file.yaml
kubectl delete pod <pod-name>
kubectl delete deployment <deployment-name>

# Dry run (preview)
kubectl apply -f file.yaml --dry-run=client
kubectl delete pod <pod-name> --dry-run=client
```

---

## Useful One-Liners

```bash
# Get all resources in namespace
kubectl get all -n ebpf-telemetry

# Delete all pods in namespace (restart them)
kubectl delete pods --all -n kube-system

# Scale deployment
kubectl scale deployment dashboard --replicas=3 -n ebpf-telemetry

# Get pod on specific node
kubectl get pods --field-selector spec.nodeName=<node-name>

# Get pods not in Running state
kubectl get pods --field-selector=status.phase!=Running

# Find pod by label
kubectl get pods -l app=node-communication-daemon

# Tail logs from all pods
kubectl logs -l app=node-communication-daemon -n kube-system -f --all-containers

# Watch resources in real-time
kubectl get pods -n kube-system -w

# Get CPU/Memory requests
kubectl get pods -o json | jq '.items[] | {name: .metadata.name, cpu: .spec.containers[0].resources.requests.cpu}'

# Execute command on all pods with label
kubectl get pods -l app=daemon -o name | xargs -I {} kubectl exec {} -- ps aux

# Get all events sorted by timestamp
kubectl get events --all-namespaces --sort-by='.lastTimestamp'

# Clean up evicted/completed pods
kubectl delete pods --field-selector status.phase=Failed,status.phase=Succeeded -n kube-system
```

---

## Component 4 Specific Workflow

### Full Deploy Pipeline
```bash
# 1. Create cluster
kind create cluster --name ebpf-cluster --config k8s/kind-config.yaml

# 2. Verify nodes
kubectl get nodes -o wide

# 3. Create namespace (if needed)
kubectl create namespace ebpf-telemetry

# 4. Deploy peers ConfigMap & DaemonSet
bash component-4-node-communication/update-peers.sh
kubectl apply -f component-4-node-communication/daemonset.yaml

# 5. Wait for pods
kubectl rollout status daemonset/node-communication-daemon -n kube-system

# 6. Verify pod distribution (one per node)
kubectl get pods -l app=node-communication-daemon -n kube-system -o wide

# 7. Test inter-node communication
POD=$(kubectl -n kube-system get pods -l app=node-communication-daemon -o jsonpath='{.items[0].metadata.name}')
PEER_IP=$(kubectl get nodes -o jsonpath='{.items[1].status.addresses[?(@.type=="InternalIP")].address}')
kubectl -n kube-system exec -it "$POD" -- curl -s http://$PEER_IP:30080/health

# 8. View logs
kubectl logs -l app=node-communication-daemon -n kube-system -f

# 9. Cleanup
kind delete cluster --name ebpf-cluster
```

---

## Tips & Tricks

- Use `alias k=kubectl` to save typing
- Add `--dry-run=client -o yaml` to preview what will be applied
- Use `kubectl explain <resource>` to get documentation (e.g., `kubectl explain pod.spec.containers`)
- Use `--watch` / `-w` flag on `get` commands for real-time updates
- Use labels (`-l`) and selectors to group and manage resources efficiently
- Always specify namespace with `-n` to avoid accidental operations in default namespace
- Use `kubectl api-resources` to list all available resource types
- Check `kubectl auth can-i <verb> <resource>` to verify permissions
