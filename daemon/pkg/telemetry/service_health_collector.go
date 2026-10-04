package telemetry

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// ServiceHealthMetrics holds service endpoint health information
type ServiceHealthMetrics struct {
	TotalServices     int                      `json:"total_services"`
	HealthyServices   int                      `json:"healthy_services"`
	UnhealthyServices int                      `json:"unhealthy_services"`
	ServiceDetails    map[string]ServiceHealth `json:"service_details"`
}

// ServiceHealth holds health status for a service
type ServiceHealth struct {
	Name           string                    `json:"name"`
	Namespace      string                    `json:"namespace"`
	ClusterIP      string                    `json:"cluster_ip"`
	Type           string                    `json:"type"`
	Status         string                    `json:"status"` // "healthy", "degraded", "unhealthy"
	TotalEndpoints int                       `json:"total_endpoints"`
	ReadyEndpoints int                       `json:"ready_endpoints"`
	EndpointHealth map[string]EndpointHealth `json:"endpoint_health"`
	LastCheck      time.Time                 `json:"last_check"`
}

// EndpointHealth holds health status for an endpoint
type EndpointHealth struct {
	PodName   string    `json:"pod_name"`
	PodIP     string    `json:"pod_ip"`
	Status    string    `json:"status"` // "ready", "not_ready"
	HTTPCheck bool      `json:"http_check"`
	LatencyMs float64   `json:"latency_ms"`
	LastCheck time.Time `json:"last_check"`
}

var serviceHealthMetrics ServiceHealthMetrics
var serviceHealthMutex sync.RWMutex

func init() {
	serviceHealthMetrics.ServiceDetails = make(map[string]ServiceHealth)
}

// ServiceHealthCollector implements the Collector interface
type ServiceHealthCollector struct {
	nodeName   string
	httpClient *http.Client
	k8sClient  *kubernetes.Clientset
}

// NewServiceHealthCollector creates a new service health collector
func NewServiceHealthCollector(nodeName string, k8sClient *kubernetes.Clientset) *ServiceHealthCollector {
	return &ServiceHealthCollector{
		nodeName: nodeName,
		httpClient: &http.Client{
			Timeout: 2 * time.Second,
		},
		k8sClient: k8sClient,
	}
}

// GetType returns the metric type
func (c *ServiceHealthCollector) GetType() MetricType {
	return MetricType("service_health")
}

// GetNodeMetrics returns current node-level service health metrics
func (c *ServiceHealthCollector) GetNodeMetrics() NodeMetric {
	serviceHealthMutex.RLock()
	defer serviceHealthMutex.RUnlock()

	// Create a copy of the service details
	serviceDetails := make(map[string]ServiceHealth)
	for k, v := range serviceHealthMetrics.ServiceDetails {
		serviceDetails[k] = v
	}

	value := ServiceHealthMetrics{
		TotalServices:     serviceHealthMetrics.TotalServices,
		HealthyServices:   serviceHealthMetrics.HealthyServices,
		UnhealthyServices: serviceHealthMetrics.UnhealthyServices,
		ServiceDetails:    serviceDetails,
	}

	return NodeMetric{
		Type:      c.GetType(),
		Timestamp: time.Now(),
		NodeName:  c.nodeName,
		Value:     value,
	}
}

// GetPodMetrics returns empty map (service health is service-level, not pod-level)
func (c *ServiceHealthCollector) GetPodMetrics() map[string]PodMetric {
	return make(map[string]PodMetric)
}

// Subscribe returns a channel for real-time updates
func (c *ServiceHealthCollector) Subscribe() <-chan Metric {
	ch := make(chan Metric, 100)
	// TODO: Implement event-driven updates
	return ch
}

// Unsubscribe removes a subscription
func (c *ServiceHealthCollector) Unsubscribe(ch <-chan Metric) {
	// Channels are receive-only, cannot close
	// Subscriptions are managed by the collector internally
}

// StartServiceHealthCollector starts collecting service health metrics
func StartServiceHealthCollector(k8sClient *kubernetes.Clientset) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	// Initial collection
	collectServiceHealth(k8sClient)

	for range ticker.C {
		collectServiceHealth(k8sClient)
	}
}

// maxConcurrentProbes bounds parallel HTTP health probes per collection cycle.
const maxConcurrentProbes = 16

// probeHTTPClient has a hard timeout so one hung pod cannot stall collection.
var probeHTTPClient = &http.Client{Timeout: 2 * time.Second}

