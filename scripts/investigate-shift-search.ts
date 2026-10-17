/** Offline investigation, not a production solver. Run with:
 * npx tsx scripts/investigate-shift-search.ts --output docs/exact-shift-search-results.json
 * The exhaustive comparison deliberately uses small rosters with no Nexus skills
 * and no hard assignments. It does not claim to solve the full roster exactly.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import rosterFixture from "../tests/fixtures/shift-rotation-roster.json";
import type { GameCatalog, OptimizationScenario, ShiftSchedule } from "@endfield/domain";
import { createStarterScenario } from "@endfield/data";
import { loadDefaultCatalog } from "@endfield/data/node";
import { createAssignmentScorer } from "../packages/optimizer/src/assignment-scoring.js";
import { normalizeScenario, solveScenario, type NormalizedRoom } from "../packages/optimizer/src/solver.js";
import { getRotationUptime } from "../packages/optimizer/src/rotation-model.js";
import { maximumMatchingWeight } from "../packages/optimizer/src/matching-bound.js";
import { SUPPORT_WEIGHTS } from "../packages/optimizer/src/config.js";

interface ProbeWorker { production: number; reduction: number; weaponProduction?: number }
interface Column {
  mask: number;
  score: number;
  mode: "normal" | "rotation";
  a: string[];
  b: string[];
  schedule?: ShiftSchedule;
}
const noSupport = { moodDropReductionPercent: 0, moodRegenPercent: 0 };
const tolerance = 1e-10;
const staffingBonus = SUPPORT_WEIGHTS.assignedOperatorProductionEfficiencyPercent / 100;
const bundled = await loadDefaultCatalog();

/** A schedule-independent relaxation. Each physical facility's daily average
 * cannot exceed its stronger team's fully active rate. Those selected teams
 * remain disjoint between facilities. Relax fatigue, pins, Nexus staffing and
 * missing workers, fill every seat, then match production bonuses globally.
 * The inspected fixtures all contain a zero-production worker in each room;
 * that lets this investigation recover the base rate from the existing scorer.
 * Production implementation should expose base rates directly instead.
 */
function fullUptimeUpperBound(catalog: GameCatalog, scenario: OptimizationScenario) {
  const normalized = normalizeScenario(catalog, scenario);
  const physical = normalized.rooms.filter((room) => room.shift === "A" && room.roomKind !== "control_nexus");
  const scorer = createAssignmentScorer(catalog, normalized.scenario, normalized.rooms);
  const ids = scenario.roster.filter((entry) => entry.owned).map((entry) => entry.operatorId);
  const weights: number[][] = [];
  let base = 0;
  for (const room of physical) {
    scorer.setShiftSchedule(room.physicalRoomId!, { startMinute: 0, endMinute: 60 });
    const generic = ids.find((id) => {
      const worker = scorer.workerEffects(room.roomId, id);
      return room.roomKind === "reception_room" ? worker.clueEfficiencyPercent === 0
        : Object.values(worker.production).every((bonus) => bonus === 0);
    });
    assert.ok(generic, "Investigation bound needs a generic reference worker");
    const unstaffedBaseRate = scorer.scoreTeam(room.roomId, [generic], noSupport) * 24 / (1 + staffingBonus);
    const factor = 1 + room.slotCap * staffingBonus;
    base += factor * unstaffedBaseRate;
    const bonuses = ids.map((id) => factor * (scorer.scoreTeam(room.roomId, [id], noSupport) * 24 / (1 + staffingBonus) - unstaffedBaseRate));
    for (let seat = 0; seat < room.slotCap; seat += 1) weights.push(bonuses);
  }
  return base + maximumMatchingWeight(weights) + tolerance;
}

