import type {
  GameCatalog,
  OptimizationProfile,
  OptimizationResult,
  OptimizationScenario,
  UpgradeRecommendationResult,
} from "@endfield/domain";

export interface SolverStrategy {
  name: string;
  guarantee: "exact" | "approximate";
  summary: string;
  steps: string[];
}

export interface AssignmentSolver {
  solve(catalog: GameCatalog, scenario: OptimizationScenario, options?: SolveScenarioOptions): OptimizationResult;
}

export interface UpgradeAdvisor {
  recommend(
    catalog: GameCatalog,
    scenario: OptimizationScenario,
    baseline?: OptimizationResult,
  ): UpgradeRecommendationResult;
}

export interface OptimizationSearchConfig {
  profileLabel: OptimizationProfile;
  effort: number;
  maxBranchCandidatesPerSlot: number;
  maxVisitedNodes: number;
  progressIntervalNodes: number;
}

export interface OptimizationProgressSnapshot {
  phase: string;
  visitedNodes: number;
  totalSlots: number;
  currentDepth: number;
  bestScore: number;
  maxBranchCandidatesPerSlot: number;
  profileLabel: OptimizationProfile;
  effort: number;
  maxVisitedNodes: number;
}

export interface SolveScenarioOptions {
  searchConfig?: OptimizationSearchConfig;
  onProgress?: (progress: OptimizationProgressSnapshot) => void;
  shouldCancel?: () => boolean;
}
