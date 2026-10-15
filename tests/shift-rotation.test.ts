import { describe, expect, it } from "vitest";
import { createStarterScenario, getShiftRoomId, migrateScenario, snapShiftScheduleToHours, validateScenarioAgainstCatalog } from "@endfield/data";
import { loadDefaultCatalog } from "@endfield/data/node";
import { formatOptimizationResultText, normalizeScenario, solveNormalizedScenario, solveScenario } from "@endfield/optimizer";
import { createAssignmentScorer } from "../packages/optimizer/src/assignment-scoring.js";
import { getRotationUptime, simulateControlRotation } from "../packages/optimizer/src/rotation-model.js";
import { maximumIntegerMatching, maximumMatchingWeight } from "../packages/optimizer/src/matching-bound.js";

const noMood = { moodDropReductionPercent: 0, moodRegenPercent: 0 };
const day = { startMinute: 0, endMinute: 720 };
const night = { startMinute: 720, endMinute: 0 };

async function fixture() {
  const catalog = await loadDefaultCatalog();
  const scenario = createStarterScenario(catalog);
  scenario.facilities.controlNexus.level = 5;
  scenario.facilities.manufacturingCabins.forEach((room, i) => {
    room.enabled = i === 0; room.level = 3; room.fixedRecipeId = "arms-insp-set";
  });
  scenario.facilities.growthChambers.forEach((room) => { room.enabled = false; });
  scenario.facilities.receptionRoom!.enabled = false;
  scenario.options.shiftRotation = { enabled: true, scheduleMode: "fixed" };
  scenario.options.optimizationProfile = "exhaustive";
  for (const id of ["ember", "chen-qianyu"]) scenario.roster.find((entry) => entry.operatorId === id)!.owned = true;
  const scorer = () => {
    const normalized = normalizeScenario(catalog, scenario);
    return createAssignmentScorer(catalog, normalized.scenario, normalized.rooms);
  };
  return { catalog, scenario, scorer };
}

describe("rotation Mood forecast", () => {
  it("covers balanced 12-hour windows without rest during either shift", () => {
    for (const schedule of [day, night, { startMinute: 1200, endMinute: 480 }]) {
      const result = getRotationUptime({ schedule, workers: [noMood] });
      expect(result.workingHoursPerDay).toBeCloseTo(12, 8);
      expect(result.downtimeHoursPerDay).toBeCloseTo(0, 8);
      expect(result.estimatedWorkHoursFromFullMood).toBeCloseTo(50_000 / 3600, 8);
    }
  });

  it("reports an unstaffed shift as downtime", () => {
    const result = getRotationUptime({ schedule: night, workers: [] });
    expect(result.workingHoursPerDay).toBe(0);
    expect(result.downtimeHoursPerDay).toBe(12);
  });

  it("carries partial recovery across days even when a full-Mood team initially covers its window", () => {
    const result = getRotationUptime({ schedule: { startMinute: 0, endMinute: 1200 },
      workers: [{ ...noMood, moodDropReductionPercent: 40 }] });
    expect(result.estimatedWorkHoursFromFullMood).toBeGreaterThan(20);
    expect(result.workingHoursPerDay).toBeLessThan(20);
    expect(result.downtimeHoursPerDay).toBeGreaterThan(1);
  });

  it("applies Nexus support only while the providing shift works", () => {
    const control = simulateControlRotation([
      { schedule: day, workers: [{ ...noMood, moodDropReductionPercent: 100 }] },
      { schedule: night, workers: [] },
    ], "day-only");
    expect(control.average.moodDropReductionPercent).toBeCloseTo(50, 8);
    expect(control.workingHoursPerDay).toEqual([12, 0]);
    const supported = getRotationUptime({ schedule: { startMinute: 0, endMinute: 1200 }, workers: [noMood] }, control);
    const unsupported = getRotationUptime({ schedule: { startMinute: 0, endMinute: 1200 }, workers: [noMood] });
    expect(supported.workingHoursPerDay).toBeGreaterThan(unsupported.workingHoursPerDay);
    // Eight hours of unprotected drain exceed four hours of recovery: daytime
    // support must not be treated as continuous protection at night.
    expect(supported.workingHoursPerDay).toBeLessThan(20);
    expect(unsupported.workingHoursPerDay).toBeLessThan(20);
    expect(getRotationUptime({ schedule: day, workers: [{ ...noMood, moodDropReductionPercent: 100 }] }).estimatedWorkHoursFromFullMood).toBeNull();
  });
});

