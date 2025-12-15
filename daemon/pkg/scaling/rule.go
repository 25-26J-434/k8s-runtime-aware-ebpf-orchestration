package scaling

type ScalingRule struct {
	Namespace  string `json:"namespace"`
	Deployment string `json:"deployment"`

	MetricType  string `json:"metric_type"`  // dns_latency | rtt
	MetricLevel string `json:"metric_level"` // node | pod

	ScaleUpAt   float64 `json:"scale_up_at"`
	ScaleDownAt float64 `json:"scale_down_at"`

	MinReplicas int32 `json:"min_replicas"`
	MaxReplicas int32 `json:"max_replicas"`
}