function makeProbe(workers: ProbeWorker[], facilities = 1) {
  const catalog = structuredClone(bundled);
  catalog.operators = workers.map((worker, index) => {
    const operator = structuredClone(catalog.operators[0]!);
    operator.id = `probe-${index}`;
    operator.name = `Probe ${index}`;
    operator.baseSkills = [{
      ...operator.baseSkills[0]!, id: "probe-skill", facilityKind: "manufacturing_cabin",
      ranks: [{
        ...operator.baseSkills[0]!.ranks[0]!, rank: 1, modifiers: [
          { metric: "production_efficiency", appliesTo: "operator_exp", unit: "percent", value: worker.production },
          { metric: "production_efficiency", appliesTo: "weapon_exp", unit: "percent", value: worker.weaponProduction ?? worker.production },
          { metric: "mood_drop_reduction", appliesTo: "all", unit: "percent", value: worker.reduction },
        ],
      }],
    }];
    return operator;
  });
  const scenario = createStarterScenario(catalog);
  scenario.roster.forEach((entry) => {
    entry.owned = true; entry.level = 80; entry.promotionTier = 4;
    entry.baseSkillStates = [{ skillId: "probe-skill", unlockedRank: 1 }];
  });
  scenario.facilities.controlNexus.level = 3;
  scenario.facilities.manufacturingCabins.forEach((room, index) => {
    room.enabled = index < facilities;
    room.level = 1;
    room.fixedRecipeId = index === 0 ? "elementary-combat-record" : "arms-inspector";
  });
  scenario.facilities.growthChambers.forEach((room) => { room.enabled = false; });
  scenario.facilities.receptionRoom!.enabled = false;
  scenario.options.optimizationProfile = "exhaustive";
  scenario.options.optimizationEffort = 100;
  scenario.options.shiftRotation = { enabled: true, scheduleMode: "optimized" };
  return { catalog, scenario };
}

/** Enumerate all legal hourly windows, normal operation, team choices and
 * cross-facility operator exclusions for the restricted probes above. Keeping
 * only the best column for an identical worker mask is lossless here: nothing
 * outside this facility depends on its schedule when there is no Nexus support.
 */
function exactProbe(catalog: GameCatalog, scenario: OptimizationScenario) {
  const normalized = normalizeScenario(catalog, scenario);
  assert.equal(scenario.facilities.hardAssignments.length, 0);
  const physical = normalized.rooms.filter((room) => room.shift === "A" && room.roomKind !== "control_nexus");
  assert.ok(physical.every((room) => room.slotCap === 1));
  assert.ok(physical.every((room) => room.recipes.length > 0));
  const scorer = createAssignmentScorer(catalog, normalized.scenario, normalized.rooms);
  const ids = scenario.roster.filter((entry) => entry.owned).map((entry) => entry.operatorId);
  const controlId = normalized.rooms.find((room) => room.roomKind === "control_nexus")!.roomId;
  assert.ok(ids.every((id) => {
    const worker = scorer.workerEffects(controlId, id);
    return worker.moodDropReductionPercent === 0 && worker.moodRegenPercent === 0;
  }));
  assert.ok(ids.length < 31);
  const hours = new Map<string, number>();
  let evaluatedWindows = 0;
  const uptime = (room: NormalizedRoom, id: string, schedule?: ShiftSchedule) => {
    const worker = scorer.workerEffects(room.roomId, id);
    const key = `${worker.moodDropReductionPercent}|${worker.moodRegenPercent}|${schedule?.startMinute}-${schedule?.endMinute}`;
    const cached = hours.get(key);
    if (cached !== undefined) return cached;
    const value = getRotationUptime({ workers: [worker], schedule }).workingHoursPerDay;
    hours.set(key, value);
    return value;
  };
  const columns = physical.map((room) => {
    const byMask = new Map<number, Column>();
    const remember = (column: Column) => {
      if (column.score > (byMask.get(column.mask)?.score ?? -Infinity)) byMask.set(column.mask, column);
    };
    const physicalId = room.physicalRoomId!;
    scorer.setShiftSchedule(physicalId, { startMinute: 0, endMinute: 60 });
    // One hour is fully sustainable for every probe; recover the active rate.
    const active = ids.map((id) => scorer.scoreTeam(room.roomId, [id], noSupport) * 24);
    remember({ mask: 0, score: 0, mode: "normal", a: [], b: [] });
    ids.forEach((id, index) => remember({
      mask: 1 << index, score: active[index]! * uptime(room, id) / 24,
      mode: "normal", a: [id], b: [],
    }));
    for (let a = 0; a < ids.length; a += 1) for (let b = 0; b < ids.length; b += 1) {
      if (a === b) continue;
      for (let start = 0; start < 24; start += 1) for (let duration = 1; duration < 24; duration += 1) {
        const schedule = { startMinute: start * 60, endMinute: ((start + duration) % 24) * 60 };
        const reverse = { startMinute: schedule.endMinute, endMinute: schedule.startMinute };
        evaluatedWindows += 1;
        remember({ mask: (1 << a) | (1 << b), mode: "rotation", a: [ids[a]!], b: [ids[b]!], schedule,
          score: (active[a]! * uptime(room, ids[a]!, schedule) + active[b]! * uptime(room, ids[b]!, reverse)) / 24 });
      }
    }
    return [...byMask.values()];
  });
  let bestScore = -Infinity;
  let bestColumns: Column[] = [];
  const chosen: Column[] = [];
  let combinations = 0;
  const search = (index: number, mask: number, score: number) => {
    if (index === columns.length) {
      combinations += 1;
      if (score > bestScore) { bestScore = score; bestColumns = [...chosen]; }
      return;
    }
    for (const column of columns[index]!) {
      if ((mask & column.mask) !== 0) continue;
      chosen.push(column); search(index + 1, mask | column.mask, score + column.score); chosen.pop();
    }
  };
  search(0, 0, 0);
  // Replay the winning columns through the production scorer, including normal
  // rooms, instead of trusting the oracle's additive objective arithmetic.
  const replayRooms: NormalizedRoom[] = [];
  const assignments = new Map<string, Array<string | null>>();
  physical.forEach((room, index) => {
    const column = bestColumns[index]!;
    if (column.mode === "normal") {
      replayRooms.push({ ...room, roomId: room.physicalRoomId!, shift: undefined, shiftSchedule: undefined });
      assignments.set(room.physicalRoomId!, column.a);
    } else {
      const b = normalized.rooms.find((entry) => entry.physicalRoomId === room.physicalRoomId && entry.shift === "B")!;
      replayRooms.push({ ...room, shiftSchedule: column.schedule }, { ...b, shiftSchedule: {
        startMinute: column.schedule!.endMinute, endMinute: column.schedule!.startMinute,
      } });
      assignments.set(room.roomId, column.a); assignments.set(b.roomId, column.b);
    }
  });
  const replayedScore = createAssignmentScorer(catalog, normalized.scenario, replayRooms).score(assignments);
  assert.ok(Math.abs(replayedScore - bestScore) < tolerance);
  return { score: replayedScore, columns: bestColumns, evaluatedWindows, uniqueUptimeSimulations: hours.size, combinations };
}

