import type {
  AssignmentExplanation,
  BaseSkillDefinition,
  BaseSkillRankDefinition,
  DataConfidence,
  FacilityKind,
  GameCatalog,
  OptimizationResult,
  OptimizationScenario,
  OperatorDefinition,
  ProductKind,
  RecipeDefinition,
  RoomPlan,
  ScoreBreakdown,
} from "@endfield/domain";

import { createProjectedOutputs, getMaxFacilityRoomCounts, getRoomSlotCap } from "@endfield/data";

import { SUPPORT_WEIGHTS } from "./config.js";

interface NormalizedRoom {
  roomId: string;
  roomKind: FacilityKind;
  level: number;
  slotCap: number;
  fixedRecipeId?: string;
  recipe?: RecipeDefinition;
}

export interface NormalizedScenarioResult {
  scenario: OptimizationScenario;
  rooms: NormalizedRoom[];
  warnings: string[];
}

interface OperatorRoomEvaluation {
  directPercent: number;
  supportScore: number;
  crossRoomScore: number;
  reasons: string[];
  usedFallbackHeuristics: boolean;
  dataConfidence: DataConfidence;
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
      fixedRecipeId: normalized.facilities.growthChambers[0]?.fixedRecipeId,
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
  const rooms: NormalizedRoom[] = [];

  const addRoom = (
    roomId: string,
    roomKind: FacilityKind,
    level: number,
    fixedRecipeId?: string,
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
    const recipe = fixedRecipeId ? recipesById.get(fixedRecipeId) : undefined;
    if ((roomKind === "manufacturing_cabin" || roomKind === "growth_chamber") && !fixedRecipeId) {
      warnings.push(`Room '${roomId}' has no selected recipe and will contribute no production.`);
    }
    rooms.push({ roomId, roomKind, level, slotCap, fixedRecipeId, recipe });
  };

  addRoom("control_nexus", "control_nexus", normalizedScenario.facilities.controlNexus.level);

  for (const room of normalizedScenario.facilities.manufacturingCabins) {
    if (room.enabled) {
      addRoom(room.id, "manufacturing_cabin", room.level, room.fixedRecipeId);
    }
  }

  for (const room of normalizedScenario.facilities.growthChambers) {
    if (room.enabled) {
      addRoom(room.id, "growth_chamber", room.level, room.fixedRecipeId);
    }
  }

  if (normalizedScenario.options.includeReceptionRoom !== false && normalizedScenario.facilities.receptionRoom?.enabled) {
    addRoom(
      normalizedScenario.facilities.receptionRoom.id,
      "reception_room",
      normalizedScenario.facilities.receptionRoom.level,
    );
  }

  return {
    scenario: normalizedScenario,
    rooms: rooms.filter((room) => room.slotCap > 0 || room.roomKind === "control_nexus"),
    warnings: uniqueWarnings(warnings),
  };
}

function getOwnedOperatorStateMap(scenario: OptimizationScenario) {
  return new Map(
    scenario.roster
      .filter((operator) => operator.owned)
      .map((operator) => [operator.operatorId, operator]),
  );
}

function getUnlockedRank(ownedOperator: OptimizationScenario["roster"][number], skillId: string) {
  return ownedOperator.baseSkillStates.find((entry) => entry.skillId === skillId)?.unlockedRank ?? 0;
}

function getBaseRoomUnits(room: NormalizedRoom, horizonHours: number, warnings: string[]) {
  if (!room.recipe) {
    return 0;
  }
  const duration = room.recipe.baseDurationMinutes ?? 0;
  const outputAmount = room.recipe.outputAmount ?? 1;

  if (room.recipe.baseDurationMinutes == null) {
    warnings.push(`Recipe '${room.recipe.id}' is missing duration data; assuming one baseline run per horizon.`);
  }
  if (room.recipe.outputAmount == null) {
    warnings.push(`Recipe '${room.recipe.id}' is missing output amount; assuming one baseline unit.`);
  }
  if (duration <= 0) {
    return outputAmount;
  }

  return (horizonHours * 60 / duration) * outputAmount;
}

