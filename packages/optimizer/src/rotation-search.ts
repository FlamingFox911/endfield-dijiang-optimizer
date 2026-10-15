import type { GameCatalog, OptimizationResult, ShiftSchedule } from "@endfield/domain";
import { getShiftDurationMinutes, getShiftRoomId, snapShiftScheduleToHours, SHIFT_SCHEDULE_STEP_MINUTES } from "@endfield/data";
import { createAssignmentScorer } from "./assignment-scoring.js";
import { createOperatorPreference } from "./operator-preference.js";
import { OptimizationCancelledError, type NormalizedScenarioResult } from "./solver.js";
import type { SolveScenarioOptions } from "./types.js";

type Assignments = Map<string, Array<string | null>>;
type FixedSolver = (catalog: GameCatalog, normalized: NormalizedScenarioResult, options?: SolveScenarioOptions) => OptimizationResult;
const EPSILON = 1e-11;
const minute = (value: number) => (Math.round(value) % 1440 + 1440) % 1440;
const clone = (assignments: Assignments): Assignments => new Map([...assignments].map(([id, workers]) => [id, [...workers]]));

/** Alternates team reallocations and daily schedule searches, from several
 * feasible starts. This deliberately reports an approximate joint result:
 * certifying an allocation at noon does not certify all possible schedules.
 */
