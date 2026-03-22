import { describe, expect, it } from "vitest";

import { createStarterScenario } from "@endfield/data";
import { loadDefaultCatalog, loadScenarioFile, resolveRepoPath } from "@endfield/data/node";
import {
  DEFAULT_OPTIMIZATION_EFFORT,
  DEFAULT_OPTIMIZATION_PROFILE,
  OptimizationCancelledError,
  SUPPORT_WEIGHTS,
  applyMaxFacilitiesOverlay,
  getOptimizationSearchConfig,
  formatOptimizationResultText,
  formatUpgradeRecommendationsText,
  normalizeScenario,
  recommendUpgrades,
  solveScenario,
} from "@endfield/optimizer";

describe("optimizer runtime", () => {
  it("returns rich room score breakdowns", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = await loadScenarioFile(resolveRepoPath("scenarios", "examples", "current-base.simple.json"));
    const result = solveScenario(catalog, scenario);

    expect(result.roomPlans.length).toBeGreaterThan(0);
    expect(result.roomPlans[0]?.scoreBreakdown.totalScore).toBeDefined();
    expect(result.supportWeightsVersion).toBeTruthy();
  });

  it("applies the baseline production efficiency from assigned production-room seats", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    const recipe = catalog.recipes.find((entry) => entry.id === scenario.facilities.manufacturingCabins[0]?.fixedRecipeId);
    const snowshine = scenario.roster.find((operator) => operator.operatorId === "snowshine");

    expect(recipe).toBeDefined();
    expect(snowshine).toBeDefined();

    snowshine!.owned = true;
    scenario.facilities.controlNexus.level = 1;
    scenario.facilities.hardAssignments = [];
    scenario.facilities.manufacturingCabins[0]!.enabled = true;
    scenario.facilities.manufacturingCabins[0]!.level = 1;
    scenario.facilities.manufacturingCabins[1]!.enabled = false;
    scenario.facilities.growthChambers[0]!.enabled = false;
    scenario.facilities.receptionRoom!.enabled = false;

    const result = solveScenario(catalog, scenario);
    const manufacturingPlan = result.roomPlans.find((room) => room.roomId === "mfg-1");
    const baseUnits = (scenario.options.horizonHours * 60 / recipe!.baseDurationMinutes!) * (recipe!.outputAmount ?? 1);

    expect(manufacturingPlan).toBeDefined();
    expect(manufacturingPlan!.assignedOperatorIds).toEqual(["snowshine"]);
    expect(manufacturingPlan!.scoreBreakdown.directProductionScore).toBeCloseTo(baseUnits * 1.4, 6);
  });

  it("values production-room Mood sustain from long-run uptime against the staffed seat and personal bonuses", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    const recipe = catalog.recipes.find((entry) => entry.id === "arms-insp-set");
    const pogranichnik = scenario.roster.find((operator) => operator.operatorId === "pogranichnik");

    expect(recipe).toBeDefined();
    expect(pogranichnik).toBeDefined();

    for (const operator of scenario.roster) {
      operator.owned = operator.operatorId === "pogranichnik";
    }

    pogranichnik!.owned = true;
    pogranichnik!.baseSkillStates = pogranichnik!.baseSkillStates.map((state) => ({
      ...state,
      unlockedRank: state.skillId === "hone-the-weapons" || state.skillId === "morale-boost" ? 1 : 0,
    }));

    scenario.facilities.controlNexus.level = 3;
    scenario.facilities.hardAssignments = [];
    scenario.facilities.manufacturingCabins[0]!.enabled = true;
    scenario.facilities.manufacturingCabins[0]!.level = 3;
    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "arms-insp-set";
    scenario.facilities.manufacturingCabins[1]!.enabled = false;
    scenario.facilities.growthChambers[0]!.enabled = false;
    scenario.facilities.receptionRoom!.enabled = false;

    const result = solveScenario(catalog, scenario);
    const manufacturingPlan = result.roomPlans.find((room) => room.roomId === "mfg-1");
    const baseUnits = (scenario.options.horizonHours * 60 / recipe!.baseDurationMinutes!) * (recipe!.outputAmount ?? 1);
    const boostedUptime = 1 / (
      1 + ((SUPPORT_WEIGHTS.baselineMoodDrainPerHour * 0.86) / SUPPORT_WEIGHTS.baselineMoodRegenPerHour)
    );
    const preservedActiveContributionUnits = baseUnits * 0.6;
    const expectedMoodSustainUnits =
      preservedActiveContributionUnits * ((boostedUptime / SUPPORT_WEIGHTS.baselineMoodWorkingUptime) - 1);
    const expectedScore = baseUnits + (baseUnits * 0.4) + (baseUnits * 0.2) + expectedMoodSustainUnits;

    expect(manufacturingPlan).toBeDefined();
    expect(manufacturingPlan!.assignedOperatorIds).toEqual(["pogranichnik"]);
    expect(manufacturingPlan!.scoreBreakdown.directProductionScore).toBeCloseTo(expectedScore, 6);
  });

  it("values Control Nexus Mood support from long-run shipwide uptime", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    const recipe = catalog.recipes.find((entry) => entry.id === "arms-insp-set");
    const snowshine = scenario.roster.find((operator) => operator.operatorId === "snowshine");
    const pogranichnik = scenario.roster.find((operator) => operator.operatorId === "pogranichnik");

    expect(recipe).toBeDefined();
    expect(snowshine).toBeDefined();
    expect(pogranichnik).toBeDefined();

    for (const operator of scenario.roster) {
      operator.owned = operator.operatorId === "snowshine" || operator.operatorId === "pogranichnik";
    }

    snowshine!.owned = true;
    snowshine!.baseSkillStates = snowshine!.baseSkillStates.map((state) => ({
      ...state,
      unlockedRank: state.skillId === "happy-go-lucky" ? 1 : 0,
    }));
    pogranichnik!.owned = true;
    pogranichnik!.baseSkillStates = pogranichnik!.baseSkillStates.map((state) => ({
      ...state,
      unlockedRank: state.skillId === "hone-the-weapons" ? 1 : 0,
    }));

    scenario.facilities.controlNexus.level = 3;
    scenario.facilities.hardAssignments = [
      { operatorId: "snowshine", roomId: "control_nexus" },
      { operatorId: "pogranichnik", roomId: "mfg-1" },
    ];
    scenario.facilities.manufacturingCabins[0]!.enabled = true;
    scenario.facilities.manufacturingCabins[0]!.level = 3;
    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "arms-insp-set";
    scenario.facilities.manufacturingCabins[1]!.enabled = false;
    scenario.facilities.growthChambers[0]!.enabled = false;
    scenario.facilities.receptionRoom!.enabled = false;

    const result = solveScenario(catalog, scenario);
    const controlPlan = result.roomPlans.find((room) => room.roomId === "control_nexus");
    const manufacturingPlan = result.roomPlans.find((room) => room.roomId === "mfg-1");
    const baseUnits = (scenario.options.horizonHours * 60 / recipe!.baseDurationMinutes!) * (recipe!.outputAmount ?? 1);
    let controlWorkingUptime = SUPPORT_WEIGHTS.baselineMoodWorkingUptime;
    for (let iteration = 0; iteration < 16; iteration += 1) {
      controlWorkingUptime = 1 / (
        1 + (
          SUPPORT_WEIGHTS.baselineMoodDrainPerHour
          / (SUPPORT_WEIGHTS.baselineMoodRegenPerHour * (1 + ((12 * controlWorkingUptime) / 100)))
        )
      );
    }
    const averageMoodRegenPercent = 12 * controlWorkingUptime;
    const boostedProductionUptime = 1 / (
      1 + (SUPPORT_WEIGHTS.baselineMoodDrainPerHour / (
        SUPPORT_WEIGHTS.baselineMoodRegenPerHour * (1 + (averageMoodRegenPercent / 100))
      ))
    );
    const expectedCrossRoomContribution =
      (baseUnits * 0.6) * ((boostedProductionUptime / SUPPORT_WEIGHTS.baselineMoodWorkingUptime) - 1);
    const expectedManufacturingOutput = baseUnits + (baseUnits * 0.4) + (baseUnits * 0.2) + expectedCrossRoomContribution;

    expect(controlPlan).toBeDefined();
    expect(manufacturingPlan).toBeDefined();
    expect(controlPlan!.assignedOperatorIds).toContain("snowshine");
    expect(controlPlan!.scoreBreakdown.crossRoomBonusContribution).toBeCloseTo(expectedCrossRoomContribution, 6);
    expect(manufacturingPlan!.projectedOutputs.weapon_exp).toBeCloseTo(expectedManufacturingOutput, 6);
  });

  it("applies the max-facilities overlay without mutating the original scenario", async () => {
    const scenario = await loadScenarioFile(resolveRepoPath("scenarios", "examples", "current-base.simple.json"));
    const overlaid = applyMaxFacilitiesOverlay(scenario);

    expect(scenario.facilities.controlNexus.level).toBe(3);
    expect(overlaid.facilities.controlNexus.level).toBe(5);
    expect(overlaid.facilities.manufacturingCabins.every((room) => room.level === 3)).toBe(true);
  });

  it("returns upgrade recommendations using the scenario ranking mode", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = await loadScenarioFile(resolveRepoPath("scenarios", "examples", "current-base.simple.json"));
    scenario.options.upgradeRankingMode = "fastest";

    const result = recommendUpgrades(catalog, scenario);

    expect(result.rankingMode).toBe("fastest");
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("includes missing level and promotion costs in upgrade recommendations", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    const tangtang = scenario.roster.find((operator) => operator.operatorId === "tangtang");
    const tangtangDef = catalog.operators.find((operator) => operator.id === "tangtang");

    expect(tangtang).toBeDefined();
    expect(tangtangDef).toBeDefined();

    tangtang!.owned = true;
    tangtang!.level = 1;
    tangtang!.promotionTier = 0;

    const result = recommendUpgrades(catalog, scenario);
    const recommendation = result.recommendations.find(
      (entry) =>
        entry.action.operatorId === "tangtang" &&
        entry.action.skillId === tangtangDef!.baseSkills[1]!.id,
    );

    expect(recommendation).toBeDefined();
    expect(recommendation!.action.requiredPromotionTier).toBe(2);
    expect(recommendation!.action.requiredLevel).toBe(40);
    expect(recommendation!.action.levelsToGain).toBe(39);
    expect(recommendation!.action.levelExpCost).toBe(271400);
    expect(recommendation!.action.levelTCredCost).toBe(13360);
    expect(recommendation!.action.levelCostIsUpperBound).toBe(false);
    expect(recommendation!.action.levelMaterialCosts).toEqual([
      { itemId: "advanced-combat-record", quantity: 27 },
      { itemId: "intermediate-combat-record", quantity: 1 },
      { itemId: "elementary-combat-record", quantity: 2 },
      { itemId: "t-creds", quantity: 13360 },
    ]);
    expect(recommendation!.action.promotionMaterialCosts).toEqual([
      { itemId: "protodisk", quantity: 33 },
      { itemId: "pink-bolete", quantity: 3 },
      { itemId: "t-creds", quantity: 8100 },
      { itemId: "red-bolete", quantity: 5 },
    ]);
    expect(recommendation!.action.skillMaterialCosts).toEqual([
      { itemId: "protoprism", quantity: 12 },
      { itemId: "t-creds", quantity: 3000 },
    ]);
  });

  it("uses facility slot caps instead of the Control Nexus assignment limit for production rooms", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = await loadScenarioFile(resolveRepoPath("scenarios", "examples", "current-base.simple.json"));

    const normalized = normalizeScenario(catalog, scenario);
    const mfg2 = normalized.rooms.find((room) => room.roomId === "mfg-2");

    expect(mfg2?.slotCap).toBe(1);
  });

  it("formats results and recommendations with catalog-backed names", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = await loadScenarioFile(resolveRepoPath("scenarios", "examples", "current-base.simple.json"));
    const optimization = solveScenario(catalog, scenario);
    const upgrades = recommendUpgrades(catalog, scenario);

    const optimizationText = formatOptimizationResultText(optimization, catalog);
    const upgradeText = formatUpgradeRecommendationsText(upgrades, catalog);

    expect(optimizationText).toContain("Chen Qianyu");
    expect(optimizationText).toContain("Elementary Cognitive Carrier");
    expect(upgradeText).toContain("Chen Qianyu");
    expect(upgradeText).toContain("Blade Critique");
  });

  it("maps optimization profiles to increasing search budgets", () => {
    const fast = getOptimizationSearchConfig("fast", 4);
    const balanced = getOptimizationSearchConfig(DEFAULT_OPTIMIZATION_PROFILE, DEFAULT_OPTIMIZATION_EFFORT);
    const exhaustive = getOptimizationSearchConfig("exhaustive", 20);

    expect(fast.maxBranchCandidatesPerSlot).toBeLessThan(balanced.maxBranchCandidatesPerSlot);
    expect(balanced.maxVisitedNodes).toBeLessThan(exhaustive.maxVisitedNodes);
    expect(exhaustive.profileLabel).toBe("exhaustive");
  });

  it("emits progress snapshots during optimization when requested", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = await loadScenarioFile(resolveRepoPath("scenarios", "examples", "current-base.simple.json"));
    const progress: number[] = [];

    solveScenario(catalog, scenario, {
      searchConfig: { ...getOptimizationSearchConfig("balanced", 8), progressIntervalNodes: 1 },
      onProgress: (snapshot) => {
        progress.push(snapshot.visitedNodes);
      },
    });

    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]).toBeGreaterThanOrEqual(0);
  });

  it("supports cancellation through solver options", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = await loadScenarioFile(resolveRepoPath("scenarios", "examples", "current-base.simple.json"));
    let shouldCancel = false;

    expect(() => solveScenario(catalog, scenario, {
      searchConfig: { ...getOptimizationSearchConfig("thorough", 14), progressIntervalNodes: 1 },
      onProgress: () => {
        shouldCancel = true;
      },
      shouldCancel: () => shouldCancel,
    })).toThrow(OptimizationCancelledError);
  });

  it("keeps solveScenario backwards-compatible when no solver options are passed", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = await loadScenarioFile(resolveRepoPath("scenarios", "examples", "current-base.simple.json"));

    const baseline = solveScenario(catalog, scenario);
    const explicit = solveScenario(catalog, scenario, {});

    expect(explicit.totalScore).toBe(baseline.totalScore);
    expect(explicit.roomPlans).toHaveLength(baseline.roomPlans.length);
  });

  it("keeps multiple hard assignments in the same room", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);

    scenario.facilities.controlNexus.level = 3;

    for (const operatorId of ["snowshine", "gilberta", "tangtang"] as const) {
      const entry = scenario.roster.find((operator) => operator.operatorId === operatorId);
      expect(entry).toBeDefined();
      entry!.owned = true;
    }

    scenario.facilities.hardAssignments = [
      { operatorId: "snowshine", roomId: "control_nexus" },
      { operatorId: "gilberta", roomId: "control_nexus" },
      { operatorId: "tangtang", roomId: "control_nexus" },
    ];

    const result = solveScenario(catalog, scenario);
    const controlNexusPlan = result.roomPlans.find((room) => room.roomId === "control_nexus");

    expect(controlNexusPlan?.assignedOperatorIds).toHaveLength(3);
    expect(controlNexusPlan?.assignedOperatorIds).toEqual(
      expect.arrayContaining(["snowshine", "gilberta", "tangtang"]),
    );
    expect(result.warnings.some((warning) => warning.includes("Ignoring hard assignment"))).toBe(false);
  });
});