function evaluateRankModifiers(rankDef: BaseSkillRankDefinition, room: NormalizedRoom): OperatorRoomEvaluation {
  let directPercent = 0;
  let supportScore = 0;
  let crossRoomScore = 0;
  const reasons: string[] = [];

  for (const modifier of rankDef.modifiers) {
    if (
      modifier.appliesTo !== "all" &&
      room.recipe?.productKind &&
      modifier.appliesTo !== room.recipe.productKind
    ) {
      continue;
    }

    switch (modifier.metric) {
      case "production_efficiency":
      case "growth_rate":
        directPercent += modifier.value;
        reasons.push(`${modifier.metric} +${modifier.value}%`);
        break;
      case "mood_regen":
        if (room.roomKind === "control_nexus") {
          crossRoomScore += modifier.value * SUPPORT_WEIGHTS.controlNexusMoodRegenWeight;
          reasons.push(`control support +${(modifier.value * SUPPORT_WEIGHTS.controlNexusMoodRegenWeight).toFixed(1)}`);
        } else if (room.roomKind === "manufacturing_cabin") {
          directPercent += modifier.value * SUPPORT_WEIGHTS.manufacturingMoodSustainFactor;
          reasons.push(`mood sustain +${(modifier.value * SUPPORT_WEIGHTS.manufacturingMoodSustainFactor).toFixed(1)}%`);
        } else if (room.roomKind === "growth_chamber") {
          directPercent += modifier.value * SUPPORT_WEIGHTS.growthMoodSustainFactor;
          reasons.push(`growth sustain +${(modifier.value * SUPPORT_WEIGHTS.growthMoodSustainFactor).toFixed(1)}%`);
        } else {
          supportScore += modifier.value * SUPPORT_WEIGHTS.offRoomClueWeight;
          reasons.push(`support utility +${(modifier.value * SUPPORT_WEIGHTS.offRoomClueWeight).toFixed(1)}`);
        }
        break;
      case "mood_drop_reduction":
        if (room.roomKind === "control_nexus") {
          crossRoomScore += modifier.value * SUPPORT_WEIGHTS.controlNexusMoodDropReductionWeight;
          reasons.push(`cross-room sustain +${(modifier.value * SUPPORT_WEIGHTS.controlNexusMoodDropReductionWeight).toFixed(1)}`);
        } else if (room.roomKind === "manufacturing_cabin") {
          directPercent += modifier.value * SUPPORT_WEIGHTS.manufacturingMoodSustainFactor;
          reasons.push(`room sustain +${(modifier.value * SUPPORT_WEIGHTS.manufacturingMoodSustainFactor).toFixed(1)}%`);
        } else if (room.roomKind === "growth_chamber") {
          directPercent += modifier.value * SUPPORT_WEIGHTS.growthMoodSustainFactor;
          reasons.push(`room sustain +${(modifier.value * SUPPORT_WEIGHTS.growthMoodSustainFactor).toFixed(1)}%`);
        }
        break;
      case "clue_collection_efficiency":
        supportScore +=
          room.roomKind === "reception_room"
            ? modifier.value * SUPPORT_WEIGHTS.receptionClueCollectionWeight
            : modifier.value * SUPPORT_WEIGHTS.offRoomClueWeight;
        reasons.push(`clue utility +${modifier.value}%`);
        break;
      case "clue_rate_up":
        supportScore += 0;
        reasons.push(
          `clue targeting recorded (+${modifier.value}%) but treated as score-neutral; use hard assignments if you want a specific clue number.`,
        );
        break;
    }
  }

  return {
    directPercent,
    supportScore,
    crossRoomScore,
    reasons,
    usedFallbackHeuristics: false,
    dataConfidence: rankDef.dataConfidence ?? "verified",
  };
}

function fallbackEvaluation(
  operatorDef: OperatorDefinition,
  unlockedRank: number,
  room: NormalizedRoom,
): OperatorRoomEvaluation {
  if (room.roomKind === "control_nexus" || room.roomKind === "reception_room") {
    return {
      directPercent: 0,
      supportScore:
        room.roomKind === "reception_room"
          ? unlockedRank * SUPPORT_WEIGHTS.fallbackSupportPercentPerRank
          : 0,
      crossRoomScore:
        room.roomKind === "control_nexus"
          ? unlockedRank * SUPPORT_WEIGHTS.fallbackSupportPercentPerRank
          : 0,
      reasons: [`${operatorDef.name} uses fallback support scoring because precise modifiers are missing.`],
      usedFallbackHeuristics: true,
      dataConfidence: "heuristic",
    };
  }

  return {
    directPercent: unlockedRank * SUPPORT_WEIGHTS.fallbackProductionPercentPerRank,
    supportScore: 0,
    crossRoomScore: 0,
    reasons: [`${operatorDef.name} uses fallback production scoring because precise modifiers are missing.`],
    usedFallbackHeuristics: true,
    dataConfidence: "heuristic",
  };
}

