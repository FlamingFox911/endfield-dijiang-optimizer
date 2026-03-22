export {
  DEFAULT_SOLVER_STRATEGY,
  DEFAULT_UPGRADE_STRATEGY,
  SUPPORT_WEIGHTS,
} from "./config.js";
export { formatOptimizationResultText, formatUpgradeRecommendationsText } from "./format.js";
export {
  applyMaxFacilitiesOverlay,
  normalizeScenario,
  solveNormalizedScenario,
  solveScenario,
} from "./solver.js";
export { recommendUpgrades } from "./upgrade.js";
export type { AssignmentSolver, SolverStrategy, UpgradeAdvisor } from "./types.js";
