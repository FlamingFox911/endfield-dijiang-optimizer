import { describe, expect, it } from "vitest";
import { createStarterScenario, resolveDemandProfile } from "@endfield/data";
import { loadDefaultCatalog } from "@endfield/data/node";
import { createAssignmentScorer } from "../packages/optimizer/src/assignment-scoring.js";
import { normalizeScenario } from "../packages/optimizer/src/solver.js";
import { SUPPORT_WEIGHTS } from "../packages/optimizer/src/config.js";

async function fixture() {
  const catalog = await loadDefaultCatalog();
  const scenario = createStarterScenario(catalog);
  for (const operator of scenario.roster) operator.owned = false;
  scenario.facilities.controlNexus.level = 5;
  scenario.facilities.manufacturingCabins.forEach((room, index) => {
    room.enabled = index === 0;
    room.level = 3;
    room.fixedRecipeId = "arms-insp-set";
  });
  scenario.facilities.growthChambers.forEach((room) => { room.enabled = false; });
  scenario.facilities.receptionRoom!.enabled = false;
  scenario.facilities.hardAssignments = [];
  const own = (id: string, unlock = false) => {
    const operator = scenario.roster.find((entry) => entry.operatorId === id)!;
    operator.owned = true;
    if (unlock) {
      operator.baseSkillStates = catalog.operators.find((entry) => entry.id === id)!.baseSkills.map((skill) => ({ skillId: skill.id, unlockedRank: 2 }));
    }
    return operator;
  };
  const scorer = () => {
    const normalized = normalizeScenario(catalog, scenario);
    return createAssignmentScorer(catalog, normalized.scenario, normalized.rooms);
  };
  return { catalog, scenario, own, scorer };
}