describe("shift assignment integration", () => {
  it("optimizes a stronger team's daily window with recovery instead of fixing it at 12 hours", async () => {
    const { catalog, scenario } = await fixture();
    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "advanced-combat-record";
    const skill = catalog.operators.find((operator) => operator.id === "ember")!.baseSkills
      .find((entry) => entry.facilityKind === "manufacturing_cabin")!;
    for (const rank of skill.ranks) rank.modifiers = [
      { metric: "production_efficiency", appliesTo: "operator_exp", unit: "percent", value: 60 },
      { metric: "mood_drop_reduction", appliesTo: "all", unit: "percent", value: 40 },
    ];
    scenario.roster.find((entry) => entry.operatorId === "ember")!.baseSkillStates = [{ skillId: skill.id, unlockedRank: 2 }];
    scenario.facilities.hardAssignments = [
      { operatorId: "ember", roomId: "mfg-1", shift: "A" },
      { operatorId: "chen-qianyu", roomId: "mfg-1", shift: "B" },
    ];
    const normalized = normalizeScenario(catalog, scenario);
    normalized.rooms.forEach((room) => { room.slotCap = room.roomKind === "control_nexus" ? 0 : 1; });
    const fixed = solveNormalizedScenario(catalog, normalized);
    delete normalized.scenario.options.shiftRotation!.scheduleMode;
    const result = solveNormalizedScenario(catalog, normalized);
    const plans = result.roomPlans.filter((room) => room.physicalRoomId === "mfg-1");
    expect(plans[0]!.scheduledHoursPerDay).toBeGreaterThan(12);
    expect(plans[0]!.scheduledHoursPerDay! + plans[1]!.scheduledHoursPerDay!).toBeCloseTo(24, 10);
    expect(plans[0]!.assignedOperatorIds).toEqual(["ember"]);
    expect(plans[1]!.assignedOperatorIds).toEqual(["chen-qianyu"]);
    expect(result.totalScore).toBeGreaterThan(fixed.totalScore);
    expect(result.search?.complete).toBe(false);
    expect(result.search?.scheduleSearch!.evaluatedSchedules).toBeGreaterThan(23);
    const schedules = Object.fromEntries(plans.filter((plan) => plan.shift === "A").map((plan) => [plan.physicalRoomId!, plan.shiftSchedule!]));
    scenario.options.shiftRotation!.schedules = schedules;
    const replay = normalizeScenario(catalog, scenario);
    const objective = createAssignmentScorer(catalog, replay.scenario, replay.rooms);
    expect(objective.score(new Map(result.roomPlans.map((plan) => [plan.roomId, plan.assignedOperatorIds])))).toBeCloseTo(result.totalScore, 10);
  });

  it("searches full-base schedules, makes Nexus support useful, and never reuses an operator", async () => {
    const { catalog, scenario } = await fixture();
    scenario.options.maxFacilities = true;
    scenario.facilities.growthChambers[0]!.fixedRecipeIds = ["kalkonyx"];
    scenario.roster.forEach((entry) => {
      entry.owned = true;
      entry.baseSkillStates.forEach((skill) => { skill.unlockedRank = 2; });
    });
    const fixed = solveScenario(catalog, scenario);
    scenario.options.shiftRotation!.scheduleMode = "optimized";
    const result = solveScenario(catalog, scenario);
    expect(result.totalScore).toBeGreaterThan(fixed.totalScore);
    expect(result.search?.complete).toBe(false);
    expect(result.search?.visitedNodes).toBeGreaterThan(1);
    expect(result.roomPlans.some((room) => room.roomKind === "control_nexus" && room.assignedOperatorIds.length > 0)).toBe(true);
    const workforce = result.roomPlans.flatMap((room) => room.assignedOperatorIds);
    expect(new Set(workforce).size).toBe(workforce.length);
    expect(workforce.length).toBeLessThanOrEqual(Math.min(30, scenario.roster.length));
    expect(result.roomPlans.reduce((sum, room) => sum + room.projectedScore, 0)).toBeCloseTo(result.totalScore, 9);
  }, 30000);

  it("keeps a scarce operator in one shift even when other windows do not overlap", async () => {
    const { catalog, scenario } = await fixture();
    scenario.roster.forEach((entry) => { entry.owned = entry.operatorId === "ember"; });
    scenario.options.shiftRotation!.scheduleMode = "optimized";
    scenario.facilities.manufacturingCabins[1]!.enabled = true;
    const result = solveScenario(catalog, scenario);
    expect(result.roomPlans.flatMap((room) => room.assignedOperatorIds)).toEqual(["ember"]);
    expect(result.roomPlans.filter((room) => room.assignedOperatorIds.length === 0).length).toBeGreaterThan(0);
  });

  it("can reserve scarce Nexus support instead of trapping it as generic production staffing", async () => {
    const { catalog, scenario } = await fixture();
    scenario.roster.forEach((entry) => {
      entry.owned = ["ember", "lifeng"].includes(entry.operatorId);
      entry.baseSkillStates.forEach((skill) => { skill.unlockedRank = 2; });
    });
    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "advanced-combat-record";
    for (const [id, kind, metric, value] of [
      ["ember", "manufacturing_cabin", "production_efficiency", 100],
      ["lifeng", "control_nexus", "mood_drop_reduction", 100],
    ] as const) {
      const skill = catalog.operators.find((operator) => operator.id === id)!.baseSkills.find((entry) => entry.facilityKind === kind)!;
      for (const rank of skill.ranks) rank.modifiers = [{ metric, value, appliesTo: metric === "production_efficiency" ? "operator_exp" : "all", unit: "percent" }];
    }
    const normalized = normalizeScenario(catalog, scenario);
    normalized.rooms.forEach((room) => { room.slotCap = 1; });
    const fixed = solveNormalizedScenario(catalog, normalized);
    normalized.scenario.options.shiftRotation!.scheduleMode = "optimized";
    const result = solveNormalizedScenario(catalog, normalized);
    expect(result.totalScore).toBeGreaterThan(fixed.totalScore);
    expect(result.roomPlans.find((room) => room.roomKind === "control_nexus" && room.shift === "A")!.assignedOperatorIds).toEqual(["lifeng"]);
    expect(result.roomPlans.find((room) => room.roomKind === "manufacturing_cabin" && room.shift === "A")!.workingHoursPerDay).toBeCloseTo(23, 8);
  });

  it("avoids specific-clue targeting automatically and permits explicit Reception pins", async () => {
    const { catalog, scenario } = await fixture();
    scenario.facilities.manufacturingCabins.forEach((room) => { room.enabled = false; });
    scenario.facilities.receptionRoom!.enabled = true;
    scenario.roster.forEach((entry) => { entry.owned = entry.operatorId === "lifeng"; });
    const operator = catalog.operators.find((entry) => entry.id === "lifeng")!;
    operator.baseSkills = [{ ...operator.baseSkills[0]!, id: "targeted-clues", facilityKind: "reception_room",
      ranks: [{ rank: 2, name: "Targeted", modifiers: [
        { metric: "clue_rate_up", appliesTo: "clue_3", unit: "tier", value: 2 },
        { metric: "clue_collection_efficiency", appliesTo: "all", unit: "percent", value: 200 },
      ] }] }];
    scenario.roster.find((entry) => entry.operatorId === "lifeng")!.baseSkillStates = [{ skillId: "targeted-clues", unlockedRank: 2 }];
    for (const [enabled, mode] of [[false, "fixed"], [true, "fixed"], [true, "optimized"]] as const) {
      scenario.options.shiftRotation!.enabled = enabled;
      scenario.options.shiftRotation!.scheduleMode = mode;
      const automatic = solveScenario(catalog, scenario);
      expect(automatic.roomPlans.flatMap((room) => room.assignedOperatorIds)).not.toContain("lifeng");
      expect(automatic.roomPlans.filter((room) => room.roomKind === "reception_room")
        .flatMap((room) => room.alternativeOperatorIdsBySlot?.flat() ?? [])).not.toContain("lifeng");
      scenario.facilities.hardAssignments = [{ operatorId: "lifeng", roomId: scenario.facilities.receptionRoom!.id }];
      const pinned = solveScenario(catalog, scenario);
      expect(pinned.roomPlans.find((room) => room.roomId === scenario.facilities.receptionRoom!.id)!.assignedOperatorIds).toEqual(["lifeng"]);
      scenario.facilities.hardAssignments = [];
    }
  });

  it("fills generic Reception seats in legacy and fixed rotation searches without any unlocked skills", async () => {
    const { catalog, scenario } = await fixture();
    const ids = ["chen-qianyu", "akekuri", "ardelia", "estella", "snowshine", "lifeng"];
    scenario.roster.forEach((entry) => {
      entry.owned = ids.includes(entry.operatorId);
      entry.baseSkillStates.forEach((skill) => { skill.unlockedRank = 0; });
    });
    scenario.facilities.manufacturingCabins.forEach((room) => { room.enabled = false; });
    scenario.facilities.receptionRoom!.enabled = true;
    scenario.facilities.receptionRoom!.level = 3;
    for (const enabled of [false, true]) {
      scenario.options.shiftRotation!.enabled = enabled;
      const result = solveScenario(catalog, scenario);
      const reception = result.roomPlans.filter((plan) => plan.roomKind === "reception_room");
      expect(reception).toHaveLength(enabled ? 2 : 1);
      expect(reception.every((plan) => plan.assignedOperatorIds.length === 3)).toBe(true);
      const workers = reception.flatMap((plan) => plan.assignedOperatorIds);
      expect(new Set(workers).size).toBe(enabled ? 6 : 3);
      expect(result.search?.complete).toBe(true);
      if (enabled) expect(result.search?.visitedNodes).toBe(1);
    }
  });

  it("can cancel during joint schedule search", async () => {
    const { catalog, scenario } = await fixture();
    scenario.options.shiftRotation!.scheduleMode = "optimized";
    let cancel = false;
    expect(() => solveScenario(catalog, scenario, {
      shouldCancel: () => cancel,
      onProgress: (progress) => { if (progress.phase === "Optimizing shift teams and schedules") cancel = true; },
    })).toThrow("Optimization canceled");
  });

  it("certifies a full roster and maximum base without enumerating shift permutations", async () => {
    const { catalog, scenario } = await fixture();
    scenario.options.maxFacilities = true;
    scenario.facilities.growthChambers[0]!.fixedRecipeIds = ["kalkonyx"];
    scenario.roster.forEach((entry) => {
      entry.owned = true;
      entry.baseSkillStates.forEach((skill) => { skill.unlockedRank = 2; });
    });
    const result = solveScenario(catalog, scenario);
    expect(result.search?.complete).toBe(true);
    expect(result.search?.visitedNodes).toBe(1);
    const production = result.roomPlans.filter((room) => room.roomKind === "manufacturing_cabin" || room.roomKind === "growth_chamber");
    expect(production).toHaveLength(6);
    expect(production.every((room) => room.assignedOperatorIds.length === 3 && room.downtimeHoursPerDay === 0)).toBe(true);
    const workforce = result.roomPlans.flatMap((room) => room.assignedOperatorIds);
    expect(new Set(workforce).size).toBe(workforce.length);
    expect(result.roomPlans.filter((room) => room.roomKind === "reception_room").every((room) => room.assignedOperatorIds.length > 0)).toBe(true);
  });

  it("matches direct allocation enumeration with competing products and shift teams", async () => {
    const { catalog, scenario } = await fixture();
    const ids = ["ember", "chen-qianyu", "lifeng", "da-pan", "laevatain", "xaihi"];
    scenario.roster.forEach((entry) => {
      entry.owned = ids.includes(entry.operatorId);
      entry.baseSkillStates.forEach((skill) => { skill.unlockedRank = 2; });
    });
    scenario.facilities.manufacturingCabins[1]!.enabled = true;
    scenario.facilities.manufacturingCabins[1]!.fixedRecipeId = "advanced-combat-record";
    const normalized = normalizeScenario(catalog, scenario);
    normalized.rooms.forEach((room) => { room.slotCap = room.roomKind === "control_nexus" ? 0 : 1; });
    const scorer = createAssignmentScorer(catalog, normalized.scenario, normalized.rooms);
    const rooms = normalized.rooms.filter((room) => room.roomKind !== "control_nexus");
    const assigned = new Map<string, string[]>();
    let best = 0;
    const enumerate = (index: number, free: string[]) => {
      if (index === rooms.length) { best = Math.max(best, scorer.score(assigned)); return; }
      const room = rooms[index]!;
      assigned.set(room.roomId, []);
      enumerate(index + 1, free);
      for (const id of free) {
        assigned.set(room.roomId, [id]);
        enumerate(index + 1, free.filter((candidate) => candidate !== id));
      }
      assigned.delete(room.roomId);
    };
    enumerate(0, ids);
    const result = solveNormalizedScenario(catalog, normalized);
    expect(result.totalScore).toBeCloseTo(best, 10);
    expect(result.search?.complete).toBe(true);
  });

  it("searches both shifts together and uses each operator once", async () => {
    const { catalog, scenario } = await fixture();
    const result = solveScenario(catalog, scenario);
    const plans = result.roomPlans.filter((room) => room.physicalRoomId === "mfg-1");
    expect(plans.map((room) => room.shift)).toEqual(["A", "B"]);
    expect(plans.map((room) => room.assignedOperatorIds.length)).toEqual([1, 1]);
    expect(plans.map((room) => room.downtimeHoursPerDay)).toEqual([0, 0]);
    const workers = result.roomPlans.flatMap((room) => room.assignedOperatorIds);
    expect(new Set(workers).size).toBe(workers.length);
    const recipe = catalog.recipes.find((entry) => entry.id === "arms-insp-set")!;
    expect(result.projectedOutputs.weapon_exp).toBeCloseTo(60 / recipe.baseDurationMinutes! * recipe.outputAmount! * 1.4, 8);
    expect(result.roomPlans.reduce((sum, room) => sum + room.projectedScore, 0)).toBeCloseTo(result.totalScore, 10);
    expect(result.search?.complete).toBe(true);
    expect(formatOptimizationResultText(result, catalog)).toContain("mfg-1 Shift B");
  });

  it("preserves separate pins, respects per-shift capacity, and ignores saved B pins when disabled", async () => {
    const { catalog, scenario } = await fixture();
    scenario.facilities.hardAssignments = [
      { roomId: "mfg-1", operatorId: "ember", shift: "B" },
      { roomId: "mfg-1", operatorId: "chen-qianyu" },
    ];
    expect(validateScenarioAgainstCatalog(catalog, scenario).ok).toBe(true);
    const result = solveScenario(catalog, scenario);
    expect(result.roomPlans.find((room) => room.roomId === getShiftRoomId("mfg-1", "B"))!.assignedOperatorIds).toEqual(["ember"]);
    scenario.options.shiftRotation!.enabled = false;
    const disabled = solveScenario(catalog, scenario);
    scenario.facilities.hardAssignments = scenario.facilities.hardAssignments.filter((pin) => pin.shift !== "B");
    delete scenario.options.shiftRotation;
    expect(disabled).toEqual(solveScenario(catalog, scenario));
  });

  it("uses the same daily weighting for score and recipe outputs and exposes empty-shift downtime", async () => {
    const { scenario, scorer } = await fixture();
    scenario.options.shiftRotation!.schedules = { "mfg-1": { startMinute: 1200, endMinute: 360 } };
    const result = scorer().result(new Map([["mfg-1", ["ember"]]]));
    const plans = result.roomPlans.filter((room) => room.physicalRoomId === "mfg-1");
    expect(plans[0]!.scheduledHoursPerDay).toBe(10);
    expect(plans[1]!.downtimeHoursPerDay).toBe(14);
    expect(result.totalScore).toBeCloseTo(result.projectedRecipeOutputs["arms-insp-set"]!, 10);
    expect(plans[1]!.warnings.join(" ")).toContain("no operators assigned");
  });

  it("searches compatible Nexus teams for both shifts and credits their gains once", async () => {
    const { catalog, scenario } = await fixture();
    for (const id of ["lifeng", "da-pan"]) {
      const definition = catalog.operators.find((operator) => operator.id === id)!;
      const state = scenario.roster.find((operator) => operator.operatorId === id)!;
      state.owned = true;
      state.baseSkillStates = definition.baseSkills.map((skill) => ({ skillId: skill.id, unlockedRank: 2 }));
      for (const skill of definition.baseSkills.filter((skill) => skill.facilityKind === "control_nexus")) {
        for (const rank of skill.ranks) rank.modifiers = [{ metric: "mood_drop_reduction", appliesTo: "all", unit: "percent", value: 100 }];
      }
    }
    scenario.options.shiftRotation!.schedules = { "mfg-1": { startMinute: 0, endMinute: 1200 } };
    scenario.facilities.hardAssignments = [
      { operatorId: "ember", roomId: "mfg-1", shift: "A" },
      { operatorId: "chen-qianyu", roomId: "mfg-1", shift: "B" },
    ];
    const normalized = normalizeScenario(catalog, scenario);
    normalized.rooms.forEach((room) => { if (room.roomKind !== "control_nexus") room.slotCap = 1; });
    const result = solveNormalizedScenario(catalog, normalized);
    const controls = result.roomPlans.filter((room) => room.roomKind === "control_nexus");
    expect(controls.map((room) => room.assignedOperatorIds.length)).toEqual([1, 1]);
    expect(controls.every((room) => room.projectedScore > 0)).toBe(true);
    expect(result.roomPlans.filter((room) => room.physicalRoomId === "mfg-1").map((room) => room.downtimeHoursPerDay)).toEqual([0, 0]);
    expect(result.roomPlans.reduce((sum, room) => sum + room.projectedScore, 0)).toBeCloseTo(result.totalScore, 10);
    expect(result.search?.complete).toBe(true);
  });

  it("checks capacities per shift and still rejects duplicate operator placements", async () => {
    const { catalog, scenario } = await fixture();
    const ids = catalog.operators.slice(0, 6).map((operator) => operator.id);
    scenario.roster.forEach((operator) => { operator.owned = ids.includes(operator.operatorId); });
    scenario.facilities.hardAssignments = ids.map((operatorId, i) => ({ operatorId, roomId: "mfg-1", shift: i < 3 ? "A" : "B" }));
    const validation = validateScenarioAgainstCatalog(catalog, scenario);
    expect(validation.issues.some((issue) => issue.code === "hard_assignment_room_overflow")).toBe(false);
    scenario.facilities.hardAssignments[3]!.operatorId = ids[0]!;
    expect(validateScenarioAgainstCatalog(catalog, scenario).issues.some((issue) => issue.code === "hard_assignment_duplicate")).toBe(true);
  });

  it("validates times, room ids and pin shifts and round-trips rotation settings", async () => {
    const { catalog, scenario } = await fixture();
    scenario.options.shiftRotation!.schedules = { "mfg-1": { startMinute: 1380, endMinute: 660 } };
    scenario.facilities.hardAssignments = [{ roomId: "mfg-1", operatorId: "ember", shift: "B" }];
    const migrated = migrateScenario(JSON.parse(JSON.stringify(scenario)));
    expect(migrated.ok).toBe(true);
    expect(migrated.scenario.options.shiftRotation).toEqual(scenario.options.shiftRotation);
    expect(migrated.scenario.facilities.hardAssignments).toEqual(scenario.facilities.hardAssignments);
    for (const invalid of [NaN, -1, 1440, 1.5, 1, 833, 1439, 660]) {
      scenario.options.shiftRotation!.schedules["mfg-1"]!.startMinute = invalid;
      expect(validateScenarioAgainstCatalog(catalog, scenario).issues.some((issue) => issue.code === "invalid_shift_schedule")).toBe(true);
    }
    scenario.options.shiftRotation!.schedules = { missing: day };
    expect(validateScenarioAgainstCatalog(catalog, scenario).issues.some((issue) => issue.code === "shift_schedule_unknown_room")).toBe(true);
    expect(migrateScenario({ ...scenario, options: { ...scenario.options, shiftRotation: { enabled: true, schedules: [] } } }).ok).toBe(false);
    expect(migrateScenario({ ...scenario, options: { ...scenario.options, shiftRotation: { enabled: true, scheduleMode: "invalid" } } }).ok).toBe(false);
    expect(migrateScenario({ ...scenario, facilities: { ...scenario.facilities, hardAssignments: [{ operatorId: "ember", roomId: "mfg-1", shift: "C" }] } }).ok).toBe(false);
  });

  it("migrates old minute schedules to legal hourly windows without collapsing either shift", async () => {
    const { scenario } = await fixture();
    for (const [saved, expected] of [
      [{ startMinute: 424, endMinute: 0 }, { startMinute: 420, endMinute: 0 }],
      [{ startMinute: 1380, endMinute: 30 }, { startMinute: 1380, endMinute: 60 }],
      [{ startMinute: 0, endMinute: 1439 }, { startMinute: 0, endMinute: 1380 }],
      [{ startMinute: 1439, endMinute: 0 }, { startMinute: 0, endMinute: 60 }],
    ]) {
      scenario.options.shiftRotation!.schedules = { "mfg-1": saved! };
      const migrated = migrateScenario(scenario);
      expect(migrated.ok).toBe(true);
      expect(migrated.scenario.options.shiftRotation!.schedules!["mfg-1"]).toEqual(expected);
      expect(migrated.changes.some((change) => change.path === "options.shiftRotation.schedules.mfg-1")).toBe(true);
      expect(scenario.options.shiftRotation!.schedules!["mfg-1"]).toEqual(saved);
    }
    expect(snapShiftScheduleToHours({ startMinute: -1, endMinute: 720 })).toBeUndefined();
    expect(snapShiftScheduleToHours({ startMinute: 0, endMinute: 0 })).toBeUndefined();
  });
});

