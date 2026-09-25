import type { OptimizationProgressSnapshot } from "./types.js";

type SearchTiming = NonNullable<OptimizationProgressSnapshot["timing"]>;

/** Timing is observational only: it never changes traversal or imposes a cutoff. */
export function createSearchTiming(maxVisitedNodes: number | null, now = () => performance.now()) {
  let startedAt: number | null = null;
  let finishedAt: number | null = null;
  let lastBranchFinishedAt = 0;
  let completedBranches = 0;
  let totalBranches = 0;
  return {
    start() {
      startedAt = now();
      lastBranchFinishedAt = startedAt;
    },
    setTotalBranches(count: number) { totalBranches = count; },
    completeBranch() {
      completedBranches += 1;
      lastBranchFinishedAt = now();
    },
    finish() { finishedAt = now(); },
    snapshot(visitedNodes: number): SearchTiming {
      const timestamp = finishedAt ?? now();
      const elapsedMs = startedAt == null ? 0 : Math.max(0, timestamp - startedAt);
      const nodesPerSecond = elapsedMs >= 1_000 && visitedNodes >= 100
        ? visitedNodes * 1_000 / elapsedMs : null;
      let estimatedRemainingMs: number | null = null;
      let estimateBasis: SearchTiming["estimateBasis"] = null;
      if (finishedAt == null && nodesPerSecond != null) {
        if (maxVisitedNodes != null) {
          estimatedRemainingMs = Math.max(0, maxVisitedNodes - visitedNodes) / nodesPerSecond * 1_000;
          estimateBasis = "budget";
        } else if (startedAt != null && elapsedMs >= 5_000 && completedBranches >= 3 && completedBranches < totalBranches) {
          // Root branches can differ greatly. Require several completed samples,
          // and withdraw the estimate if the active branch outgrows that sample.
          const averageBranchMs = (lastBranchFinishedAt - startedAt) / completedBranches;
          const activeBranchMs = timestamp - lastBranchFinishedAt;
          if (averageBranchMs > 0 && activeBranchMs <= averageBranchMs * 1.5) {
            const remaining = averageBranchMs * (totalBranches - completedBranches) - activeBranchMs;
            if (remaining > 0) {
              estimatedRemainingMs = remaining;
              estimateBasis = "branches";
            }
          }
        }
      }
      return { elapsedMs, nodesPerSecond, estimatedRemainingMs, estimateBasis,
        completedBranches, totalBranches, searchFinished: finishedAt != null };
    },
  };
}
