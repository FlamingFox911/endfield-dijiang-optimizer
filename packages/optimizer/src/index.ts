export {
  DEFAULT_SOLVER_STRATEGY,
  DEFAULT_UPGRADE_STRATEGY,
  DEFAULT_OPTIMIZATION_EFFORT,
  DEFAULT_OPTIMIZATION_PROFILE,
  MAX_OPTIMIZATION_EFFORT,
  MIN_OPTIMIZATION_EFFORT,
  OPTIMIZATION_PROFILE_EFFORTS,
  SUPPORT_WEIGHTS,
  clampOptimizationEffort,
  getOptimizationSearchConfig,
} from "./config.js";
export { formatOptimizationResultText, formatUpgradeRecommendationsText } from "./format.js";
export {
  applyMaxFacilitiesOverlay,
  OptimizationCancelledError,
  normalizeScenario,
  solveNormalizedScenario,
  solveScenario,
} from "./solver.js";
export { recommendUpgrades } from "./upgrade.js";
export type {
  AssignmentSolver,
  OptimizationProgressSnapshot,
  OptimizationSearchConfig,
  SolveScenarioOptions,
  SolverStrategy,
  UpgradeAdvisor,
} from "./types.js";
