package scheduler

func MatchLabels(rule Rule, labels map[string]string) bool {
	for k, v := range rule.PodSelector {
		if labels[k] != v {
			return false
		}
	}
	return true
}

func Compare(value, threshold float64, op string) bool {
	switch op {
	case ">":
		return value > threshold
	case "<":
		return value < threshold
	case ">=":
		return value >= threshold
	case "<=":
		return value <= threshold
	}
	return false
}
