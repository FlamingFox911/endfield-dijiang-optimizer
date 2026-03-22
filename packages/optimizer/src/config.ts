import type { OptimizationProfile } from "@endfield/domain";

import type { OptimizationSearchConfig } from "./types.js";

export const SUPPORT_WEIGHTS = {
  version: "2026-03-22-v3",
  controlNexusMoodRegenWeight: 0.55,
  controlNexusMoodDropReductionWeight: 0.45,
  assignedOperatorProductionEfficiencyPercent: 40,
  manufacturingMoodSustainFactor: 0.25,
  growthMoodSustainFactor: 0.25,
  receptionClueCollectionWeight: 0.75,
  receptionClueRateWeight: 0,
  offRoomClueWeight: 0.2,
  fallbackProductionPercentPerRank: 10,
  fallbackSupportPercentPerRank: 8,
  estimatedEffortPerDay: 18,
} as const;

export const OPTIMIZATION_PROFILE_EFFORTS: Record<Exclude<OptimizationProfile, "custom">, number> = {
  fast: 8,
  balanced: 18,
  thorough: 30,
  exhaustive: 45,
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

export function getOptimizationSearchConfig(profile: OptimizationProfile, effort: number): OptimizationSearchConfig {
  const normalizedEffort = clampOptimizationEffort(effort);
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
  name: "assignment enumeration + branch and bound",
  guarantee: "exact",
  summary:
    "Use the user-selected room recipe plan, then search operator assignments with upper-bound pruning.",
  steps: [
    "Normalize the scenario and apply the max-facilities overlay if requested.",
    "Reserve hard assignments before searching other rooms.",
    "Use the scenario's fixed recipe selection for each production room.",
    "Branch on remaining operator-slot choices while pruning with an optimistic bound.",
    "Re-score the best feasible plan and return per-room explanations and score breakdowns.",
  ],
} as const;

export const DEFAULT_UPGRADE_STRATEGY = {
  name: "counterfactual next-unlock evaluation",
  guarantee: "exact",
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
