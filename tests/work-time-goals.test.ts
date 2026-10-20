import { describe, expect, it } from "vitest";
import type { GameCatalog, WorkTimeGoal } from "@endfield/domain";
import { createStarterScenario, migrateScenario, resolveDemandProfile, validateScenarioAgainstCatalog } from "@endfield/data";
import { loadDefaultCatalog } from "@endfield/data/node";
import { formatOptimizationResultText, normalizeScenario, recommendUpgrades, solveNormalizedScenario, solveScenario } from "@endfield/optimizer";
import { compareWorkTimeObjectives } from "../packages/optimizer/src/work-time-goals.js";
import rosterFixture from "./fixtures/shift-rotation-roster.json";

async function fixture(goal?: WorkTimeGoal) {
  const catalog = await loadDefaultCatalog();
  const purrchena = rosterFixture.catalogOverrides.operators.find((op) => op.id === "purrchena")!;
  catalog.operators.push({ ...purrchena, images: [], sourceRefs: [], baseSkills: purrchena.baseSkills.map((skill) => ({
    ...skill, icon: catalog.operators[0]!.baseSkills[0]!.icon, sourceRefs: [],
    ranks: skill.ranks.map((rank) => ({ ...rank, sourceRefs: [], materialCosts: [] })),
  })) } as GameCatalog["operators"][number]);
  const scenario = createStarterScenario(catalog);
  scenario.facilities.controlNexus.level = 5;
  scenario.facilities.manufacturingCabins.forEach((room, index) => {
    room.enabled = index === 0; room.level = 3; room.fixedRecipeId = "arms-insp-set";
  });
  scenario.facilities.growthChambers.forEach((room) => { room.enabled = false; });
  scenario.facilities.receptionRoom!.enabled = false;
  scenario.options.shiftRotation = { enabled: true, scheduleMode: "optimized",
    schedules: { control_nexus: { startMinute: 0, endMinute: 60 } } };
  scenario.options.optimizationProfile = "fast";
  for (const state of scenario.roster) {
    state.owned = ["ember", "purrchena", "da-pan", "chen-qianyu", "wulfgard"].includes(state.operatorId);
    state.baseSkillStates = [];
  }
  const supportSkill = catalog.operators.find((op) => op.id === "da-pan")!.baseSkills.find((skill) => skill.facilityKind === "control_nexus")!;
  scenario.roster.find((op) => op.operatorId === "da-pan")!.baseSkillStates = [{ skillId: supportSkill.id, unlockedRank: 2 }];
  scenario.facilities.hardAssignments = [
    { operatorId: "ember", roomId: "control_nexus", shift: "A", workTimeGoal: goal },
    { operatorId: "purrchena", roomId: "control_nexus", shift: "A", workTimeGoal: goal },
    { operatorId: "da-pan", roomId: "control_nexus", shift: "B" },
    { operatorId: "chen-qianyu", roomId: "mfg-1", shift: "A" },
    { operatorId: "wulfgard", roomId: "mfg-1", shift: "B" },
  ];
  const normalized = normalizeScenario(catalog, scenario);
  normalized.rooms.forEach((room) => { room.slotCap = room.roomKind === "control_nexus" ? 2 : 1; });
  return { catalog, scenario, normalized };
}

