import { describe, expect, it } from "vitest";
import { createStarterScenario, migrateScenario } from "@endfield/data";
import { loadDefaultCatalog } from "@endfield/data/node";
import { formatOptimizationResultText, normalizeScenario, solveScenario } from "@endfield/optimizer";
import { createAssignmentScorer } from "../packages/optimizer/src/assignment-scoring.js";
import { createOperatorPreference } from "../packages/optimizer/src/operator-preference.js";

async function tiedScenario() {
  const catalog = await loadDefaultCatalog();
  const ids = ["akekuri", "chen-qianyu", "ardelia", "laevatain", "yvonne"];
  catalog.operators = catalog.operators.filter((operator) => ids.includes(operator.id));
  // Identical staffing contribution, independent of the live skill balance.
  for (const operator of catalog.operators) operator.baseSkills = [];
  const scenario = createStarterScenario(catalog);
  for (const entry of scenario.roster) entry.owned = true;
  scenario.facilities.controlNexus.level = 1;
  scenario.facilities.manufacturingCabins = [{ id: "mfg-1", enabled: true, level: 1, fixedRecipeId: "arms-inspector" }];
  scenario.facilities.growthChambers = [];
  scenario.facilities.receptionRoom = undefined;
  scenario.facilities.hardAssignments = [];
  return { catalog, scenario };
}

describe("assignment ties", () => {
  it("prefers newer limited six-stars and lists every unused alternative in preference order", async () => {
    const { catalog, scenario } = await tiedScenario();
    const result = solveScenario(catalog, scenario);
    const room = result.roomPlans.find((plan) => plan.roomId === "mfg-1")!;
    expect(room.assignedOperatorIds).toEqual(["yvonne"]);
    expect(room.alternativeOperatorIdsBySlot).toEqual([["laevatain", "ardelia", "chen-qianyu", "akekuri"]]);
    const text = formatOptimizationResultText(result, catalog);
    expect(text).toContain("slot 1 alternatives (one change at a time): Laevatain, Ardelia, Chen Qianyu, Akekuri");
    const before = JSON.stringify(scenario);
    solveScenario(catalog, scenario);
    expect(JSON.stringify(scenario)).toBe(before);
  });

  it("never trades even a tiny real score gain for rarity", async () => {
    const { catalog, scenario } = await tiedScenario();
    const worker = catalog.operators.find((operator) => operator.id === "akekuri")!;
    worker.baseSkills = [{
      id: "tiny-bonus", name: "Tiny bonus", facilityKind: "manufacturing_cabin",
      icon: { id: "test", kind: "icon", path: "test.png" }, sourceRefs: [],
      ranks: [{ rank: 1, label: "alpha", modifiers: [{ metric: "production_efficiency", appliesTo: "all", value: 0.000001, unit: "percent" }], materialCosts: [], sourceRefs: [] }],
    }];
    scenario.roster.find((entry) => entry.operatorId === worker.id)!.baseSkillStates = [{ skillId: "tiny-bonus", unlockedRank: 1 }];
    const result = solveScenario(catalog, scenario);
    const room = result.roomPlans.find((plan) => plan.roomId === "mfg-1")!;
    expect(room.assignedOperatorIds).toEqual(["akekuri"]);
    expect(room.alternativeOperatorIdsBySlot).toEqual([[]]);
  });

  it("honors hard assignments and excludes workers already assigned elsewhere", async () => {
    const { catalog, scenario } = await tiedScenario();
    scenario.facilities.controlNexus.level = 3;
    scenario.facilities.manufacturingCabins.push({ id: "mfg-2", enabled: true, level: 1, fixedRecipeId: "arms-inspector" });
    scenario.facilities.hardAssignments = [{ roomId: "mfg-1", operatorId: "akekuri" }];
    const result = solveScenario(catalog, scenario);
    const fixed = result.roomPlans.find((plan) => plan.roomId === "mfg-1")!;
    expect(fixed.assignedOperatorIds).toEqual(["akekuri"]);
    expect(fixed.alternativeOperatorIdsBySlot).toEqual([[]]);
    const used = new Set(result.roomPlans.flatMap((plan) => plan.assignedOperatorIds));
    const normalized = normalizeScenario(catalog, scenario);
    const scorer = createAssignmentScorer(catalog, normalized.scenario, normalized.rooms);
    for (const room of result.roomPlans) {
      for (const [slot, alternatives] of room.alternativeOperatorIdsBySlot!.entries()) {
        for (const id of alternatives) {
          expect(used.has(id)).toBe(false);
          const assignment = new Map(result.roomPlans.map((plan) => [plan.roomId, [...plan.assignedOperatorIds] as (string | null)[]]));
          assignment.get(room.roomId)![slot] = id;
          expect(scorer.score(assignment)).toBe(result.totalScore);
        }
      }
    }
  });

  it("lists neutral options for empty slots without adding idle workers to the plan", async () => {
    const { catalog, scenario } = await tiedScenario();
    scenario.facilities.manufacturingCabins = [];
    const result = solveScenario(catalog, scenario);
    const control = result.roomPlans[0]!;
    expect(control.assignedOperatorIds).toEqual([]);
    expect(result.totalScore).toBe(0);
    expect(control.alternativeOperatorIdsBySlot?.[0]).toEqual(["yvonne", "laevatain", "ardelia", "chen-qianyu", "akekuri"]);
  });

  it("does not cap tie alternatives when the search budget is small", async () => {
    const { catalog, scenario } = await tiedScenario();
    const result = solveScenario(catalog, scenario, {
      searchConfig: { profileLabel: "custom", effort: 1, maxBranchCandidatesPerSlot: 1, maxVisitedNodes: 1, progressIntervalNodes: 1 },
    });
    expect(result.roomPlans.find((plan) => plan.roomId === "mfg-1")?.alternativeOperatorIdsBySlot?.[0]).toHaveLength(4);
  });

  it("uses explicit future banner metadata and keeps unknown operators in their rarity category", async () => {
    const { catalog } = await tiedScenario();
    const template = catalog.operators.find((operator) => operator.id === "ardelia")!;
    const future = { ...template, id: "future", limitedBannerDebut: "2027-01-01" };
    const unknown = { ...template, id: "unknown" };
    const compare = createOperatorPreference([...catalog.operators, future, unknown]);
    expect(["unknown", "yvonne", "future", "akekuri", "chen-qianyu", "laevatain"].sort(compare))
      .toEqual(["future", "yvonne", "laevatain", "unknown", "chen-qianyu", "akekuri"]);
  });

  it("includes alternatives even when an older saved scenario disabled them", async () => {
    const { catalog, scenario } = await tiedScenario();
    const legacy = migrateScenario({ ...scenario, options: { ...scenario.options, showTiedOptions: false } }).scenario;
    expect(solveScenario(catalog, legacy)).toEqual(solveScenario(catalog, scenario));
  });
});
