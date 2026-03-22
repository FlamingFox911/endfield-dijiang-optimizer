import type {
  GameCatalog,
  OptimizationResult,
  OptimizationScenario,
  UpgradeRecommendationResult,
} from "@endfield/domain";
import type {
  OptimizationProgressSnapshot,
  OptimizationSearchConfig,
  UpgradeRecommendationProgressSnapshot,
} from "@endfield/optimizer";

export interface StartOptimizationMessage {
  type: "start-optimization";
  runId: number;
  catalog: GameCatalog;
  scenario: OptimizationScenario;
  searchConfig: OptimizationSearchConfig;
}

export interface StartRecommendationsMessage {
  type: "start-recommendations";
  runId: number;
  catalog: GameCatalog;
  scenario: OptimizationScenario;
}

export interface CancelOptimizationMessage {
  type: "cancel";
  runId: number;
}

export type OptimizerWorkerRequest =
  | StartOptimizationMessage
  | StartRecommendationsMessage
  | CancelOptimizationMessage;

export interface OptimizerWorkerStartedMessage {
  type: "optimization-started";
  runId: number;
  progress: OptimizationProgressSnapshot;
}

export interface OptimizerWorkerProgressMessage {
  type: "optimization-progress";
  runId: number;
  progress: OptimizationProgressSnapshot;
}

export interface OptimizerWorkerCompletedMessage {
  type: "optimization-completed";
  runId: number;
  result: OptimizationResult;
}

export interface RecommendationWorkerStartedMessage {
  type: "recommendations-started";
  runId: number;
  progress: UpgradeRecommendationProgressSnapshot;
}

export interface RecommendationWorkerProgressMessage {
  type: "recommendations-progress";
  runId: number;
  progress: UpgradeRecommendationProgressSnapshot;
}

export interface RecommendationWorkerCompletedMessage {
  type: "recommendations-completed";
  runId: number;
  result: UpgradeRecommendationResult;
}

export interface OptimizerWorkerCanceledMessage {
  type: "canceled";
  runId: number;
}

export interface OptimizerWorkerErrorMessage {
  type: "error";
  runId: number;
  message: string;
}

export type OptimizerWorkerResponse =
  | OptimizerWorkerStartedMessage
  | OptimizerWorkerProgressMessage
  | OptimizerWorkerCompletedMessage
  | RecommendationWorkerStartedMessage
  | RecommendationWorkerProgressMessage
  | RecommendationWorkerCompletedMessage
  | OptimizerWorkerCanceledMessage
  | OptimizerWorkerErrorMessage;
