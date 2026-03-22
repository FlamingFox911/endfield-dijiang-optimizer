import { describe, expect, it } from "vitest";

import { createStarterScenario } from "@endfield/data";
import { loadDefaultCatalog, loadScenarioFile, resolveRepoPath } from "@endfield/data/node";
import {
  applyMaxFacilitiesOverlay,
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
});
