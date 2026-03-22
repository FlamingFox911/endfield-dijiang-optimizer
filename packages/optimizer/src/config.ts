export const SUPPORT_WEIGHTS = {
  version: "2026-03-21-v2",
  controlNexusMoodRegenWeight: 0.55,
  controlNexusMoodDropReductionWeight: 0.45,
  manufacturingMoodSustainFactor: 0.25,
  growthMoodSustainFactor: 0.25,
  receptionClueCollectionWeight: 0.75,
  receptionClueRateWeight: 0,
  offRoomClueWeight: 0.2,
  fallbackProductionPercentPerRank: 10,
  fallbackSupportPercentPerRank: 8,
  estimatedEffortPerDay: 18,
} as const;

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
