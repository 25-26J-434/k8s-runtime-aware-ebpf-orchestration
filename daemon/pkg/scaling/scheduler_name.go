package scaling

import (
	"os"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
)

const defaultScalingSchedulerName = "kerneleye-scheduler"

func applyScalingSchedulerName(dep *appsv1.Deployment, rule ScalingRule) bool {
	if dep == nil || !rule.UseCustomScheduler {
		return false
	}

	desired := strings.TrimSpace(os.Getenv("SCALING_SCHEDULER_NAME"))
	if desired == "" {
		desired = defaultScalingSchedulerName
	}

	if dep.Spec.Template.Spec.SchedulerName == desired {
		return false
	}

	dep.Spec.Template.Spec.SchedulerName = desired
	return true
}
