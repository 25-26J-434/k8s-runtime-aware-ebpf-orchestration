package scheduler

type Rule struct {
	Enabled     bool              `bson:"enabled"`
	Namespace   string            `bson:"namespace"`
	PodSelector map[string]string `bson:"podSelector"`
	Metric      string            `bson:"metric"`
	Operator    string            `bson:"operator"`
	Threshold   float64           `bson:"threshold"`
}
