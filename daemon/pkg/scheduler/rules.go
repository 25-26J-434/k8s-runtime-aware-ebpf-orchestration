package scheduler

type SchedulingRule struct {
	MetricType  string  `json:"metric_type"`  // dns_latency, rtt, tcp_metrics...
	Operator    string  `json:"operator"`     // <, >, =
	Threshold   float64 `json:"threshold"`    // compare value
	MetricLevel string  `json:"metric_level"` // node / pod
	Action      string  `json:"action"`       // prefer / avoid (for now)
}
