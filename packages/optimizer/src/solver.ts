import type { GameCatalog, OptimizationResult, OptimizationScenario, RecipeDefinition, FacilityKind } from "@endfield/domain";
import {
  getFacilityLevelCapForControlNexus, getGrowthSlotCap, getMaxFacilityRoomCounts,
  getRoomSlotCap, getUnlockedFacilityRoomCount,
} from "@endfield/data";
import {
  DEFAULT_OPTIMIZATION_EFFORT, DEFAULT_OPTIMIZATION_PROFILE, OPTIMIZATION_PROFILE_EFFORTS,
  clampOptimizationEffort, getOptimizationSearchConfig,
} from "./config.js";
import { createAssignmentScorer } from "./assignment-scoring.js";
import { createOperatorPreference } from "./operator-preference.js";
import { boundAssignmentSearch } from "./search-space.js";
import { createSearchTiming } from "./search-timing.js";
import { searchRoomTeams } from "./team-search.js";
import type { OptimizationProgressSnapshot, OptimizationSearchConfig, SolveScenarioOptions } from "./types.js";

export interface NormalizedRoom {
  roomId: string;
  roomKind: FacilityKind;
  level: number;
  slotCap: number;
  fixedRecipeIds: string[];
  recipes: RecipeDefinition[];
}

export interface NormalizedScenarioResult {
  scenario: OptimizationScenario;
  rooms: NormalizedRoom[];
  warnings: string[];
}

export class OptimizationCancelledError extends Error {
  constructor(message = "Optimization canceled.") {
    super(message);
    this.name = "OptimizationCancelledError";
  }
}

function resolveSearchConfig(
  scenario: OptimizationScenario,
  limits: ReturnType<typeof boundAssignmentSearch>,
  options?: SolveScenarioOptions,
): OptimizationSearchConfig {
  const nodeLimit = limits.exceedsBoundedBudget ? Number.POSITIVE_INFINITY : limits.nodeUpperBound;
  if (options?.searchConfig) {
    return {
      ...options.searchConfig,
      effort: Math.min(limits.maxEffort, clampOptimizationEffort(options.searchConfig.effort)),
      maxVisitedNodes: options.searchConfig.maxVisitedNodes == null ? null : Math.min(nodeLimit, options.searchConfig.maxVisitedNodes),
      maxBranchCandidatesPerSlot: options.searchConfig.maxBranchCandidatesPerSlot == null ? null
        : Math.min(Math.max(1, limits.availableOperators), options.searchConfig.maxBranchCandidatesPerSlot),
    };
  }

  const profile = scenario.options.optimizationProfile ?? DEFAULT_OPTIMIZATION_PROFILE;
  const defaultEffort = profile === "custom"
    ? DEFAULT_OPTIMIZATION_EFFORT
    : OPTIMIZATION_PROFILE_EFFORTS[profile];
  // Maximum is an intent, including when a saved endpoint becomes outdated after
  // roster/facility edits outside the web UI.
  const effort = profile === "exhaustive" ? limits.maxEffort
    : Math.min(limits.maxEffort, clampOptimizationEffort(scenario.options.optimizationEffort ?? defaultEffort));

  const config = getOptimizationSearchConfig(profile, effort, limits.maxEffort);
  return { ...config, maxVisitedNodes: config.maxVisitedNodes == null ? null : Math.min(config.maxVisitedNodes, nodeLimit) };
}

