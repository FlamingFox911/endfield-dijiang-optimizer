import type {
  AssignmentExplanation,
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

import { createProjectedOutputs, getGrowthSlotCap, getMaxFacilityRoomCounts, getRoomSlotCap } from "@endfield/data";

import {
  DEFAULT_OPTIMIZATION_EFFORT,
  DEFAULT_OPTIMIZATION_PROFILE,
  OPTIMIZATION_PROFILE_EFFORTS,
  SUPPORT_WEIGHTS,
  clampOptimizationEffort,
  getOptimizationSearchConfig,
} from "./config.js";
import type { OptimizationProgressSnapshot, OptimizationSearchConfig, SolveScenarioOptions } from "./types.js";

interface NormalizedRoom {
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

interface OperatorRoomEvaluation {
  directScore: number;
  supportScore: number;
  crossRoomScore: number;
  reasons: string[];
  usedFallbackHeuristics: boolean;
  dataConfidence: DataConfidence;
  productionDirectUnits: number;
  localMoodRegenPercent: number;
  localMoodDropReductionPercent: number;
  globalMoodRegenPercent: number;
  globalMoodDropReductionPercent: number;
}

const STEADY_STATE_HOURS = 1;

export class OptimizationCancelledError extends Error {
  constructor(message = "Optimization canceled.") {
    super(message);
    this.name = "OptimizationCancelledError";
  }
}

function resolveSearchConfig(
  scenario: OptimizationScenario,
  options?: SolveScenarioOptions,
): OptimizationSearchConfig {
  if (options?.searchConfig) {
    return {
      ...options.searchConfig,
      effort: clampOptimizationEffort(options.searchConfig.effort),
    };
  }

  const profile = scenario.options.optimizationProfile ?? DEFAULT_OPTIMIZATION_PROFILE;
  const defaultEffort = profile === "custom"
    ? DEFAULT_OPTIMIZATION_EFFORT
    : OPTIMIZATION_PROFILE_EFFORTS[profile];
  const effort = clampOptimizationEffort(scenario.options.optimizationEffort ?? defaultEffort);

  return getOptimizationSearchConfig(profile, effort);
}

function getRecipeBaseUnits(recipe: RecipeDefinition, horizonHours: number, warnings: string[]) {
  const duration = recipe.baseDurationMinutes ?? 0;
  const outputAmount = recipe.outputAmount ?? 1;

  if (recipe.baseDurationMinutes == null) {
    warnings.push(`Recipe '${recipe.id}' is missing duration data; assuming one baseline run per hour.`);
  }
  if (recipe.outputAmount == null) {
    warnings.push(`Recipe '${recipe.id}' is missing output amount; assuming one baseline unit.`);
  }
  if (duration <= 0) {
    return outputAmount;
  }

  return (horizonHours * 60 / duration) * outputAmount;
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
    const recipes = fixedRecipeIds
      .map((recipeId) => recipesById.get(recipeId))
      .filter((recipe): recipe is RecipeDefinition => Boolean(recipe));
    if ((roomKind === "manufacturing_cabin" || roomKind === "growth_chamber") && fixedRecipeIds.length === 0) {
      warnings.push(`Room '${roomId}' has no selected recipe and will contribute no production.`);
    }
    if (roomKind === "growth_chamber" && fixedRecipeIds.length > getGrowthSlotCap(catalog, level)) {
      warnings.push(`Growth chamber '${roomId}' has more selected materials than its level supports; extra selections may be invalid.`);
    }
    rooms.push({ roomId, roomKind, level, slotCap, fixedRecipeIds, recipes });
  };

  addRoom("control_nexus", "control_nexus", normalizedScenario.facilities.controlNexus.level);

  for (const room of normalizedScenario.facilities.manufacturingCabins) {
    if (room.enabled) {
      addRoom(room.id, "manufacturing_cabin", room.level, room.fixedRecipeId ? [room.fixedRecipeId] : []);
    }
  }

  for (const room of normalizedScenario.facilities.growthChambers) {
    if (room.enabled) {
      addRoom(room.id, "growth_chamber", room.level, room.fixedRecipeIds ?? []);
    }
  }

  if (normalizedScenario.facilities.receptionRoom?.enabled) {
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
  return room.recipes.reduce(
    (sum, recipe) => sum + getRecipeBaseUnits(recipe, horizonHours, warnings),
    0,
  );
}

function getProductionOccupancyBonusUnits(
  room: NormalizedRoom,
  baseUnits: number,
  assignedOperatorCount: number,
) {
  if (
    baseUnits <= 0
    || assignedOperatorCount <= 0
    || (room.roomKind !== "manufacturing_cabin" && room.roomKind !== "growth_chamber")
  ) {
    return 0;
  }

  return baseUnits * ((assignedOperatorCount * SUPPORT_WEIGHTS.assignedOperatorProductionEfficiencyPercent) / 100);
}

function getMatchingBaseUnits(
  room: NormalizedRoom,
  horizonHours: number,
  warnings: string[],
  appliesTo: ProductKind | "all",
) {
  return room.recipes.reduce((sum, recipe) => {
    if (appliesTo !== "all" && recipe.productKind !== appliesTo) {
      return sum;
    }
    return sum + getRecipeBaseUnits(recipe, horizonHours, warnings);
  }, 0);
}

function getLongRunMoodWorkingUptime(
  moodDropReductionPercent: number,
  moodRegenPercent: number,
): number {
  const drainMultiplier = Math.max(0, 1 - (moodDropReductionPercent / 100));
  const regenMultiplier = Math.max(0, 1 + (moodRegenPercent / 100));
  const adjustedDrainPerHour = SUPPORT_WEIGHTS.baselineMoodDrainPerHour * drainMultiplier;
  const adjustedRegenPerHour = SUPPORT_WEIGHTS.baselineMoodRegenPerHour * regenMultiplier;

  if (adjustedDrainPerHour <= 0) {
    return 1;
  }
  if (adjustedRegenPerHour <= 0) {
    return 0;
  }

  return 1 / (1 + (adjustedDrainPerHour / adjustedRegenPerHour));
}

function getLocalMoodSustainUnits(
  activeContributionUnits: number,
  moodDropReductionPercent: number,
  moodRegenPercent: number,
): number {
  if (activeContributionUnits <= 0 || (moodDropReductionPercent <= 0 && moodRegenPercent <= 0)) {
    return 0;
  }

  const boostedUptime = getLongRunMoodWorkingUptime(moodDropReductionPercent, moodRegenPercent);
  const relativeUptimeGain = (boostedUptime / SUPPORT_WEIGHTS.baselineMoodWorkingUptime) - 1;

  return activeContributionUnits * Math.max(0, relativeUptimeGain);
}

function evaluateRankModifiers(
  rankDef: BaseSkillRankDefinition,
  room: NormalizedRoom,
  horizonHours: number,
  warnings: string[],
): OperatorRoomEvaluation {
  let directScore = 0;
  let supportScore = 0;
  let crossRoomScore = 0;
  let productionDirectUnits = 0;
  let localMoodRegenPercent = 0;
  let localMoodDropReductionPercent = 0;
  let globalMoodRegenPercent = 0;
  let globalMoodDropReductionPercent = 0;
  const reasons: string[] = [];

  for (const modifier of rankDef.modifiers) {
    const matchingBaseUnits = getMatchingBaseUnits(room, horizonHours, warnings, modifier.appliesTo);
    if (modifier.appliesTo !== "all" && matchingBaseUnits <= 0) {
      continue;
    }

    switch (modifier.metric) {
      case "production_efficiency":
      case "growth_rate":
        directScore += matchingBaseUnits * (modifier.value / 100);
        productionDirectUnits += matchingBaseUnits * (modifier.value / 100);
        reasons.push(`${modifier.metric} +${modifier.value}%`);
        break;
      case "mood_regen":
        if (room.roomKind === "control_nexus") {
          crossRoomScore += modifier.value * SUPPORT_WEIGHTS.controlNexusMoodRegenWeight;
          globalMoodRegenPercent += modifier.value;
          reasons.push(`control support +${(modifier.value * SUPPORT_WEIGHTS.controlNexusMoodRegenWeight).toFixed(1)}`);
        } else if (room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber") {
          localMoodRegenPercent += modifier.value;
          reasons.push(`mood regen +${modifier.value}%`);
        } else {
          supportScore += modifier.value * SUPPORT_WEIGHTS.offRoomClueWeight;
          reasons.push(`support utility +${(modifier.value * SUPPORT_WEIGHTS.offRoomClueWeight).toFixed(1)}`);
        }
        break;
      case "mood_drop_reduction":
        if (room.roomKind === "control_nexus") {
          crossRoomScore += modifier.value * SUPPORT_WEIGHTS.controlNexusMoodDropReductionWeight;
          globalMoodDropReductionPercent += modifier.value;
          reasons.push(`cross-room sustain +${(modifier.value * SUPPORT_WEIGHTS.controlNexusMoodDropReductionWeight).toFixed(1)}`);
        } else if (room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber") {
          localMoodDropReductionPercent += modifier.value;
          reasons.push(`mood drop reduction +${modifier.value}%`);
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
    directScore,
    supportScore,
    crossRoomScore,
    reasons,
    usedFallbackHeuristics: false,
    dataConfidence: rankDef.dataConfidence ?? "verified",
    productionDirectUnits,
    localMoodRegenPercent,
    localMoodDropReductionPercent,
    globalMoodRegenPercent,
    globalMoodDropReductionPercent,
  };
}

function fallbackEvaluation(
  operatorDef: OperatorDefinition,
  unlockedRank: number,
  room: NormalizedRoom,
  horizonHours: number,
  warnings: string[],
): OperatorRoomEvaluation {
  if (room.roomKind === "control_nexus" || room.roomKind === "reception_room") {
    return {
      directScore: 0,
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
      productionDirectUnits: 0,
      localMoodRegenPercent: 0,
      localMoodDropReductionPercent: 0,
      globalMoodRegenPercent: 0,
      globalMoodDropReductionPercent: 0,
    };
  }

  const baseUnits = getBaseRoomUnits(room, horizonHours, warnings);
  return {
    directScore: baseUnits * ((unlockedRank * SUPPORT_WEIGHTS.fallbackProductionPercentPerRank) / 100),
    supportScore: 0,
    crossRoomScore: 0,
    reasons: [`${operatorDef.name} uses fallback production scoring because precise modifiers are missing.`],
    usedFallbackHeuristics: true,
    dataConfidence: "heuristic",
    productionDirectUnits: baseUnits * ((unlockedRank * SUPPORT_WEIGHTS.fallbackProductionPercentPerRank) / 100),
    localMoodRegenPercent: 0,
    localMoodDropReductionPercent: 0,
    globalMoodRegenPercent: 0,
    globalMoodDropReductionPercent: 0,
  };
}

function evaluateOperatorForRoom(
  operatorDef: OperatorDefinition,
  ownedOperator: OptimizationScenario["roster"][number],
  room: NormalizedRoom,
  horizonHours: number,
  warnings: string[],
): OperatorRoomEvaluation {
  let directScore = 0;
  let supportScore = 0;
  let crossRoomScore = 0;
  let productionDirectUnits = 0;
  let usedFallbackHeuristics = false;
  let localMoodRegenPercent = 0;
  let localMoodDropReductionPercent = 0;
  let globalMoodRegenPercent = 0;
  let globalMoodDropReductionPercent = 0;
  const reasons: string[] = [];
  const confidences: DataConfidence[] = [];
  const baseUnits = getBaseRoomUnits(room, horizonHours, warnings);
  const seatOccupancyUnits =
    room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber"
      ? baseUnits * (SUPPORT_WEIGHTS.assignedOperatorProductionEfficiencyPercent / 100)
      : 0;

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
      const fallback = fallbackEvaluation(operatorDef, unlockedRank, room, horizonHours, warnings);
      directScore += fallback.directScore;
      supportScore += fallback.supportScore;
      crossRoomScore += fallback.crossRoomScore;
      productionDirectUnits += fallback.productionDirectUnits;
      usedFallbackHeuristics ||= fallback.usedFallbackHeuristics;
      reasons.push(...fallback.reasons);
      confidences.push(fallback.dataConfidence);
      localMoodRegenPercent += fallback.localMoodRegenPercent;
      localMoodDropReductionPercent += fallback.localMoodDropReductionPercent;
      globalMoodRegenPercent += fallback.globalMoodRegenPercent;
      globalMoodDropReductionPercent += fallback.globalMoodDropReductionPercent;
      continue;
    }

    const evaluation = evaluateRankModifiers(rankDef, room, horizonHours, warnings);
    directScore += evaluation.directScore;
    supportScore += evaluation.supportScore;
    crossRoomScore += evaluation.crossRoomScore;
    productionDirectUnits += evaluation.productionDirectUnits;
    usedFallbackHeuristics ||= evaluation.usedFallbackHeuristics;
    localMoodRegenPercent += evaluation.localMoodRegenPercent;
    localMoodDropReductionPercent += evaluation.localMoodDropReductionPercent;
    globalMoodRegenPercent += evaluation.globalMoodRegenPercent;
    globalMoodDropReductionPercent += evaluation.globalMoodDropReductionPercent;
    reasons.push(
      `${skill.name} rank ${unlockedRank}: ${evaluation.reasons.join(", ") || "no active modifier for this room"}.`,
    );
    confidences.push(skill.dataConfidence ?? "verified");
    confidences.push(evaluation.dataConfidence);
  }

  if (
    (room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber")
    && (localMoodRegenPercent > 0 || localMoodDropReductionPercent > 0)
  ) {
    const preservedActiveContributionUnits = seatOccupancyUnits + directScore;
    const moodSustainUnits = getLocalMoodSustainUnits(
      preservedActiveContributionUnits,
      localMoodDropReductionPercent,
      localMoodRegenPercent,
    );
    const boostedUptime = getLongRunMoodWorkingUptime(localMoodDropReductionPercent, localMoodRegenPercent);

    directScore += moodSustainUnits;
    reasons.push(
      `Long-run Mood sustain: +${(boostedUptime * 100).toFixed(1)}% working uptime, preserving ${moodSustainUnits.toFixed(2)} score.`,
    );
  }

  return {
    directScore,
    supportScore,
    crossRoomScore,
    reasons,
    usedFallbackHeuristics,
    dataConfidence: confidences.includes("heuristic")
      ? "heuristic"
      : confidences.includes("provisional")
        ? "provisional"
        : "verified",
    productionDirectUnits,
    localMoodRegenPercent,
    localMoodDropReductionPercent,
    globalMoodRegenPercent,
    globalMoodDropReductionPercent,
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

function buildScoreBreakdown(
  room: NormalizedRoom,
  baseUnits: number,
  occupancyBonusUnits: number,
  aggregateDirectScore: number,
  aggregateSupportScore: number,
  aggregateCrossRoomScore: number,
): ScoreBreakdown {
  const directProductionScore =
    room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber"
      ? baseUnits + occupancyBonusUnits + aggregateDirectScore
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
  const assignedOperatorCount = assignedOperatorIds.filter(Boolean).length;
  const occupancyBonusUnits = getProductionOccupancyBonusUnits(room, baseUnits, assignedOperatorCount);

  let aggregateDirectScore = 0;
  let aggregateSupportScore = 0;
  let aggregateCrossRoomScore = 0;
  let usedFallbackHeuristics = false;
  let dataConfidence: DataConfidence = room.recipes.some((recipe) => recipe.dataConfidence === "heuristic")
    ? "heuristic"
    : room.recipes.some((recipe) => recipe.dataConfidence === "provisional")
      ? "provisional"
      : "verified";

  for (const operatorId of assignedOperatorIds.filter(Boolean) as string[]) {
    const operatorDef = operatorDefs.get(operatorId);
    const ownedOperator = ownedOperators.get(operatorId);
    if (!operatorDef || !ownedOperator) {
      continue;
    }

    const evaluation = evaluateOperatorForRoom(operatorDef, ownedOperator, room, horizonHours, warnings);
    aggregateDirectScore += evaluation.directScore;
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
          ? evaluation.directScore
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
    occupancyBonusUnits,
    aggregateDirectScore,
    aggregateSupportScore,
    aggregateCrossRoomScore,
  );

  if (room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber") {
    const roomDirectBonus = Math.max(scoreBreakdown.directProductionScore - baseUnits, 0);
    for (const recipe of room.recipes) {
      const recipeBaseUnits = getRecipeBaseUnits(recipe, horizonHours, warnings);
      const recipeShare = baseUnits > 0 ? recipeBaseUnits / baseUnits : 0;
      projectedOutputs[recipe.productKind] += recipeBaseUnits + (roomDirectBonus * recipeShare);
    }
  }

  return {
    roomPlan: {
      roomId: room.roomId,
      roomKind: room.roomKind,
      roomLevel: room.level,
      chosenRecipeIds: room.fixedRecipeIds,
      chosenProductKind: room.recipes.length === 1 ? room.recipes[0]?.productKind : undefined,
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

interface ProductionMoodTarget {
  operatorId: string;
  roomId: string;
  activeContributionUnits: number;
  localMoodRegenPercent: number;
  localMoodDropReductionPercent: number;
}

interface ControlMoodSource {
  operatorId: string;
  roomId: string;
  moodRegenPercent: number;
  moodDropReductionPercent: number;
}

function solveAverageControlMoodSupport(sources: ControlMoodSource[]) {
  const totalMoodRegenPercent = sources.reduce((sum, source) => sum + source.moodRegenPercent, 0);
  const totalMoodDropReductionPercent = sources.reduce((sum, source) => sum + source.moodDropReductionPercent, 0);

  if (totalMoodRegenPercent <= 0 && totalMoodDropReductionPercent <= 0) {
    return {
      controlWorkingUptime: SUPPORT_WEIGHTS.baselineMoodWorkingUptime,
      averageMoodRegenPercent: 0,
      averageMoodDropReductionPercent: 0,
    };
  }

  let controlWorkingUptime: number = SUPPORT_WEIGHTS.baselineMoodWorkingUptime;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const averageMoodRegenPercent = totalMoodRegenPercent * controlWorkingUptime;
    const averageMoodDropReductionPercent = totalMoodDropReductionPercent * controlWorkingUptime;
    const nextUptime = getLongRunMoodWorkingUptime(averageMoodDropReductionPercent, averageMoodRegenPercent);
    if (Math.abs(nextUptime - controlWorkingUptime) < 1e-6) {
      controlWorkingUptime = nextUptime;
      break;
    }
    controlWorkingUptime = nextUptime;
  }

  return {
    controlWorkingUptime,
    averageMoodRegenPercent: totalMoodRegenPercent * controlWorkingUptime,
    averageMoodDropReductionPercent: totalMoodDropReductionPercent * controlWorkingUptime,
  };
}

function getShipwideControlMoodSupportGains(
  sources: ControlMoodSource[],
  targets: ProductionMoodTarget[],
): Array<ProductionMoodTarget & { gainUnits: number }> {
  if (sources.length === 0 || targets.length === 0) {
    return [];
  }

  const averageSupport = solveAverageControlMoodSupport(sources);

  return targets.map((target) => {
    const localUptime = getLongRunMoodWorkingUptime(
      target.localMoodDropReductionPercent,
      target.localMoodRegenPercent,
    );
    const boostedUptime = getLongRunMoodWorkingUptime(
      target.localMoodDropReductionPercent + averageSupport.averageMoodDropReductionPercent,
      target.localMoodRegenPercent + averageSupport.averageMoodRegenPercent,
    );
    const relativeUptimeGain = (boostedUptime / localUptime) - 1;

    return {
      ...target,
      gainUnits: target.activeContributionUnits * Math.max(0, relativeUptimeGain),
    };
  });
}

function getShipwideControlMoodSupportUnits(
  sources: ControlMoodSource[],
  targets: ProductionMoodTarget[],
): number {
  return getShipwideControlMoodSupportGains(sources, targets)
    .reduce((sum, target) => sum + target.gainUnits, 0);
}

function applyControlNexusMoodSupport(
  rooms: NormalizedRoom[],
  assignedByRoom: Map<string, Array<string | null>>,
  roomPlans: RoomPlan[],
  explanations: AssignmentExplanation[],
  operatorDefs: Map<string, OperatorDefinition>,
  ownedOperators: Map<string, OptimizationScenario["roster"][number]>,
  horizonHours: number,
  warnings: string[],
) {
  const roomById = new Map(rooms.map((room) => [room.roomId, room]));
  const roomPlanById = new Map(roomPlans.map((roomPlan) => [roomPlan.roomId, roomPlan]));
  const controlPlan = roomPlanById.get("control_nexus");
  const controlAssignments = (assignedByRoom.get("control_nexus") ?? []).filter(Boolean) as string[];
  const controlRoom = roomById.get("control_nexus");

  if (!controlPlan || !controlRoom || controlAssignments.length === 0) {
    return;
  }

  const controlSources = collectControlMoodSources(
    controlAssignments,
    controlRoom,
    operatorDefs,
    ownedOperators,
    horizonHours,
    warnings,
  );

  if (controlSources.length === 0) {
    controlPlan.scoreBreakdown.crossRoomBonusContribution = 0;
    controlPlan.scoreBreakdown.totalScore =
      controlPlan.scoreBreakdown.directProductionScore
      + controlPlan.scoreBreakdown.supportRoomScore
      + controlPlan.scoreBreakdown.crossRoomBonusContribution;
    controlPlan.projectedScore = controlPlan.scoreBreakdown.totalScore;
    return;
  }

  const productionTargets = collectProductionMoodTargets(
    rooms,
    assignedByRoom,
    operatorDefs,
    ownedOperators,
    horizonHours,
    warnings,
  );

  const targetGains = getShipwideControlMoodSupportGains(controlSources, productionTargets);
  const exactCrossRoomContribution = targetGains.reduce((sum, target) => sum + target.gainUnits, 0);
  const averageSupport = solveAverageControlMoodSupport(controlSources);

  controlPlan.scoreBreakdown.crossRoomBonusContribution = exactCrossRoomContribution;
  controlPlan.scoreBreakdown.totalScore =
    controlPlan.scoreBreakdown.directProductionScore
    + controlPlan.scoreBreakdown.supportRoomScore
    + controlPlan.scoreBreakdown.crossRoomBonusContribution;
  controlPlan.projectedScore = controlPlan.scoreBreakdown.totalScore;

  const roomGainById = new Map<string, number>();
  for (const target of targetGains) {
    roomGainById.set(target.roomId, (roomGainById.get(target.roomId) ?? 0) + target.gainUnits);
  }
  for (const [roomId, roomGainUnits] of roomGainById.entries()) {
    const room = roomById.get(roomId);
    const roomPlan = roomPlanById.get(roomId);
    if (!room || !roomPlan || roomGainUnits <= 0) {
      continue;
    }

    const baseUnits = getBaseRoomUnits(room, horizonHours, warnings);
    if (baseUnits <= 0) {
      continue;
    }

    for (const recipe of room.recipes) {
      const recipeBaseUnits = getRecipeBaseUnits(recipe, horizonHours, warnings);
      const recipeShare = recipeBaseUnits / baseUnits;
      roomPlan.projectedOutputs[recipe.productKind] += roomGainUnits * recipeShare;
    }
  }

  const marginalContributions = controlSources.map((source) => {
    const withoutSource = controlSources.filter((candidate) => candidate.operatorId !== source.operatorId);
    return Math.max(
      0,
      exactCrossRoomContribution - getShipwideControlMoodSupportUnits(withoutSource, productionTargets),
    );
  });
  const totalMarginalContribution = marginalContributions.reduce((sum, value) => sum + value, 0);

  for (const explanation of explanations) {
    if (explanation.roomId !== "control_nexus") {
      continue;
    }

    const sourceIndex = controlSources.findIndex((source) => source.operatorId === explanation.operatorId);
    if (sourceIndex < 0) {
      continue;
    }

    const allocatedContribution = totalMarginalContribution > 0
      ? exactCrossRoomContribution * (marginalContributions[sourceIndex]! / totalMarginalContribution)
      : exactCrossRoomContribution / controlSources.length;

    explanation.projectedContribution = allocatedContribution;
    explanation.reasons.push(
      `Long-run shipwide Mood support preserves ${allocatedContribution.toFixed(2)} score at ~${(averageSupport.controlWorkingUptime * 100).toFixed(1)}% average Control Nexus uptime.`,
    );
  }
}

function collectProductionMoodTargets(
  rooms: NormalizedRoom[],
  assignedByRoom: Map<string, Array<string | null>>,
  operatorDefs: Map<string, OperatorDefinition>,
  ownedOperators: Map<string, OptimizationScenario["roster"][number]>,
  horizonHours: number,
  warnings: string[],
): ProductionMoodTarget[] {
  const productionTargets: ProductionMoodTarget[] = [];

  for (const room of rooms) {
    if (room.roomKind !== "manufacturing_cabin" && room.roomKind !== "growth_chamber") {
      continue;
    }

    const assignedOperatorIds = (assignedByRoom.get(room.roomId) ?? []).filter(Boolean) as string[];
    if (assignedOperatorIds.length === 0) {
      continue;
    }

    const baseUnits = getBaseRoomUnits(room, horizonHours, warnings);
    const seatOccupancyUnits = baseUnits * (SUPPORT_WEIGHTS.assignedOperatorProductionEfficiencyPercent / 100);

    for (const operatorId of assignedOperatorIds) {
      const operatorDef = operatorDefs.get(operatorId);
      const ownedOperator = ownedOperators.get(operatorId);
      if (!operatorDef || !ownedOperator) {
        continue;
      }

      const evaluation = evaluateOperatorForRoom(operatorDef, ownedOperator, room, horizonHours, warnings);
      productionTargets.push({
        operatorId,
        roomId: room.roomId,
        activeContributionUnits: seatOccupancyUnits + evaluation.productionDirectUnits,
        localMoodRegenPercent: evaluation.localMoodRegenPercent,
        localMoodDropReductionPercent: evaluation.localMoodDropReductionPercent,
      });
    }
  }

  return productionTargets;
}

function collectControlMoodSources(
  assignedOperatorIds: string[],
  controlRoom: NormalizedRoom,
  operatorDefs: Map<string, OperatorDefinition>,
  ownedOperators: Map<string, OptimizationScenario["roster"][number]>,
  horizonHours: number,
  warnings: string[],
): ControlMoodSource[] {
  const controlSources: ControlMoodSource[] = [];

  for (const operatorId of assignedOperatorIds) {
    const operatorDef = operatorDefs.get(operatorId);
    const ownedOperator = ownedOperators.get(operatorId);
    if (!operatorDef || !ownedOperator) {
      continue;
    }

    const evaluation = evaluateOperatorForRoom(operatorDef, ownedOperator, controlRoom, horizonHours, warnings);
    if (evaluation.globalMoodRegenPercent <= 0 && evaluation.globalMoodDropReductionPercent <= 0) {
      continue;
    }

    controlSources.push({
      operatorId,
      roomId: controlRoom.roomId,
      moodRegenPercent: evaluation.globalMoodRegenPercent,
      moodDropReductionPercent: evaluation.globalMoodDropReductionPercent,
    });
  }

  return controlSources;
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
    for (const recipeId of roomPlan.chosenRecipeIds ?? []) {
      projectedRecipeOutputs[recipeId] =
        (projectedRecipeOutputs[recipeId] ?? 0) + roomPlan.scoreBreakdown.directProductionScore / Math.max(roomPlan.chosenRecipeIds?.length ?? 1, 1);
    }
  }

  return { totalScore, projectedOutputs, projectedRecipeOutputs };
}

export function solveNormalizedScenario(
  catalog: GameCatalog,
  normalizedScenarioResult: NormalizedScenarioResult,
  options?: SolveScenarioOptions,
): OptimizationResult {
  const warnings = [...normalizedScenarioResult.warnings];
  const searchConfig = resolveSearchConfig(normalizedScenarioResult.scenario, options);
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
      const leftBase = getBaseRoomUnits(leftRoom, STEADY_STATE_HOURS, warnings);
      const rightBase = getBaseRoomUnits(rightRoom, STEADY_STATE_HOURS, warnings);
      return rightBase - leftBase;
    });

  const availableOperatorIds = Array.from(ownedOperators.keys()).filter(
    (operatorId) => !hardState.hardAssignedOperatorIds.has(operatorId),
  );
  const totalSlots = slotQueue.length;
  const controlRoom = roomMap.get("control_nexus");
  const productionRooms = rooms.filter(
    (room) => room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber",
  );
  let visitedNodes = 0;
  let budgetExceeded = false;
  let lastProgressNode = -1;

  const maybeCancel = () => {
    if (options?.shouldCancel?.()) {
      throw new OptimizationCancelledError();
    }
  };

  const emitProgress = (phase: string, currentDepth: number) => {
    if (!options?.onProgress) {
      return;
    }

    const nextProgress: OptimizationProgressSnapshot = {
      phase,
      visitedNodes,
      totalSlots,
      currentDepth,
      bestScore: Number.isFinite(best.score) ? best.score : 0,
      maxBranchCandidatesPerSlot: searchConfig.maxBranchCandidatesPerSlot,
      profileLabel: searchConfig.profileLabel,
      effort: searchConfig.effort,
      maxVisitedNodes: searchConfig.maxVisitedNodes,
    };

    options.onProgress(nextProgress);
  };

  let best = {
    score: Number.NEGATIVE_INFINITY,
    assignedByRoom: hardState.assignedByRoom,
  };

  const optimisticContributionCache = new Map<string, number>();
  const perRoomContributionCache = new Map<string, number>();
  const maxControlMoodSupportUpperBound = productionRooms.reduce((sum, room) => {
    const baseUnits = getBaseRoomUnits(room, STEADY_STATE_HOURS, warnings);
    const seatOccupancyUnits = baseUnits * (SUPPORT_WEIGHTS.assignedOperatorProductionEfficiencyPercent / 100);
    let maxProductionDirectUnits = 0;

    for (const operatorId of Array.from(ownedOperators.keys())) {
      const operatorDef = operatorDefs.get(operatorId)!;
      const ownedOperator = ownedOperators.get(operatorId)!;
      const evaluation = evaluateOperatorForRoom(
        operatorDef,
        ownedOperator,
        room,
        STEADY_STATE_HOURS,
        warnings,
      );
      if (evaluation.productionDirectUnits > maxProductionDirectUnits) {
        maxProductionDirectUnits = evaluation.productionDirectUnits;
      }
    }

    return sum + (room.slotCap * (seatOccupancyUnits + maxProductionDirectUnits));
  }, 0) * ((1 / SUPPORT_WEIGHTS.baselineMoodWorkingUptime) - 1);

  const getOperatorContributionForRoom = (operatorId: string, room: NormalizedRoom) => {
    const cacheKey = `${operatorId}:${room.roomId}`;
    const cached = perRoomContributionCache.get(cacheKey);
    if (cached != null) {
      return cached;
    }

    const operatorDef = operatorDefs.get(operatorId)!;
    const ownedOperator = ownedOperators.get(operatorId)!;
    const evaluation = evaluateOperatorForRoom(
      operatorDef,
      ownedOperator,
      room,
      STEADY_STATE_HOURS,
      warnings,
    );
    const contribution =
      room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber"
        ? evaluation.directScore
        : evaluation.supportScore + evaluation.crossRoomScore;
    perRoomContributionCache.set(cacheKey, contribution);
    return contribution;
  };

  const getExactControlMoodContribution = (
    operatorId: string,
    assignedByRoom: Map<string, Array<string | null>>,
  ) => {
    if (!controlRoom) {
      return 0;
    }

    const productionTargets = collectProductionMoodTargets(
      rooms,
      assignedByRoom,
      operatorDefs,
      ownedOperators,
      STEADY_STATE_HOURS,
      warnings,
    );
    const currentControlAssignments = (assignedByRoom.get(controlRoom.roomId) ?? []).filter(Boolean) as string[];
    const currentControlSources = collectControlMoodSources(
      currentControlAssignments,
      controlRoom,
      operatorDefs,
      ownedOperators,
      STEADY_STATE_HOURS,
      warnings,
    );
    const nextControlSources = collectControlMoodSources(
      [...currentControlAssignments, operatorId],
      controlRoom,
      operatorDefs,
      ownedOperators,
      STEADY_STATE_HOURS,
      warnings,
    );

    return getShipwideControlMoodSupportUnits(nextControlSources, productionTargets)
      - getShipwideControlMoodSupportUnits(currentControlSources, productionTargets);
  };

  for (const operatorId of availableOperatorIds) {
    let bestContribution = 0;

    for (const room of rooms) {
      const contribution = room.roomKind === "control_nexus"
        ? Math.max(getOperatorContributionForRoom(operatorId, room), maxControlMoodSupportUpperBound)
        : getOperatorContributionForRoom(operatorId, room);
      if (contribution > bestContribution) {
        bestContribution = contribution;
      }
    }

    optimisticContributionCache.set(operatorId, bestContribution);
  }

  emitProgress("Preparing search", 0);

  const dfs = (
    slotIndex: number,
    assignedByRoom: Map<string, Array<string | null>>,
    remainingOperatorIds: string[],
    currentScore: number,
  ) => {
    maybeCancel();
    if (visitedNodes >= searchConfig.maxVisitedNodes) {
      budgetExceeded = true;
      return;
    }

    visitedNodes += 1;
    if (visitedNodes === 1 || visitedNodes - lastProgressNode >= searchConfig.progressIntervalNodes) {
      lastProgressNode = visitedNodes;
      emitProgress("Searching assignments", slotIndex);
    }

    if (slotIndex >= slotQueue.length || remainingOperatorIds.length === 0) {
      if (currentScore > best.score) {
        best = { score: currentScore, assignedByRoom: cloneAssignedByRoom(assignedByRoom) };
        emitProgress("Searching assignments", slotIndex);
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
    const largeSearchStateThreshold = Math.max(20, searchConfig.maxBranchCandidatesPerSlot * 10);
    const candidateLimit = remainingOperatorIds.length * (slotQueue.length - slotIndex) > largeSearchStateThreshold
      ? Math.min(searchConfig.maxBranchCandidatesPerSlot, remainingOperatorIds.length)
      : remainingOperatorIds.length;
    const candidateIndexes = remainingOperatorIds
      .map((operatorId, index) => ({
        index,
        operatorId,
        contribution: room.roomKind === "control_nexus"
          ? getExactControlMoodContribution(operatorId, assignedByRoom)
          : getOperatorContributionForRoom(operatorId, room),
      }))
      .sort((left, right) => right.contribution - left.contribution)
      .slice(0, candidateLimit);

    for (const candidate of candidateIndexes) {
      maybeCancel();
      if (budgetExceeded) {
        return;
      }
      const index = candidate.index;
      const operatorId = candidate.operatorId;
      nextAssignedByRoom.get(room.roomId)![targetSlot.slotIndex] = operatorId;
      const addedScore = candidate.contribution;

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
  maybeCancel();

  if (budgetExceeded) {
    warnings.push(
      `Optimization search stopped after ${visitedNodes} visited nodes using the '${searchConfig.profileLabel}' profile.`,
    );
  }

  const roomPlans: RoomPlan[] = [];
  const explanations: AssignmentExplanation[] = [];
  const finalWarnings = [...warnings];
  emitProgress("Scoring best plan", totalSlots);

  for (const room of rooms) {
    maybeCancel();
    const plan = computeRoomPlan(
      room,
      best.assignedByRoom.get(room.roomId) ?? [],
      operatorDefs,
      ownedOperators,
      STEADY_STATE_HOURS,
      finalWarnings,
    );
    roomPlans.push(plan.roomPlan);
    explanations.push(...plan.explanations);
    finalWarnings.push(...plan.roomPlan.warnings);
  }

  applyControlNexusMoodSupport(
    rooms,
    best.assignedByRoom,
    roomPlans,
    explanations,
    operatorDefs,
    ownedOperators,
    STEADY_STATE_HOURS,
    finalWarnings,
  );

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

export function solveScenario(
  catalog: GameCatalog,
  scenario: OptimizationScenario,
  options?: SolveScenarioOptions,
): OptimizationResult {
  return solveNormalizedScenario(catalog, normalizeScenario(catalog, scenario), options);
}

export type { NormalizedRoom };