describe("Hard Assignment work-time goals", () => {
  it("gives two neutral pinned Nexus trainees a sustainable working window instead of one hour", async () => {
    const { catalog, normalized } = await fixture({ mode: "maximize" });
    const result = solveNormalizedScenario(catalog, normalized);
    expect(result.workTimeGoals).toHaveLength(2);
    for (const goal of result.workTimeGoals!) {
      expect(goal.status).toBe("maximized");
      expect(goal.workingHoursPerDay).toBeGreaterThan(13.8);
      expect(goal.workingHoursPerDay).toBeLessThanOrEqual(24);
    }
    const primary = result.roomPlans.find((room) => room.roomId === "control_nexus")!;
    expect(primary.assignedOperatorIds.sort()).toEqual(["ember", "purrchena"]);
    expect(primary.workingHoursPerDay).toBeCloseTo(result.workTimeGoals![0]!.workingHoursPerDay, 8);
    expect(result.search?.complete).toBe(false);
    expect(new Set(result.roomPlans.flatMap((room) => room.assignedOperatorIds)).size).toBe(5);
  });

  it("meets a minimum before optimizing production and respects the hourly clock", async () => {
    const { catalog, normalized } = await fixture({ mode: "minimum", hoursPerDay: 12 });
    const result = solveNormalizedScenario(catalog, normalized);
    expect(result.workTimeGoals!.every((goal) => goal.status === "met" && goal.workingHoursPerDay >= 12 - 1e-7), JSON.stringify(result.workTimeGoals)).toBe(true);
    expect(result.warnings.join(" ")).not.toContain("Work-time minimum not met");
    expect(result.roomPlans.every((room) => !room.shiftSchedule
      || room.shiftSchedule.startMinute % 60 === 0 && room.shiftSchedule.endMinute % 60 === 0)).toBe(true);
    expect(result.roomPlans.reduce((sum, room) => sum + room.projectedScore, 0)).toBeCloseTo(result.totalScore, 10);
  });

  it("counts Mood-limited work, preserves fixed hours, and reports an unmet minimum", async () => {
    const { catalog, normalized } = await fixture({ mode: "minimum", hoursPerDay: 20 });
    normalized.scenario.options.shiftRotation!.scheduleMode = "fixed";
    const result = solveNormalizedScenario(catalog, normalized);
    const primary = result.roomPlans.find((room) => room.roomId === "control_nexus")!;
    expect(primary.shiftSchedule).toEqual({ startMinute: 0, endMinute: 60 });
    expect(result.workTimeGoals!.every((goal) => goal.status === "unmet"), JSON.stringify(result.workTimeGoals)).toBe(true);
    expect(result.workTimeGoals![0]!.workingHoursPerDay).toBeCloseTo(1, 8);
    expect(result.warnings.join(" ")).toContain("requested 20.00h/day, estimated 1.00h/day");
    expect(formatOptimizationResultText(result, catalog)).toContain("minimum 20h/day | estimated 1.00h/day | unmet");
    const long = normalized.rooms.find((room) => room.roomId === "control_nexus")!;
    long.shiftSchedule = { startMinute: 0, endMinute: 1380 };
    normalized.rooms.find((room) => room.roomId === "control_nexus::shift-B")!.shiftSchedule = { startMinute: 1380, endMinute: 0 };
    const depleted = solveNormalizedScenario(catalog, normalized);
    expect(depleted.workTimeGoals![0]!.workingHoursPerDay).toBeLessThan(20);
    expect(depleted.workTimeGoals![0]!.status).toBe("unmet");
  });

  it("keeps old pins equivalent to explicit placement-only goals", async () => {
    const { catalog, normalized } = await fixture();
    normalized.scenario.options.shiftRotation!.scheduleMode = "fixed";
    const original = solveNormalizedScenario(catalog, normalized);
    normalized.scenario.facilities.hardAssignments.forEach((pin) => { pin.workTimeGoal = { mode: "placement_only" }; });
    const explicit = solveNormalizedScenario(catalog, normalized);
    expect(explicit.totalScore).toBe(original.totalScore);
    expect(explicit.roomPlans).toEqual(original.roomPlans);
    expect(explicit.workTimeGoals).toBeUndefined();
  });

  it("reports saved B goals as inactive while rotation is off", async () => {
    const { catalog, scenario } = await fixture();
    scenario.options.shiftRotation!.enabled = false;
    scenario.facilities.hardAssignments = [{ operatorId: "ember", roomId: "control_nexus", shift: "B", workTimeGoal: { mode: "minimum", hoursPerDay: 24 } }];
    const result = solveScenario(catalog, scenario);
    expect(result.workTimeGoals).toEqual([{ operatorId: "ember", roomId: "control_nexus", shift: "B", mode: "minimum", requestedHoursPerDay: 24, workingHoursPerDay: 0, status: "inactive" }]);
    expect(result.warnings.join(" ")).not.toContain("Work-time minimum not met");
  });

  it("preserves a lone B farming goal when its facility becomes normal", async () => {
    const { catalog, scenario } = await fixture();
    scenario.roster.forEach((state) => { state.owned = state.operatorId === "purrchena"; });
    scenario.facilities.manufacturingCabins.forEach((room) => { room.enabled = false; });
    scenario.facilities.hardAssignments = [{ operatorId: "purrchena", roomId: "control_nexus", shift: "B", workTimeGoal: { mode: "maximize" } }];
    const result = solveScenario(catalog, scenario);
    expect(result.roomPlans).toHaveLength(1);
    expect(result.roomPlans[0]!.shift).toBeUndefined();
    expect(result.workTimeGoals![0]!.status, JSON.stringify({ goals: result.workTimeGoals, rooms: result.roomPlans, warnings: result.warnings })).toBe("maximized");
    expect(result.workTimeGoals![0]!.workingHoursPerDay).toBeGreaterThan(14);
  });

  it("applies goals to targeted Reception skills without inventing a clue probability", async () => {
    const { catalog, scenario } = await fixture();
    scenario.facilities.receptionRoom!.enabled = true;
    scenario.facilities.receptionRoom!.level = 3;
    scenario.roster.find((state) => state.operatorId === "avywenna")!.owned = true;
    const clue = catalog.operators.find((op) => op.id === "avywenna")!.baseSkills.find((skill) => skill.facilityKind === "reception_room")!;
    scenario.roster.find((state) => state.operatorId === "avywenna")!.baseSkillStates = [{ skillId: clue.id, unlockedRank: 2 }];
    scenario.facilities.hardAssignments = [
      { operatorId: "avywenna", roomId: "reception-1", shift: "A", workTimeGoal: { mode: "minimum", hoursPerDay: 12 } },
      { operatorId: "chen-qianyu", roomId: "reception-1", shift: "B" },
    ];
    const result = solveScenario(catalog, scenario);
    expect(result.roomPlans.find((room) => room.roomId === "reception-1")!.assignedOperatorIds).toContain("avywenna");
    expect(result.workTimeGoals![0]!.status).toBe("met");
    expect(result.workTimeGoals![0]!.workingHoursPerDay).toBeGreaterThanOrEqual(12 - 1e-7);
  });

  it("uses minimum shortfall, then combined maximizing hours, then production", () => {
    const base = { minimumShortfallHours: 0, maximizedHours: 12, productionScore: 1 };
    expect(compareWorkTimeObjectives(base, { ...base, minimumShortfallHours: 1, productionScore: 1e6 })).toBeGreaterThan(0);
    expect(compareWorkTimeObjectives({ ...base, maximizedHours: 13 }, { ...base, productionScore: 1e6 })).toBeGreaterThan(0);
    expect(compareWorkTimeObjectives({ ...base, productionScore: 2 }, base)).toBeGreaterThan(0);
  });

  it("reallocates a helper to improve a minimum even when Reception production loses value", async () => {
    const { catalog, scenario } = await fixture();
    scenario.options.shiftRotation = { enabled: true, scheduleMode: "fixed", schedules: { "mfg-1": { startMinute: 0, endMinute: 960 } } };
    scenario.options.demandProfile = { ...resolveDemandProfile(), preset: "custom", receptionWeight: 4,
      productWeights: { ...resolveDemandProfile().productWeights, weapon_exp: 0 } };
    scenario.facilities.receptionRoom!.enabled = true;
    scenario.facilities.receptionRoom!.level = 3;
    const snow = scenario.roster.find((state) => state.operatorId === "snowshine")!;
    snow.owned = true;
    const skill = catalog.operators.find((op) => op.id === "snowshine")!.baseSkills.find((entry) => entry.facilityKind === "manufacturing_cabin")!;
    snow.baseSkillStates = [{ skillId: skill.id, unlockedRank: 2 }];
    scenario.facilities.hardAssignments = [
      { operatorId: "purrchena", roomId: "mfg-1", shift: "A" },
      { operatorId: "chen-qianyu", roomId: "mfg-1", shift: "B" },
      { operatorId: "ember", roomId: "reception-1", shift: "A" },
      { operatorId: "da-pan", roomId: "reception-1", shift: "B" },
    ];
    const normalized = normalizeScenario(catalog, scenario);
    normalized.rooms.forEach((room) => { room.slotCap = room.roomKind === "control_nexus" ? 0 : 2; });
    const production = solveNormalizedScenario(catalog, normalized);
    normalized.scenario.facilities.hardAssignments[0]!.workTimeGoal = { mode: "minimum", hoursPerDay: 16 };
    const farming = solveNormalizedScenario(catalog, normalized);
    expect(farming.roomPlans.find((room) => room.roomId === "mfg-1")!.assignedOperatorIds).toContain("snowshine");
    expect(farming.workTimeGoals![0]!.workingHoursPerDay).toBeGreaterThan(production.roomPlans.find((room) => room.roomId === "mfg-1")!.workingHoursPerDay! + 1);
    expect(farming.totalScore).toBeLessThan(production.totalScore);
  });

  it("optimizes normal-operation goals and excludes production ties that would reduce farming hours", async () => {
    const { catalog, scenario } = await fixture();
    scenario.options.shiftRotation!.enabled = false;
    scenario.facilities.manufacturingCabins.forEach((room) => { room.enabled = false; });
    scenario.roster.forEach((state) => { state.owned = ["purrchena", "da-pan", "chen-qianyu"].includes(state.operatorId); });
    scenario.facilities.hardAssignments = [{ operatorId: "purrchena", roomId: "control_nexus", workTimeGoal: { mode: "maximize" } }];
    const normalized = normalizeScenario(catalog, scenario);
    normalized.rooms[0]!.slotCap = 2;
    const result = solveNormalizedScenario(catalog, normalized);
    expect(result.workTimeGoals![0]!.workingHoursPerDay).toBeGreaterThan(15);
    expect(result.roomPlans[0]!.assignedOperatorIds).toContain("da-pan");
    const index = result.roomPlans[0]!.assignedOperatorIds.indexOf("da-pan");
    expect(result.roomPlans[0]!.alternativeOperatorIdsBySlot![index]).not.toContain("chen-qianyu");
    expect(result.totalScore).toBe(0);
    expect(result.search?.complete).toBe(false);
    expect(result.search?.scheduleSearch).toBeUndefined();
    expect(result.supportWeightsVersion).not.toContain("rotation");
  });

  it("honors a minimum on A before maximizing a conflicting B goal", async () => {
    const { catalog, normalized } = await fixture({ mode: "minimum", hoursPerDay: 12 });
    normalized.scenario.facilities.hardAssignments.find((pin) => pin.operatorId === "da-pan")!.workTimeGoal = { mode: "maximize" };
    const result = solveNormalizedScenario(catalog, normalized);
    expect(result.workTimeGoals!.filter((goal) => goal.mode === "minimum").every((goal) => goal.status === "met")).toBe(true);
    expect(result.workTimeGoals!.find((goal) => goal.operatorId === "da-pan")!.workingHoursPerDay).toBeGreaterThanOrEqual(12 - 1e-7);
  });

  it("reports competing minimums honestly instead of claiming they were satisfied", async () => {
    const { catalog, normalized } = await fixture({ mode: "minimum", hoursPerDay: 20 });
    normalized.scenario.facilities.hardAssignments.find((pin) => pin.operatorId === "da-pan")!.workTimeGoal = { mode: "minimum", hoursPerDay: 20 };
    const result = solveNormalizedScenario(catalog, normalized);
    expect(result.workTimeGoals!.some((goal) => goal.status === "unmet")).toBe(true);
    expect(result.warnings.join(" ")).toContain("Work-time minimum not met");
    expect(result.search?.complete).toBe(false);
  });

  it("ranks an unlock's extra farming hours before production-only gains", async () => {
    const { catalog, scenario } = await fixture();
    scenario.options.shiftRotation!.enabled = false;
    scenario.facilities.manufacturingCabins.forEach((room) => { room.enabled = false; });
    scenario.roster.forEach((state) => { state.owned = ["purrchena", "da-pan"].includes(state.operatorId); });
    scenario.roster.find((state) => state.operatorId === "da-pan")!.baseSkillStates[0]!.unlockedRank = 1;
    scenario.facilities.hardAssignments = [{ operatorId: "purrchena", roomId: "control_nexus", workTimeGoal: { mode: "maximize" } }];
    const result = recommendUpgrades(catalog, scenario);
    const first = result.recommendations[0]!;
    expect(first.action.operatorId).toBe("da-pan");
    expect(first.workTimeImprovement!.maximizedHoursGain).toBeGreaterThan(0);
    expect(first.scoreDelta).toBe(0);
    expect(first.notes.join(" ")).toContain("Goal improvements rank before production gains");
    expect(first.notes.join(" ")).not.toContain("No immediate improvement");
  });

  it("validates goals and preserves them through JSON migration", async () => {
    const { catalog, scenario } = await fixture({ mode: "minimum", hoursPerDay: 12.5 });
    expect(validateScenarioAgainstCatalog(catalog, scenario).ok).toBe(true);
    const migrated = migrateScenario(JSON.parse(JSON.stringify(scenario)), catalog);
    expect(migrated.scenario.facilities.hardAssignments[0]!.workTimeGoal).toEqual({ mode: "minimum", hoursPerDay: 12.5 });
    for (const invalid of [{ mode: "minimum" }, { mode: "minimum", hoursPerDay: 25 }, { mode: "minimum", hoursPerDay: 0 },
      { mode: "minimum", hoursPerDay: NaN }, { mode: "unknown" }, { mode: "maximize", hoursPerDay: 12 }, null]) {
      const broken = structuredClone(scenario);
      broken.facilities.hardAssignments[0]!.workTimeGoal = invalid as WorkTimeGoal;
      expect(validateScenarioAgainstCatalog(catalog, broken).issues.some((issue) => issue.code === "invalid_work_time_goal")).toBe(true);
    }
  });
});
