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
  /** null means every eligible candidate is considered. */
  maxBranchCandidatesPerSlot: number | null;
  /** null means search continues until completion or cancellation. */
  maxVisitedNodes: number | null;
  progressIntervalNodes: number;
}

export interface OptimizationProgressSnapshot {
  timing?: {
    elapsedMs: number;
    nodesPerSecond: number | null;
    estimatedRemainingMs: number | null;
    estimateBasis: "budget" | "branches" | null;
    completedBranches: number;
    totalBranches: number;
    searchFinished: boolean;
  };
  phase: string;
  visitedNodes: number;
  totalSlots: number;
  currentDepth: number;
  bestScore: number;
  maxBranchCandidatesPerSlot: number | null;
  profileLabel: OptimizationProfile;
  effort: number;
  maxVisitedNodes: number | null;
}

export interface UpgradeRecommendationProgressSnapshot {
  assignmentSearch?: OptimizationProgressSnapshot;
  phase: string;
  completedCandidates: number;
  totalCandidates: number;
  baselineScore: number;
  bestScoreDelta: number;
}

export interface SolveScenarioOptions {
  /** Feasible assignment hints are rescored under the current scenario, never trusted as scores. */
  initialAssignments?: OptimizationResult["roomPlans"];
  searchConfig?: OptimizationSearchConfig;
  onProgress?: (progress: OptimizationProgressSnapshot) => void;
  shouldCancel?: () => boolean;
}

export interface RecommendUpgradesOptions {
  baselineResult?: OptimizationResult;
  onProgress?: (progress: UpgradeRecommendationProgressSnapshot) => void;
  shouldCancel?: () => boolean;
}
