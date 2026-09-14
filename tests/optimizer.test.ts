import { describe, expect, it } from "vitest";

import { createStarterScenario } from "@endfield/data";
import { loadDefaultCatalog, loadScenarioFile, resolveRepoPath } from "@endfield/data/node";
import { createAssignmentScorer } from "../packages/optimizer/src/assignment-scoring.js";
import {
  DEFAULT_OPTIMIZATION_EFFORT,
  DEFAULT_OPTIMIZATION_PROFILE,
  OptimizationCancelledError,
  SUPPORT_WEIGHTS,
  applyMaxFacilitiesOverlay,
  getOptimizationSearchConfig,
  formatOptimizationResultText,
  formatUpgradeRecommendationsText,
  formatScorePoints,
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
    const recipe = catalog.recipes.find((entry) => entry.id === "arms-insp-set");
    const snowshine = scenario.roster.find((operator) => operator.operatorId === "snowshine");

    expect(recipe).toBeDefined();
    expect(snowshine).toBeDefined();

    snowshine!.owned = true;
    scenario.facilities.controlNexus.level = 4;
    scenario.facilities.hardAssignments = [];
    scenario.facilities.manufacturingCabins[0]!.enabled = true;
    scenario.facilities.manufacturingCabins[0]!.level = 3;
    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "arms-insp-set";
    scenario.facilities.manufacturingCabins[1]!.enabled = false;
    scenario.facilities.growthChambers[0]!.enabled = false;
    scenario.facilities.receptionRoom!.enabled = false;

    const result = solveScenario(catalog, scenario);
    const manufacturingPlan = result.roomPlans.find((room) => room.roomId === "mfg-1");
    const baseUnits = (60 / recipe!.baseDurationMinutes!) * (recipe!.outputAmount ?? 1);

    expect(manufacturingPlan).toBeDefined();
    expect(manufacturingPlan!.assignedOperatorIds).toEqual(["snowshine"]);
    expect(manufacturingPlan!.scoreBreakdown.directProductionScore).toBeCloseTo(baseUnits * 1.4 * 0.625, 6);
  });

  it("normalizes low-tier manufacturing recipes below top-tier item value", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    const recipe = catalog.recipes.find((entry) => entry.id === "arms-inspector");
    const snowshine = scenario.roster.find((operator) => operator.operatorId === "snowshine");

    expect(recipe).toBeDefined();
    expect(snowshine).toBeDefined();

    snowshine!.owned = true;
    scenario.facilities.controlNexus.level = 1;
    scenario.facilities.hardAssignments = [];
    scenario.facilities.manufacturingCabins[0]!.enabled = true;
    scenario.facilities.manufacturingCabins[0]!.level = 1;
    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "arms-inspector";
    scenario.facilities.manufacturingCabins[1]!.enabled = false;
    scenario.facilities.growthChambers[0]!.enabled = false;
    scenario.facilities.receptionRoom!.enabled = false;

    const result = solveScenario(catalog, scenario);
    const manufacturingPlan = result.roomPlans.find((room) => room.roomId === "mfg-1");
    const baseUnits = (60 / recipe!.baseDurationMinutes!) * (recipe!.outputAmount ?? 1);
    const expectedScoreUnits = baseUnits * 1.4 * 0.625 * (200 / 10_000);

    expect(manufacturingPlan).toBeDefined();
    expect(manufacturingPlan!.scoreBreakdown.directProductionScore).toBeCloseTo(expectedScoreUnits, 6);
    expect(manufacturingPlan!.projectedOutputs.weapon_exp).toBeCloseTo(baseUnits * 1.4 * 0.625, 6);
    expect(result.projectedRecipeOutputs["arms-inspector"]).toBeCloseTo(baseUnits * 1.4 * 0.625, 6);
  });

  it("ignores locked future rooms and clamps active room level for current optimization", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);

    scenario.facilities.controlNexus.level = 1;
    scenario.facilities.manufacturingCabins[0]!.enabled = true;
    scenario.facilities.manufacturingCabins[0]!.level = 3;
    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "advanced-cognitive-carrier";
    scenario.facilities.manufacturingCabins[1]!.enabled = true;
    scenario.facilities.manufacturingCabins[1]!.level = 3;
    scenario.facilities.manufacturingCabins[1]!.fixedRecipeId = "advanced-combat-record";

    const normalized = normalizeScenario(catalog, scenario);
    const activeManufacturingRoom = normalized.rooms.find((room) => room.roomId === "mfg-1");

    expect(activeManufacturingRoom).toMatchObject({
      roomId: "mfg-1",
      level: 1,
      fixedRecipeIds: [],
    });
    expect(normalized.rooms.find((room) => room.roomId === "mfg-2")).toBeUndefined();
    expect(normalized.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Manufacturing cabin 'mfg-1' is set to level 3"),
        expect.stringContaining("Room 'mfg-1' has recipe 'advanced-cognitive-carrier' saved for room level 3"),
        expect.stringContaining("Manufacturing cabin 'mfg-2' is saved as enabled, but stays inactive until Control Nexus level 3."),
      ]),
    );
  });

  it("applies custom demand weights to long-run production scoring without changing raw outputs", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    const recipe = catalog.recipes.find((entry) => entry.id === "arms-inspector");
    const snowshine = scenario.roster.find((operator) => operator.operatorId === "snowshine");

    expect(recipe).toBeDefined();
    expect(snowshine).toBeDefined();

    snowshine!.owned = true;
    scenario.options.demandProfile = {
      preset: "custom",
      productWeights: {
        operator_exp: 1,
        weapon_exp: 3,
        fungal: 1,
        vitrified_plant: 1,
        rare_mineral: 1,
      },
      receptionWeight: 1,
    };
    scenario.facilities.controlNexus.level = 1;
    scenario.facilities.hardAssignments = [];
    scenario.facilities.manufacturingCabins[0]!.enabled = true;
    scenario.facilities.manufacturingCabins[0]!.level = 1;
    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "arms-inspector";
    scenario.facilities.manufacturingCabins[1]!.enabled = false;
    scenario.facilities.growthChambers[0]!.enabled = false;
    scenario.facilities.receptionRoom!.enabled = false;

    const result = solveScenario(catalog, scenario);
    const manufacturingPlan = result.roomPlans.find((room) => room.roomId === "mfg-1");
    const baseUnits = (60 / recipe!.baseDurationMinutes!) * (recipe!.outputAmount ?? 1);
    const expectedScoreUnits = baseUnits * 1.4 * 0.625 * (200 / 10_000) * 3;

    expect(manufacturingPlan).toBeDefined();
    expect(manufacturingPlan!.scoreBreakdown.directProductionScore).toBeCloseTo(expectedScoreUnits, 6);
    expect(manufacturingPlan!.projectedOutputs.weapon_exp).toBeCloseTo(baseUnits * 1.4 * 0.625, 6);
  });

  it("boosts an exact priority recipe on top of the broader demand profile", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    const recipe = catalog.recipes.find((entry) => entry.id === "arms-inspector");
    const snowshine = scenario.roster.find((operator) => operator.operatorId === "snowshine");

    expect(recipe).toBeDefined();
    expect(snowshine).toBeDefined();

    snowshine!.owned = true;
    scenario.options.demandProfile = {
      preset: "balanced",
      productWeights: {
        operator_exp: 1,
        weapon_exp: 1,
        fungal: 1,
        vitrified_plant: 1,
        rare_mineral: 1,
      },
      receptionWeight: 1,
      priorityRecipeId: "arms-inspector",
    };
    scenario.facilities.controlNexus.level = 1;
    scenario.facilities.hardAssignments = [];
    scenario.facilities.manufacturingCabins[0]!.enabled = true;
    scenario.facilities.manufacturingCabins[0]!.level = 1;
    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "arms-inspector";
    scenario.facilities.manufacturingCabins[1]!.enabled = false;
    scenario.facilities.growthChambers[0]!.enabled = false;
    scenario.facilities.receptionRoom!.enabled = false;

    const result = solveScenario(catalog, scenario);
    const manufacturingPlan = result.roomPlans.find((room) => room.roomId === "mfg-1");
    const baseUnits = (60 / recipe!.baseDurationMinutes!) * (recipe!.outputAmount ?? 1);
    const expectedScoreUnits =
      baseUnits
      * 1.4
      * 0.625
      * (200 / 10_000)
      * SUPPORT_WEIGHTS.priorityRecipeFocusMultiplier;

    expect(manufacturingPlan).toBeDefined();
    expect(manufacturingPlan!.scoreBreakdown.directProductionScore).toBeCloseTo(expectedScoreUnits, 6);
    expect(result.projectedRecipeOutputs["arms-inspector"]).toBeCloseTo(baseUnits * 1.4 * 0.625, 6);
  });

  it("applies custom reception demand weights to clue utility scoring", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    const ardelia = scenario.roster.find((operator) => operator.operatorId === "ardelia");
    const estella = scenario.roster.find((operator) => operator.operatorId === "estella");

    expect(ardelia).toBeDefined();
    expect(estella).toBeDefined();

    for (const operator of scenario.roster) {
      operator.owned = operator.operatorId === "ardelia" || operator.operatorId === "estella";
    }

    ardelia!.owned = true;
    ardelia!.baseSkillStates = ardelia!.baseSkillStates.map((state) => ({
      ...state,
      unlockedRank: state.skillId === "tales-of-the-land" ? 2 : 0,
    }));
    estella!.owned = true;
    estella!.baseSkillStates = estella!.baseSkillStates.map((state) => ({
      ...state,
      unlockedRank: state.skillId === "frequency-monitoring" ? 2 : 0,
    }));

    scenario.options.demandProfile = {
      preset: "custom",
      productWeights: {
        operator_exp: 1,
        weapon_exp: 1,
        fungal: 1,
        vitrified_plant: 1,
        rare_mineral: 1,
      },
      receptionWeight: 2.5,
    };
    scenario.facilities.controlNexus.level = 5;
    scenario.facilities.hardAssignments = [
      { operatorId: "ardelia", roomId: "reception-1" },
      { operatorId: "estella", roomId: "reception-1" },
    ];
    scenario.facilities.manufacturingCabins[0]!.enabled = false;
    scenario.facilities.manufacturingCabins[1]!.enabled = false;
    scenario.facilities.growthChambers[0]!.enabled = false;
    scenario.facilities.receptionRoom!.enabled = true;
    scenario.facilities.receptionRoom!.level = 3;

    const result = solveScenario(catalog, scenario);
    const receptionPlan = result.roomPlans.find((room) => room.roomId === "reception-1");

    expect(receptionPlan).toBeDefined();
    expect(receptionPlan!.scoreBreakdown.supportRoomScore).toBeCloseTo(
      (30 + 30) * SUPPORT_WEIGHTS.receptionClueCollectionWeight * 2.5 * 0.625,
      6,
    );
  });

  it("keeps Reception Room clue utility on a conservative support scale", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    const ardelia = scenario.roster.find((operator) => operator.operatorId === "ardelia");
    const estella = scenario.roster.find((operator) => operator.operatorId === "estella");

    expect(ardelia).toBeDefined();
    expect(estella).toBeDefined();

    for (const operator of scenario.roster) {
      operator.owned = operator.operatorId === "ardelia" || operator.operatorId === "estella";
    }

    ardelia!.owned = true;
    ardelia!.baseSkillStates = ardelia!.baseSkillStates.map((state) => ({
      ...state,
      unlockedRank: state.skillId === "tales-of-the-land" ? 2 : 0,
    }));
    estella!.owned = true;
    estella!.baseSkillStates = estella!.baseSkillStates.map((state) => ({
      ...state,
      unlockedRank: state.skillId === "frequency-monitoring" ? 2 : 0,
    }));

    scenario.facilities.controlNexus.level = 5;
    scenario.facilities.hardAssignments = [
      { operatorId: "ardelia", roomId: "reception-1" },
      { operatorId: "estella", roomId: "reception-1" },
    ];
    scenario.facilities.manufacturingCabins[0]!.enabled = false;
    scenario.facilities.manufacturingCabins[1]!.enabled = false;
    scenario.facilities.growthChambers[0]!.enabled = false;
    scenario.facilities.receptionRoom!.enabled = true;
    scenario.facilities.receptionRoom!.level = 3;

    const result = solveScenario(catalog, scenario);
    const receptionPlan = result.roomPlans.find((room) => room.roomId === "reception-1");

    expect(receptionPlan).toBeDefined();
    expect(receptionPlan!.assignedOperatorIds).toEqual(["ardelia", "estella"]);
    expect(receptionPlan!.scoreBreakdown.supportRoomScore).toBeCloseTo(
      (30 + 30) * SUPPORT_WEIGHTS.receptionClueCollectionWeight * 0.625,
      6,
    );
  });

  it("values Reception Mood sustain and leaves targeted clue-rate candidates unassigned", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    const ownedIds = new Set(["akekuri", "ardelia", "estella", "arclight", "avywenna"]);

    for (const operator of scenario.roster) {
      operator.owned = ownedIds.has(operator.operatorId);
      operator.baseSkillStates = operator.baseSkillStates.map((state) => ({
        ...state,
        unlockedRank:
          (operator.operatorId === "akekuri" && state.skillId === "icebreaker")
          || (operator.operatorId === "ardelia" && (state.skillId === "tales-of-the-land" || state.skillId === "mr-dollys-game"))
          || (operator.operatorId === "estella" && state.skillId === "frequency-monitoring")
            ? 2
            : (operator.operatorId === "avywenna" && state.skillId === "messengers-secret")
              || (operator.operatorId === "arclight" && state.skillId === "blade-of-the-wildlands")
              ? 1
              : 0,
      }));
    }

    scenario.facilities.controlNexus.level = 5;
    scenario.facilities.hardAssignments = [];
    scenario.facilities.manufacturingCabins.forEach((room) => { room.enabled = false; });
    scenario.facilities.growthChambers.forEach((room) => { room.enabled = false; });
    scenario.facilities.receptionRoom!.enabled = true;
    scenario.facilities.receptionRoom!.level = 3;

    const result = solveScenario(catalog, scenario);
    const receptionPlan = result.roomPlans.find((room) => room.roomId === "reception-1");
    const akekuriExplanation = result.explanations.find(
      (explanation) => explanation.roomId === "reception-1" && explanation.operatorId === "akekuri",
    );

    expect(new Set(receptionPlan?.assignedOperatorIds)).toEqual(new Set(["ardelia", "estella", "akekuri"]));
    expect(receptionPlan?.assignedOperatorIds).not.toContain("arclight");
    expect(receptionPlan?.assignedOperatorIds).not.toContain("avywenna");
    expect(akekuriExplanation?.projectedContribution).toBeGreaterThan(0);
    expect(akekuriExplanation?.reasons.join(" ")).toMatch(/Mood/i);
  });

  it("leaves Reception slots open when only targeted clue-rate candidates are available", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);

    for (const operator of scenario.roster) {
      operator.owned = operator.operatorId === "arclight" || operator.operatorId === "avywenna";
      operator.baseSkillStates = operator.baseSkillStates.map((state) => ({
        ...state,
        unlockedRank: operator.operatorId === "avywenna" && state.skillId === "messengers-secret" ? 1 : 0,
      }));
    }

    scenario.facilities.controlNexus.level = 5;
    scenario.facilities.hardAssignments = [];
    scenario.facilities.manufacturingCabins.forEach((room) => { room.enabled = false; });
    scenario.facilities.growthChambers.forEach((room) => { room.enabled = false; });
    scenario.facilities.receptionRoom!.enabled = true;
    scenario.facilities.receptionRoom!.level = 3;

    const result = solveScenario(catalog, scenario);
    const receptionPlan = result.roomPlans.find((room) => room.roomId === "reception-1");

    expect(receptionPlan?.slotCap).toBe(3);
    expect(receptionPlan?.assignedOperatorIds).toEqual([]);
    expect(receptionPlan?.scoreBreakdown.supportRoomScore).toBe(0);
  });

  it("values production-room Mood sustain against multiplicative active staffing and skill bonuses", async () => {
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

    scenario.facilities.controlNexus.level = 4;
    scenario.facilities.hardAssignments = [];
    scenario.facilities.manufacturingCabins[0]!.enabled = true;
    scenario.facilities.manufacturingCabins[0]!.level = 3;
    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "arms-insp-set";
    scenario.facilities.manufacturingCabins[1]!.enabled = false;
    scenario.facilities.growthChambers[0]!.enabled = false;
    scenario.facilities.receptionRoom!.enabled = false;

    const result = solveScenario(catalog, scenario);
    const manufacturingPlan = result.roomPlans.find((room) => room.roomId === "mfg-1");
    const baseUnits = (60 / recipe!.baseDurationMinutes!) * (recipe!.outputAmount ?? 1);
    const boostedUptime = 1 / (
      1 + ((SUPPORT_WEIGHTS.baselineMoodDrainPerHour * 0.86) / SUPPORT_WEIGHTS.baselineMoodRegenPerHour)
    );
    const expectedScore = baseUnits * 1.4 * 1.2 * boostedUptime;

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

    scenario.facilities.controlNexus.level = 4;
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
    const baseUnits = (60 / recipe!.baseDurationMinutes!) * (recipe!.outputAmount ?? 1);
    // Snowshine cannot provide her own regeneration bonus while resting.
    const averageMoodRegenPercent = 12 * 0.625;
    const boostedProductionUptime = 1 / (
      1 + (SUPPORT_WEIGHTS.baselineMoodDrainPerHour / (
        SUPPORT_WEIGHTS.baselineMoodRegenPerHour * (1 + (averageMoodRegenPercent / 100))
      ))
    );
    const expectedCrossRoomContribution =
      baseUnits * 1.4 * 1.2 * (boostedProductionUptime - 0.625);
    const expectedManufacturingOutput = baseUnits * 1.4 * 1.2 * boostedProductionUptime;

    expect(controlPlan).toBeDefined();
    expect(manufacturingPlan).toBeDefined();
    expect(controlPlan!.assignedOperatorIds).toContain("snowshine");
    expect(controlPlan!.scoreBreakdown.crossRoomBonusContribution).toBeCloseTo(expectedCrossRoomContribution, 6);
    expect(manufacturingPlan!.projectedOutputs.weapon_exp).toBeCloseTo(expectedManufacturingOutput, 6);
  });

  it("applies matching Growth skills only to their product, including recipe yield", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    for (const operator of scenario.roster) {
      operator.owned = operator.operatorId === "yvonne";
      operator.baseSkillStates = operator.baseSkillStates.map((state) => ({
        ...state,
        unlockedRank: state.skillId === "fungal-pigment-extraction" ? 2 : 0,
      }));
    }
    scenario.facilities.controlNexus.level = 2;
    scenario.facilities.manufacturingCabins.forEach((room) => { room.enabled = false; });
    scenario.facilities.receptionRoom!.enabled = false;
    const growth = scenario.facilities.growthChambers[0]!;
    growth.enabled = true;
    growth.level = 1;
    growth.fixedRecipeIds = ["pink-bolete", "kalkodendra", "kalkonyx"];
    scenario.facilities.hardAssignments = [{ operatorId: "yvonne", roomId: growth.id }];

    const result = solveScenario(catalog, scenario);
    for (const recipeId of growth.fixedRecipeIds) {
      const recipe = catalog.recipes.find((entry) => entry.id === recipeId)!;
      const baseUnits = 60 / recipe.baseDurationMinutes! * recipe.outputAmount!;
      const matchingBonus = recipe.productKind === "fungal" ? 1.3 : 1;
      expect(result.projectedRecipeOutputs[recipeId]).toBeCloseTo(baseUnits * 0.625 * 1.4 * matchingBonus, 9);
    }
    const mineralRate = result.projectedRecipeOutputs["kalkonyx"]!;
    expect(result.projectedRecipeOutputs["kalkodendra"]).toBeCloseTo(mineralRate * 3, 9);
  });

  it("values a room Mood provider's benefit to a production specialist beside them", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    for (const operator of scenario.roster) {
      operator.owned = operator.operatorId === "gilberta" || operator.operatorId === "ember";
      operator.baseSkillStates = operator.baseSkillStates.map((state) => ({
        ...state,
        unlockedRank: state.skillId === "messengerial-processing" || state.skillId === "special-northern-training" ? 2 : 0,
      }));
    }
    scenario.facilities.controlNexus.level = 4;
    scenario.facilities.manufacturingCabins.forEach((room, index) => {
      room.enabled = index === 0;
      room.level = 3;
      room.fixedRecipeId = "advanced-combat-record";
    });
    scenario.facilities.growthChambers.forEach((room) => { room.enabled = false; });
    scenario.facilities.receptionRoom!.enabled = false;
    scenario.facilities.hardAssignments = [
      { operatorId: "gilberta", roomId: "mfg-1" },
      { operatorId: "ember", roomId: "mfg-1" },
    ];

    const result = solveScenario(catalog, scenario);
    const recipe = catalog.recipes.find((entry) => entry.id === "advanced-combat-record")!;
    const baseUnits = 60 / recipe.baseDurationMinutes!;
    const providerUptime = 6000 / (6000 + 3600 * 0.82);
    const peerUptime = 6000 / (6000 + 3600 * (1 - 0.18 * providerUptime));
    const expectedMultiplier = (peer: number) => providerUptime * (1 - peer) * 1.4
      + (1 - providerUptime) * peer * 1.4 * 1.3
      + providerUptime * peer * 1.8 * 1.3;
    expect(result.projectedRecipeOutputs[recipe.id]).toBeCloseTo(baseUnits * expectedMultiplier(peerUptime), 8);
    expect(result.projectedRecipeOutputs[recipe.id]).toBeGreaterThan(baseUnits * expectedMultiplier(0.625));
  });

  it("can leave the higher-base-rate first room empty for a better matching assignment", async () => {
    const catalog = await loadDefaultCatalog();
    // Give the first room a slightly higher unstaffed recipe rate. Ember's
    // matching operator EXP skill still makes the second room more valuable.
    catalog.recipes.find((recipe) => recipe.id === "arms-insp-set")!.baseDurationMinutes = 560;
    const scenario = createStarterScenario(catalog);
    for (const operator of scenario.roster) {
      operator.owned = operator.operatorId === "ember";
      operator.baseSkillStates = operator.baseSkillStates.map((state) => ({
        ...state,
        unlockedRank: state.skillId === "special-northern-training" ? 2 : 0,
      }));
    }
    scenario.facilities.controlNexus.level = 4;
    scenario.facilities.manufacturingCabins.forEach((room, index) => {
      room.enabled = true;
      room.level = 3;
      room.fixedRecipeId = index === 0 ? "arms-insp-set" : "advanced-combat-record";
    });
    scenario.facilities.growthChambers.forEach((room) => { room.enabled = false; });
    scenario.facilities.receptionRoom!.enabled = false;
    scenario.facilities.hardAssignments = [];

    const result = solveScenario(catalog, scenario);
    expect(result.roomPlans.find((room) => room.roomId === "mfg-1")!.assignedOperatorIds).toEqual([]);
    expect(result.roomPlans.find((room) => room.roomId === "mfg-2")!.assignedOperatorIds).toEqual(["ember"]);
    expect(result.projectedOutputs.weapon_exp).toBe(0);
    expect(result.projectedOutputs.operator_exp).toBeGreaterThan(0);
  });

  it("matches an exhaustive independent assignment oracle and reports the searched score", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    const ids = ["ember", "xaihi", "chen-qianyu"];
    const skills = ["special-northern-training", "standardized-scripting", "blade-critique"];
    for (const operator of scenario.roster) {
      operator.owned = ids.includes(operator.operatorId);
      operator.baseSkillStates = operator.baseSkillStates.map((state) => ({
        ...state,
        unlockedRank: skills.includes(state.skillId) ? 2 : 0,
      }));
    }
    scenario.facilities.controlNexus.level = 3;
    scenario.facilities.manufacturingCabins.forEach((room, index) => {
      room.enabled = true;
      room.level = 1;
      room.fixedRecipeId = index === 0 ? "elementary-combat-record" : "arms-inspector";
    });
    scenario.facilities.growthChambers.forEach((room) => { room.enabled = false; });
    scenario.facilities.receptionRoom!.enabled = false;
    scenario.facilities.hardAssignments = [];

    const recipe = catalog.recipes.find((entry) => entry.id === "arms-inspector")!;
    const weightedRate = 60 / recipe.baseDurationMinutes! * 0.02 * 0.625 * 1.4;
    const operatorBonuses = [0.3, 0.2, 0];
    const weaponBonuses = [0, 0, 0.2];
    let oracleBest = 0;
    for (let first = -1; first < ids.length; first += 1) {
      for (let second = -1; second < ids.length; second += 1) {
        if (first >= 0 && first === second) continue;
        const score = (first < 0 ? 0 : weightedRate * (1 + operatorBonuses[first]!))
          + (second < 0 ? 0 : weightedRate * (1 + weaponBonuses[second]!));
        oracleBest = Math.max(oracleBest, score);
      }
    }
    let lastBestScore = 0;
    const result = solveScenario(catalog, scenario, {
      searchConfig: { ...getOptimizationSearchConfig("exhaustive", 45), progressIntervalNodes: 1 },
      onProgress: (progress) => { lastBestScore = progress.bestScore; },
    });
    expect(result.totalScore).toBeCloseTo(oracleBest, 9);
    expect(lastBestScore).toBeCloseTo(result.totalScore, 9);
    expect(result.roomPlans.reduce((sum, room) => sum + room.projectedScore, 0)).toBeCloseTo(result.totalScore, 12);
    expect(result.roomPlans.find((room) => room.roomId === "mfg-1")!.assignedOperatorIds).toEqual(["ember"]);
    expect(result.roomPlans.find((room) => room.roomId === "mfg-2")!.assignedOperatorIds).toEqual(["chen-qianyu"]);
  });

  it("completes useful slots under a tiny search budget and retains a rescored upgrade incumbent", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    scenario.options.maxFacilities = true;
    scenario.facilities.hardAssignments = [];
    for (const operator of scenario.roster) {
      operator.owned = true;
      operator.baseSkillStates = catalog.operators.find((entry) => entry.id === operator.operatorId)!.baseSkills
        .map((skill) => ({ skillId: skill.id, unlockedRank: Math.max(...skill.ranks.map((rank) => rank.rank)) as 1 | 2 }));
    }
    scenario.facilities.manufacturingCabins.forEach((room, index) => {
      room.fixedRecipeId = index === 0 ? "advanced-cognitive-carrier" : "arms-insp-set";
    });
    scenario.facilities.growthChambers[0]!.fixedRecipeIds = Array(9).fill("bloodcap");
    const skill = scenario.roster.find((operator) => operator.operatorId === "laevatain")!.baseSkillStates
      .find((entry) => entry.skillId === "memory-crucible")!;
    skill.unlockedRank = 1;
    const searchConfig = { ...getOptimizationSearchConfig("fast", 1), maxVisitedNodes: 1 };
    const baseline = solveScenario(catalog, scenario, { searchConfig });
    const normalized = normalizeScenario(catalog, scenario);
    const scorer = createAssignmentScorer(catalog, normalized.scenario, normalized.rooms);
    const assignments = new Map(normalized.rooms.map((room) => {
      const ids: Array<string | null> = [...baseline.roomPlans.find((plan) => plan.roomId === room.roomId)!.assignedOperatorIds];
      while (ids.length < room.slotCap) ids.push(null);
      return [room.roomId, ids] as const;
    }));
    const used = new Set([...assignments.values()].flat());
    for (const [roomId, ids] of assignments) {
      const slot = ids.indexOf(null);
      if (slot < 0) continue;
      for (const operator of scenario.roster.filter((entry) => !used.has(entry.operatorId))) {
        ids[slot] = operator.operatorId;
        expect(scorer.score(assignments)).toBeLessThanOrEqual(baseline.totalScore + 1e-10);
        ids[slot] = null;
      }
    }
    skill.unlockedRank = 2;
    const upgraded = solveScenario(catalog, scenario, { searchConfig, initialAssignments: baseline.roomPlans });
    const upgradedNormalized = normalizeScenario(catalog, scenario);
    const retainedScore = createAssignmentScorer(catalog, upgradedNormalized.scenario, upgradedNormalized.rooms).score(assignments);
    expect(upgraded.totalScore).toBeGreaterThanOrEqual(retainedScore - 1e-10);
    expect(upgraded.totalScore).toBeGreaterThanOrEqual(baseline.totalScore - 1e-10);
  });

  it("values Cognitive Carriers at their distinct progression opportunity cost", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    for (const operator of scenario.roster) operator.owned = operator.operatorId === "snowshine";
    scenario.facilities.controlNexus.level = 4;
    scenario.facilities.manufacturingCabins.forEach((room, index) => {
      room.enabled = index === 0;
      room.level = 3;
      room.fixedRecipeId = "advanced-cognitive-carrier";
    });
    scenario.facilities.growthChambers.forEach((room) => { room.enabled = false; });
    scenario.facilities.receptionRoom!.enabled = false;
    scenario.facilities.hardAssignments = [{ operatorId: "snowshine", roomId: "mfg-1" }];
    const result = solveScenario(catalog, scenario);
    const recipe = catalog.recipes.find((entry) => entry.id === "advanced-cognitive-carrier")!;
    const output = 60 / recipe.baseDurationMinutes! * 1.4 * 0.625;
    expect(result.projectedRecipeOutputs[recipe.id]).toBeCloseTo(output, 9);
    expect(result.totalScore).toBeCloseTo(output * 2.5, 9);
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

  it("preserves Ember's small Gamma gain and reports the production benefit", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    for (const operator of scenario.roster) operator.owned = operator.operatorId === "ember";
    const ember = scenario.roster.find((operator) => operator.operatorId === "ember")!;
    ember.level = 40;
    ember.promotionTier = 2;
    ember.baseSkillStates = [{ skillId: "special-northern-training", unlockedRank: 1 }];
    scenario.options.demandProfile = {
      preset: "custom",
      productWeights: { operator_exp: 0.25, weapon_exp: 1, fungal: 1, vitrified_plant: 1, rare_mineral: 1 },
      receptionWeight: 1,
    };
    scenario.facilities.controlNexus.level = 1;
    scenario.facilities.hardAssignments = [];
    scenario.facilities.manufacturingCabins.forEach((room, index) => {
      room.enabled = index === 0;
      room.level = 1;
      room.fixedRecipeId = "elementary-combat-record";
    });
    scenario.facilities.growthChambers.forEach((room) => { room.enabled = false; });
    scenario.facilities.receptionRoom!.enabled = false;

    const baseline = solveScenario(catalog, scenario);
    const result = recommendUpgrades(catalog, scenario, baseline);
    const recommendation = result.recommendations.find((entry) =>
      entry.action.skillId === "special-northern-training" && entry.action.targetRank === 2)!;

    expect(recommendation.action.requiredLevel).toBe(60);
    expect(recommendation.scoreDelta).toBeGreaterThan(0);
    expect(recommendation.scoreDelta.toFixed(2)).toBe("0.00");
    expect(formatScorePoints(recommendation.scoreDelta, true)).toMatch(/^\+/);
    expect(recommendation.notes.join(" ")).not.toContain("does not improve");
    const output = recommendation.projectedOutputChanges!.find((change) => change.productKind === "operator_exp")!;
    expect(output.before).toBe(baseline.projectedOutputs.operator_exp);
    expect(output.after).toBeGreaterThan(output.before);
    expect(formatUpgradeRecommendationsText(result, catalog)).toContain("output: Operator Exp:");
    expect(formatUpgradeRecommendationsText(result, catalog)).toContain(`score gain ${formatScorePoints(recommendation.scoreDelta, true)} pts`);
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
        entry.action.skillId === tangtangDef!.baseSkills[1]!.id &&
        entry.action.targetRank === 1,
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

  it("includes cumulative prerequisite costs for future-rank upgrade recommendations", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);
    const tangtang = scenario.roster.find((operator) => operator.operatorId === "tangtang");
    const tangtangDef = catalog.operators.find((operator) => operator.id === "tangtang");

    expect(tangtang).toBeDefined();
    expect(tangtangDef).toBeDefined();

    tangtang!.owned = true;
    tangtang!.level = 1;
    tangtang!.promotionTier = 0;

    const skillId = tangtangDef!.baseSkills[1]!.id;
    const result = recommendUpgrades(catalog, scenario);
    const skillRecommendations = result.recommendations.filter(
      (entry) =>
        entry.action.operatorId === "tangtang" &&
        entry.action.skillId === skillId,
    );
    const gammaRecommendation = skillRecommendations.find((entry) => entry.action.targetRank === 2);

    expect(skillRecommendations.map((entry) => entry.action.targetRank)).toEqual(
      expect.arrayContaining([1, 2]),
    );
    expect(gammaRecommendation).toBeDefined();
    expect(gammaRecommendation!.action.requiredPromotionTier).toBe(4);
    expect(gammaRecommendation!.action.requiredLevel).toBe(80);
    expect(gammaRecommendation!.action.levelsToGain).toBe(79);
    expect(gammaRecommendation!.action.levelExpCost).toBe(1212340);
    expect(gammaRecommendation!.action.levelTCredCost).toBe(146440);
    expect(gammaRecommendation!.action.skillMaterialCosts).toEqual([
      { itemId: "protoprism", quantity: 12 },
      { itemId: "t-creds", quantity: 23000 },
      { itemId: "protohedron", quantity: 20 },
    ]);
    expect(gammaRecommendation!.action.promotionMaterialCosts).toEqual([
      { itemId: "protodisk", quantity: 33 },
      { itemId: "pink-bolete", quantity: 3 },
      { itemId: "t-creds", quantity: 126100 },
      { itemId: "red-bolete", quantity: 5 },
      { itemId: "protoset", quantity: 60 },
      { itemId: "ruby-bolete", quantity: 5 },
      { itemId: "metadiastima-photoemission-tube", quantity: 20 },
      { itemId: "bloodcap", quantity: 8 },
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