function evaluateOperatorForRoom(
  operatorDef: OperatorDefinition,
  ownedOperator: OptimizationScenario["roster"][number],
  room: NormalizedRoom,
): OperatorRoomEvaluation {
  let directPercent = 0;
  let supportScore = 0;
  let crossRoomScore = 0;
  let usedFallbackHeuristics = false;
  const reasons: string[] = [];
  const confidences: DataConfidence[] = [];

  for (const skill of operatorDef.baseSkills) {
    if (skill.facilityKind !== room.roomKind) {
      continue;
    }

    const unlockedRank = getUnlockedRank(ownedOperator, skill.id);
    if (unlockedRank <= 0) {
      continue;
    }

    const rankDef = skill.ranks.find((entry) => entry.rank === unlockedRank);
    if (!rankDef || rankDef.modifiers.length === 0) {
      const fallback = fallbackEvaluation(operatorDef, unlockedRank, room);
      directPercent += fallback.directPercent;
      supportScore += fallback.supportScore;
      crossRoomScore += fallback.crossRoomScore;
      usedFallbackHeuristics ||= fallback.usedFallbackHeuristics;
      reasons.push(...fallback.reasons);
      confidences.push(fallback.dataConfidence);
      continue;
    }

    const evaluation = evaluateRankModifiers(rankDef, room);
    directPercent += evaluation.directPercent;
    supportScore += evaluation.supportScore;
    crossRoomScore += evaluation.crossRoomScore;
    usedFallbackHeuristics ||= evaluation.usedFallbackHeuristics;
    reasons.push(
      `${skill.name} rank ${unlockedRank}: ${evaluation.reasons.join(", ") || "no active modifier for this room"}.`,
    );
    confidences.push(skill.dataConfidence ?? "verified");
    confidences.push(evaluation.dataConfidence);
  }

  return {
    directPercent,
    supportScore,
    crossRoomScore,
    reasons,
    usedFallbackHeuristics,
    dataConfidence: confidences.includes("heuristic")
      ? "heuristic"
      : confidences.includes("provisional")
        ? "provisional"
        : "verified",
  };
}

