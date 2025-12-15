package scaling

func DecideReplicas(
	current int32,
	metricValue float64,
	rule ScalingRule,
) (int32, string) {

	desired := current
	action := "NO_ACTION"

	if metricValue > rule.ScaleUpAt {
		desired++
		action = "SCALE_OUT"
	} else if metricValue < rule.ScaleDownAt {
		desired--
		action = "SCALE_IN"
	}

	if desired < rule.MinReplicas {
		desired = rule.MinReplicas
	}
	if desired > rule.MaxReplicas {
		desired = rule.MaxReplicas
	}

	return desired, action
}
