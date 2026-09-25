import { describe, expect, it } from "vitest";
import { createStarterScenario } from "@endfield/data";
import { loadDefaultCatalog } from "@endfield/data/node";
import {
  getOptimizationSearchLimits, getScenarioSearchConfig, getOptimizationSearchConfig,
  normalizeScenario, recommendUpgrades, solveScenario, OptimizationCancelledError,
} from "@endfield/optimizer";
import { boundAssignmentSearch } from "../packages/optimizer/src/search-space.js";

describe("roster-aware search limits", () => {
  it("bounds a complete unpruned tree with room symmetries and empty-room branches", () => {
    // Independently enumerate the actual DFS shape, with every operator eligible.
    const countTree = (ids: number[], capacities: number[], previous = -1): number => {
      if (!ids.length || !capacities.length) return 1;
      const [capacity, ...rest] = capacities;
      if (!capacity) return countTree(ids, rest);
      let count = 1 + countTree(ids, rest);
      for (const id of ids.filter((value) => value > previous)) {
        count += countTree(ids.filter((value) => value !== id), capacity === 1 ? rest : [capacity! - 1, ...rest], capacity === 1 ? -1 : id);
      }
      return count;
    };
    for (let owned = 0; owned <= 7; owned += 1) {
      for (const slots of [[], [1], [3], [1, 3, 2], [3, 2, 1], [2, 1, 3]]) {
        expect(boundAssignmentSearch(owned, slots).nodeUpperBound)
          .toBeGreaterThanOrEqual(countTree(Array.from({ length: owned }, (_, id) => id), slots));
      }
    }
    expect(boundAssignmentSearch(100, [3, 3, 3, 3, 3]).exceedsBoundedBudget).toBe(true);
    expect(boundAssignmentSearch(100, [3, 3, 3, 3, 3]).maxEffort).toBe(100);
  });

  it("clamps empty and small rosters, including imported excessive effort, without changing results", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    scenario.options.optimizationEffort = 100;
    for (const operator of scenario.roster) operator.owned = false;
    expect(getOptimizationSearchLimits(catalog, scenario)).toMatchObject({ maxEffort: 1, nodeUpperBound: 1 });
    expect(solveScenario(catalog, scenario).search?.complete).toBe(true);
    for (const operator of scenario.roster) operator.owned = ["ember", "chen-qianyu", "snowshine"].includes(operator.operatorId);
    const limits = getOptimizationSearchLimits(catalog, scenario);
    expect(limits.maxEffort).toBeLessThan(100);
    expect(getScenarioSearchConfig(catalog, scenario).effort).toBe(limits.maxEffort);
    expect(getScenarioSearchConfig(catalog, scenario)).toMatchObject({ maxVisitedNodes: null, maxBranchCandidatesPerSlot: null });
    const capped = solveScenario(catalog, scenario);
    const high = solveScenario(catalog, scenario, { searchConfig: getOptimizationSearchConfig("custom", 100) });
    expect(capped.search?.complete).toBe(true);
    expect(capped.totalScore).toBe(high.totalScore);
    expect(capped.roomPlans).toEqual(high.roomPlans);
    expect(recommendUpgrades(catalog, scenario).searchComplete).toBe(true);
  });

  it("uses normalized facilities, known owned operators and only valid fixed assignments", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    for (const operator of scenario.roster) operator.owned = ["ember", "snowshine"].includes(operator.operatorId);
    scenario.roster.push({ ...scenario.roster[0]!, operatorId: "unknown", owned: true });
    scenario.facilities.controlNexus.level = 1;
    scenario.facilities.hardAssignments = [
      { operatorId: "ember", roomId: "mfg-1" },
      { operatorId: "ember", roomId: "control_nexus" },
      { operatorId: "snowshine", roomId: "missing" },
      { operatorId: "unknown", roomId: "control_nexus" },
    ];
    const limits = getOptimizationSearchLimits(catalog, scenario);
    expect(limits.availableOperators).toBe(1);
    expect(limits.openSlots).toBe(normalizeScenario(catalog, scenario).rooms.reduce((sum, room) => sum + room.slotCap, 0) - 1);
    scenario.options.maxFacilities = true;
    expect(getOptimizationSearchLimits(catalog, scenario).openSlots).toBeGreaterThan(limits.openSlots);
    const beforeUnlocks = getOptimizationSearchLimits(catalog, scenario);
    for (const operator of scenario.roster) operator.baseSkillStates = [];
    expect(getOptimizationSearchLimits(catalog, scenario)).toEqual(beforeUnlocks);
  });

  it("reports node truncation and carries baseline uncertainty into unlock recommendations", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    for (const [index, operator] of scenario.roster.entries()) operator.owned = index < 8;
    scenario.options.optimizationEffort = 1;
    scenario.options.maxFacilities = true;
    expect(getOptimizationSearchLimits(catalog, scenario).maxEffort).toBeGreaterThan(1);
    const baseline = solveScenario(catalog, scenario, {
      searchConfig: { ...getOptimizationSearchConfig("custom", 1), maxVisitedNodes: 1 },
    });
    expect(baseline.search).toMatchObject({ complete: false, budgetExceeded: true });
    const recommendations = recommendUpgrades(catalog, scenario, baseline);
    expect(recommendations.searchComplete).toBe(false);
    expect(recommendations.warnings?.join(" ")).toContain("Baseline assignment search");
    expect(recommendations.recommendations.every((entry) => entry.notes.some((note) => note.includes("ranking may change")))).toBe(true);
  });

  it("does not claim completion when candidate limits omit branches", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    for (const operator of scenario.roster) operator.owned = true;
    const result = solveScenario(catalog, scenario, {
      searchConfig: { ...getOptimizationSearchConfig("custom", 1), maxBranchCandidatesPerSlot: 1, maxVisitedNodes: 1_000_000 },
    });
    expect(result.search).toMatchObject({ complete: false, budgetExceeded: false, candidatesLimited: true });
  });

  it("discloses incomplete candidate searches in unlock rankings", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    scenario.options.optimizationEffort = 1;
    scenario.options.maxFacilities = true;
    scenario.facilities.manufacturingCabins.forEach((room) => { room.fixedRecipeId = "advanced-cognitive-carrier"; });
    for (const operator of scenario.roster) {
      operator.owned = true;
      operator.baseSkillStates = catalog.operators.find((entry) => entry.id === operator.operatorId)!.baseSkills
        .map((skill) => ({ skillId: skill.id, unlockedRank: 2 }));
    }
    scenario.roster.find((operator) => operator.operatorId === "ember")!.baseSkillStates[0]!.unlockedRank = 1;
    const result = recommendUpgrades(catalog, scenario);
    expect(result.searchComplete).toBe(false);
    expect(result.warnings?.join(" ")).toContain("unlock candidate search(es) did not complete");
    expect(result.recommendations).toHaveLength(1);
  });

  it("keeps every intermediate effort bounded and makes the endpoint unlimited", () => {
    let previousBudget = 0;
    let previousCap = 0;
    for (let effort = 1; effort < 100; effort += 1) {
      const config = getOptimizationSearchConfig("custom", effort);
      expect(config.maxVisitedNodes).toBeGreaterThan(previousBudget);
      expect(config.maxBranchCandidatesPerSlot).toBeGreaterThanOrEqual(previousCap);
      previousBudget = config.maxVisitedNodes!;
      previousCap = config.maxBranchCandidatesPerSlot!;
    }
    const maximum = getOptimizationSearchConfig("exhaustive", 100);
    expect(maximum).toMatchObject({ maxVisitedNodes: null, maxBranchCandidatesPerSlot: null });
    expect(Number.isFinite(maximum.progressIntervalNodes)).toBe(true);
    expect(JSON.parse(JSON.stringify(maximum))).toEqual(maximum);
  });

  it("proves a large neutral roster at maximum without enumerating redundant slot choices", async () => {
    const catalog = await loadDefaultCatalog();
    catalog.operators = Array.from({ length: 35 }, (_, index) => ({
      ...catalog.operators[0]!, id: `worker-${String(index).padStart(2, "0")}`, baseSkills: [],
    }));
    const scenario = createStarterScenario(catalog);
    for (const operator of scenario.roster) operator.owned = true;
    scenario.facilities.controlNexus.level = 5;
    scenario.facilities.manufacturingCabins.forEach((room, index) => {
      room.enabled = index === 0;
      room.level = 3;
      room.fixedRecipeId = "arms-inspector";
    });
    scenario.facilities.growthChambers.forEach((room) => { room.enabled = false; });
    scenario.facilities.receptionRoom!.enabled = false;
    scenario.options.optimizationEffort = 1;
    const quick = solveScenario(catalog, scenario);
    expect(quick.search?.complete).toBe(false);

    scenario.options.optimizationProfile = "exhaustive";
    expect(getScenarioSearchConfig(catalog, scenario)).toMatchObject({
      effort: getOptimizationSearchLimits(catalog, scenario).maxEffort,
      maxVisitedNodes: null,
      maxBranchCandidatesPerSlot: null,
    });
    scenario.options.optimizationEffort = getOptimizationSearchLimits(catalog, scenario).maxEffort;
    const progress: number[] = [];
    const maximum = solveScenario(catalog, scenario, { onProgress: (snapshot) => {
      expect(snapshot.maxVisitedNodes).toBeNull();
      expect(snapshot.maxBranchCandidatesPerSlot).toBeNull();
      progress.push(snapshot.visitedNodes);
    } });
    expect(maximum.search).toMatchObject({ complete: true, budgetExceeded: false, candidatesLimited: false, maxVisitedNodes: null });
    expect(maximum.search!.visitedNodes).toBeLessThan(100);
    expect(progress.length).toBeGreaterThan(1);
    // All workers are neutral: the optimum fills all three production seats.
    const recipe = catalog.recipes.find((entry) => entry.id === "arms-inspector")!;
    const expectedMultiplier = 1 - (1 - 0.625) ** 3 + 0.4 * 3 * 0.625;
    const expected = 60 / recipe.baseDurationMinutes! * (recipe.outputAmount ?? 1) * 0.02 * expectedMultiplier;
    expect(maximum.totalScore).toBeCloseTo(expected, 9);
    expect(maximum.totalScore).toBeGreaterThanOrEqual(quick.totalScore);

    let cancel = false;
    expect(() => solveScenario(catalog, scenario, {
      onProgress: (snapshot) => { if (snapshot.phase === "Scoring room combinations") cancel = true; },
      shouldCancel: () => cancel,
    })).toThrow(OptimizationCancelledError);
  });

  it("re-solves incomplete supplied baselines at maximum and reports each unlimited unlock search", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    for (const operator of scenario.roster) operator.owned = operator.operatorId === "ember";
    const baseline = solveScenario(catalog, scenario, {
      searchConfig: { ...getOptimizationSearchConfig("custom", 1), maxVisitedNodes: 1 },
    });
    expect(baseline.search?.complete).toBe(false);
    scenario.options.optimizationEffort = 100;
    const phases = new Set<string>();
    const result = recommendUpgrades(catalog, scenario, baseline, { onProgress: (snapshot) => {
      if (snapshot.assignmentSearch) {
        expect(snapshot.assignmentSearch.maxVisitedNodes).toBeNull();
        expect(snapshot.assignmentSearch.maxBranchCandidatesPerSlot).toBeNull();
        phases.add(snapshot.phase);
      }
    } });
    expect(phases.has("Optimizing baseline assignments")).toBe(true);
    expect(phases.has(`Searching unlock ${result.recommendations.length} of ${result.recommendations.length}`)).toBe(true);
    expect(result.searchComplete).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});
