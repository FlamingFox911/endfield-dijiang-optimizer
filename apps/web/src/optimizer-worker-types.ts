import type { GameCatalog, OptimizationResult, OptimizationScenario } from "@endfield/domain";
import type { OptimizationProgressSnapshot, OptimizationSearchConfig } from "@endfield/optimizer";

export interface StartOptimizationMessage {
  type: "start";
  runId: number;
  catalog: GameCatalog;
  scenario: OptimizationScenario;
  searchConfig: OptimizationSearchConfig;
}

export interface CancelOptimizationMessage {
  type: "cancel";
  runId: number;
}

export type OptimizerWorkerRequest = StartOptimizationMessage | CancelOptimizationMessage;

export interface OptimizerWorkerStartedMessage {
  type: "started";
  runId: number;
  progress: OptimizationProgressSnapshot;
}

export interface OptimizerWorkerProgressMessage {
  type: "progress";
  runId: number;
  progress: OptimizationProgressSnapshot;
}

export interface OptimizerWorkerCompletedMessage {
  type: "completed";
  runId: number;
  result: OptimizationResult;
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
  | OptimizerWorkerCanceledMessage
  | OptimizerWorkerErrorMessage;
