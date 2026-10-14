import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { metricsConfigService, type MetricsConfig } from "../services/metricsConfig";
import { healthKeys } from "./useClusterHealth";

export function useMetricsConfig(enabled = true) {
  return useQuery({ queryKey: healthKeys.config, queryFn: () => metricsConfigService.getConfig(), enabled });
}

export function useSaveMetricsConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: MetricsConfig) => metricsConfigService.updateConfig(config),
    onSuccess: (_data, config) => {
      queryClient.setQueryData(healthKeys.config, config);
      queryClient.invalidateQueries({ queryKey: healthKeys.cluster });
    },
  });
}
