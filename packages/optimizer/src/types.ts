import type {
  GameCatalog,
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
  solve(catalog: GameCatalog, scenario: OptimizationScenario): OptimizationResult;
}

export interface UpgradeAdvisor {
  recommend(
    catalog: GameCatalog,
    scenario: OptimizationScenario,
    baseline?: OptimizationResult,
  ): UpgradeRecommendationResult;
}
