import { OptimizationCancelledError, solveScenario } from "@endfield/optimizer";

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
  postMessageToMainThread({
    type: "started",
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

  try {
    const result = solveScenario(message.catalog, message.scenario, {
      searchConfig: message.searchConfig,
      onProgress: (progress) => {
        postMessageToMainThread({ type: "progress", runId: message.runId, progress });
      },
      shouldCancel: () => canceledRunId === message.runId,
    });

    if (canceledRunId === message.runId) {
      postMessageToMainThread({ type: "canceled", runId: message.runId });
      return;
    }

    postMessageToMainThread({ type: "completed", runId: message.runId, result });
  } catch (error) {
    if (error instanceof OptimizationCancelledError) {
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
