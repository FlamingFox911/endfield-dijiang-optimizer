import type { OptimizationProfile } from "@endfield/domain";

import type { OptimizationSearchConfig } from "./types.js";

export const SUPPORT_WEIGHTS = {
  version: "v4",
  assignedOperatorProductionEfficiencyPercent: 40,
  baselineMoodDrainPerHour: 3_600,
  baselineMoodRegenPerHour: 6_000,
  baselineMoodWorkingUptime: 0.625,
  // Reception Room credits matter, but guide priority and community discussion both put
  // them below steady production once social-loop and store RNG variance are accounted for.
  receptionClueCollectionWeight: 0.01,
  receptionClueRateWeight: 0,
  priorityRecipeFocusMultiplier: 2.5,
  estimatedEffortPerDay: 18,
} as const;

export const OPTIMIZATION_PROFILE_EFFORTS: Record<Exclude<OptimizationProfile, "custom">, number> = {
  fast: 8,
  balanced: 18,
  thorough: 30,
  exhaustive: 100,
};

export const DEFAULT_OPTIMIZATION_PROFILE: OptimizationProfile = "balanced";
export const DEFAULT_OPTIMIZATION_EFFORT = OPTIMIZATION_PROFILE_EFFORTS[DEFAULT_OPTIMIZATION_PROFILE];
export const MIN_OPTIMIZATION_EFFORT = 1;
export const MAX_OPTIMIZATION_EFFORT = 100;

export function clampOptimizationEffort(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_OPTIMIZATION_EFFORT;
  }
  return Math.min(MAX_OPTIMIZATION_EFFORT, Math.max(MIN_OPTIMIZATION_EFFORT, Math.round(value)));
}

export function getOptimizationSearchConfig(
  profile: OptimizationProfile,
  effort: number,
  maxEffort = MAX_OPTIMIZATION_EFFORT,
): OptimizationSearchConfig {
  const ceiling = clampOptimizationEffort(maxEffort);
  const normalizedEffort = Math.min(ceiling, clampOptimizationEffort(effort));
  if (normalizedEffort === ceiling) {
    return {
      profileLabel: profile,
      effort: normalizedEffort,
      maxBranchCandidatesPerSlot: null,
      maxVisitedNodes: null,
      // Unbounded search still needs regular progress updates and cancellation.
      progressIntervalNodes: 1_000,
    };
  }
  const branchCap = Math.min(30, Math.max(4, Math.ceil(4 + normalizedEffort * 0.35)));
  const maxVisitedNodes = 1_000 + (normalizedEffort * normalizedEffort * 2_000);
  const progressIntervalNodes = Math.max(10, Math.floor(maxVisitedNodes / 20));

  return {
    profileLabel: profile,
    effort: normalizedEffort,
    maxBranchCandidatesPerSlot: branchCap,
    maxVisitedNodes,
    progressIntervalNodes,
  };
}

export const DEFAULT_SOLVER_STRATEGY = {
  name: "assignment search + exact room-team branch and bound",
  guarantee: "approximate",
  summary:
    "Compare assignment sets using estimated working/resting cycles and recipe-specific output, with upper-bound pruning. Maximum effort removes search budgets and candidate limits.",
  steps: [
    "Normalize the scenario and apply the max-facilities overlay if requested.",
    "Reserve hard assignments before searching other rooms.",
    "At maximum effort, enumerate Control Nexus teams first and score complete teams for each remaining room.",
    "Use the scenario's fixed recipe selection for each production room.",
    "Branch on remaining operator-slot choices while pruning with an optimistic bound.",
    "Use the same whole-assignment score for search and results, and return per-room marginal explanations.",
  ],
} as const;

export const DEFAULT_UPGRADE_STRATEGY = {
  name: "counterfactual next-unlock evaluation",
  guarantee: "approximate",
  summary:
    "Generate every next unlock candidate, re-solve the scenario, and rank by impact and effort.",
  steps: [
    "Solve the baseline scenario once.",
    "Generate one-step upgrade actions for every owned operator's locked Base Skill rank.",
    "Apply each candidate as a temporary scenario mutation.",
    "Re-run the assignment solver and compute score delta against baseline.",
    "Rank candidates by the selected mode.",
  ],
} as const;
