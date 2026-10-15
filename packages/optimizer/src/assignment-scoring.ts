import type {
  AssignmentExplanation,
  DataConfidence,
  GameCatalog,
  OptimizationResult,
  OptimizationScenario,
  ProductKind,
  RoomPlan,
} from "@endfield/domain";
import { createProjectedOutputs, getShiftRoomId, resolveDemandProfile } from "@endfield/data";

import { SUPPORT_WEIGHTS } from "./config.js";
import {
  getAverageControlSupport,
  getExpectedProductionMultiplier,
  getRoomWorkingUptimes,
  type MoodModifiers,
} from "./production-model.js";
import { formatScorePoints } from "./score-format.js";
import { maximumIntegerMatching, maximumMatchingWeight } from "./matching-bound.js";
import {
  EMPTY_ROTATION_SUPPORT, MAX_MOOD, getRotationUptime, simulateControlRotation,
  type RotationSupport, type RotationUptime,
} from "./rotation-model.js";
import type { NormalizedRoom } from "./solver.js";

type Assignments = Map<string, Array<string | null>>;
interface WorkerEffects extends MoodModifiers {
  operatorId: string;
  production: Record<ProductKind, number>;
  clueEfficiencyPercent: number;
  targetsSpecificClue: boolean;
  specificClueTargets: string[];
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
  rotation?: RotationUptime;
}
type ControlSupport = MoodModifiers & { rotation?: RotationSupport };

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
  const rotationControlCache = new Map<string, ControlSupport>();
  // If even the worst drain and recovery rates cover every window, Nexus
  // skills cannot improve the objective. Avoid enumerating irrelevant teams.
  const requiresNexusSupport = () => !scenario.options.shiftRotation?.enabled || rooms.some((room) => {
    if (room.roomKind === "control_nexus") return false;
    if (!room.shiftSchedule) return true;
    const hours = ((room.shiftSchedule.endMinute - room.shiftSchedule.startMinute + 1440) % 1440) / 60;
    return hours * SUPPORT_WEIGHTS.baselineMoodDrainPerHour > MAX_MOOD
      || hours * SUPPORT_WEIGHTS.baselineMoodDrainPerHour > (24 - hours) * SUPPORT_WEIGHTS.baselineMoodRegenPerHour;
  });
  let needsNexusSupport = requiresNexusSupport();
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
        targetsSpecificClue: false,
        specificClueTargets: [],
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
            worker.targetsSpecificClue = true;
            worker.specificClueTargets.push(modifier.appliesTo.replaceAll("_", " ").replace(/^clue/, "Clue"));
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
                worker.reasons.push(`${skill.name}: general clue collection +${modifier.value}% while working; multiplies active staffing efficiency.`);
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

  function controlSupport(assignments: Assignments): ControlSupport {
    if (scenario.options.shiftRotation?.enabled) {
      const controls = rooms.filter((room) => room.roomKind === "control_nexus");
      const key = controls.map((room) => `${room.roomId}:${room.shiftSchedule ? `${room.shiftSchedule.startMinute}-${room.shiftSchedule.endMinute}` : "normal"}:${workerIds(room.roomId, assignments).join(",")}`).join("|");
      const cached = rotationControlCache.get(key);
      if (cached) return cached;
      const rotation = simulateControlRotation(controls.map((room) => ({
        schedule: room.shiftSchedule,
        workers: workerIds(room.roomId, assignments).map((id) => effects.get(room.roomId)!.get(id)!),
      })), key);
      if (rotationControlCache.size >= 256) rotationControlCache.clear();
      const value = { ...rotation.average, rotation };
      rotationControlCache.set(key, value);
      return value;
    }
    const controlWorkers = rooms.filter((room) => room.roomKind === "control_nexus").flatMap((room) => (
      workerIds(room.roomId, assignments).map((id) => effects.get(room.roomId)!.get(id)!)
    ));
    const key = controlWorkers.map((worker) => worker.operatorId).sort().join(",");
    const cached = controlCache.get(key);
    if (cached) return cached;
    return remember(controlCache, key, getAverageControlSupport(controlWorkers));
  }

  function evaluateRoom(room: NormalizedRoom, assignments: Assignments, support: ControlSupport): RoomEvaluation {
    const ids = workerIds(room.roomId, assignments);
    return evaluateTeam(room, ids, support);
  }

  function evaluateTeam(room: NormalizedRoom, ids: string[], support: ControlSupport): RoomEvaluation {
    const key = `${room.roomId}|${room.shiftSchedule?.startMinute}-${room.shiftSchedule?.endMinute}|${ids.join(",")}|${support.rotation?.key ?? `${support.moodDropReductionPercent}|${support.moodRegenPercent}`}`;
    const cached = roomCache.get(key);
    if (cached) return cached;
    const workers = ids.map((id) => effects.get(room.roomId)!.get(id)!);
    const rotation = scenario.options.shiftRotation?.enabled
      ? getRotationUptime({ schedule: room.shiftSchedule, workers }, support.rotation ?? EMPTY_ROTATION_SUPPORT) : undefined;
    const uptimes = rotation ? workers.map(() => rotation.workingHoursPerDay / 24) : getRoomWorkingUptimes(workers, support);
    const outputs = createProjectedOutputs();
    const recipeOutputs: Record<string, number> = {};
    let score = 0;
    for (const recipe of recipes.get(room.roomId)!) {
      const multiplier = rotation
        ? getExpectedProductionMultiplier(workers.map(() => 1), workers.map((worker) => worker.production[recipe.productKind])) * rotation.workingHoursPerDay / 24
        : getExpectedProductionMultiplier(uptimes, workers.map((worker) => worker.production[recipe.productKind]));
      const output = recipe.baseUnitsPerHour * multiplier;
      outputs[recipe.productKind] += output;
      recipeOutputs[recipe.id] = (recipeOutputs[recipe.id] ?? 0) + output;
      score += output * recipe.scorePerUnit;
    }
    if (room.roomKind === "reception_room") {
      // Reception has the same base and per-worker staffing terms as other
      // productive cabins. Skills multiply that throughput; they are not the
      // only reason a worker contributes. Keep utility in efficiency points,
      // without inventing a clue period or a Credits-to-EXP conversion.
      const bonuses = workers.map((worker) => worker.clueEfficiencyPercent);
      const multiplier = rotation
        ? getExpectedProductionMultiplier(workers.map(() => 1), bonuses) * rotation.workingHoursPerDay / 24
        : getExpectedProductionMultiplier(uptimes, bonuses);
      score = multiplier * 100 * SUPPORT_WEIGHTS.receptionClueCollectionWeight * demand.receptionWeight;
    }
    return remember(roomCache, key, { score, workers, uptimes, outputs, recipeOutputs, rotation });
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
      const boosted = control ? { ...baseline } : evaluateRoom(room, assignments, support);
      if (control && support.rotation && boosted.rotation) {
        const index = rooms.filter((entry) => entry.roomKind === "control_nexus").indexOf(room);
        const workingHoursPerDay = support.rotation.workingHoursPerDay[index] ?? 0;
        boosted.rotation = { ...boosted.rotation, workingHoursPerDay,
          downtimeHoursPerDay: Math.max(0, boosted.rotation.scheduledHoursPerDay - workingHoursPerDay) };
        boosted.uptimes = boosted.workers.map(() => workingHoursPerDay / 24);
      }
      if (!control) crossRoomGain += boosted.score - baseline.score;
      const perRoomWarnings = [...roomWarnings.get(room.roomId)!];
      if (room.shift && boosted.rotation && boosted.rotation.downtimeHoursPerDay > 1 / 60 && !control) {
        const roomName = room.roomKind === "manufacturing_cabin" ? "Manufacturing Cabin" : room.roomKind === "growth_chamber" ? "Growth Chamber" : "Reception Room";
        perRoomWarnings.push(`${roomName} (${room.physicalRoomId}): Shift ${room.shift} has estimated downtime ${boosted.rotation.downtimeHoursPerDay.toFixed(2)} hours/day within its scheduled window${boosted.workers.length === 0 ? " (no operators assigned)" : " due to Mood depletion and recovery"}.`);
      }
      let dataConfidence = roomConfidence.get(room.roomId)!;
      for (let index = 0; index < boosted.workers.length; index += 1) {
        const worker = boosted.workers[index]!;
        dataConfidence = combineConfidence(dataConfidence, worker.dataConfidence);
        perRoomWarnings.push(...worker.warnings);
        const withoutWorker = new Map(assignments);
        withoutWorker.set(room.roomId, (assignments.get(room.roomId) ?? []).map((id) => id === worker.operatorId ? null : id));
        const contribution = totalScore - score(withoutWorker);
        const reasons = [...worker.reasons];
        if (room.roomKind !== "control_nexus") {
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
        ...(room.physicalRoomId ? { physicalRoomId: room.physicalRoomId } : {}),
        ...(room.shift ? {
          shift: room.shift, shiftSchedule: room.shiftSchedule,
        } : {}),
        ...boosted.rotation,
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
    const controlPlans = roomPlans.filter((room) => room.roomKind === "control_nexus");
    const controlGains = controlPlans.map((plan) => {
      const without = new Map(assignments);
      without.set(plan.roomId, []);
      return Math.max(0, totalScore - score(without));
    });
    const gainSum = controlGains.reduce((sum, gain) => sum + gain, 0);
    for (const [index, controlPlan] of controlPlans.entries()) {
      const gain = crossRoomGain * (gainSum > 0 ? controlGains[index]! / gainSum : 1 / controlPlans.length);
      controlPlan.scoreBreakdown.crossRoomBonusContribution = gain;
      controlPlan.scoreBreakdown.totalScore = gain;
      controlPlan.projectedScore = gain;
      if (support.rotation) {
        const working = support.rotation.workingHoursPerDay[index] ?? 0;
        controlPlan.workingHoursPerDay = working;
        controlPlan.downtimeHoursPerDay = Math.max(0, (controlPlan.scheduledHoursPerDay ?? 0) - working);
        if (controlPlan.shift && controlPlan.downtimeHoursPerDay > 1 / 60 && needsNexusSupport) {
          const warning = `${controlPlan.shift ? `Shift ${controlPlan.shift}` : "Normal operation"}: estimated Control Nexus support downtime ${controlPlan.downtimeHoursPerDay.toFixed(2)} hours/day.`;
          controlPlan.warnings.push(warning);
          warnings.push(warning);
        }
      }
    }
    const used = new Set(roomPlans.flatMap((plan) => plan.assignedOperatorIds));
    const openRooms = rooms.filter((room) => workerIds(room.roomId, assignments).length < room.slotCap);
    const unassignedOperators = [...owned.keys()].filter((id) => definitions.has(id) && !used.has(id)).map((operatorId) => {
      let bestOpenSlotScoreGain = 0;
      for (const room of openRooms.filter((entry) => canAssign(entry.roomId, operatorId))) {
        const withWorker = new Map(assignments);
        withWorker.set(room.roomId, [...workerIds(room.roomId, assignments), operatorId]);
        bestOpenSlotScoreGain = Math.max(bestOpenSlotScoreGain, score(withWorker) - totalScore);
      }
      if (bestOpenSlotScoreGain < 1e-11) bestOpenSlotScoreGain = 0;
      const reasons = [openRooms.length === 0 ? "All available shift seats are occupied."
        : bestOpenSlotScoreGain === 0 ? "Adding this operator to a permitted open seat does not improve the score at the current teams and schedules."
          : "The search left this operator unused; an open seat may still improve the plan."];
      const reception = openRooms.find((room) => room.roomKind === "reception_room");
      if (reception) {
        const worker = effects.get(reception.roomId)!.get(operatorId)!;
        if (worker.targetsSpecificClue) {
          reasons.push(`Reception avoids ${[...new Set(worker.specificClueTargets)].join(" / ")} Rate-UP by default; use a Hard Assignment to request it.`);
        } else if (worker.moodDropReductionPercent + worker.moodRegenPercent > 0 && worker.clueEfficiencyPercent === 0
          && roomPlans.filter((plan) => plan.roomKind === "reception_room").every((plan) =>
            plan.workingHoursPerDay !== undefined && plan.workingHoursPerDay >= (plan.scheduledHoursPerDay ?? 24) - 1e-8)) {
          reasons.push("Reception teams already cover their scheduled hours; extra Mood sustain adds no gain beyond this operator's staffing bonus.");
        }
      }
      if (rooms.some((room) => room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber")
        && !openRooms.some((room) => room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber")) {
        reasons.push("Production shifts are fully staffed; a placement there requires replacing another operator.");
      }
      return { operatorId, reasons, bestOpenSlotScoreGain };
    });
    return {
      catalogVersion: catalog.version,
      totalScore,
      projectedOutputs,
      projectedRecipeOutputs,
      roomPlans,
      explanations,
      unassignedOperators,
      warnings: [...new Set(warnings)],
      supportWeightsVersion: scenario.options.shiftRotation?.enabled ? `${SUPPORT_WEIGHTS.version}-rotation-v4` : SUPPORT_WEIGHTS.version,
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
      return (100 + totalBonus) * (1 + fullActiveCount * SUPPORT_WEIGHTS.assignedOperatorProductionEfficiencyPercent / 100)
        * SUPPORT_WEIGHTS.receptionClueCollectionWeight * demand.receptionWeight
        * (room.shiftSchedule ? ((room.shiftSchedule.endMinute - room.shiftSchedule.startMinute + 1440) % 1440) / 1440 : 1);
    }
    return recipes.get(roomId)!.reduce((sum, recipe) => {
      // Each recipe may optimistically choose different workers. This remains an
      // upper bound when a room grows several material families simultaneously.
      const bonus = current.reduce((total, id) => total + roomEffects.get(id)!.production[recipe.productKind], 0)
        + bestRemaining((worker) => worker.production[recipe.productKind]);
      const multiplier = (1 + fullActiveCount * SUPPORT_WEIGHTS.assignedOperatorProductionEfficiencyPercent / 100) * (1 + bonus / 100);
      return sum + recipe.baseUnitsPerHour * recipe.scorePerUnit * multiplier
        * (room.shiftSchedule ? ((room.shiftSchedule.endMinute - room.shiftSchedule.startMinute + 1440) % 1440) / 1440 : 1);
    }, 0);
  }

  function canAssign(roomId: string, operatorId: string): boolean {
    const worker = effects.get(roomId)?.get(operatorId);
    if (!worker) return false;
    if (roomsById.get(roomId)?.roomKind !== "reception_room" || !worker.targetsSpecificClue) return true;
    return scenario.facilities.hardAssignments.some((pin) => pin.operatorId === operatorId
      && getShiftRoomId(pin.roomId, pin.shift) === roomId
      && (pin.shift !== "B" || scenario.options.shiftRotation?.enabled));
  }

  function canContribute(roomId: string, operatorId: string): boolean {
    const room = roomsById.get(roomId);
    const worker = effects.get(roomId)?.get(operatorId);
    if (!room || !worker || !canAssign(roomId, operatorId)) return false;
    if (room.roomKind === "control_nexus" && !needsNexusSupport) return false;
    if (room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber") {
      return recipes.get(roomId)!.some((recipe) => recipe.baseUnitsPerHour * recipe.scorePerUnit > 0);
    }
    if (room.roomKind === "reception_room") return demand.receptionWeight > 0;
    return worker.moodDropReductionPercent > 0 || worker.moodRegenPercent > 0;
  }

  const fullStaffBonuses = new Map<string, Map<string, number>>();
  const fullStaffBases = new Map<string, number>();
  const matchingBoundCache = new Map<string, number>();
  function symmetryKey(roomId: string): string | undefined {
    const room = roomsById.get(roomId)!;
    return room.shiftSchedule && !needsNexusSupport
      ? JSON.stringify([room.roomKind, room.slotCap, room.fixedRecipeIds,
        (room.shiftSchedule.endMinute - room.shiftSchedule.startMinute + 1440) % 1440]) : undefined;
  }

  /** Relax to full staffing and match skill bonuses to seats without reusing
   * operators. This bounds all staffing/skill interactions while respecting
   * competition across both shifts and different facility kinds.
   */
  function staffingUpperBound(roomIds: string[], candidates: string[], fixed: Map<string, string[]>, limit?: { roomId: string; openSlots: number }): number | undefined {
    if (!scenario.options.shiftRotation?.enabled || needsNexusSupport) return undefined;
    const key = `${roomIds.join(",")}|${candidates.join(",")}|${limit ? `${limit.roomId}:${limit.openSlots}` : ""}`;
    const cached = matchingBoundCache.get(key);
    if (cached !== undefined) return cached;
    const weights: number[][] = [];
    let bound = 0;
    for (const roomId of roomIds) {
      const room = roomsById.get(roomId)!;
      const fraction = ((room.shiftSchedule!.endMinute - room.shiftSchedule!.startMinute + 1440) % 1440) / 1440;
      if (!fullStaffBonuses.has(roomId)) {
        const staffing = 1 + room.slotCap * SUPPORT_WEIGHTS.assignedOperatorProductionEfficiencyPercent / 100;
        fullStaffBases.set(roomId, room.roomKind === "reception_room"
          ? 100 * SUPPORT_WEIGHTS.receptionClueCollectionWeight * demand.receptionWeight * staffing * fraction
          : recipes.get(roomId)!.reduce((sum, recipe) => sum + recipe.baseUnitsPerHour * recipe.scorePerUnit * staffing * fraction, 0));
        fullStaffBonuses.set(roomId, new Map([...effects.get(roomId)!].map(([id, worker]) => [id,
          room.roomKind === "reception_room"
            ? worker.clueEfficiencyPercent * SUPPORT_WEIGHTS.receptionClueCollectionWeight * demand.receptionWeight * staffing * fraction
            : recipes.get(roomId)!.reduce((sum, recipe) => sum + recipe.baseUnitsPerHour * recipe.scorePerUnit * staffing * fraction * worker.production[recipe.productKind] / 100, 0),
        ])));
      }
      const bonuses = fullStaffBonuses.get(roomId)!;
      const pinned = fixed.get(roomId)!;
      bound += fullStaffBases.get(roomId)! + pinned.reduce((sum, id) => sum + bonuses.get(id)!, 0);
      const values = candidates.map((id) => bonuses.get(id)!);
      const openSlots = Math.min(room.slotCap - pinned.length, limit?.roomId === roomId ? limit.openSlots : Infinity);
      for (let seat = 0; seat < openSlots; seat += 1) weights.push(values);
    }
    return remember(matchingBoundCache, key, bound + maximumMatchingWeight(weights));
  }

  /** When full staffing attains the relaxed bound, matching itself proves the
   * optimum. Confirm against the actual scorer before using the certificate.
   * Integer low bits prefer fewer workers, then the preferred workforce.
   */
  function certifiedFullUptimePlan(initial: Assignments, available: string[]): Assignments | undefined {
    if (!scenario.options.shiftRotation?.enabled || needsNexusSupport) return undefined;
    const productive = rooms.filter((room) => room.roomKind !== "control_nexus");
    const fixed = new Map(rooms.map((room) => [room.roomId, workerIds(room.roomId, initial)]));
    const bound = staffingUpperBound(productive.map((room) => room.roomId), available, fixed)!;
    const seats = productive.flatMap((room, roomIndex) => Array.from({ length: room.slotCap - fixed.get(room.roomId)!.length },
      (_, seat) => ({ room, roomIndex, first: seat === 0 && fixed.get(room.roomId)!.length === 0,
        mandatory: (fullStaffBases.get(room.roomId) ?? 0) > 0 })));
    if (available.length < seats.filter((seat) => seat.mandatory).length) return undefined;
    const placementBits = available.length * productive.length;
    const workforceOffset = placementBits + Math.ceil(Math.log2(productive.length + 1));
    const countUnit = 1n << BigInt(available.length + workforceOffset + 1);
    const scoreUnit = countUnit * BigInt(4 * (seats.length + 1));
    const scale = 1e15;
    const forbidden = -BigInt(Math.ceil(Math.abs(bound) + 1)) * BigInt(scale) * scoreUnit;
    const weights = seats.map(({ room, roomIndex, mandatory, first }) => [
      ...available.map((id, index) => !canAssign(room.roomId, id) ? forbidden : BigInt(Math.round(fullStaffBonuses.get(room.roomId)!.get(id)! * scale)) * scoreUnit
        - countUnit + (1n << BigInt(workforceOffset + available.length - index - 1))
        + (first ? 1n << BigInt(placementBits) : 0n)
        + (1n << BigInt(available.length * (productive.length - roomIndex) - index - 1))),
      ...seats.map(() => mandatory ? forbidden : 0n),
    ]);
    const matched = maximumIntegerMatching(weights);
    const assigned = new Map([...initial].map(([roomId, ids]) => [roomId, [...ids]]));
    for (const [index, column] of matched.entries()) {
      if (column >= available.length) { if (seats[index]!.mandatory) return undefined; continue; }
      const values = assigned.get(seats[index]!.room.roomId)!;
      values[values.indexOf(null)] = available[column]!;
    }
    return Math.abs(score(assigned) - bound) <= 1e-12 ? assigned : undefined;
  }

  return {
    score, result, roomUpperBound, canAssign, canContribute, controlSupport, staffingUpperBound, certifiedFullUptimePlan,
    workerEffects: (roomId: string, operatorId: string) => effects.get(roomId)!.get(operatorId)!,
    setShiftSchedule: (physicalRoomId: string, schedule: NonNullable<NormalizedRoom["shiftSchedule"]>) => {
      for (const room of rooms.filter((entry) => entry.physicalRoomId === physicalRoomId)) {
        room.shiftSchedule = room.shift === "A" ? { ...schedule }
          : { startMinute: schedule.endMinute, endMinute: schedule.startMinute };
      }
      needsNexusSupport = requiresNexusSupport();
      fullStaffBases.clear(); fullStaffBonuses.clear(); matchingBoundCache.clear();
    },
    requiresFullStaffing: (roomId: string, gap: number): boolean => {
      const room = roomsById.get(roomId)!;
      const base = fullStaffBases.get(roomId) ?? 0;
      const loss = base / (1 + room.slotCap * SUPPORT_WEIGHTS.assignedOperatorProductionEfficiencyPercent / 100)
        * SUPPORT_WEIGHTS.assignedOperatorProductionEfficiencyPercent / 100;
      return loss > gap + 1e-12;
    },
    // With guaranteed full scheduled uptime, equal-duration copies of a cabin
    // have identical objectives even when their clock windows differ.
    teamSymmetryKey: symmetryKey,
    scoreTeam: (roomId: string, ids: string[], support: MoodModifiers) =>
      evaluateTeam(roomsById.get(roomId)!, [...ids].sort(), support).score,
  };
}