function uniqueWarnings(warnings: string[]): string[] {
  return Array.from(new Set(warnings));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export function applyMaxFacilitiesOverlay(scenario: OptimizationScenario): OptimizationScenario {
  const normalized = cloneJson(scenario);
  const maxLayoutDefaults = getMaxFacilityRoomCounts();
  normalized.facilities.controlNexus.level = 5;

  for (const room of normalized.facilities.manufacturingCabins) {
    room.enabled = true;
    room.level = 3;
  }

  for (const room of normalized.facilities.growthChambers) {
    room.enabled = true;
    room.level = 3;
  }

  if (normalized.facilities.receptionRoom) {
    normalized.facilities.receptionRoom.enabled = true;
    normalized.facilities.receptionRoom.level = 3;
  }

  while (normalized.facilities.manufacturingCabins.length < maxLayoutDefaults.manufacturing_cabin) {
    normalized.facilities.manufacturingCabins.push({
      id: `mfg-${normalized.facilities.manufacturingCabins.length + 1}`,
      enabled: true,
      level: 3,
      fixedRecipeId: normalized.facilities.manufacturingCabins[0]?.fixedRecipeId,
    });
  }

  while (normalized.facilities.growthChambers.length < maxLayoutDefaults.growth_chamber) {
    normalized.facilities.growthChambers.push({
      id: `growth-${normalized.facilities.growthChambers.length + 1}`,
      enabled: true,
      level: 3,
      fixedRecipeIds: [...(normalized.facilities.growthChambers[0]?.fixedRecipeIds ?? [])],
    });
  }

  if (!normalized.facilities.receptionRoom) {
    normalized.facilities.receptionRoom = {
      id: "reception-1",
      enabled: true,
      level: 3,
    };
  }

  return normalized;
}

export function normalizeScenario(
  catalog: GameCatalog,
  scenario: OptimizationScenario,
): NormalizedScenarioResult {
  const warnings: string[] = [];
  const normalizedScenario = scenario.options.maxFacilities
    ? applyMaxFacilitiesOverlay(scenario)
    : cloneJson(scenario);
  const recipesById = indexById(catalog.recipes);
  const controlNexusLevel = normalizedScenario.facilities.controlNexus.level;
  const unlockedManufacturingRooms = getUnlockedFacilityRoomCount("manufacturing_cabin", controlNexusLevel);
  const unlockedGrowthRooms = getUnlockedFacilityRoomCount("growth_chamber", controlNexusLevel);
  const unlockedReceptionRooms = getUnlockedFacilityRoomCount("reception_room", controlNexusLevel);
  const manufacturingLevelCap = getFacilityLevelCapForControlNexus("manufacturing_cabin", controlNexusLevel);
  const growthLevelCap = getFacilityLevelCapForControlNexus("growth_chamber", controlNexusLevel);
  const receptionLevelCap = getFacilityLevelCapForControlNexus("reception_room", controlNexusLevel);
  const rooms: NormalizedRoom[] = [];

  const addRoom = (
    roomId: string,
    roomKind: FacilityKind,
    level: number,
    fixedRecipeIds: string[] = [],
  ) => {
    const slotCap = getRoomSlotCap(
      catalog,
      roomKind,
      level,
      normalizedScenario.facilities.controlNexus.level,
    );
    if (slotCap <= 0) {
      warnings.push(`Room '${roomId}' resolved to slot cap 0 and will be skipped by assignment search.`);
    }
    const normalizedRecipeIds = fixedRecipeIds.filter((recipeId) => {
      const recipe = recipesById.get(recipeId);
      if (!recipe) {
        return false;
      }
      if (recipe.roomLevel > level) {
        warnings.push(
          `Room '${roomId}' has recipe '${recipeId}' saved for room level ${recipe.roomLevel}, but current optimization uses room level ${level}; the recipe will be ignored for now.`,
        );
        return false;
      }
      return true;
    });
    const recipes = normalizedRecipeIds
      .map((recipeId) => recipesById.get(recipeId))
      .filter((recipe): recipe is RecipeDefinition => Boolean(recipe));
    if ((roomKind === "manufacturing_cabin" || roomKind === "growth_chamber") && normalizedRecipeIds.length === 0) {
      warnings.push(`Room '${roomId}' has no selected recipe and will contribute no production.`);
    }
    if (roomKind === "growth_chamber" && normalizedRecipeIds.length > getGrowthSlotCap(catalog, level)) {
      warnings.push(`Growth chamber '${roomId}' has more selected materials than its level supports; extra selections may be invalid.`);
    }
    rooms.push({ roomId, roomKind, level, slotCap, fixedRecipeIds: normalizedRecipeIds, recipes });
  };

  addRoom("control_nexus", "control_nexus", normalizedScenario.facilities.controlNexus.level);

  for (const [roomIndex, room] of normalizedScenario.facilities.manufacturingCabins.entries()) {
    if (!room.enabled) {
      continue;
    }
    if (roomIndex >= unlockedManufacturingRooms) {
      warnings.push(`Manufacturing cabin '${room.id}' is saved as enabled, but stays inactive until Control Nexus level 3.`);
      continue;
    }
    const effectiveLevel = Math.min(room.level, manufacturingLevelCap);
    if (room.level > manufacturingLevelCap) {
      warnings.push(
        `Manufacturing cabin '${room.id}' is set to level ${room.level}, but Control Nexus level ${controlNexusLevel} only supports level ${manufacturingLevelCap}. Optimization uses level ${effectiveLevel} for now.`,
      );
    }
    addRoom(room.id, "manufacturing_cabin", effectiveLevel, room.fixedRecipeId ? [room.fixedRecipeId] : []);
  }

  for (const [roomIndex, room] of normalizedScenario.facilities.growthChambers.entries()) {
    if (!room.enabled) {
      continue;
    }
    if (roomIndex >= unlockedGrowthRooms) {
      warnings.push(`Growth chamber '${room.id}' is saved as enabled, but stays inactive until Control Nexus level 2.`);
      continue;
    }
    const effectiveLevel = Math.min(room.level, growthLevelCap);
    if (room.level > growthLevelCap) {
      warnings.push(
        `Growth chamber '${room.id}' is set to level ${room.level}, but Control Nexus level ${controlNexusLevel} only supports level ${growthLevelCap}. Optimization uses level ${effectiveLevel} for now.`,
      );
    }
    addRoom(room.id, "growth_chamber", effectiveLevel, room.fixedRecipeIds ?? []);
  }

  if (normalizedScenario.facilities.receptionRoom?.enabled) {
    if (unlockedReceptionRooms === 0) {
      warnings.push("Reception room is saved as enabled, but stays inactive until Control Nexus level 3.");
    } else {
      const effectiveLevel = Math.min(normalizedScenario.facilities.receptionRoom.level, receptionLevelCap);
      if (normalizedScenario.facilities.receptionRoom.level > receptionLevelCap) {
        warnings.push(
          `Reception room is set to level ${normalizedScenario.facilities.receptionRoom.level}, but Control Nexus level ${controlNexusLevel} only supports level ${receptionLevelCap}. Optimization uses level ${effectiveLevel} for now.`,
        );
      }
      addRoom(
        normalizedScenario.facilities.receptionRoom.id,
        "reception_room",
        effectiveLevel,
      );
    }
  }

  return {
    scenario: normalizedScenario,
    rooms: rooms.filter((room) => room.slotCap > 0 || room.roomKind === "control_nexus"),
    warnings: uniqueWarnings(warnings),
  };
}

function buildHardAssignmentState(
  normalizedScenario: OptimizationScenario,
  rooms: NormalizedRoom[],
  ownedOperators: Map<string, OptimizationScenario["roster"][number]>,
  warnings: string[],
) {
  const roomMap = new Map(rooms.map((room) => [room.roomId, room]));
  const assignedByRoom = new Map(
    rooms.map((room) => [room.roomId, Array(room.slotCap).fill(null) as Array<string | null>]),
  );
  const hardAssignedOperatorIds = new Set<string>();

  for (const assignment of normalizedScenario.facilities.hardAssignments) {
    const room = roomMap.get(assignment.roomId);
    if (!room) {
      warnings.push(`Ignoring hard assignment for unknown room '${assignment.roomId}'.`);
      continue;
    }
    if (!ownedOperators.has(assignment.operatorId)) {
      warnings.push(`Ignoring hard assignment for non-owned operator '${assignment.operatorId}'.`);
      continue;
    }
    if (hardAssignedOperatorIds.has(assignment.operatorId)) {
      warnings.push(`Ignoring duplicate hard assignment for operator '${assignment.operatorId}'.`);
      continue;
    }

    const roomAssignments = assignedByRoom.get(room.roomId)!;
    const targetIndex = roomAssignments.findIndex((value) => value === null);
    if (targetIndex == null || targetIndex < 0 || targetIndex >= roomAssignments.length) {
      warnings.push(`Ignoring hard assignment for operator '${assignment.operatorId}' because no valid slot is available in room '${room.roomId}'.`);
      continue;
    }

    roomAssignments[targetIndex] = assignment.operatorId;
    hardAssignedOperatorIds.add(assignment.operatorId);
  }

  return { assignedByRoom, hardAssignedOperatorIds };
}

function cloneAssignedByRoom(assignedByRoom: Map<string, Array<string | null>>) {
  return new Map(
    Array.from(assignedByRoom.entries(), ([roomId, assignments]) => [roomId, [...assignments]]),
  );
}

function prepareSearchState(catalog: GameCatalog, normalized: NormalizedScenarioResult, warnings: string[]) {
  const knownIds = new Set(catalog.operators.map((operator) => operator.id));
  const owned = new Map(normalized.scenario.roster.filter((operator) => operator.owned && knownIds.has(operator.operatorId))
    .map((operator) => [operator.operatorId, operator]));
  const hard = buildHardAssignmentState(normalized.scenario, normalized.rooms, owned, warnings);
  const limits = boundAssignmentSearch(owned.size - hard.hardAssignedOperatorIds.size,
    [...hard.assignedByRoom.values()].map((assignments) => assignments.filter((id) => id == null).length));
  return { owned, hard, limits };
}

/** Includes active facilities and valid hard assignments; safe for every unlock counterfactual. */
export function getOptimizationSearchLimits(catalog: GameCatalog, scenario: OptimizationScenario) {
  return prepareSearchState(catalog, normalizeScenario(catalog, scenario), []).limits;
}

export function getScenarioSearchConfig(catalog: GameCatalog, scenario: OptimizationScenario) {
  return resolveSearchConfig(scenario, getOptimizationSearchLimits(catalog, scenario));
}

export function solveNormalizedScenario(
  catalog: GameCatalog,
  normalized: NormalizedScenarioResult,
  options?: SolveScenarioOptions,
): OptimizationResult {
  const warnings = [...normalized.warnings];
  const { scenario, rooms } = normalized;
  const { owned, hard, limits } = prepareSearchState(catalog, normalized, warnings);
  const config = resolveSearchConfig(scenario, limits, options);
  const compareOperators = createOperatorPreference(catalog.operators);
  const available = [...owned.keys()].filter((id) => !hard.hardAssignedOperatorIds.has(id)).sort(compareOperators);
  const scorer = createAssignmentScorer(catalog, scenario, rooms);
  // Keep each room's slots together to eliminate equivalent worker permutations.
  // Control is considered after productive rooms, when its actual benefit is known.
  const orderedRooms = [...rooms].sort((left, right) => {
    if (left.roomKind === "control_nexus") return 1;
    if (right.roomKind === "control_nexus") return -1;
    return scorer.roomUpperBound(right.roomId, [], [...owned.keys()], right.slotCap)
      - scorer.roomUpperBound(left.roomId, [], [...owned.keys()], left.slotCap);
  });
  const slots = orderedRooms.flatMap((room) => Array.from({ length: room.slotCap }, (_, index) => ({ roomId: room.roomId, index }))
    .filter((slot) => hard.assignedByRoom.get(slot.roomId)![slot.index] == null));
  let bestAssignments = cloneAssignedByRoom(hard.assignedByRoom);
  let bestScore = scorer.score(bestAssignments);
  let bestWorkerCount = hard.hardAssignedOperatorIds.size;
  let visitedNodes = 0;
  let budgetExceeded = false;
  let candidatesLimited = false;
  const searchTiming = createSearchTiming(config.maxVisitedNodes);
  let lastProgressAt = Number.NEGATIVE_INFINITY;
  const maybeCancel = () => {
    if (options?.shouldCancel?.()) throw new OptimizationCancelledError();
  };
  const emitProgress = (phase: string, currentDepth: number) => {
    if (!options?.onProgress) return;
    const now = performance.now();
    // Unlimited searches can visit hundreds of thousands of nodes per second.
    // Keep worker messages and React updates from consuming that search time.
    if ((phase === "Searching assignments" || phase === "Scoring room combinations")
      && visitedNodes > 1 && now - lastProgressAt < 250) return;
    lastProgressAt = now;
    options?.onProgress?.({
      phase, visitedNodes, totalSlots: slots.length, currentDepth, bestScore,
      maxBranchCandidatesPerSlot: config.maxBranchCandidatesPerSlot,
      profileLabel: config.profileLabel, effort: config.effort,
      maxVisitedNodes: config.maxVisitedNodes,
      timing: searchTiming.snapshot(visitedNodes),
    } satisfies OptimizationProgressSnapshot);
  };
  const freeIds = (assignment: Map<string, Array<string | null>>) => {
    const used = new Set([...assignment.values()].flat().filter(Boolean));
    return available.filter((id) => !used.has(id));
  };
  const workersIn = (assignment: Map<string, Array<string | null>>) =>
    [...assignment.values()].flat().filter((id): id is string => id != null);
  const compareLists = (left: string[], right: string[]) => {
    left.sort(compareOperators);
    right.sort(compareOperators);
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const order = compareOperators(left[index]!, right[index]!);
      if (order !== 0) return order;
    }
    return left.length - right.length;
  };
  const compareAssignments = (
    left: Map<string, Array<string | null>>, right: Map<string, Array<string | null>>,
  ) => {
    // Prefer the workforce first, then resolve placement ties in stable room order.
    const workforce = compareLists(workersIn(left), workersIn(right));
    if (workforce !== 0) return workforce;
    for (const room of rooms) {
      const order = compareLists(
        left.get(room.roomId)!.filter((id): id is string => id != null),
        right.get(room.roomId)!.filter((id): id is string => id != null),
      );
      if (order !== 0) return order;
    }
    return 0;
  };
  const greedyFill = (assignment: Map<string, Array<string | null>>) => {
    let current = scorer.score(assignment);
    while (true) {
      let next: { roomId: string; index: number; id: string; score: number } | undefined;
      for (const room of rooms) {
        const values = assignment.get(room.roomId)!;
        const index = values.indexOf(null);
        if (index < 0) continue;
        for (const id of freeIds(assignment)) {
          maybeCancel();
          if (!scorer.canContribute(room.roomId, id)) continue;
          values[index] = id;
          const score = scorer.score(assignment);
          values[index] = null;
          if (score > (next?.score ?? current) + 1e-12
            || (next && score === next.score && compareOperators(id, next.id) < 0)) {
            next = { roomId: room.roomId, index, id, score };
          }
        }
      }
      if (!next) return current;
      assignment.get(next.roomId)![next.index] = next.id;
      current = next.score;
    }
  };
  const accept = (assignment: Map<string, Array<string | null>>, score: number) => {
    const workers = [...assignment.values()].flat().filter(Boolean).length;
    if (score > bestScore || (score === bestScore && (workers < bestWorkerCount
      || (workers === bestWorkerCount && compareAssignments(assignment, bestAssignments) < 0)))) {
      bestAssignments = cloneAssignedByRoom(assignment);
      bestScore = score;
      bestWorkerCount = workers;
    }
  };
  const assigned = hard.assignedByRoom;
  const dfs = (depth: number, remaining: string[], currentScore: number) => {
    maybeCancel();
    if (config.maxVisitedNodes != null && visitedNodes >= config.maxVisitedNodes) {
      budgetExceeded = true;
      return;
    }
    visitedNodes += 1;
    accept(assigned, currentScore);
    if (visitedNodes === 1 || visitedNodes % Math.max(1, config.progressIntervalNodes) === 0) {
      emitProgress("Searching assignments", depth);
    }
    if (depth >= slots.length || remaining.length === 0) return;

    // Full active output bounds every possible Mood/production synergy. A worker
    // may be reused between these room bounds; this intentionally overestimates.
    const upperBound = rooms.reduce((sum, room) => sum + scorer.roomUpperBound(
      room.roomId,
      assigned.get(room.roomId)!.filter((id): id is string => id != null),
      remaining,
      slots.slice(depth).filter((slot) => slot.roomId === room.roomId).length,
    ), 0);
    if (upperBound < bestScore - 1e-12) return;

    const slot = slots[depth]!;
    const roomAssignments = assigned.get(slot.roomId)!;
    const previousSlot = slots[depth - 1];
    const previousId = previousSlot?.roomId === slot.roomId ? roomAssignments[previousSlot.index] : null;
    const candidates = remaining.filter((id) => (previousId == null || id > previousId) && scorer.canContribute(slot.roomId, id)).map((id) => {
      roomAssignments[slot.index] = id;
      const score = scorer.score(assigned);
      roomAssignments[slot.index] = null;
      return { id, score };
    }).sort((left, right) => right.score - left.score || compareOperators(left.id, right.id));
    const branchCap = config.maxBranchCandidatesPerSlot;
    const largeSearch = branchCap != null && remaining.length * (slots.length - depth) > Math.max(20, branchCap * 10);
    const limit = largeSearch ? branchCap : candidates.length;
    if (depth === 0) searchTiming.setTotalBranches(Math.min(limit, candidates.length) + 1);
    if (candidates.length > limit) candidatesLimited = true;
    for (const candidate of candidates.slice(0, limit)) {
      if (budgetExceeded) break;
      roomAssignments[slot.index] = candidate.id;
      dfs(depth + 1, remaining.filter((id) => id !== candidate.id), candidate.score);
      if (depth === 0 && !budgetExceeded) searchTiming.completeBranch();
      roomAssignments[slot.index] = null;
    }
    // Leaving the remainder of ANY room empty is a valid allocation. In
    // particular a short roster must be able to prioritize a later room.
    if (!budgetExceeded) {
      let nextRoom = depth + 1;
      while (slots[nextRoom]?.roomId === slot.roomId) nextRoom += 1;
      dfs(nextRoom, remaining, currentScore);
      if (depth === 0 && !budgetExceeded) searchTiming.completeBranch();
    }
  };
  maybeCancel();
  emitProgress("Preparing search", 0);
  const initial = cloneAssignedByRoom(hard.assignedByRoom);
  accept(initial, greedyFill(initial));
  if (options?.initialAssignments) {
    const hinted = cloneAssignedByRoom(hard.assignedByRoom);
    for (const plan of options.initialAssignments) {
      const values = hinted.get(plan.roomId);
      if (!values) continue;
      for (const id of plan.assignedOperatorIds) {
        const index = values.indexOf(null);
        if (index < 0) break;
        if (freeIds(hinted).includes(id)) values[index] = id;
      }
    }
    accept(hinted, scorer.score(hinted));
    accept(hinted, greedyFill(hinted));
  }
  searchTiming.start();
  if (config.maxVisitedNodes == null && config.maxBranchCandidatesPerSlot == null) {
    searchRoomTeams({
      rooms, available, hardAssignments: hard.assignedByRoom, scorer, compareOperators,
      best: () => ({ score: bestScore, assignments: bestAssignments, workerCount: bestWorkerCount }),
      accept, checkCancel: maybeCancel,
      visit: (depth) => {
        visitedNodes += 1;
        if (visitedNodes === 1 || visitedNodes % config.progressIntervalNodes === 0) emitProgress("Searching assignments", depth);
      },
      phase: (phase) => emitProgress(phase, 0),
      rootCount: (count) => searchTiming.setTotalBranches(count),
      rootComplete: () => searchTiming.completeBranch(),
    });
  } else {
    dfs(0, available, scorer.score(hard.assignedByRoom));
  }
  searchTiming.finish();
  maybeCancel();
  emitProgress("Improving best assignment", slots.length);
  // A truncated search should still complete useful empty slots and check local
  // reallocations. Hard assignments remain fixed during these bounded passes.
  for (let pass = 0; pass < 4; pass += 1) {
    const current = cloneAssignedByRoom(bestAssignments);
    accept(current, greedyFill(current));
    let improvement: Map<string, Array<string | null>> | undefined;
    let improvedScore = bestScore;
    const movable = slots.filter((slot) => current.get(slot.roomId)![slot.index] != null);
    const unassigned = freeIds(current);
    for (const source of movable) {
      const sourceValues = current.get(source.roomId)!;
      const sourceId = sourceValues[source.index]!;
      // Replace a worker with a currently unassigned operator.
      for (const id of unassigned) {
        maybeCancel();
        if (!scorer.canContribute(source.roomId, id)) continue;
        sourceValues[source.index] = id;
        const score = scorer.score(current);
        if (score > improvedScore + 1e-12) { improvedScore = score; improvement = cloneAssignedByRoom(current); }
      }
      sourceValues[source.index] = sourceId;
      // Swap workers between rooms, or move one to an empty slot.
      for (const target of slots) {
        maybeCancel();
        if (source.roomId === target.roomId) continue;
        const targetValues = current.get(target.roomId)!;
        const targetId = targetValues[target.index]!;
        sourceValues[source.index] = targetId;
        targetValues[target.index] = sourceId;
        const score = scorer.score(current);
        if (score > improvedScore + 1e-12) { improvedScore = score; improvement = cloneAssignedByRoom(current); }
        sourceValues[source.index] = sourceId;
        targetValues[target.index] = targetId;
      }
    }
    if (!improvement) break;
    accept(improvement, improvedScore);
  }
  const completed = cloneAssignedByRoom(bestAssignments);
  accept(completed, greedyFill(completed));
  // Budget-limited search must still resolve every single-worker tie. Each
  // replacement strictly improves the finite preference order, so this terminates.
  let changed = true;
  while (changed) {
    changed = false;
    for (const slot of slots) {
      const values = bestAssignments.get(slot.roomId)!;
      const original = values[slot.index];
      if (original == null) continue;
      for (const id of freeIds(bestAssignments)) {
        maybeCancel();
        if (compareOperators(id, original) >= 0) continue;
        values[slot.index] = id;
        if (scorer.score(bestAssignments) === bestScore) {
          changed = true;
          break;
        }
        values[slot.index] = original;
      }
    }
  }
  maybeCancel();
  if (budgetExceeded) warnings.push(`Optimization search stopped after ${visitedNodes} visited nodes using the '${config.profileLabel}' profile.`);
  if (candidatesLimited) warnings.push("Candidate limits were used; this is the best assignment found within the selected search effort.");
  emitProgress("Scoring best plan", slots.length);
  const result = scorer.result(bestAssignments);
  result.search = {
    complete: !budgetExceeded && !candidatesLimited,
    visitedNodes,
    maxVisitedNodes: config.maxVisitedNodes,
    budgetExceeded,
    candidatesLimited,
  };
  for (const plan of result.roomPlans) {
    plan.assignedOperatorIds.sort(compareOperators);
    const values = bestAssignments.get(plan.roomId)!;
    const unassigned = freeIds(bestAssignments);
    plan.alternativeOperatorIdsBySlot = Array.from({ length: plan.slotCap ?? values.length }, (_, index) => {
      const original = plan.assignedOperatorIds[index] ?? null;
      if (original != null && hard.hardAssignedOperatorIds.has(original)) return [];
      const assignmentIndex = values.indexOf(original);
      if (assignmentIndex < 0) return [];
      const alternatives: string[] = [];
      for (const id of unassigned) {
        maybeCancel();
        values[assignmentIndex] = id;
        if (scorer.score(bestAssignments) === bestScore) alternatives.push(id);
      }
      values[assignmentIndex] = original;
      return alternatives;
    });
  }
  result.warnings = uniqueWarnings([...warnings, ...result.warnings]);
  return result;
}

export function solveScenario(catalog: GameCatalog, scenario: OptimizationScenario, options?: SolveScenarioOptions): OptimizationResult {
  return solveNormalizedScenario(catalog, normalizeScenario(catalog, scenario), options);
}