describe("matching upper bound", () => {
  it("matches exhaustive one-to-one matching for small matrices, including missing operators", () => {
    for (let rows = 1; rows <= 4; rows += 1) {
      for (let columns = 0; columns <= 4; columns += 1) {
        const weights = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => ((row + 3) * (column + 5) % 11) / 7));
        const enumerate = (row: number, used: Set<number>): number => {
          if (row === rows) return 0;
          let best = enumerate(row + 1, used);
          for (let column = 0; column < columns; column += 1) {
            if (used.has(column)) continue;
            used.add(column);
            best = Math.max(best, weights[row]![column]! + enumerate(row + 1, used));
            used.delete(column);
          }
          return best;
        };
        expect(maximumMatchingWeight(weights)).toBeCloseTo(enumerate(0, new Set()), 12);
        const integerWeights = weights.map((row) => [...row.map((weight) => BigInt(Math.round(weight * 7))), ...Array<bigint>(rows).fill(0n)]);
        const matching = maximumIntegerMatching(integerWeights);
        expect(new Set(matching).size).toBe(rows);
        const matched = matching.reduce((sum, column, row) => sum + Number(integerWeights[row]![column]!), 0);
        expect(matched).toBe(Math.round(enumerate(0, new Set()) * 7));
      }
    }
  });
});