function compare(name: string, workers: ProbeWorker[], facilities = 1) {
  const { catalog, scenario } = makeProbe(workers, facilities);
  const started = performance.now();
  const heuristic = solveScenario(catalog, scenario);
  const heuristicMs = performance.now() - started;
  const exactStarted = performance.now();
  const exact = exactProbe(catalog, scenario);
  const exactMs = performance.now() - exactStarted;
  const upperBound = fullUptimeUpperBound(catalog, scenario);
  assert.ok(exact.score >= heuristic.totalScore - tolerance);
  assert.ok(upperBound >= exact.score);
  return {
    name, syntheticWorkers: workers, facilities, heuristicScore: heuristic.totalScore,
    exactScore: exact.score, gainPercent: (exact.score / heuristic.totalScore - 1) * 100,
    fullUptimeUpperBound: upperBound,
    heuristicMs, exactMs,
    heuristicPlans: heuristic.roomPlans.filter((room) => room.roomKind !== "control_nexus").map((room) => ({
      shift: room.shift, workers: room.assignedOperatorIds, schedule: room.shiftSchedule,
    })),
    exact,
  };
}

const comparisons = [
  compare("normal mode must compete with rotation", [{ production: 60, reduction: 100 }, { production: 0, reduction: 0 }]),
  compare("ordinary Mood reduction", [{ production: 60, reduction: 20 }, { production: 0, reduction: 0 }]),
  compare("shared operators across two facilities", [
    { production: 80, weaponProduction: 0, reduction: 40 }, { production: 0, weaponProduction: 80, reduction: 20 },
    { production: 30, weaponProduction: 40, reduction: 0 }, { production: 0, reduction: 0 },
  ], 2),
];

