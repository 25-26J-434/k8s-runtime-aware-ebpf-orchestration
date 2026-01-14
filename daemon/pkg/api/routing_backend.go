package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/IrushiGunawardana/k8s-runtime-aware-ebpf-orchestration/daemon/pkg/redirection"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/dynamic"
)

var (
	routingStore  *redirection.Store
	routingEngine *redirection.Engine
)

func initRoutingBackend() {
	ctx := context.Background()

	store, err := redirection.InitStore(ctx)
	if err != nil {
		log.Printf("[Routing] WARNING: failed to initialize Mongo store: %v", err)
		return
	}
	routingStore = store

	var dynClient dynamic.Interface
	if cfg := GetRestConfig(); cfg != nil {
		if dyn, err := dynamic.NewForConfig(cfg); err != nil {
			log.Printf("[Routing] WARNING: dynamic client init failed: %v", err)
		} else {
			dynClient = dyn
		}
	}

	routingEngine = redirection.NewEngine(store, dynClient, GetK8sClient(), log.Default())

	ttlSweepMs, _ := strconv.Atoi(firstNonEmpty(os.Getenv("TTL_SWEEP_MS"), "30000"))
	if ttlSweepMs > 0 {
		routingEngine.StartTTLSweeper(context.Background(), time.Duration(ttlSweepMs)*time.Millisecond)
	}

	log.Printf("[Routing] Component 2 backend initialized (TTL sweep every %dms)", ttlSweepMs)
}

func handleWhoAmI(w http.ResponseWriter, _ *http.Request) {
	name := os.Getenv("SERVICE_NAME")
	if name == "" {
		name, _ = os.Hostname()
	}
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprintf(w, "Hi, I am component2-backend (%s)\n", name)
}