// collectServiceHealth checks health of all services.
// Results are built locally and swapped in under the lock at the end, so
// readers are never blocked behind slow HTTP probes.
func collectServiceHealth(k8sClient *kubernetes.Clientset) {
	if k8sClient == nil {
		return
	}

	ctx := context.Background()

	services, err := k8sClient.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	if err != nil {
		log.Printf("[ServiceHealth] Failed to list services: %v", err)
		return
	}

	endpoints, err := k8sClient.CoreV1().Endpoints("").List(ctx, metav1.ListOptions{})
	if err != nil {
		log.Printf("[ServiceHealth] Failed to list endpoints: %v", err)
		return
	}

	endpointMap := make(map[string]*corev1.Endpoints, len(endpoints.Items))
	for i := range endpoints.Items {
		key := fmt.Sprintf("%s/%s", endpoints.Items[i].Namespace, endpoints.Items[i].Name)
		endpointMap[key] = &endpoints.Items[i]
	}

	details := make(map[string]ServiceHealth, len(services.Items))
	var wg sync.WaitGroup
	var detailsMu sync.Mutex
	sem := make(chan struct{}, maxConcurrentProbes)

	for _, svc := range services.Items {
		svcKey := fmt.Sprintf("%s/%s", svc.Namespace, svc.Name)

		svcHealth := ServiceHealth{
			Name:           svc.Name,
			Namespace:      svc.Namespace,
			ClusterIP:      svc.Spec.ClusterIP,
			Type:           string(svc.Spec.Type),
			EndpointHealth: make(map[string]EndpointHealth),
			LastCheck:      time.Now(),
		}

		var probes []func()

		if ep, ok := endpointMap[svcKey]; ok {
			for _, subset := range ep.Subsets {
				for _, addr := range subset.Addresses {
					podName := ""
					if addr.TargetRef != nil && addr.TargetRef.Kind == "Pod" {
						podName = addr.TargetRef.Name
					}
					svcHealth.ReadyEndpoints++
					svcHealth.TotalEndpoints++

					key := fmt.Sprintf("%s:%s", podName, addr.IP)
					svcHealth.EndpointHealth[key] = EndpointHealth{
						PodIP:     addr.IP,
						PodName:   podName,
						Status:    "ready",
						LastCheck: time.Now(),
					}

					if len(subset.Ports) > 0 {
						port := int(subset.Ports[0].Port)
						ip := addr.IP
						probes = append(probes, func() {
							ok, latency := checkHTTPHealth(ip, port)
							detailsMu.Lock()
							defer detailsMu.Unlock()
							entry := details[svcKey].EndpointHealth[key]
							entry.HTTPCheck = ok
							entry.LatencyMs = latency
							details[svcKey].EndpointHealth[key] = entry
						})
					}
				}

				for _, addr := range subset.NotReadyAddresses {
					podName := ""
					if addr.TargetRef != nil && addr.TargetRef.Kind == "Pod" {
						podName = addr.TargetRef.Name
					}
					svcHealth.TotalEndpoints++
					key := fmt.Sprintf("%s:%s", podName, addr.IP)
					svcHealth.EndpointHealth[key] = EndpointHealth{
						PodIP:     addr.IP,
						PodName:   podName,
						Status:    "not_ready",
						LastCheck: time.Now(),
					}
				}
			}
		}

		switch {
		case svcHealth.ReadyEndpoints == 0:
			svcHealth.Status = "unhealthy"
		case svcHealth.ReadyEndpoints == svcHealth.TotalEndpoints:
			svcHealth.Status = "healthy"
		default:
			svcHealth.Status = "degraded"
		}

		details[svcKey] = svcHealth

		for _, probe := range probes {
			probe := probe
			wg.Add(1)
			sem <- struct{}{}
			go func() {
				defer wg.Done()
				defer func() { <-sem }()
				probe()
			}()
		}
	}
	wg.Wait()

	result := ServiceHealthMetrics{
		TotalServices:  len(services.Items),
		ServiceDetails: details,
	}
	for _, svc := range details {
		if svc.Status == "healthy" {
			result.HealthyServices++
		} else {
			result.UnhealthyServices++
		}
	}

	serviceHealthMutex.Lock()
	serviceHealthMetrics = result
	serviceHealthMutex.Unlock()
}

// checkHTTPHealth performs an HTTP health check with a bounded timeout.
func checkHTTPHealth(ip string, port int) (bool, float64) {
	start := time.Now()
	url := fmt.Sprintf("http://%s:%d/health", ip, port)

	resp, err := probeHTTPClient.Get(url)
	latency := float64(time.Since(start).Nanoseconds()) / 1e6 // milliseconds

	if err != nil {
		return false, latency
	}
	defer resp.Body.Close()

	return resp.StatusCode >= 200 && resp.StatusCode < 400, latency
}

// Global service health collector instance
var globalServiceHealthCollector *ServiceHealthCollector

// InitServiceHealthCollector initializes the global service health collector
func InitServiceHealthCollector(nodeName string, k8sClient *kubernetes.Clientset) {
	globalServiceHealthCollector = NewServiceHealthCollector(nodeName, k8sClient)
	GlobalRegistry.Register(globalServiceHealthCollector)
	// Start collecting metrics
	if k8sClient != nil {
		go StartServiceHealthCollector(k8sClient)
	}
}

// GetServiceHealthMetrics returns a snapshot of current service health metrics.
// The map is copied so callers cannot race with the collector.
func GetServiceHealthMetrics() ServiceHealthMetrics {
	serviceHealthMutex.RLock()
	defer serviceHealthMutex.RUnlock()
	snapshot := serviceHealthMetrics
	snapshot.ServiceDetails = make(map[string]ServiceHealth, len(serviceHealthMetrics.ServiceDetails))
	for k, v := range serviceHealthMetrics.ServiceDetails {
		snapshot.ServiceDetails[k] = v
	}
	return snapshot
}