function createRoomSlots(rooms: NormalizedRoom[]) {
  const slots: Array<{ roomId: string; slotIndex: number }> = [];
  for (const room of rooms) {
    for (let slotIndex = 0; slotIndex < room.slotCap; slotIndex += 1) {
      slots.push({ roomId: room.roomId, slotIndex });
    }
  }
  return slots;
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
    let targetIndex = assignment.slotIndex;
    if (targetIndex == null) {
      targetIndex = roomAssignments.findIndex((value) => value === null);
    }
    if (targetIndex == null || targetIndex < 0 || targetIndex >= roomAssignments.length) {
      warnings.push(`Ignoring hard assignment for operator '${assignment.operatorId}' because no valid slot is available in room '${room.roomId}'.`);
      continue;
    }
    if (roomAssignments[targetIndex] != null) {
      warnings.push(`Ignoring hard assignment for operator '${assignment.operatorId}' because slot ${targetIndex} in room '${room.roomId}' is already occupied.`);
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

function buildScoreBreakdown(
  room: NormalizedRoom,
  baseUnits: number,
  aggregateDirectPercent: number,
  aggregateSupportScore: number,
  aggregateCrossRoomScore: number,
): ScoreBreakdown {
  const directProductionScore =
    room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber"
      ? baseUnits * (1 + aggregateDirectPercent / 100)
      : 0;
  const supportRoomScore = room.roomKind === "reception_room" ? aggregateSupportScore : 0;
  const crossRoomBonusContribution = room.roomKind === "control_nexus" ? aggregateCrossRoomScore : 0;

  return {
    directProductionScore,
    supportRoomScore,
    crossRoomBonusContribution,
    totalScore: directProductionScore + supportRoomScore + crossRoomBonusContribution,
  };
}

function computeRoomPlan(
  room: NormalizedRoom,
  assignedOperatorIds: Array<string | null>,
  operatorDefs: Map<string, OperatorDefinition>,
  ownedOperators: Map<string, OptimizationScenario["roster"][number]>,
  horizonHours: number,
  inheritedWarnings: string[],
): { roomPlan: RoomPlan; explanations: AssignmentExplanation[] } {
  const warnings = [...inheritedWarnings];
  const projectedOutputs = createProjectedOutputs();
  const explanations: AssignmentExplanation[] = [];
  const baseUnits = getBaseRoomUnits(room, horizonHours, warnings);

  let aggregateDirectPercent = 0;
  let aggregateSupportScore = 0;
  let aggregateCrossRoomScore = 0;
  let usedFallbackHeuristics = false;
  let dataConfidence: DataConfidence = room.recipe?.dataConfidence ?? "verified";

  for (const operatorId of assignedOperatorIds.filter(Boolean) as string[]) {
    const operatorDef = operatorDefs.get(operatorId);
    const ownedOperator = ownedOperators.get(operatorId);
    if (!operatorDef || !ownedOperator) {
      continue;
    }

    const evaluation = evaluateOperatorForRoom(operatorDef, ownedOperator, room);
    aggregateDirectPercent += evaluation.directPercent;
    aggregateSupportScore += evaluation.supportScore;
    aggregateCrossRoomScore += evaluation.crossRoomScore;
    usedFallbackHeuristics ||= evaluation.usedFallbackHeuristics;
    dataConfidence = evaluation.dataConfidence === "heuristic" || dataConfidence === "heuristic"
      ? "heuristic"
      : evaluation.dataConfidence === "provisional" || dataConfidence === "provisional"
        ? "provisional"
        : "verified";

    explanations.push({
      operatorId,
      roomId: room.roomId,
      projectedContribution:
        room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber"
          ? baseUnits * (evaluation.directPercent / 100)
          : evaluation.supportScore + evaluation.crossRoomScore,
      reasons:
        evaluation.reasons.length > 0
          ? evaluation.reasons
          : [`${operatorDef.name} has no known active Base Skill contribution in ${room.roomId}.`],
      dataConfidence: evaluation.dataConfidence,
    });
  }

  const scoreBreakdown = buildScoreBreakdown(
    room,
    baseUnits,
    aggregateDirectPercent,
    aggregateSupportScore,
    aggregateCrossRoomScore,
  );

  if (room.recipe && (room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber")) {
    projectedOutputs[room.recipe.productKind] += scoreBreakdown.directProductionScore;
  }

  return {
    roomPlan: {
      roomId: room.roomId,
      roomKind: room.roomKind,
      roomLevel: room.level,
      chosenRecipeId: room.fixedRecipeId,
      chosenProductKind: room.recipe?.productKind,
      assignedOperatorIds: assignedOperatorIds.filter(Boolean) as string[],
      scoreBreakdown,
      projectedScore: scoreBreakdown.totalScore,
      projectedOutputs,
      warnings: uniqueWarnings(warnings),
      usedFallbackHeuristics,
      dataConfidence,
    },
    explanations,
  };
}

function summarizePlans(roomPlans: RoomPlan[]) {
  const projectedOutputs = createProjectedOutputs();
  const projectedRecipeOutputs: Record<string, number> = {};
  let totalScore = 0;

  for (const roomPlan of roomPlans) {
    totalScore += roomPlan.projectedScore;
    for (const [productKind, value] of Object.entries(roomPlan.projectedOutputs) as Array<[ProductKind, number]>) {
      projectedOutputs[productKind] += value;
    }
    if (roomPlan.chosenRecipeId) {
      projectedRecipeOutputs[roomPlan.chosenRecipeId] =
        (projectedRecipeOutputs[roomPlan.chosenRecipeId] ?? 0) + roomPlan.scoreBreakdown.directProductionScore;
    }
  }

  return { totalScore, projectedOutputs, projectedRecipeOutputs };
}

export function solveNormalizedScenario(
  catalog: GameCatalog,
  normalizedScenarioResult: NormalizedScenarioResult,
): OptimizationResult {
  const warnings = [...normalizedScenarioResult.warnings];
  const operatorDefs = indexById(catalog.operators);
  const ownedOperators = getOwnedOperatorStateMap(normalizedScenarioResult.scenario);
  const rooms = normalizedScenarioResult.rooms;
  const roomMap = new Map(rooms.map((room) => [room.roomId, room]));
  const hardState = buildHardAssignmentState(normalizedScenarioResult.scenario, rooms, ownedOperators, warnings);

  const slotQueue = createRoomSlots(rooms)
    .filter(({ roomId, slotIndex }) => hardState.assignedByRoom.get(roomId)?.[slotIndex] == null)
    .sort((left, right) => {
      const leftRoom = roomMap.get(left.roomId)!;
      const rightRoom = roomMap.get(right.roomId)!;
      const leftBase = getBaseRoomUnits(leftRoom, normalizedScenarioResult.scenario.options.horizonHours, warnings);
      const rightBase = getBaseRoomUnits(rightRoom, normalizedScenarioResult.scenario.options.horizonHours, warnings);
      return rightBase - leftBase;
    });

  const availableOperatorIds = Array.from(ownedOperators.keys()).filter(
    (operatorId) => !hardState.hardAssignedOperatorIds.has(operatorId),
  );

  let best = {
    score: Number.NEGATIVE_INFINITY,
    assignedByRoom: hardState.assignedByRoom,
  };

  const optimisticContributionCache = new Map<string, number>();
  for (const operatorId of availableOperatorIds) {
    const operatorDef = operatorDefs.get(operatorId)!;
    const ownedOperator = ownedOperators.get(operatorId)!;
    let bestContribution = 0;

    for (const room of rooms) {
      const evaluation = evaluateOperatorForRoom(operatorDef, ownedOperator, room);
      const baseUnits = getBaseRoomUnits(room, normalizedScenarioResult.scenario.options.horizonHours, warnings);
      const contribution =
        room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber"
          ? baseUnits * (evaluation.directPercent / 100)
          : evaluation.supportScore + evaluation.crossRoomScore;
      if (contribution > bestContribution) {
        bestContribution = contribution;
      }
    }

    optimisticContributionCache.set(operatorId, bestContribution);
  }

  const dfs = (
    slotIndex: number,
    assignedByRoom: Map<string, Array<string | null>>,
    remainingOperatorIds: string[],
    currentScore: number,
  ) => {
    if (slotIndex >= slotQueue.length || remainingOperatorIds.length === 0) {
      if (currentScore > best.score) {
        best = { score: currentScore, assignedByRoom: cloneAssignedByRoom(assignedByRoom) };
      }
      return;
    }

    const optimisticTail = remainingOperatorIds
      .map((operatorId) => optimisticContributionCache.get(operatorId) ?? 0)
      .sort((left, right) => right - left)
      .slice(0, slotQueue.length - slotIndex)
      .reduce((sum, value) => sum + value, 0);

    if (currentScore + optimisticTail < best.score) {
      return;
    }

    const targetSlot = slotQueue[slotIndex]!;
    const room = roomMap.get(targetSlot.roomId)!;
    const nextAssignedByRoom = cloneAssignedByRoom(assignedByRoom);

    for (let index = 0; index < remainingOperatorIds.length; index += 1) {
      const operatorId = remainingOperatorIds[index]!;
      nextAssignedByRoom.get(room.roomId)![targetSlot.slotIndex] = operatorId;

      const operatorDef = operatorDefs.get(operatorId)!;
      const ownedOperator = ownedOperators.get(operatorId)!;
      const evaluation = evaluateOperatorForRoom(operatorDef, ownedOperator, room);
      const baseUnits = getBaseRoomUnits(room, normalizedScenarioResult.scenario.options.horizonHours, warnings);
      const addedScore =
        room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber"
          ? baseUnits * (evaluation.directPercent / 100)
          : evaluation.supportScore + evaluation.crossRoomScore;

      dfs(
        slotIndex + 1,
        nextAssignedByRoom,
        [...remainingOperatorIds.slice(0, index), ...remainingOperatorIds.slice(index + 1)],
        currentScore + addedScore,
      );
      nextAssignedByRoom.get(room.roomId)![targetSlot.slotIndex] = null;
    }
  };

  dfs(0, hardState.assignedByRoom, availableOperatorIds, 0);

  const roomPlans: RoomPlan[] = [];
  const explanations: AssignmentExplanation[] = [];
  const finalWarnings = [...warnings];

  for (const room of rooms) {
    const plan = computeRoomPlan(
      room,
      best.assignedByRoom.get(room.roomId) ?? [],
      operatorDefs,
      ownedOperators,
      normalizedScenarioResult.scenario.options.horizonHours,
      finalWarnings,
    );
    roomPlans.push(plan.roomPlan);
    explanations.push(...plan.explanations);
    finalWarnings.push(...plan.roomPlan.warnings);
  }

  const summary = summarizePlans(roomPlans);

  return {
    catalogVersion: normalizedScenarioResult.scenario.catalogVersion,
    totalScore: summary.totalScore,
    projectedRecipeOutputs: summary.projectedRecipeOutputs,
    projectedOutputs: summary.projectedOutputs,
    roomPlans,
    explanations,
    warnings: uniqueWarnings(finalWarnings),
    supportWeightsVersion: SUPPORT_WEIGHTS.version,
  };
}

export function solveScenario(catalog: GameCatalog, scenario: OptimizationScenario): OptimizationResult {
  return solveNormalizedScenario(catalog, normalizeScenario(catalog, scenario));
}

export type { NormalizedRoom };
