import { MAX_OPTIMIZATION_EFFORT, getOptimizationSearchConfig } from "./config.js";

/** A structural bound, independent of skill ranks, scoring and room search order. */
export function boundAssignmentSearch(availableOperators: number, roomSlots: number[]) {
  const slots = roomSlots.reduce((sum, count) => sum + count, 0);
  const maximumBudget = getOptimizationSearchConfig("custom", MAX_OPTIMIZATION_EFFORT - 1).maxVisitedNodes!;
  // Beyond the largest bounded setting, the slider endpoint selects unlimited search.
  const ceiling = maximumBudget + 1;
  const saturate = (value: number) => Math.min(ceiling, value);
  let allocations = [1];
  for (const capacity of roomSlots) {
    const next = Array(Math.min(availableOperators, allocations.length - 1 + capacity) + 1).fill(0) as number[];
    for (let used = 0; used < allocations.length; used += 1) {
      let combinations = 1;
      for (let count = 0; count <= Math.min(capacity, availableOperators - used); count += 1) {
        if (count > 0) combinations = combinations * (availableOperators - used - count + 1) / count;
        next[used + count] = saturate(next[used + count]! + allocations[used]! * combinations);
      }
    }
    allocations = next;
  }
  // Each distinct unordered room allocation has at most slots + 1 ancestors.
  // Counting all allocations (including empty rooms) overestimates DFS leaves.
  const nodeUpperBound = availableOperators === 0 || slots === 0
    ? 1
    : saturate((slots + 1) * allocations.reduce((sum, count) => saturate(sum + count), 0));
  let maxEffort = MAX_OPTIMIZATION_EFFORT;
  for (let effort = 1; effort < MAX_OPTIMIZATION_EFFORT; effort += 1) {
    const config = getOptimizationSearchConfig("custom", effort);
    // Mirror the solver's large-search gate. Either all operators fit the cap,
    // or no state can activate candidate truncation at this effort.
    const allCandidatesFit = config.maxBranchCandidatesPerSlot! >= availableOperators
      || availableOperators * slots <= Math.max(20, config.maxBranchCandidatesPerSlot! * 10);
    if (config.maxVisitedNodes! >= nodeUpperBound && allCandidatesFit) {
      maxEffort = effort;
      break;
    }
  }
  return {
    availableOperators,
    openSlots: slots,
    nodeUpperBound,
    exceedsBoundedBudget: nodeUpperBound > maximumBudget,
    maxEffort,
  };
}
