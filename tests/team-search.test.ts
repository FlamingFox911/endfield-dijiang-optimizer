import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { GameCatalog, OptimizationScenario } from "@endfield/domain";
import { createStarterScenario, mergeLiveRosterUpdate } from "@endfield/data";
import { loadDefaultCatalog } from "@endfield/data/node";
import { normalizeScenario, recommendUpgrades, solveScenario } from "@endfield/optimizer";
import { createAssignmentScorer } from "../packages/optimizer/src/assignment-scoring.js";
import { createOperatorPreference } from "../packages/optimizer/src/operator-preference.js";

// Enumerate each operator's room (or no room), independently of both search
// algorithms, and compare the full objective including all deterministic ties.
function enumerateAssignments(catalog: GameCatalog, scenario: OptimizationScenario) {
  const { rooms } = normalizeScenario(catalog, scenario);
  const scorer = createAssignmentScorer(catalog, scenario, rooms);
  const compare = createOperatorPreference(catalog.operators);
  const assigned = new Map(rooms.map((room) => [room.roomId, [] as string[]]));
  for (const fixed of scenario.facilities.hardAssignments) assigned.get(fixed.roomId)!.push(fixed.operatorId);
  const fixed = new Set([...assigned.values()].flat());
  const ids = scenario.roster.filter((operator) => operator.owned && !fixed.has(operator.operatorId)).map((operator) => operator.operatorId);
  const listCompare = (a: string[], b: string[]) => {
    const left = [...a].sort(compare);
    const right = [...b].sort(compare);
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const order = compare(left[index]!, right[index]!);
      if (order) return order;
    }
    return left.length - right.length;
  };
  let bestScore = Number.NEGATIVE_INFINITY;
  let best = new Map(rooms.map((room) => [room.roomId, [] as string[]]));
  const visit = (index: number) => {
    if (index === ids.length) {
      const score = scorer.score(assigned);
      const currentIds = [...assigned.values()].flat();
      const bestIds = [...best.values()].flat();
      let tie = currentIds.length - bestIds.length || listCompare(currentIds, bestIds);
      if (!tie) for (const room of rooms) {
        tie = listCompare(assigned.get(room.roomId)!, best.get(room.roomId)!);
        if (tie) break;
      }
      if (score > bestScore || (score === bestScore && tie < 0)) {
        bestScore = score;
        best = new Map([...assigned].map(([id, workers]) => [id, [...workers].sort(compare)]));
      }
      return;
    }
    visit(index + 1);
    for (const room of rooms) {
      const workers = assigned.get(room.roomId)!;
      if (workers.length === room.slotCap) continue;
      workers.push(ids[index]!);
      visit(index + 1);
      workers.pop();
    }
  };
  visit(0);
  return { bestScore, best };
}