func handleProbe(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/probe/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "service required", http.StatusBadRequest)
		return
	}
	service := parts[0]
	portStr := firstNonEmpty(r.URL.Query().Get("port"), "5000")
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 {
		port = 5000
	}
	namespace := firstNonEmpty(r.URL.Query().Get("namespace"), "default")
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/whoami"
	}
	host := r.URL.Query().Get("host")
	if host == "" {
		host = fmt.Sprintf("%s.%s.svc.cluster.local", service, namespace)
	}

	client := http.Client{Timeout: 4 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://%s:%d%s", host, port, path))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func handlePolicies(w http.ResponseWriter, r *http.Request) {
	if routingStore == nil {
		http.Error(w, "routing backend not initialized", http.StatusServiceUnavailable)
		return
	}

	switch r.Method {
	case http.MethodGet:
		items, err := routingStore.List(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, items)
	case http.MethodPost:
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		policy, err := redirection.NormalizeCreatePayload(body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		policy.AddHistory("CREATED", "Policy created", map[string]interface{}{"policy_name": policy.PolicyName})
		created, err := routingStore.Insert(r.Context(), policy)
		if err != nil {
			http.Error(w, fmt.Sprintf("create failed: %v", err), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusCreated)
		writeJSON(w, created)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func handlePolicyByName(w http.ResponseWriter, r *http.Request) {
	if routingStore == nil {
		http.Error(w, "routing backend not initialized", http.StatusServiceUnavailable)
		return
	}

	name := strings.TrimPrefix(r.URL.Path, "/api/policies/")
	if name == "" {
		http.NotFound(w, r)
		return
	}

	switch r.Method {
	case http.MethodGet:
		p, err := routingStore.GetByName(r.Context(), name)
		if err != nil {
			if errors.Is(err, redirection.ErrNotFound) {
				http.Error(w, "Policy not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, p)
	case http.MethodPut:
		existing, err := routingStore.GetByName(r.Context(), name)
		if err != nil {
			if errors.Is(err, redirection.ErrNotFound) {
				http.Error(w, "Policy not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}

		if err := redirection.ApplyUpdatePayload(existing, body); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		existing.AddHistory("UPDATED", "Policy updated", map[string]interface{}{"policy_name": existing.PolicyName})
		if err := routingStore.Replace(r.Context(), existing); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, existing)
	case http.MethodDelete:
		policy, _ := routingStore.GetByName(r.Context(), name)
		if policy != nil && routingEngine != nil {
			_, _ = routingEngine.ExpirePolicy(r.Context(), name, "delete", true)
		}
		if err := routingStore.Delete(r.Context(), name); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]bool{"deleted": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func handlePolicyEvaluate(w http.ResponseWriter, r *http.Request) {
	if routingEngine == nil {
		http.Error(w, "routing backend not initialized", http.StatusServiceUnavailable)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/policies/"), "/evaluate")
	name = strings.TrimSuffix(name, "/")
	_, res, err := routingEngine.EvaluateAndApply(r.Context(), name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if res.StatusCode > 0 {
		w.WriteHeader(res.StatusCode)
	}
	writeJSON(w, res)
}

func handlePolicyExpire(w http.ResponseWriter, r *http.Request) {
	if routingEngine == nil {
		http.Error(w, "routing backend not initialized", http.StatusServiceUnavailable)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/policies/"), "/expire")
	name = strings.TrimSuffix(name, "/")
	if _, err := routingEngine.ExpirePolicy(r.Context(), name, "manual", true); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"message": "Expired (LRP deleted)"})
}

type clusterSummary struct {
	Cluster struct {
		Context     string `json:"context"`
		ClusterInfo string `json:"clusterInfo"`
	} `json:"cluster"`
	Nodes      []map[string]interface{} `json:"nodes"`
	Namespaces []string                 `json:"namespaces"`
	Pods       []map[string]interface{} `json:"pods"`
	Services   []map[string]interface{} `json:"services"`
}

func handleClusterSummary(w http.ResponseWriter, r *http.Request) {
	client := GetK8sClient()
	if client == nil {
		http.Error(w, "kubernetes client not initialized", http.StatusServiceUnavailable)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	onlyNs := r.URL.Query().Get("namespace")

	summary := clusterSummary{}
	cfg := GetRestConfig()
	apiHost := ""
	if cfg != nil {
		apiHost = cfg.Host
	}
	summary.Cluster.Context = firstNonEmpty(os.Getenv("KUBECONFIG"), "in-cluster")
	summary.Cluster.ClusterInfo = fmt.Sprintf("api: %s", apiHost)

	// Nodes
	nodes, err := client.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("nodes: %v", err), http.StatusInternalServerError)
		return
	}
	for _, n := range nodes.Items {
		internalIP := ""
		for _, addr := range n.Status.Addresses {
			if addr.Type == "InternalIP" {
				internalIP = addr.Address
				break
			}
		}
		roles := []string{}
		for k := range n.Labels {
			if strings.HasPrefix(k, "node-role.kubernetes.io/") {
				roles = append(roles, strings.TrimPrefix(k, "node-role.kubernetes.io/"))
			}
		}
		summary.Nodes = append(summary.Nodes, map[string]interface{}{
			"name":           n.Name,
			"labels":         n.Labels,
			"internalIP":     internalIP,
			"roles":          roles,
			"kubeletVersion": n.Status.NodeInfo.KubeletVersion,
			"osImage":        n.Status.NodeInfo.OSImage,
		})
	}

	// Namespaces
	namespaces, err := client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("namespaces: %v", err), http.StatusInternalServerError)
		return
	}
	for _, ns := range namespaces.Items {
		if onlyNs == "" || onlyNs == ns.Name {
			summary.Namespaces = append(summary.Namespaces, ns.Name)
		}
	}

	// Pods
	pods, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("pods: %v", err), http.StatusInternalServerError)
		return
	}
	for _, p := range pods.Items {
		if onlyNs != "" && p.Namespace != onlyNs {
			continue
		}
		containers := []map[string]interface{}{}
		for _, c := range p.Spec.Containers {
			ports := []map[string]interface{}{}
			for _, port := range c.Ports {
				ports = append(ports, map[string]interface{}{
					"name":          port.Name,
					"containerPort": port.ContainerPort,
					"protocol":      port.Protocol,
				})
			}
			containers = append(containers, map[string]interface{}{
				"name":  c.Name,
				"ports": ports,
			})
		}
		summary.Pods = append(summary.Pods, map[string]interface{}{
			"namespace":  p.Namespace,
			"name":       p.Name,
			"node":       p.Spec.NodeName,
			"podIP":      p.Status.PodIP,
			"phase":      p.Status.Phase,
			"labels":     p.Labels,
			"containers": containers,
		})
	}

	// Services
	services, err := client.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("services: %v", err), http.StatusInternalServerError)
		return
	}

	// EndpointSlices
	eps, err := client.DiscoveryV1().EndpointSlices("").List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("endpoint slices: %v", err), http.StatusInternalServerError)
		return
	}
	endpointsBySvc := map[string][]map[string]interface{}{}
	for _, es := range eps.Items {
		ns := es.Namespace
		if onlyNs != "" && ns != onlyNs {
			continue
		}
		svcName := es.Labels["kubernetes.io/service-name"]
		key := fmt.Sprintf("%s/%s", ns, svcName)
		ports := []map[string]interface{}{}
		for _, p := range es.Ports {
			port := map[string]interface{}{
				"name":     p.Name,
				"port":     p.Port,
				"protocol": p.Protocol,
			}
			ports = append(ports, port)
		}
		for _, ep := range es.Endpoints {
			for _, addr := range ep.Addresses {
				target := map[string]interface{}{}
				if ep.TargetRef != nil {
					target["kind"] = ep.TargetRef.Kind
					target["name"] = ep.TargetRef.Name
					target["namespace"] = ep.TargetRef.Namespace
				}
				endpointsBySvc[key] = append(endpointsBySvc[key], map[string]interface{}{
					"address":    addr,
					"ports":      ports,
					"targetRef":  target,
					"conditions": ep.Conditions,
				})
			}
		}
	}

	for _, svc := range services.Items {
		if onlyNs != "" && svc.Namespace != onlyNs {
			continue
		}
		ports := []map[string]interface{}{}
		for _, p := range svc.Spec.Ports {
			targetPort := ""
			if p.TargetPort.StrVal != "" {
				targetPort = p.TargetPort.StrVal
			} else if p.TargetPort.IntVal != 0 {
				targetPort = strconv.Itoa(int(p.TargetPort.IntVal))
			}
			ports = append(ports, map[string]interface{}{
				"name":       p.Name,
				"port":       p.Port,
				"targetPort": targetPort,
				"protocol":   p.Protocol,
			})
		}
		key := fmt.Sprintf("%s/%s", svc.Namespace, svc.Name)
		summary.Services = append(summary.Services, map[string]interface{}{
			"namespace": svc.Namespace,
			"name":      svc.Name,
			"type":      svc.Spec.Type,
			"clusterIP": svc.Spec.ClusterIP,
			"selector":  svc.Spec.Selector,
			"ports":     ports,
			"endpoints": endpointsBySvc[key],
		})
	}

	writeJSON(w, summary)
}

// small helper used by this file only
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
