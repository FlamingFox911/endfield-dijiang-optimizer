import type {
  AssignmentExplanation,
  DataConfidence,
  GameCatalog,
  OptimizationResult,
  OptimizationScenario,
  ProductKind,
  RoomPlan,
} from "@endfield/domain";
import { createProjectedOutputs, resolveDemandProfile } from "@endfield/data";

import { SUPPORT_WEIGHTS } from "./config.js";
import {
  getAverageControlSupport,
  getExpectedProductionMultiplier,
  getRoomWorkingUptimes,
  type MoodModifiers,
} from "./production-model.js";
import { formatScorePoints } from "./score-format.js";
import type { NormalizedRoom } from "./solver.js";

type Assignments = Map<string, Array<string | null>>;
interface WorkerEffects extends MoodModifiers {
  operatorId: string;
  production: Record<ProductKind, number>;
  clueEfficiencyPercent: number;
  reasons: string[];
  warnings: string[];
  dataConfidence: DataConfidence;
}
interface RecipeValue {
  id: string;
  productKind: ProductKind;
  baseUnitsPerHour: number;
  scorePerUnit: number;
}
interface RoomEvaluation {
  score: number;
  workers: WorkerEffects[];
  uptimes: number[];
  recipeOutputs: Record<string, number>;
  outputs: Record<ProductKind, number>;
}

const NO_SUPPORT: MoodModifiers = { moodDropReductionPercent: 0, moodRegenPercent: 0 };
const CACHE_LIMIT = 20_000;
// Endgame farm rewards replace 10,000 Cognitive EXP at 2.5 times the Sanity
// needed for 10,000 Combat EXP; see docs/scoring-economics-2026-09-13.md.
const COGNITIVE_REPLACEMENT_MULTIPLIER = 2.5;

function combineConfidence(left: DataConfidence, right?: DataConfidence): DataConfidence {
  if (left === "heuristic" || right === "heuristic") return "heuristic";
  if (left === "provisional" || right === "provisional") return "provisional";
  return "verified";
}

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, value);
  return value;
}