// Profile the existing offline regression without importing any account data.
const rosterCatalog = structuredClone(bundled);
for (const operator of rosterFixture.catalogOverrides.operators) {
  const definition = { ...operator, images: [], sourceRefs: [], baseSkills: operator.baseSkills.map((skill) => ({
    ...skill, icon: bundled.operators[0]!.baseSkills[0]!.icon, sourceRefs: [],
    ranks: skill.ranks.map((rank) => ({ ...rank, materialCosts: [], sourceRefs: [] })),
  })) } as GameCatalog["operators"][number];
  const index = rosterCatalog.operators.findIndex((entry) => entry.id === definition.id);
  if (index < 0) rosterCatalog.operators.push(definition); else rosterCatalog.operators[index] = definition;
}
for (const recipe of rosterFixture.catalogOverrides.recipes) {
  const index = rosterCatalog.recipes.findIndex((entry) => entry.id === recipe.id);
  const definition = recipe as GameCatalog["recipes"][number];
  if (index < 0) rosterCatalog.recipes.push(definition); else rosterCatalog.recipes[index] = definition;
}
const rosterScenario = rosterFixture.scenario as OptimizationScenario;
const rosterStarted = performance.now();
const rosterResult = solveScenario(rosterCatalog, rosterScenario);
const rosterElapsedMs = performance.now() - rosterStarted;
const rosterUpperBound = fullUptimeUpperBound(rosterCatalog, rosterScenario);
assert.ok(rosterUpperBound >= rosterResult.totalScore);
const rosterNormalized = normalizeScenario(rosterCatalog, rosterScenario);
const rosterScorer = createAssignmentScorer(rosterCatalog, rosterNormalized.scenario, rosterNormalized.rooms);
const ownedIds = rosterScenario.roster.filter((entry) => entry.owned).map((entry) => entry.operatorId);
const rosterProfile = {
  owned: ownedIds.length,
  elapsedMs: rosterElapsedMs,
  score: rosterResult.totalScore,
  search: rosterResult.search,
  exactFullRosterVerified: false,
  fullUptimeUpperBound: rosterUpperBound,
  upperBoundGapPercent: (rosterUpperBound / rosterResult.totalScore - 1) * 100,
  facilityEffectProfiles: rosterNormalized.rooms.filter((room) => room.shift === "A").map((room) => ({
    room: room.physicalRoomId, slotCap: room.slotCap,
    // Sharing a local score calculation is safe; merging operator identities
    // globally requires equivalence in every other facility and all hard pins.
    distinctLocalEffects: new Set(ownedIds.map((id) => {
      const { operatorId, ...effects } = rosterScorer.workerEffects(room.roomId, id);
      return JSON.stringify(effects);
    })).size,
  })),
};

// Check the existing constant-support phase shortcut against the actual finite
// forecast, independently of any team search or score weights.
const phaseValues = Array.from({ length: 24 }, (_, start) => ({ startHour: start,
  workingHoursPerDay: getRotationUptime({
    schedule: { startMinute: start * 60, endMinute: ((start + 19) % 24) * 60 },
    workers: [{ moodDropReductionPercent: 20, moodRegenPercent: 0 }],
  }).workingHoursPerDay,
}));
const combinationsOf = (n: number, k: number) => {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = result * (n - i + 1) / i;
  return result;
};
const pairCount = (n: number, capacity: number) => {
  let result = 0;
  for (let a = 1; a <= capacity; a += 1) for (let b = 1; b <= capacity; b += 1) {
    result += combinationsOf(n, a) * combinationsOf(n - a, b);
  }
  return result;
};
const output = {
  scope: "Restricted exhaustive probes; no full-roster optimality or runtime claim.",
  environment: { node: process.version, platform: process.platform, architecture: process.arch },
  comparisons,
  rosterProfile,
  constantSupportPhaseCheck: { durationHours: 19, reductionPercent: 20, phaseValues,
    rangeHoursPerDay: Math.max(...phaseValues.map((value) => value.workingHoursPerDay))
      - Math.min(...phaseValues.map((value) => value.workingHoursPerDay)) },
  rawEnumeration: [27, 32].map((owned) => ({ owned, teamCapacity: 3,
    orderedDisjointNonemptyTeamPairs: pairCount(owned, 3),
    pairWindowCombinationsPerFacility: pairCount(owned, 3) * 552 })),
};
const outputIndex = process.argv.indexOf("--output");
if (outputIndex >= 0) {
  assert.ok(process.argv[outputIndex + 1], "--output requires a file path");
  await fs.writeFile(process.argv[outputIndex + 1]!, `${JSON.stringify(output, null, 2)}\n`);
}
console.log(JSON.stringify(output, null, 2));
