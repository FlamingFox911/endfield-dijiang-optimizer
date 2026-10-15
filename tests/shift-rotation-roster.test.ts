import { beforeAll, describe, expect, it } from "vitest";
import type { GameCatalog, OptimizationResult, OptimizationScenario } from "@endfield/domain";
import { isValidShiftSchedule, validateScenarioAgainstCatalog } from "@endfield/data";
import { loadDefaultCatalog } from "@endfield/data/node";
import { normalizeScenario, solveScenario } from "@endfield/optimizer";
import { createAssignmentScorer } from "../packages/optimizer/src/assignment-scoring.js";
import rosterFixture from "./fixtures/shift-rotation-roster.json";

// Frozen roster regression with six live operator definitions.
// No account import metadata, combat snapshots, or inventory is needed here.
async function loadRosterFixture() {
  const catalog = await loadDefaultCatalog();
  const overrides = structuredClone(rosterFixture.catalogOverrides);
  for (const operator of overrides.operators) {
    const definition = { ...operator, images: [], sourceRefs: [], baseSkills: operator.baseSkills.map((skill) => ({
      ...skill, icon: catalog.operators[0]!.baseSkills[0]!.icon, sourceRefs: [],
      ranks: skill.ranks.map((rank) => ({ ...rank, materialCosts: [], sourceRefs: [] })),
    })) } as GameCatalog["operators"][number];
    const index = catalog.operators.findIndex((entry) => entry.id === operator.id);
    if (index < 0) catalog.operators.push(definition); else catalog.operators[index] = definition;
  }
  for (const recipe of overrides.recipes) {
    const index = catalog.recipes.findIndex((entry) => entry.id === recipe.id);
    if (index < 0) catalog.recipes.push(recipe as GameCatalog["recipes"][number]);
    else catalog.recipes[index] = recipe as GameCatalog["recipes"][number];
  }
  return { catalog, scenario: structuredClone(rosterFixture.scenario) as OptimizationScenario };
}