export function optimizeRotationSchedules(
  catalog: GameCatalog, normalized: NormalizedScenarioResult, options: SolveScenarioOptions | undefined,
  solveFixed: FixedSolver,
): OptimizationResult {
  const startedAt = performance.now();
  const checkCancel = () => { if (options?.shouldCancel?.()) throw new OptimizationCancelledError(); };
  const scenario = normalized.scenario;
  const rooms = normalized.rooms.map((room) => ({ ...room, shiftSchedule: room.shiftSchedule && { ...room.shiftSchedule } }));
  const physical = rooms.filter((room) => room.shift === "A");
  // A sustainable balanced split gives a useful starting allocation without
  // spending an unbounded search on an arbitrary user-saved starting schedule.
  const seedRooms = rooms.map((room) => {
    if (!room.shift) return { ...room };
    const original = physical.find((entry) => entry.physicalRoomId === room.physicalRoomId)!.shiftSchedule!;
    const start = original.startMinute;
    return { ...room, shiftSchedule: room.shift === "A"
      ? { startMinute: start, endMinute: minute(start + 720) }
      : { startMinute: minute(start + 720), endMinute: start } };
  });
  const seed = solveFixed(catalog, { ...normalized, rooms: seedRooms, scenario: {
    ...scenario, options: { ...scenario.options, shiftRotation: { ...scenario.options.shiftRotation!, scheduleMode: "fixed" } },
  } }, { ...options, searchConfig: {
    profileLabel: options?.searchConfig?.profileLabel ?? scenario.options.optimizationProfile ?? "exhaustive",
    effort: options?.searchConfig?.effort ?? scenario.options.optimizationEffort ?? 100,
    maxVisitedNodes: Math.min(options?.searchConfig?.maxVisitedNodes ?? 3000, 3000),
    maxBranchCandidatesPerSlot: null, progressIntervalNodes: 250,
  } });
  const scorer = createAssignmentScorer(catalog, scenario, rooms);
  const compare = createOperatorPreference(catalog.operators);
  const known = new Set(catalog.operators.map((operator) => operator.id));
  const owned = [...new Set(scenario.roster.filter((entry) => entry.owned && known.has(entry.operatorId))
    .map((entry) => entry.operatorId))].sort(compare);
  const base = new Map(seed.roomPlans.map((plan) => [plan.roomId,
    [...plan.assignedOperatorIds, ...Array(Math.max(0, (plan.slotCap ?? 0) - plan.assignedOperatorIds.length)).fill(null)] as Array<string | null>]));
  const pins = new Set(scenario.facilities.hardAssignments.filter((pin) =>
    base.get(getShiftRoomId(pin.roomId, pin.shift))?.includes(pin.operatorId)).map((pin) => pin.operatorId));
  const slots = rooms.flatMap((room) => Array.from({ length: room.slotCap }, (_, index) => ({ roomId: room.roomId, index })));
  const free = (assignments: Assignments) => {
    const used = new Set([...assignments.values()].flat());
    return owned.filter((id) => !used.has(id));
  };
  const schedules = () => new Map(physical.map((room) => [room.physicalRoomId!, { ...room.shiftSchedule! }]));
  const restore = (saved: Map<string, ShiftSchedule>) => { for (const [id, schedule] of saved) scorer.setShiftSchedule(id, schedule); };
  const balanced = new Map(seedRooms.filter((room) => room.shift === "A").map((room) => [room.physicalRoomId!, { ...room.shiftSchedule! }]));
  restore(balanced);
  let evaluations = seed.search?.visitedNodes ?? 0;
  let evaluatedSchedules = 0;
  let best = clone(base);
  let bestScore = scorer.score(best);
  let bestSchedules = schedules();
  let lastProgressAt = -Infinity;
  const progress = (phase: string, force = false) => {
    checkCancel();
    const now = performance.now();
    if (!force && now - lastProgressAt < 250) return;
    lastProgressAt = now;
    options?.onProgress?.({ phase, visitedNodes: evaluations, bestScore, currentDepth: slots.length,
      totalSlots: slots.length, profileLabel: scenario.options.optimizationProfile ?? "exhaustive",
      effort: scenario.options.optimizationEffort ?? 100, maxVisitedNodes: null, maxBranchCandidatesPerSlot: null,
      timing: { elapsedMs: now - startedAt, nodesPerSecond: evaluations * 1000 / Math.max(1, now - startedAt),
        estimatedRemainingMs: null, estimateBasis: null, completedBranches: 0, totalBranches: 0, searchFinished: false } });
  };
  const evaluate = (assignments: Assignments) => {
    evaluations += 1;
    if (evaluations % 64 === 0) progress("Optimizing shift teams and schedules");
    return scorer.score(assignments);
  };
  const remember = (assignments: Assignments, score: number) => {
    if (score > bestScore + EPSILON) { best = clone(assignments); bestScore = score; bestSchedules = schedules(); }
  };

  function optimizeTimes(assignments: Assignments): boolean {
    let improved = false;
    // Optimize production windows first, then place Nexus support around them.
    for (const room of [...physical].sort((a, b) => Number(a.roomKind === "control_nexus") - Number(b.roomKind === "control_nexus"))) {
      checkCancel();
      const id = room.physicalRoomId!;
      const pair = rooms.filter((entry) => entry.physicalRoomId === id);
      if (pair.every((entry) => assignments.get(entry.roomId)!.every((worker) => worker == null))) continue;
      const original = { ...room.shiftSchedule! };
      let chosen = original;
      const support = scorer.controlSupport(assignments);
      const pairScore = () => pair.reduce((sum, entry) => sum + scorer.scoreTeam(entry.roomId,
        assignments.get(entry.roomId)!.filter((worker): worker is string => worker != null), support), 0);
      const local = room.roomKind !== "control_nexus";
      let chosenScore = local ? pairScore() : evaluate(assignments);
      const originalScore = chosenScore;
      const supportStrength = () => { const value = scorer.controlSupport(assignments); return value.moodDropReductionPercent + value.moodRegenPercent; };
      let chosenSupport = local ? 0 : supportStrength();
      const originalSupport = chosenSupport;
      const tryTime = (start: number, duration: number) => {
        if (duration < 60 || duration > 1380 || start % 60 !== 0 || duration % 60 !== 0) return;
        scorer.setShiftSchedule(id, { startMinute: minute(start), endMinute: minute(start + duration) });
        evaluatedSchedules += 1; evaluations += 1;
        if (evaluations % 64 === 0) progress("Optimizing shift lengths and recovery");
        const value = local ? pairScore() : scorer.score(assignments);
        const strength = local || Math.abs(value - chosenScore) > EPSILON ? 0 : supportStrength();
        if (value > chosenScore + EPSILON || (!local && Math.abs(value - chosenScore) <= EPSILON && strength > chosenSupport + EPSILON)) {
          chosenScore = value; chosen = { ...room.shiftSchedule! };
          chosenSupport = local ? 0 : supportStrength();
        }
      };
      // Every legal daily window: 24 starting hours x 23 durations. With
      // constant shipwide support, changing a production window's phase is
      // equivalent, so keep its current start and only compare durations.
      const starts = local && support.rotation?.segments.length === 1 ? [original.startMinute]
        : [original.startMinute, ...Array.from({ length: 24 }, (_, index) => index * SHIFT_SCHEDULE_STEP_MINUTES)
          .filter((start) => start !== original.startMinute)];
      const durations = Array.from({ length: 23 }, (_, index) => (index + 1) * SHIFT_SCHEDULE_STEP_MINUTES);
      for (const start of starts) for (const duration of durations) tryTime(start, duration);
      scorer.setShiftSchedule(id, chosen);
      improved ||= chosenScore > originalScore + EPSILON || chosenSupport > originalSupport + EPSILON;
      remember(assignments, evaluate(assignments));
    }
    return improved;
  }

  function improveTeams(assignments: Assignments): boolean {
    const currentScore = evaluate(assignments);
    let nextScore = currentScore;
    let next: Assignments | undefined;
    const available = free(assignments);
    const consider = () => {
      const value = evaluate(assignments);
      if (value > nextScore + EPSILON) { nextScore = value; next = clone(assignments); }
    };
    for (const [sourceIndex, source] of slots.entries()) {
      const values = assignments.get(source.roomId)!;
      const worker = values[source.index]!;
      if (worker != null && pins.has(worker)) continue;
      for (const replacement of available) {
        if (!scorer.canAssign(source.roomId, replacement)) continue;
        values[source.index] = replacement; consider();
      }
      values[source.index] = worker;
      if (worker != null) { values[source.index] = null; consider(); values[source.index] = worker; }
      for (const target of slots.slice(sourceIndex + 1)) {
        if (source.roomId === target.roomId) continue;
        const targets = assignments.get(target.roomId)!;
        const other = targets[target.index]!;
        if ((worker == null && other == null)
          || (other != null && (pins.has(other) || !scorer.canAssign(source.roomId, other)))
          || (worker != null && !scorer.canAssign(target.roomId, worker))) continue;
        values[source.index] = other; targets[target.index] = worker;
        consider();
        values[source.index] = worker; targets[target.index] = other;
      }
    }
    if (!next) return false;
    for (const [id, workers] of next) assignments.set(id, workers);
    remember(assignments, nextScore);
    return true;
  }

  // Neutral Nexus additions let subsequent schedule searches discover the
  // joint benefit of support plus a longer primary shift. Pure score-greedy
  // additions at 12/12 cannot discover that interaction.
  const seeds = [clone(base)];
  const seedSchedules = new Map<Assignments, Map<string, ShiftSchedule>>();
  for (const reserveSupport of [false, true]) for (const concentrate of [false, true]) {
    const assignments = clone(base);
    const controls = rooms.filter((room) => room.roomKind === "control_nexus");
    if (controls.length === 0) continue;
    const helpers = (reserveSupport ? owned.filter((id) => !pins.has(id)) : free(assignments)).filter((id) => {
      const effects = scorer.workerEffects(controls[0]!.roomId, id);
      return effects.moodDropReductionPercent + effects.moodRegenPercent > 0;
    }).sort((a, b) => {
      const value = (id: string) => { const effects = scorer.workerEffects(controls[0]!.roomId, id); return effects.moodDropReductionPercent + effects.moodRegenPercent; };
      return value(b) - value(a) || compare(a, b);
    });
    helpers.forEach((id, index) => {
      // Also try reserving support before production is staffed. Otherwise a
      // scarce provider used as a generic filler can never clear the initial
      // score loss of moving to Nexus and enabling a much longer primary team.
      const preferred = concentrate ? controls : [controls[index % controls.length]!, ...controls];
      for (const control of preferred) {
        const workers = assignments.get(control.roomId)!;
        const seat = workers.indexOf(null);
        if (seat >= 0) {
          for (const values of assignments.values()) {
            const previous = values.indexOf(id);
            if (previous >= 0) values[previous] = null;
          }
          workers[seat] = id; break;
        }
      }
    });
    if (helpers.length > 0 && !seeds.some((seed) => JSON.stringify([...seed]) === JSON.stringify([...assignments]))) seeds.push(assignments);
  }
  if (options?.initialAssignments) {
    const hinted = new Map([...base].map(([id, workers]) => [id, workers.map((worker) => worker != null && pins.has(worker) ? worker : null)]));
    const hintedSchedules = new Map(balanced);
    for (const plan of options.initialAssignments) {
      const workers = hinted.get(plan.roomId);
      if (!workers) continue;
      for (const id of plan.assignedOperatorIds) {
        const seat = workers.indexOf(null);
        if (seat < 0) break;
        if (free(hinted).includes(id) && scorer.canAssign(plan.roomId, id)) workers[seat] = id;
      }
      const schedule = snapShiftScheduleToHours(plan.shiftSchedule);
      if (plan.shift === "A" && plan.physicalRoomId && schedule) {
        hintedSchedules.set(plan.physicalRoomId, schedule);
      }
    }
    seeds.push(hinted); seedSchedules.set(hinted, hintedSchedules);
  }
  progress("Optimizing shift teams and schedules", true);
  for (const assignments of seeds) {
    restore(seedSchedules.get(assignments) ?? balanced);
    remember(assignments, evaluate(assignments));
    for (let pass = 0; pass < 8; pass += 1) {
      const changedTimes = optimizeTimes(assignments);
      const changedTeams = improveTeams(assignments);
      if (!changedTimes && !changedTeams) break;
    }
    optimizeTimes(assignments);
    remember(assignments, evaluate(assignments));
  }
  restore(bestSchedules);
  // The bounded team passes may end before every useful addition is made.
  // Finish all score-improving open seats before explaining unused operators.
  while (true) {
    let addition: { roomId: string; index: number; id: string; score: number } | undefined;
    for (const room of rooms) {
      const workers = best.get(room.roomId)!;
      const index = workers.indexOf(null);
      if (index < 0) continue;
      for (const id of free(best)) {
        if (!scorer.canAssign(room.roomId, id)) continue;
        workers[index] = id;
        const score = evaluate(best);
        workers[index] = null;
        if (score > (addition?.score ?? bestScore) + EPSILON) addition = { roomId: room.roomId, index, id, score };
      }
    }
    if (!addition) break;
    best.get(addition.roomId)![addition.index] = addition.id;
    bestScore = addition.score;
  }
  // Keep genuinely unused seats empty, rather than advertising arbitrary
  // interchangeable workers as required. In particular, 27 owned cannot fill 30.
  for (const slot of slots) {
    const workers = best.get(slot.roomId)!;
    const worker = workers[slot.index];
    if (worker == null || pins.has(worker)) continue;
    workers[slot.index] = null;
    if (evaluate(best) < bestScore - EPSILON) workers[slot.index] = worker;
  }
  // A is the longer primary shift where labels are unconstrained by pins.
  for (const room of physical) {
    const id = room.physicalRoomId!;
    const a = getShiftRoomId(id, "A"); const b = getShiftRoomId(id, "B");
    if (getShiftDurationMinutes(room.shiftSchedule!) >= 720
      || [...best.get(a)!, ...best.get(b)!].some((worker) => worker != null && pins.has(worker))) continue;
    const workers = best.get(a)!; best.set(a, best.get(b)!); best.set(b, workers);
    scorer.setShiftSchedule(id, { startMinute: room.shiftSchedule!.endMinute, endMinute: room.shiftSchedule!.startMinute });
  }
  checkCancel();
  const result = scorer.result(best);
  result.supportWeightsVersion = `${result.supportWeightsVersion.replace(/-rotation-v\d+$/, "")}-rotation-v4`;
  result.search = { complete: false, visitedNodes: evaluations, maxVisitedNodes: null, budgetExceeded: false,
    candidatesLimited: false, scheduleSearch: { evaluatedSchedules, resolutionMinutes: SHIFT_SCHEDULE_STEP_MINUTES } };
  for (const plan of result.roomPlans) {
    plan.assignedOperatorIds.sort(compare);
    plan.alternativeOperatorIdsBySlot = Array.from({ length: plan.slotCap ?? 0 }, (_, index) => {
      const original = plan.assignedOperatorIds[index] ?? null;
      if (original != null && pins.has(original)) return [];
      const values = best.get(plan.roomId)!;
      const seat = values.indexOf(original);
      if (seat < 0) return [];
      const alternatives = free(best).filter((id) => {
        if (!scorer.canAssign(plan.roomId, id)) return false;
        values[seat] = id;
        const tied = Math.abs(evaluate(best) - result.totalScore) <= EPSILON;
        values[seat] = original;
        return tied;
      });
      return alternatives;
    });
  }
  result.warnings = [...new Set([...normalized.warnings,
    ...seed.warnings.filter((warning) => warning.startsWith("Ignoring ")), ...result.warnings])];
  progress("Shift teams and schedules optimized", true);
  return result;
}