describe("exact room-team search", () => {
  it.each(Array.from({ length: 24 }, (_, index) => index))("matches exhaustive enumeration with overlapping synthetic skills, case %i", async (seed) => {
    const catalog = await loadDefaultCatalog();
    let randomState = seed + 1;
    const pick = (length: number) => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState % length;
    };
    const kinds = ["control_nexus", "manufacturing_cabin", "growth_chamber", "reception_room"] as const;
    const values = [0, 10, 20, 50, 100, 10 + Number.EPSILON * 8];
    catalog.operators = Array.from({ length: 5 }, (_, index) => ({
      ...catalog.operators[index]!, id: `test-${index}`,
      // Include overlap between support and production specialists, neutral
      // workers, saturation, and near-equal scores to challenge tie pruning.
      baseSkills: kinds.map((facilityKind) => ({
        ...catalog.operators[0]!.baseSkills[0]!, id: `${index}-${facilityKind}`, facilityKind,
        ranks: [{ rank: 1, label: "alpha", sourceRefs: [], materialCosts: [], modifiers: [
          { metric: "mood_drop_reduction", appliesTo: "all", unit: "percent", value: values[pick(values.length)]! },
          { metric: "mood_regen", appliesTo: "all", unit: "percent", value: values[pick(values.length)]! },
          { metric: facilityKind === "reception_room" ? "clue_collection_efficiency" : "production_efficiency",
            appliesTo: "all", unit: "percent", value: values[pick(values.length)]! },
        ] }],
      })),
    }));
    const scenario = createStarterScenario(catalog);
    scenario.options.optimizationProfile = "exhaustive";
    scenario.options.maxFacilities = true;
    scenario.options.demandProfile = { preset: "custom", receptionWeight: pick(3), productWeights: {
      operator_exp: pick(3), weapon_exp: pick(3), fungal: pick(3), vitrified_plant: pick(3), rare_mineral: pick(3),
    } };
    for (const operator of scenario.roster) {
      operator.owned = true;
      operator.baseSkillStates.forEach((skill) => { skill.unlockedRank = pick(3) === 0 ? 0 : 1; });
    }
    scenario.facilities.manufacturingCabins.forEach((room, index) => {
      room.fixedRecipeId = index === 0 ? "arms-insp-set" : "advanced-cognitive-carrier";
    });
    scenario.facilities.growthChambers[0]!.fixedRecipeIds = ["bloodcap", "kalkonyx"];
    if (seed % 3 === 0) scenario.facilities.hardAssignments = [{ operatorId: "test-0", roomId: seed % 2 ? "mfg-1" : "control_nexus" }];
    const expected = enumerateAssignments(catalog, scenario);
    const actual = solveScenario(catalog, scenario);
    expect(actual.search?.complete).toBe(true);
    expect(actual.totalScore).toBe(expected.bestScore);
    expect(new Map(actual.roomPlans.map((room) => [room.roomId, room.assignedOperatorIds]))).toEqual(expected.best);
  });

  it.each([0, 1, 2])("matches exhaustive baseline and every unlock gain using synced roster data, case %i", async (seed) => {
    const bundled = await loadDefaultCatalog();
    const live = JSON.parse(await readFile("apps/web/public/roster/latest.json", "utf8"));
    const catalog = mergeLiveRosterUpdate(bundled, live).catalog;
    const scenario = createStarterScenario(catalog);
    scenario.options.optimizationProfile = "exhaustive";
    scenario.options.maxFacilities = true;
    const ids = seed === 0 ? ["ember", "xaihi", "akekuri", "chen-qianyu"]
      : catalog.operators.slice(seed * 4, seed * 4 + 4).map((operator) => operator.id);
    for (const operator of scenario.roster) {
      operator.owned = ids.includes(operator.operatorId);
      operator.baseSkillStates.forEach((skill, index) => { skill.unlockedRank = ((seed + index) % 2) as 0 | 1; });
    }
    scenario.facilities.manufacturingCabins.forEach((room, index) => {
      room.fixedRecipeId = index === 0 ? "arms-insp-set" : "advanced-cognitive-carrier";
    });
    scenario.facilities.growthChambers[0]!.fixedRecipeIds = ["bloodcap"];
    if (seed === 0) scenario.facilities.hardAssignments = [{ operatorId: "chen-qianyu", roomId: "mfg-1" }];
    const expectedBaseline = enumerateAssignments(catalog, scenario).bestScore;
    const actual = recommendUpgrades(catalog, scenario);
    expect(actual.searchComplete).toBe(true);
    expect(actual.baselineScore).toBe(expectedBaseline);
    const expectedActions = catalog.operators.filter((operator) => ids.includes(operator.id)).flatMap((operator) =>
      operator.baseSkills.flatMap((skill) => skill.ranks.filter((rank) => rank.rank >
        (scenario.roster.find((entry) => entry.operatorId === operator.id)!.baseSkillStates.find((entry) => entry.skillId === skill.id)?.unlockedRank ?? 0))
        .map((rank) => `${operator.id}/${skill.id}/${rank.rank}`)));
    expect(actual.recommendations.map(({ action }) => `${action.operatorId}/${action.skillId}/${action.targetRank}`).sort()).toEqual(expectedActions.sort());
    for (const [index, recommendation] of actual.recommendations.entries()) {
      const upgraded = structuredClone(scenario);
      const operator = upgraded.roster.find((entry) => entry.operatorId === recommendation.action.operatorId)!;
      operator.baseSkillStates.find((skill) => skill.skillId === recommendation.action.skillId)!.unlockedRank = recommendation.action.targetRank;
      const expected = enumerateAssignments(catalog, upgraded).bestScore - expectedBaseline;
      expect(recommendation.scoreDelta).toBe(expected);
      if (index > 0) expect(actual.recommendations[index - 1]!.scoreDelta).toBeGreaterThanOrEqual(expected);
    }
  });

  it.each(Array.from({ length: 10 }, (_, index) => index))("matches exhaustive operator-to-room enumeration, case %i", async (seed) => {
    const catalog = await loadDefaultCatalog();
    const ownedIds = ["ember", "xaihi", "chen-qianyu", "akekuri", "ardelia", "snowshine"];
    const scenario = createStarterScenario(catalog);
    scenario.options.optimizationProfile = "exhaustive";
    scenario.facilities.controlNexus.level = 3;
    scenario.facilities.manufacturingCabins.forEach((room, index) => {
      room.enabled = true;
      room.level = 1;
      room.fixedRecipeId = (seed + index) % 2 === 0 ? "arms-inspector" : "elementary-combat-record";
    });
    scenario.facilities.growthChambers[0]!.enabled = true;
    scenario.facilities.growthChambers[0]!.level = 1;
    scenario.facilities.growthChambers[0]!.fixedRecipeIds = ["kalkonyx"];
    scenario.facilities.receptionRoom!.enabled = seed % 2 === 0;
    scenario.facilities.receptionRoom!.level = 1;
    scenario.facilities.hardAssignments = seed % 3 === 0 ? [{ operatorId: "ember", roomId: "mfg-1" }] : [];
    if (seed === 5) scenario.facilities.hardAssignments = [{ operatorId: "akekuri", roomId: "control_nexus" }];
    for (const [index, operator] of scenario.roster.entries()) {
      operator.owned = ownedIds.includes(operator.operatorId);
      operator.baseSkillStates = catalog.operators.find((entry) => entry.id === operator.operatorId)!.baseSkills
        .map((skill, skillIndex) => ({ skillId: skill.id, unlockedRank: ((seed + index + skillIndex) % 3) as 0 | 1 | 2 }));
    }
    if (seed === 9) for (const operator of catalog.operators) operator.baseSkills = [];
    if (seed === 8) scenario.options.demandProfile = { preset: "custom", receptionWeight: 0,
      productWeights: { operator_exp: 0, weapon_exp: 0, fungal: 0, vitrified_plant: 0, rare_mineral: 0 } };
    const expected = enumerateAssignments(catalog, scenario);
    const actual = solveScenario(catalog, scenario);
    expect(actual.search?.complete).toBe(true);
    expect(actual.totalScore).toBe(expected.bestScore);
    expect(new Map(actual.roomPlans.map((room) => [room.roomId, room.assignedOperatorIds]))).toEqual(expected.best);
  });

  it("proves a full catalog and 15-slot base without millions of slot visits", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    scenario.options.maxFacilities = true;
    scenario.options.optimizationProfile = "exhaustive";
    for (const operator of scenario.roster) {
      operator.owned = true;
      operator.baseSkillStates.forEach((skill) => { skill.unlockedRank = 2; });
    }
    scenario.facilities.manufacturingCabins.forEach((room, index) => {
      room.fixedRecipeId = index === 0 ? "advanced-cognitive-carrier" : "arms-insp-set";
    });
    scenario.facilities.growthChambers[0]!.fixedRecipeIds = Array(9).fill("bloodcap");
    const startedAt = performance.now();
    const result = solveScenario(catalog, scenario, {
      // Regression watchdog only; the production solver remains unlimited.
      shouldCancel: () => performance.now() - startedAt > 20_000,
    });
    expect(result.search).toMatchObject({ complete: true, maxVisitedNodes: null, candidatesLimited: false });
    expect(result.search!.visitedNodes).toBeLessThan(50_000);
    expect(result.roomPlans.reduce((sum, room) => sum + room.slotCap!, 0)).toBe(15);
  }, 25_000);
});