/** Shared objective and presentation, including room-wide and ship-wide effects. */
export function createAssignmentScorer(
  catalog: GameCatalog,
  scenario: OptimizationScenario,
  rooms: NormalizedRoom[],
) {
  const demand = resolveDemandProfile(scenario.options.demandProfile);
  const owned = new Map(scenario.roster.filter((entry) => entry.owned).map((entry) => [entry.operatorId, entry]));
  const definitions = new Map(catalog.operators.map((operator) => [operator.id, operator]));
  const roomsById = new Map(rooms.map((room) => [room.roomId, room]));
  const effects = new Map<string, Map<string, WorkerEffects>>();
  const recipes = new Map<string, RecipeValue[]>();
  const roomWarnings = new Map<string, string[]>();
  const roomConfidence = new Map<string, DataConfidence>();
  const roomCache = new Map<string, RoomEvaluation>();
  const controlCache = new Map<string, MoodModifiers>();
  const itemValues = new Map(catalog.progression.expItems.map((item) => [
    item.itemId,
    item.expValue / 10_000 * (item.minLevel === 61 ? COGNITIVE_REPLACEMENT_MULTIPLIER : 1),
  ]));
  itemValues.set("arms-inspector", 200 / 10_000);
  itemValues.set("arms-insp-kit", 1_000 / 10_000);
  itemValues.set("arms-insp-set", 1);

  for (const room of rooms) {
    const warnings: string[] = [];
    let confidence: DataConfidence = "provisional";
    if (room.roomKind === "growth_chamber" || room.roomKind === "reception_room") {
      confidence = "heuristic";
    }
    recipes.set(room.roomId, room.recipes.map((recipe) => {
      confidence = combineConfidence(confidence, recipe.dataConfidence);
      const validDuration = Number.isFinite(recipe.baseDurationMinutes) && (recipe.baseDurationMinutes ?? 0) > 0;
      const validOutput = Number.isFinite(recipe.outputAmount) && (recipe.outputAmount ?? -1) >= 0;
      if (!validDuration || !validOutput) {
        warnings.push(`Recipe '${recipe.id}' lacks valid duration or output data; its production is unquantified and earns no score.`);
      }
      const scorePerItem = itemValues.get(recipe.id)
        ?? (room.roomKind === "growth_chamber" ? 1 : 0);
      if (room.roomKind === "manufacturing_cabin" && !itemValues.has(recipe.id)) {
        warnings.push(`Recipe '${recipe.id}' lacks a verified EXP value; output is shown but earns no score.`);
      }
      return {
        id: recipe.id,
        productKind: recipe.productKind,
        baseUnitsPerHour: validDuration && validOutput ? 60 / recipe.baseDurationMinutes! * recipe.outputAmount! : 0,
        scorePerUnit: scorePerItem * demand.productWeights[recipe.productKind]
          * (demand.priorityRecipeId === recipe.id ? SUPPORT_WEIGHTS.priorityRecipeFocusMultiplier : 1),
      };
    }));
    roomWarnings.set(room.roomId, warnings);
    roomConfidence.set(room.roomId, confidence);

    const roomEffects = new Map<string, WorkerEffects>();
    for (const [operatorId, state] of owned) {
      const definition = definitions.get(operatorId);
      const worker: WorkerEffects = {
        operatorId,
        production: createProjectedOutputs(),
        moodDropReductionPercent: 0,
        moodRegenPercent: 0,
        clueEfficiencyPercent: 0,
        reasons: [],
        warnings: [],
        dataConfidence: definition?.dataConfidence ?? "provisional",
      };
      for (const stateSkill of state.baseSkillStates) {
        if (stateSkill.unlockedRank <= 0) continue;
        const skill = definition?.baseSkills.find((entry) => entry.id === stateSkill.skillId);
        if (!skill) {
          worker.warnings.push(`Operator '${operatorId}' has unknown unlocked skill '${stateSkill.skillId}'; no skill bonus is invented.`);
          worker.dataConfidence = "provisional";
          continue;
        }
        if (skill.facilityKind !== room.roomKind) continue;
        const rank = skill.ranks.find((entry) => entry.rank === stateSkill.unlockedRank);
        if (!rank || rank.modifiers.length === 0) {
          worker.warnings.push(`Skill '${skill.id}' rank ${stateSkill.unlockedRank} has no supported effects; it earns no skill score.`);
          worker.dataConfidence = "provisional";
          continue;
        }
        worker.dataConfidence = combineConfidence(worker.dataConfidence, skill.dataConfidence);
        worker.dataConfidence = combineConfidence(worker.dataConfidence, rank.dataConfidence);
        for (const modifier of rank.modifiers) {
          worker.dataConfidence = combineConfidence(worker.dataConfidence, modifier.dataConfidence);
          if (modifier.metric === "clue_rate_up") {
            worker.reasons.push(`${skill.name}: specific-clue Rate-UP has no score; use Hard Assignment for clue targeting.`);
            continue;
          }
          if (modifier.unit !== "percent" || !Number.isFinite(modifier.value) || modifier.value < 0) {
            worker.warnings.push(`Skill '${skill.id}' has an unsupported modifier; it earns no skill score.`);
            continue;
          }
          if ((modifier.metric === "mood_drop_reduction" || modifier.metric === "mood_regen" || modifier.metric === "clue_collection_efficiency") && modifier.appliesTo !== "all") {
            worker.warnings.push(`Skill '${skill.id}' has an unsupported effect scope; it earns no skill score.`);
            continue;
          }
          switch (modifier.metric) {
            case "production_efficiency":
            case "growth_rate": {
              const targets = Object.keys(worker.production).filter((product) => modifier.appliesTo === "all" || product === modifier.appliesTo) as ProductKind[];
              if (targets.length === 0) {
                worker.warnings.push(`Skill '${skill.id}' has an unsupported production target; it earns no skill score.`);
                break;
              }
              for (const target of targets) worker.production[target] += modifier.value;
              const matching = room.recipes.some((recipe) => targets.includes(recipe.productKind));
              worker.reasons.push(`${skill.name}: +${modifier.value}% ${modifier.appliesTo.replaceAll("_", " ")} production while working${matching ? "; multiplies active staffing efficiency." : "; does not match the selected products."}`);
              break;
            }
            case "mood_drop_reduction":
              worker.moodDropReductionPercent += modifier.value;
              worker.reasons.push(`${skill.name}: Mood Drop −${modifier.value}% for ${room.roomKind === "control_nexus" ? "all working operators" : "all working operators in this room"} while the provider works.`);
              break;
            case "mood_regen":
              worker.moodRegenPercent += modifier.value;
              worker.reasons.push(`${skill.name}: Mood Regen +${modifier.value}% for ${room.roomKind === "control_nexus" ? "resting operators across the ship" : "resting peers in this room"} while the provider works.`);
              break;
            case "clue_collection_efficiency":
              if (room.roomKind === "reception_room") {
                worker.clueEfficiencyPercent += modifier.value;
                worker.reasons.push(`${skill.name}: general clue collection +${modifier.value}% while working.`);
              }
              break;
            default:
              worker.warnings.push(`Skill '${skill.id}' has an unknown effect; it earns no skill score.`);
          }
        }
      }
      roomEffects.set(operatorId, worker);
    }
    effects.set(room.roomId, roomEffects);
  }

  function workerIds(roomId: string, assignments: Assignments): string[] {
    return (assignments.get(roomId) ?? []).filter((id): id is string => id !== null && effects.get(roomId)!.has(id)).sort();
  }

  function controlSupport(assignments: Assignments): MoodModifiers {
    const controlWorkers = rooms.filter((room) => room.roomKind === "control_nexus").flatMap((room) => (
      workerIds(room.roomId, assignments).map((id) => effects.get(room.roomId)!.get(id)!)
    ));
    const key = controlWorkers.map((worker) => worker.operatorId).sort().join(",");
    const cached = controlCache.get(key);
    if (cached) return cached;
    return remember(controlCache, key, getAverageControlSupport(controlWorkers));
  }

  function evaluateRoom(room: NormalizedRoom, assignments: Assignments, support: MoodModifiers): RoomEvaluation {
    const ids = workerIds(room.roomId, assignments);
    return evaluateTeam(room, ids, support);
  }

  function evaluateTeam(room: NormalizedRoom, ids: string[], support: MoodModifiers): RoomEvaluation {
    const key = `${room.roomId}|${ids.join(",")}|${support.moodDropReductionPercent}|${support.moodRegenPercent}`;
    const cached = roomCache.get(key);
    if (cached) return cached;
    const workers = ids.map((id) => effects.get(room.roomId)!.get(id)!);
    const uptimes = getRoomWorkingUptimes(workers, support);
    const outputs = createProjectedOutputs();
    const recipeOutputs: Record<string, number> = {};
    let score = 0;
    for (const recipe of recipes.get(room.roomId)!) {
      const multiplier = getExpectedProductionMultiplier(uptimes, workers.map((worker) => worker.production[recipe.productKind]));
      const output = recipe.baseUnitsPerHour * multiplier;
      outputs[recipe.productKind] += output;
      recipeOutputs[recipe.id] = (recipeOutputs[recipe.id] ?? 0) + output;
      score += output * recipe.scorePerUnit;
    }
    if (room.roomKind === "reception_room") {
      score = workers.reduce((sum, worker, index) => sum + worker.clueEfficiencyPercent * uptimes[index]!, 0)
        * SUPPORT_WEIGHTS.receptionClueCollectionWeight * demand.receptionWeight;
    }
    return remember(roomCache, key, { score, workers, uptimes, outputs, recipeOutputs });
  }

  function score(assignments: Assignments): number {
    const support = controlSupport(assignments);
    return rooms.reduce((sum, room) => room.roomKind === "control_nexus" ? sum : sum + evaluateRoom(room, assignments, support).score, 0);
  }

  function result(assignments: Assignments): OptimizationResult {
    const support = controlSupport(assignments);
    const totalScore = score(assignments);
    const projectedOutputs = createProjectedOutputs();
    const projectedRecipeOutputs: Record<string, number> = {};
    const explanations: AssignmentExplanation[] = [];
    const roomPlans: RoomPlan[] = [];
    const warnings: string[] = [];
    let crossRoomGain = 0;
    for (const room of rooms) {
      const control = room.roomKind === "control_nexus";
      const baseline = evaluateRoom(room, assignments, NO_SUPPORT);
      const boosted = control ? baseline : evaluateRoom(room, assignments, support);
      if (!control) crossRoomGain += boosted.score - baseline.score;
      const perRoomWarnings = [...roomWarnings.get(room.roomId)!];
      let dataConfidence = roomConfidence.get(room.roomId)!;
      for (let index = 0; index < boosted.workers.length; index += 1) {
        const worker = boosted.workers[index]!;
        dataConfidence = combineConfidence(dataConfidence, worker.dataConfidence);
        perRoomWarnings.push(...worker.warnings);
        const withoutWorker = new Map(assignments);
        withoutWorker.set(room.roomId, (assignments.get(room.roomId) ?? []).map((id) => id === worker.operatorId ? null : id));
        const contribution = totalScore - score(withoutWorker);
        const reasons = [...worker.reasons];
        if (room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber") {
          reasons.unshift(`Working operators add ${SUPPORT_WEIGHTS.assignedOperatorProductionEfficiencyPercent}% staffing efficiency each; the room stops when all operators rest.`);
        }
        reasons.push(`Estimated working uptime: ${(boosted.uptimes[index]! * 100).toFixed(1)}%.`);
        reasons.push(`Removing this operator reduces the whole assignment score by ${formatScorePoints(contribution)} points, including effects on coworkers. Marginal contributions overlap and are not additive.`);
        explanations.push({ operatorId: worker.operatorId, roomId: room.roomId, projectedContribution: contribution, reasons, dataConfidence: combineConfidence(dataConfidence, worker.dataConfidence) });
      }
      const directProductionScore = room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber" ? baseline.score : 0;
      const supportRoomScore = room.roomKind === "reception_room" ? baseline.score : 0;
      const roomScore = directProductionScore + supportRoomScore;
      roomPlans.push({
        roomId: room.roomId,
        roomKind: room.roomKind,
        roomLevel: room.level,
        slotCap: room.slotCap,
        chosenRecipeIds: [...room.fixedRecipeIds],
        chosenProductKind: room.recipes.length === 1 ? room.recipes[0]?.productKind : undefined,
        assignedOperatorIds: workerIds(room.roomId, assignments),
        scoreBreakdown: { directProductionScore, supportRoomScore, crossRoomBonusContribution: 0, totalScore: roomScore },
        projectedScore: roomScore,
        projectedOutputs: { ...boosted.outputs },
        warnings: [...new Set(perRoomWarnings)],
        usedFallbackHeuristics: false,
        dataConfidence,
      });
      if (!control) {
        for (const product of Object.keys(projectedOutputs) as ProductKind[]) projectedOutputs[product] += boosted.outputs[product];
        for (const [recipeId, output] of Object.entries(boosted.recipeOutputs)) projectedRecipeOutputs[recipeId] = (projectedRecipeOutputs[recipeId] ?? 0) + output;
      }
      warnings.push(...perRoomWarnings);
    }
    const controlPlan = roomPlans.find((room) => room.roomKind === "control_nexus");
    if (controlPlan) {
      controlPlan.scoreBreakdown.crossRoomBonusContribution = crossRoomGain;
      controlPlan.scoreBreakdown.totalScore = crossRoomGain;
      controlPlan.projectedScore = crossRoomGain;
    }
    return {
      catalogVersion: catalog.version,
      totalScore,
      projectedOutputs,
      projectedRecipeOutputs,
      roomPlans,
      explanations,
      warnings: [...new Set(warnings)],
      supportWeightsVersion: SUPPORT_WEIGHTS.version,
    };
  }

  function roomUpperBound(roomId: string, assigned: string[], candidates: string[], openSlots: number): number {
    const room = roomsById.get(roomId);
    if (!room || room.roomKind === "control_nexus") return 0;
    const roomEffects = effects.get(roomId)!;
    const current = assigned.filter((id) => roomEffects.has(id));
    const available = candidates.filter((id) => !current.includes(id) && roomEffects.has(id));
    const seats = Math.min(Math.max(0, openSlots), available.length);
    const fullActiveCount = current.length + seats;
    if (fullActiveCount === 0) return 0;
    const bestRemaining = (value: (worker: WorkerEffects) => number) => available.map((id) => value(roomEffects.get(id)!)).sort((left, right) => right - left).slice(0, seats).reduce((sum, bonus) => sum + bonus, 0);
    if (room.roomKind === "reception_room") {
      const totalBonus = current.reduce((sum, id) => sum + roomEffects.get(id)!.clueEfficiencyPercent, 0)
        + bestRemaining((worker) => worker.clueEfficiencyPercent);
      return totalBonus * SUPPORT_WEIGHTS.receptionClueCollectionWeight * demand.receptionWeight;
    }
    return recipes.get(roomId)!.reduce((sum, recipe) => {
      // Each recipe may optimistically choose different workers. This remains an
      // upper bound when a room grows several material families simultaneously.
      const bonus = current.reduce((total, id) => total + roomEffects.get(id)!.production[recipe.productKind], 0)
        + bestRemaining((worker) => worker.production[recipe.productKind]);
      const multiplier = (1 + fullActiveCount * SUPPORT_WEIGHTS.assignedOperatorProductionEfficiencyPercent / 100) * (1 + bonus / 100);
      return sum + recipe.baseUnitsPerHour * recipe.scorePerUnit * multiplier;
    }, 0);
  }

  function canContribute(roomId: string, operatorId: string): boolean {
    const room = roomsById.get(roomId);
    const worker = effects.get(roomId)?.get(operatorId);
    if (!room || !worker) return false;
    if (room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber") {
      return recipes.get(roomId)!.some((recipe) => recipe.baseUnitsPerHour * recipe.scorePerUnit > 0);
    }
    return worker.moodDropReductionPercent > 0 || worker.moodRegenPercent > 0
      || (room.roomKind === "reception_room" && worker.clueEfficiencyPercent > 0);
  }

  return {
    score, result, roomUpperBound, canContribute, controlSupport,
    scoreTeam: (roomId: string, ids: string[], support: MoodModifiers) =>
      evaluateTeam(roomsById.get(roomId)!, [...ids].sort(), support).score,
  };
}
