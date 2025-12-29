package scaling

// Mongo document: rulesdb.scaling_rules
type ScalingRule struct {
	Namespace  string  `bson:"namespace" json:"namespace"`
	Deployment string  `bson:"deployment" json:"deployment"`
	Metric     string  `bson:"metric" json:"metric"`

	// optional, default ">"
	Operator string `bson:"operator,omitempty" json:"operator,omitempty"`

	// threshold value (example: 300000 for dns_latency ns/us depending on your metric)
	Threshold float64 `bson:"threshold" json:"threshold"`

	Enabled bool `bson:"enabled" json:"enabled"`

	// optional tuning knobs
	MinReplicas int32 `bson:"minReplicas,omitempty" json:"minReplicas,omitempty"`
	MaxReplicas int32 `bson:"maxReplicas,omitempty" json:"maxReplicas,omitempty"`
	Step        int32 `bson:"step,omitempty" json:"step,omitempty"`
}