describe("assignment scoring", () => {
  it("stops an empty room and discounts a lone worker for rest", async () => {
    const { catalog, own, scorer } = await fixture();
    own("ember");
    const objective = scorer();
    const empty = objective.result(new Map());
    expect(empty.totalScore).toBe(0);
    expect(empty.projectedOutputs.weapon_exp).toBe(0);
    const result = objective.result(new Map([["mfg-1", ["ember"]]]));
    const recipe = catalog.recipes.find((entry) => entry.id === "arms-insp-set")!;
    // 14-hour work / 8.3-hour rest yields 5/8 uptime; staffing is 140% while active.
    const expected = 60 / recipe.baseDurationMinutes! * recipe.outputAmount! * 1.4 * 0.625;
    expect(result.projectedOutputs.weapon_exp).toBeCloseTo(expected, 10);
    expect(result.totalScore).toBeCloseTo(expected, 10);
  });

  it("multiplies matching skills by staffed efficiency, with no off-product output gain", async () => {
    const { catalog, scenario, own, scorer } = await fixture();
    own("ember", true);
    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "advanced-combat-record";
    const assignments = new Map([["mfg-1", ["ember"]]]);
    const result = scorer().result(assignments);
    const recipe = catalog.recipes.find((entry) => entry.id === "advanced-combat-record")!;
    expect(result.projectedOutputs.operator_exp).toBeCloseTo(60 / recipe.baseDurationMinutes! * recipe.outputAmount! * 1.4 * 1.3 * 0.625, 10);
    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "arms-insp-set";
    const weaponRecipe = catalog.recipes.find((entry) => entry.id === "arms-insp-set")!;
    expect(scorer().result(assignments).projectedOutputs.weapon_exp).toBeCloseTo(60 / weaponRecipe.baseDurationMinutes! * weaponRecipe.outputAmount! * 1.4 * 0.625, 10);
  });

  it("keeps Growth bonuses on their matching recipe in a mixed chamber", async () => {
    const { catalog, scenario, own, scorer } = await fixture();
    const chen = own("chen-qianyu");
    scenario.facilities.manufacturingCabins[0]!.enabled = false;
    const chamber = scenario.facilities.growthChambers[0]!;
    chamber.enabled = true;
    chamber.level = 3;
    chamber.fixedRecipeIds = ["pink-bolete", "kalkonyx"];
    const assignments = new Map([[chamber.id, ["chen-qianyu"]]]);
    const before = scorer().result(assignments);
    chen.baseSkillStates = [{ skillId: "jadeworking", unlockedRank: 2 }];
    const after = scorer().result(assignments);
    expect(after.projectedRecipeOutputs["pink-bolete"]).toBeCloseTo(before.projectedRecipeOutputs["pink-bolete"]!, 12);
    expect(after.projectedRecipeOutputs.kalkonyx).toBeCloseTo(before.projectedRecipeOutputs.kalkonyx! * 1.3, 10);
    expect(catalog.recipes.some((recipe) => recipe.id === "kalkonyx")).toBe(true);
  });

  it("allocates shipwide production and Reception gains to Control exactly once", async () => {
    const { scenario, own, scorer } = await fixture();
    own("ember");
    own("lifeng", true);
    own("ardelia", true);
    scenario.facilities.receptionRoom!.enabled = true;
    const receptionId = scenario.facilities.receptionRoom!.id;
    const objective = scorer();
    const baselineAssignments = new Map([["mfg-1", ["ember"]], [receptionId, ["ardelia"]]]);
    const assignments = new Map([...baselineAssignments, ["control_nexus", ["lifeng"]]]);
    const baseline = objective.result(baselineAssignments);
    const result = objective.result(assignments);
    expect(result.totalScore).toBe(objective.score(assignments));
    expect(result.totalScore).toBeGreaterThan(baseline.totalScore);
    expect(result.roomPlans.reduce((sum, room) => sum + room.projectedScore, 0)).toBeCloseTo(result.totalScore, 12);
    const control = result.roomPlans.find((room) => room.roomKind === "control_nexus")!;
    expect(control.scoreBreakdown.crossRoomBonusContribution).toBeCloseTo(result.totalScore - baseline.totalScore, 12);
    expect(result.roomPlans.find((room) => room.roomId === "mfg-1")!.projectedScore).toBeCloseTo(baseline.roomPlans.find((room) => room.roomId === "mfg-1")!.projectedScore, 12);
    expect(result.projectedOutputs.weapon_exp).toBeGreaterThan(baseline.projectedOutputs.weapon_exp);
    expect(result.explanations.find((entry) => entry.operatorId === "lifeng")!.projectedContribution).toBeCloseTo(result.totalScore - baseline.totalScore, 12);
    // Removing production leaves a separately positive Control effect on Reception.
    const receptionOnly = new Map([[receptionId, ["ardelia"]], ["control_nexus", ["lifeng"]]]);
    expect(objective.score(receptionOnly)).toBeGreaterThan(objective.score(new Map([[receptionId, ["ardelia"]]])));
  });

  it("credits generic Reception workers for base throughput and +40% staffing without requiring skills", async () => {
    const { scenario, own, scorer } = await fixture();
    own("chen-qianyu");
    own("akekuri");
    scenario.facilities.manufacturingCabins[0]!.enabled = false;
    scenario.facilities.receptionRoom!.enabled = true;
    scenario.facilities.receptionRoom!.level = 3;
    const roomId = scenario.facilities.receptionRoom!.id;
    const objective = scorer();
    const weight = SUPPORT_WEIGHTS.receptionClueCollectionWeight * resolveDemandProfile(scenario.options.demandProfile).receptionWeight;
    expect(objective.score(new Map())).toBe(0);
    expect(objective.canContribute(roomId, "chen-qianyu")).toBe(true);
    const one = objective.score(new Map([[roomId, ["chen-qianyu"]]]));
    const two = objective.score(new Map([[roomId, ["chen-qianyu", "akekuri"]]]));
    expect(one).toBeCloseTo(100 * 1.4 * 0.625 * weight, 12);
    // Independent legacy work cycles: at least one active, plus each worker's
    // staffing term. This checks the expected formula without reusing it.
    expect(two).toBeCloseTo(100 * (1 - 0.375 ** 2 + 0.4 * 2 * 0.625) * weight, 12);
    expect(two).toBeGreaterThan(one);
  });

  it("multiplies Reception staffing by general clue skills and weights both daily shifts once", async () => {
    const { catalog, scenario, own, scorer } = await fixture();
    own("chen-qianyu");
    own("akekuri");
    own("ardelia", true);
    for (const skill of catalog.operators.find((entry) => entry.id === "ardelia")!.baseSkills) {
      for (const rank of skill.ranks) rank.modifiers = rank.modifiers.filter((effect) => effect.metric === "clue_collection_efficiency");
    }
    scenario.facilities.manufacturingCabins[0]!.enabled = false;
    scenario.facilities.receptionRoom!.enabled = true;
    scenario.facilities.receptionRoom!.level = 3;
    scenario.options.shiftRotation = { enabled: true, scheduleMode: "fixed" };
    const roomId = scenario.facilities.receptionRoom!.id;
    const objective = scorer();
    const assigned = new Map([[roomId, ["chen-qianyu", "ardelia"]], [`${roomId}::shift-B`, ["akekuri"]]]);
    const weight = SUPPORT_WEIGHTS.receptionClueCollectionWeight * resolveDemandProfile(scenario.options.demandProfile).receptionWeight;
    expect(objective.workerEffects(roomId, "ardelia").clueEfficiencyPercent).toBe(30);
    expect(objective.score(assigned)).toBeCloseTo(100 * (1.8 * 1.3 + 1.4) / 2 * weight, 12);
    const result = objective.result(assigned);
    expect(result.roomPlans.reduce((sum, plan) => sum + plan.projectedScore, 0)).toBeCloseTo(result.totalScore, 12);
    expect(result.explanations.find((entry) => entry.operatorId === "chen-qianyu")!.projectedContribution).toBeGreaterThan(0);
    expect(result.explanations.find((entry) => entry.operatorId === "chen-qianyu")!.reasons.join(" ")).toContain("40% staffing efficiency");
    expect(objective.roomUpperBound(roomId, ["chen-qianyu"], ["ardelia", "akekuri"], 2)).toBeCloseTo(100 * 2.2 * 1.3 / 2 * weight, 12);
  });

  it("credits pinned clue-targeting workers for staffing without awarding their clue preference any extra score", async () => {
    const { scenario, own, scorer } = await fixture();
    const ember = own("ember");
    scenario.facilities.manufacturingCabins[0]!.enabled = false;
    scenario.facilities.receptionRoom!.enabled = true;
    const roomId = scenario.facilities.receptionRoom!.id;
    const assigned = new Map([[roomId, ["ember"]]]);
    const before = scorer().score(assigned);
    ember.baseSkillStates.forEach((skill) => { skill.unlockedRank = 2; });
    scenario.facilities.hardAssignments = [{ operatorId: "ember", roomId }];
    expect(scorer().workerEffects(roomId, "ember").targetsSpecificClue).toBe(true);
    expect(scorer().score(assigned)).toBe(before);
  });

  it("values Cognitive EXP at its separate farming replacement rate", async () => {
    const { catalog, scenario, own, scorer } = await fixture();
    own("ember");
    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "advanced-cognitive-carrier";
    const result = scorer().result(new Map([["mfg-1", ["ember"]]]));
    const item = catalog.progression.expItems.find((entry) => entry.itemId === "advanced-cognitive-carrier")!;
    expect(result.totalScore).toBeCloseTo(result.projectedRecipeOutputs["advanced-cognitive-carrier"]! * item.expValue / 10_000 * 2.5, 12);
  });

  it("bounds every completion even when support and production skills interact", async () => {
    const { own, scorer } = await fixture();
    own("gilberta", true);
    own("pogranichnik", true);
    own("perlica", true);
    own("lifeng", true);
    const objective = scorer();
    const bound = objective.roomUpperBound("mfg-1", ["gilberta"], ["pogranichnik", "perlica"], 2);
    for (const workers of [["gilberta"], ["gilberta", "pogranichnik"], ["gilberta", "perlica"], ["gilberta", "pogranichnik", "perlica"]]) {
      const score = objective.score(new Map([["mfg-1", workers], ["control_nexus", ["lifeng"]]]));
      expect(score).toBeLessThanOrEqual(bound);
    }
  });

  it("reports unknown unlocked skills without inventing a bonus", async () => {
    const { own, scorer } = await fixture();
    const ember = own("ember");
    const assignments = new Map([["mfg-1", ["ember"]]]);
    const before = scorer().score(assignments);
    ember.baseSkillStates.push({ skillId: "unknown-future-skill", unlockedRank: 2 });
    const after = scorer().result(assignments);
    expect(after.totalScore).toBe(before);
    expect(after.warnings.some((warning) => warning.includes("unknown-future-skill"))).toBe(true);
  });
});
