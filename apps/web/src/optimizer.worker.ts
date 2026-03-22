import {
  OptimizationCancelledError,
  recommendUpgrades,
  solveScenario,
  UpgradeRecommendationsCancelledError,
} from "@endfield/optimizer";

import type { OptimizerWorkerRequest, OptimizerWorkerResponse } from "./optimizer-worker-types";

let canceledRunId: number | null = null;

function postMessageToMainThread(message: OptimizerWorkerResponse) {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<OptimizerWorkerRequest>) => {
  const message = event.data;

  if (message.type === "cancel") {
    canceledRunId = message.runId;
    return;
  }

  canceledRunId = null;

  try {
    if (message.type === "start-optimization") {
      postMessageToMainThread({
        type: "optimization-started",
        runId: message.runId,
        progress: {
          phase: "Starting worker",
          visitedNodes: 0,
          totalSlots: 0,
          currentDepth: 0,
          bestScore: 0,
          maxBranchCandidatesPerSlot: message.searchConfig.maxBranchCandidatesPerSlot,
          profileLabel: message.searchConfig.profileLabel,
          effort: message.searchConfig.effort,
          maxVisitedNodes: message.searchConfig.maxVisitedNodes,
        },
      });

      const result = solveScenario(message.catalog, message.scenario, {
        searchConfig: message.searchConfig,
        onProgress: (progress) => {
          postMessageToMainThread({ type: "optimization-progress", runId: message.runId, progress });
        },
        shouldCancel: () => canceledRunId === message.runId,
      });

      if (canceledRunId === message.runId) {
        postMessageToMainThread({ type: "canceled", runId: message.runId });
        return;
      }

      postMessageToMainThread({ type: "optimization-completed", runId: message.runId, result });
      return;
    }

    postMessageToMainThread({
      type: "recommendations-started",
      runId: message.runId,
      progress: {
        phase: "Starting recommendation worker",
        completedCandidates: 0,
        totalCandidates: 0,
        baselineScore: 0,
        bestScoreDelta: 0,
      },
    });

    const result = recommendUpgrades(message.catalog, message.scenario, undefined, {
      onProgress: (progress) => {
        postMessageToMainThread({ type: "recommendations-progress", runId: message.runId, progress });
      },
      shouldCancel: () => canceledRunId === message.runId,
    });

    if (canceledRunId === message.runId) {
      postMessageToMainThread({ type: "canceled", runId: message.runId });
      return;
    }

    postMessageToMainThread({ type: "recommendations-completed", runId: message.runId, result });
  } catch (error) {
    if (error instanceof OptimizationCancelledError || error instanceof UpgradeRecommendationsCancelledError) {
      postMessageToMainThread({ type: "canceled", runId: message.runId });
      return;
    }

    postMessageToMainThread({
      type: "error",
      runId: message.runId,
      message: error instanceof Error ? error.message : "Optimization worker failed.",
    });
  }
};