describe("27-operator rotation roster regression", () => {
  let catalog: GameCatalog;
  let scenario: OptimizationScenario;
  let result: OptimizationResult;
  beforeAll(async () => {
    ({ catalog, scenario } = await loadRosterFixture());
    result = solveScenario(catalog, scenario);
  }, 60000);

  it("reproduces the 27-operator roster offline and returns only playable hourly schedules", () => {
    expect(validateScenarioAgainstCatalog(catalog, scenario).ok).toBe(true);
    expect(scenario.roster.filter((entry) => entry.owned)).toHaveLength(27);
    expect(result.roomPlans).toHaveLength(10);
    expect(result.search?.scheduleSearch?.resolutionMinutes).toBe(60);
    for (const plan of result.roomPlans) {
      if (!plan.shift) {
        expect(plan.shiftSchedule).toBeUndefined();
        expect(result.roomPlans.filter((entry) => entry.physicalRoomId === plan.physicalRoomId)).toHaveLength(1);
        continue;
      }
      expect(plan.assignedOperatorIds.length).toBeGreaterThan(0);
      expect(isValidShiftSchedule(plan.shiftSchedule)).toBe(true);
      expect(Number.isInteger(plan.scheduledHoursPerDay)).toBe(true);
      expect(plan.scheduledHoursPerDay).toBeGreaterThanOrEqual(1);
      expect(plan.scheduledHoursPerDay).toBeLessThanOrEqual(23);
      const other = result.roomPlans.find((entry) => entry.physicalRoomId === plan.physicalRoomId && entry.shift !== plan.shift)!;
      expect(plan.scheduledHoursPerDay! + other.scheduledHoursPerDay!).toBe(24);
      expect(plan.shiftSchedule!.startMinute).toBe(other.shiftSchedule!.endMinute);
      expect(plan.downtimeHoursPerDay).toBeGreaterThanOrEqual(0);
    }
    // v6 retains staffing and rebalances Reception against production.
    expect(result.totalScore).toBeGreaterThan(1);
    expect(result.supportWeightsVersion).toBe("v6-rotation-v4");
    expect(result.search?.complete).toBe(false);
  });

  it("fully staffs all six production teams without duplicating or inventing workers", () => {
    const production = result.roomPlans.filter((plan) => ["manufacturing_cabin", "growth_chamber"].includes(plan.roomKind));
    expect(production).toHaveLength(6);
    expect(production.every((plan) => plan.assignedOperatorIds.length === 3)).toBe(true);
    const workers = result.roomPlans.flatMap((plan) => plan.assignedOperatorIds);
    expect(new Set(workers).size).toBe(workers.length);
    expect(workers).toHaveLength(27);
    expect(result.roomPlans.reduce((sum, plan) => sum + plan.projectedScore, 0)).toBeCloseTo(result.totalScore, 10);
  });

  it("keeps Reception useful without letting it outweigh the rest of a Balanced base", () => {
    const reception = result.roomPlans.filter((plan) => plan.roomKind === "reception_room");
    expect(reception).toHaveLength(2);
    expect(reception.every((plan) => plan.assignedOperatorIds.length > 0)).toBe(true);
    const share = reception.reduce((sum, plan) => sum + plan.projectedScore, 0) / result.totalScore;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.3);
    expect(reception.flatMap((plan) => plan.assignedOperatorIds)).toContain("akekuri");
    expect(result.roomPlans.flatMap((plan) => plan.assignedOperatorIds)).toContain("avywenna");
    expect(result.unassignedOperators).toEqual([]);
  });

  it("credits Akekuri's staffing even when Reception's scheduled hours need no extra Mood sustain", () => {
    // Replay the selected teams at the sustainable 12/12 split, where adding
    // Akekuri cannot increase uptime. Her +40% staffing still increases output.
    const normalized = normalizeScenario(catalog, scenario);
    const scorer = createAssignmentScorer(catalog, normalized.scenario, normalized.rooms);
    const assigned = new Map(result.roomPlans.map((plan) => [plan.roomId, plan.assignedOperatorIds]));
    const room = result.roomPlans.find((plan) => plan.roomKind === "reception_room" && plan.assignedOperatorIds.includes("akekuri"))!;
    const incomplete = new Map(assigned);
    incomplete.set(room.roomId, room.assignedOperatorIds.filter((id) => id !== "akekuri"));
    expect(scorer.score(assigned) - scorer.score(incomplete)).toBeCloseTo(0.032, 10);
    const akekuri = scorer.result(incomplete).unassignedOperators!.find((entry) => entry.operatorId === "akekuri")!;
    expect(akekuri.bestOpenSlotScoreGain).toBeCloseTo(0.032, 10);
    expect(akekuri.reasons.join(" ")).toContain("an open seat may still improve the plan");
  });

  it("keeps clue-targeting workers out of Reception and supports explicitly pinning spare workers", () => {
    const normalized = normalizeScenario(catalog, scenario);
    const scorer = createAssignmentScorer(catalog, normalized.scenario, normalized.rooms);
    for (const plan of result.roomPlans.filter((entry) => entry.roomKind === "reception_room")) {
      expect(plan.assignedOperatorIds.every((id) => !scorer.workerEffects(plan.roomId, id).targetsSpecificClue)).toBe(true);
    }
    const pinned = structuredClone(scenario);
    pinned.options.shiftRotation!.scheduleMode = "fixed";
    pinned.facilities.hardAssignments = [
      { operatorId: "alesh", roomId: "control_nexus", shift: "B" },
      { operatorId: "akekuri", roomId: "reception-1", shift: "B" },
    ];
    const fixed = solveScenario(catalog, pinned);
    expect(fixed.roomPlans.find((plan) => plan.roomId === "control_nexus")!.assignedOperatorIds).toContain("alesh");
    expect(fixed.roomPlans.find((plan) => plan.roomId === "reception-1::shift-B")!.assignedOperatorIds).toContain("akekuri");
  });
});
