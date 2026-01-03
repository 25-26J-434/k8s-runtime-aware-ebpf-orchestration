package scaling

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Mongo document: rulesdb.scaling_rules
type ScalingRule struct {
	ID         primitive.ObjectID `bson:"_id,omitempty" json:"_id,omitempty"`
	Namespace  string             `bson:"namespace" json:"namespace"`
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

	// status fields populated by the scaling controller
	LastAction   string    `bson:"lastAction,omitempty" json:"lastAction,omitempty"`
	LastActionAt time.Time `bson:"lastActionAt,omitempty" json:"lastActionAt,omitempty"`
	LastValue    float64   `bson:"lastValue,omitempty" json:"lastValue"`
	LastFrom     int32     `bson:"lastFrom,omitempty" json:"lastFrom,omitempty"`
	LastTo       int32     `bson:"lastTo,omitempty" json:"lastTo,omitempty"`
}
