import type { ScalingMetric } from "./cluster";

export type Operator = ">" | "<";
export type ScalingAction = "scale_up" | "scale_down";

/** A rule as stored by the scaling service. Field names match the daemon exactly. */
export interface ScalingRule {
  _id: string;
  enabled: boolean;
  namespace: string;
  deployment: string;
  metric: ScalingMetric;
  operator: Operator;
  threshold: number;
  minReplicas: number;
  maxReplicas: number;
  step: number;
  action?: ScalingAction;
  lastAction?: string;
  lastActionAt?: string;
  lastValue?: number;
  lastFrom?: number;
  lastTo?: number;
}

export type RuleInput = Omit<ScalingRule, "_id" | "lastAction" | "lastActionAt" | "lastValue" | "lastFrom" | "lastTo">;

export interface PlacementPod {
  name: string;
  node: string;
  phase: string;
  ready: boolean;
  startTime?: string;
  ageSeconds: number;
}

export interface Placement {
  namespace: string;
  deployment: string;
  pods: PlacementPod[];
  nodeCounts: Record<string, number>;
}
