import { describe, expect, it } from "vitest";

import {
  CURRENT_SCENARIO_FORMAT_VERSION,
  createStarterScenario,
  estimateLevelingRequirement,
  getCatalogBundleStatus,
  getPromotionTierRequirement,
  hydrateScenarioForCatalog,
  listSelectableRecipes,
  migrateScenario,
  validateScenarioAgainstCatalog,
} from "@endfield/data";
import { loadCatalogBundle, loadDefaultCatalog, loadScenarioFile, resolveRepoPath } from "@endfield/data/node";

describe("data services", () => {
  it("creates a starter scenario with the current format defaults", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);

    expect(scenario.scenarioFormatVersion).toBe(CURRENT_SCENARIO_FORMAT_VERSION);
    expect(scenario.catalogVersion).toBe(catalog.version);
    expect(scenario.options.upgradeRankingMode).toBe("balanced");
    expect(scenario.options.optimizationProfile).toBe("balanced");
    expect(scenario.options.optimizationEffort).toBe(18);
    expect(scenario.facilities.manufacturingCabins).toHaveLength(2);
    expect(scenario.facilities.manufacturingCabins[0]?.enabled).toBe(true);
    expect(scenario.facilities.manufacturingCabins[1]?.enabled).toBe(false);
    expect(scenario.facilities.growthChambers[0]?.enabled).toBe(false);
    expect(scenario.facilities.receptionRoom?.enabled).toBe(false);
  });

  it("migrates legacy scenarios by filling the new format fields", () => {
    const migration = migrateScenario({
      catalogVersion: "2026-03-20/v1.1-phase1",
      roster: [],
      facilities: {
        controlNexus: { level: 1 },
        manufacturingCabins: [],
        growthChambers: [],
        hardAssignments: [],
      },
      options: {
        planningMode: "simple",
        horizonHours: 24,
        maxFacilities: false,
      },
    });

    expect(migration.migrated).toBe(true);
    expect(migration.scenario.scenarioFormatVersion).toBe(CURRENT_SCENARIO_FORMAT_VERSION);
    expect(migration.scenario.options.upgradeRankingMode).toBe("balanced");
    expect(migration.scenario.options.optimizationProfile).toBe("balanced");
    expect(migration.scenario.options.optimizationEffort).toBe(18);
    expect(migration.scenario.facilities.manufacturingCabins).toHaveLength(2);
    expect(migration.scenario.facilities.growthChambers).toHaveLength(1);
    expect(migration.scenario.facilities.receptionRoom?.id).toBe("reception-1");
  });

  it("removes deprecated hard-assignment slot indexes during migration", () => {
    const migration = migrateScenario({
      scenarioFormatVersion: 1,
      catalogVersion: "2026-03-20/v1.1-phase1",
      roster: [],
      facilities: {
        controlNexus: { level: 1 },
        manufacturingCabins: [],
        growthChambers: [],
        receptionRoom: { id: "reception-1", enabled: false, level: 1 },
        hardAssignments: [
          { operatorId: "xaihi", roomId: "control_nexus", slotIndex: 0 },
        ],
      },
      options: {
        planningMode: "simple",
        horizonHours: 24,
        maxFacilities: false,
        upgradeRankingMode: "balanced",
      },
    });

    expect(migration.scenario.facilities.hardAssignments).toEqual([
      { operatorId: "xaihi", roomId: "control_nexus" },
    ]);
  });

  it("validates the updated example scenario set", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = await loadScenarioFile(resolveRepoPath("scenarios", "examples", "current-base.simple.json"));
    const validation = validateScenarioAgainstCatalog(catalog, scenario);

    expect(validation.ok).toBe(true);
    expect(validation.issues).toHaveLength(0);
  });

  it("clamps imported custom optimization effort into the supported range", () => {
    const migration = migrateScenario({
      scenarioFormatVersion: 1,
      catalogVersion: "2026-03-20/v1.1-phase1",
      roster: [],
      facilities: {
        controlNexus: { level: 1 },
        manufacturingCabins: [],
        growthChambers: [],
        hardAssignments: [],
      },
      options: {
        planningMode: "simple",
        horizonHours: 24,
        maxFacilities: false,
        optimizationProfile: "custom",
        optimizationEffort: 420,
      },
    });

    expect(migration.scenario.options.optimizationProfile).toBe("custom");
    expect(migration.scenario.options.optimizationEffort).toBe(100);
  });

  it("hydrates partial scenarios with the active catalog for editor use", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = await loadScenarioFile(resolveRepoPath("scenarios", "examples", "current-base.simple.json"));

    scenario.roster[0]!.baseSkillStates = [{ skillId: "blade-critique", unlockedRank: 1 }];
    scenario.facilities.manufacturingCabins = [scenario.facilities.manufacturingCabins[0]!];
    scenario.facilities.growthChambers = [];
    scenario.facilities.receptionRoom = undefined;

    const hydration = hydrateScenarioForCatalog(catalog, scenario);
    const chen = hydration.scenario.roster.find((entry) => entry.operatorId === "chen-qianyu");

    expect(hydration.hydrated).toBe(true);
    expect(hydration.stats.addedOperators).toBe(catalog.operators.length - scenario.roster.length);
    expect(hydration.stats.addedBaseSkillStates).toBe(2);
    expect(chen?.baseSkillStates.map((entry) => entry.skillId)).toContain("jadeworking");
    expect(hydration.scenario.roster.length).toBe(catalog.operators.length);
    expect(hydration.scenario.facilities.manufacturingCabins).toHaveLength(2);
    expect(hydration.scenario.facilities.growthChambers).toHaveLength(1);
    expect(hydration.scenario.facilities.receptionRoom?.id).toBe("reception-1");
  });

  it("expands shared progression defaults into runtime Base Skill costs and unlock hints", async () => {
    const catalog = await loadDefaultCatalog();
    const tangtang = catalog.operators.find((operator) => operator.id === "tangtang");

    expect(tangtang).toBeDefined();
    expect(tangtang?.baseSkills[0]?.ranks[0]?.materialCosts).toEqual([
      { itemId: "protoprism", quantity: 6 },
      { itemId: "t-creds", quantity: 1600 },
    ]);
    expect(tangtang?.baseSkills[0]?.ranks[0]?.unlockHint).toBe(
      "Raise Tangtang to Elite 1 Level 20 to unlock Supreme Chief beta.",
    );
    expect(tangtang?.baseSkills[1]?.ranks[1]?.materialCosts).toEqual([
      { itemId: "protohedron", quantity: 20 },
      { itemId: "t-creds", quantity: 20000 },
    ]);
    expect(tangtang?.baseSkills[1]?.ranks[1]?.unlockHint).toBe(
      "Raise Tangtang to Elite 4 Level 80 to unlock River's Daughter gamma.",
    );
  });

  it("resolves shared and operator-specific Promotion IV material requirements", async () => {
    const catalog = await loadDefaultCatalog();
    const requirement = getPromotionTierRequirement(catalog, "tangtang", 4);

    expect(requirement).toBeDefined();
    expect(requirement?.requiredLevel).toBe(80);
    expect(requirement?.materialCosts).toEqual([
      { itemId: "protoset", quantity: 36 },
      { itemId: "t-creds", quantity: 100000 },
      { itemId: "metadiastima-photoemission-tube", quantity: 20 },
      { itemId: "bloodcap", quantity: 8 },
    ]);
  });

  it("estimates level-gate requirements from shared milestone data", async () => {
    const catalog = await loadDefaultCatalog();
    const requirement = estimateLevelingRequirement(catalog, 30, 40);

    expect(requirement).toEqual({
      levelExpCost: 248540,
      levelTCredCost: 12540,
      levelMaterialCosts: [
        { itemId: "advanced-combat-record", quantity: 24 },
        { itemId: "intermediate-combat-record", quantity: 8 },
        { itemId: "elementary-combat-record", quantity: 3 },
        { itemId: "t-creds", quantity: 12540 },
      ],
      levelCostIsUpperBound: true,
    });
  });

  it("rejects recipes assigned to the wrong room kind and overflowing hard assignments", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = await loadScenarioFile(resolveRepoPath("scenarios", "examples", "current-base.simple.json"));

    scenario.facilities.manufacturingCabins[0]!.fixedRecipeId = "kalkonyx";
    scenario.facilities.hardAssignments.push({
      operatorId: "chen-qianyu",
      roomId: "reception-1",
    });
    scenario.facilities.hardAssignments.push({
      operatorId: "tangtang",
      roomId: "reception-1",
    });

    const validation = validateScenarioAgainstCatalog(catalog, scenario);
    expect(validation.ok).toBe(false);
    expect(validation.issues.some((issue) => issue.code === "invalid_recipe_room_kind")).toBe(true);
    expect(validation.issues.some((issue) => issue.code === "hard_assignment_room_overflow")).toBe(true);
  });

  it("rejects facilities that are still locked behind Control Nexus progression", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = createStarterScenario(catalog);

    scenario.facilities.manufacturingCabins[1]!.enabled = true;
    scenario.facilities.growthChambers[0]!.enabled = true;
    scenario.facilities.receptionRoom!.enabled = true;

    const validation = validateScenarioAgainstCatalog(catalog, scenario);

    expect(validation.ok).toBe(false);
    expect(validation.issues.some((issue) => issue.path === "facilities.manufacturingCabins.mfg-2.enabled")).toBe(true);
    expect(validation.issues.some((issue) => issue.path === "facilities.growthChambers.growth-1.enabled")).toBe(true);
    expect(validation.issues.some((issue) => issue.path === "facilities.receptionRoom.enabled")).toBe(true);
  });

  it("uses the verified Manufacturing Cabin recipe unlock tiers", async () => {
    const catalog = await loadDefaultCatalog();

    expect(listSelectableRecipes(catalog, "manufacturing_cabin", 1).map((recipe) => recipe.name)).toEqual([
      "Arms Inspector",
      "Elementary Combat Record",
    ]);
    expect(listSelectableRecipes(catalog, "manufacturing_cabin", 2).map((recipe) => recipe.name)).toEqual([
      "ARMS INSP Kit",
      "Arms Inspector",
      "Elementary Cognitive Carrier",
      "Elementary Combat Record",
      "Intermediate Combat Record",
    ]);
    expect(listSelectableRecipes(catalog, "manufacturing_cabin", 3).map((recipe) => recipe.name)).toEqual([
      "Advanced Cognitive Carrier",
      "Advanced Combat Record",
      "ARMS INSP Kit",
      "Arms INSP Set",
      "Arms Inspector",
      "Elementary Cognitive Carrier",
      "Elementary Combat Record",
      "Intermediate Combat Record",
    ]);
  });

  it("stores exact Manufacturing Cabin load and duration values from in-game screenshots", async () => {
    const catalog = await loadDefaultCatalog();
    const indexed = new Map(catalog.recipes.map((recipe) => [recipe.id, recipe]));

    expect(indexed.get("elementary-combat-record")?.loadCost).toBe(1);
    expect(indexed.get("elementary-combat-record")?.baseDurationMinutes).toBe(15.33);
    expect(indexed.get("intermediate-combat-record")?.loadCost).toBe(2);
    expect(indexed.get("intermediate-combat-record")?.baseDurationMinutes).toBe(70);
    expect(indexed.get("elementary-cognitive-carrier")?.loadCost).toBe(5);
    expect(indexed.get("elementary-cognitive-carrier")?.baseDurationMinutes).toBe(175);
    expect(indexed.get("advanced-combat-record")?.loadCost).toBe(12);
    expect(indexed.get("advanced-combat-record")?.baseDurationMinutes).toBe(586.67);
    expect(indexed.get("advanced-cognitive-carrier")?.loadCost).toBe(30);
    expect(indexed.get("advanced-cognitive-carrier")?.baseDurationMinutes).toBe(1466.67);
    expect(indexed.get("arms-inspector")?.loadCost).toBe(1);
    expect(indexed.get("arms-inspector")?.baseDurationMinutes).toBe(15.33);
    expect(indexed.get("arms-insp-kit")?.loadCost).toBe(2);
    expect(indexed.get("arms-insp-kit")?.baseDurationMinutes).toBe(70);
    expect(indexed.get("arms-insp-set")?.loadCost).toBe(12);
    expect(indexed.get("arms-insp-set")?.baseDurationMinutes).toBe(586.67);
  });

  it("uses the verified Growth Chamber recipe unlock tiers", async () => {
    const catalog = await loadDefaultCatalog();

    expect(listSelectableRecipes(catalog, "growth_chamber", 1).map((recipe) => recipe.name)).toEqual([
      "Kalkodendra",
      "Kalkonyx",
      "Pink Bolete",
    ]);
    expect(listSelectableRecipes(catalog, "growth_chamber", 2).map((recipe) => recipe.name)).toEqual([
      "Auronyx",
      "Chrysodendra",
      "Kalkodendra",
      "Kalkonyx",
      "Pink Bolete",
      "Red Bolete",
    ]);
    expect(listSelectableRecipes(catalog, "growth_chamber", 3).map((recipe) => recipe.name)).toEqual([
      "Auronyx",
      "Blighted Jadeleaf",
      "Bloodcap",
      "Chrysodendra",
      "Cosmagaric",
      "False Aggela",
      "Igneosite",
      "Kalkodendra",
      "Kalkonyx",
      "Pink Bolete",
      "Red Bolete",
      "Ruby Bolete",
      "Umbronyx",
      "Vitrodendra",
      "Wulingstone",
    ]);
  });

  it("stores exact Growth Chamber durations and outputs from rebuild data", async () => {
    const catalog = await loadDefaultCatalog();
    const indexed = new Map(catalog.recipes.map((recipe) => [recipe.id, recipe]));

    expect(indexed.get("pink-bolete")).toMatchObject({ roomLevel: 1, baseDurationMinutes: 1041.67, outputAmount: 1 });
    expect(indexed.get("kalkonyx")).toMatchObject({ roomLevel: 1, baseDurationMinutes: 1041.67, outputAmount: 1 });
    expect(indexed.get("kalkodendra")).toMatchObject({ roomLevel: 1, baseDurationMinutes: 1041.67, outputAmount: 3 });
    expect(indexed.get("red-bolete")).toMatchObject({ roomLevel: 2, baseDurationMinutes: 1666.67, outputAmount: 1 });
    expect(indexed.get("auronyx")).toMatchObject({ roomLevel: 2, baseDurationMinutes: 1666.67, outputAmount: 1 });
    expect(indexed.get("chrysodendra")).toMatchObject({ roomLevel: 2, baseDurationMinutes: 1666.67, outputAmount: 3 });
    expect(indexed.get("wulingstone")).toMatchObject({ roomLevel: 3, baseDurationMinutes: 7500, outputAmount: 1 });
    expect(indexed.get("igneosite")).toMatchObject({ roomLevel: 3, baseDurationMinutes: 7500, outputAmount: 1 });
    expect(indexed.get("umbronyx")).toMatchObject({ roomLevel: 3, baseDurationMinutes: 3666.67, outputAmount: 1 });
    expect(indexed.get("false-aggela")).toMatchObject({ roomLevel: 3, baseDurationMinutes: 7500, outputAmount: 3 });
    expect(indexed.get("blighted-jadeleaf")).toMatchObject({ roomLevel: 3, baseDurationMinutes: 7500, outputAmount: 3 });
    expect(indexed.get("vitrodendra")).toMatchObject({ roomLevel: 3, baseDurationMinutes: 3666.67, outputAmount: 3 });
    expect(indexed.get("cosmagaric")).toMatchObject({ roomLevel: 3, baseDurationMinutes: 7500, outputAmount: 1 });
    expect(indexed.get("bloodcap")).toMatchObject({ roomLevel: 3, baseDurationMinutes: 7500, outputAmount: 1 });
    expect(indexed.get("ruby-bolete")).toMatchObject({ roomLevel: 3, baseDurationMinutes: 3666.67, outputAmount: 1 });
  });

  it("distinguishes catalog integrity from release completeness", async () => {
    const bundle = await loadCatalogBundle();
    const sanitized = structuredClone(bundle);
    sanitized.manifest.notes = [];
    sanitized.gaps.gaps = [];
    sanitized.manifest.counts = { ...getCatalogBundleStatus(sanitized).summary };

    const cleanStatus = getCatalogBundleStatus(sanitized);
    expect(cleanStatus.countMismatches).toHaveLength(0);
    expect(cleanStatus.releaseReady).toBe(true);

    const seeded = structuredClone(sanitized);
    seeded.manifest.notes = ["This is a seed bundle for implementation validation."];
    expect(getCatalogBundleStatus(seeded).releaseReady).toBe(false);

    const mismatched = structuredClone(sanitized);
    mismatched.manifest.counts = {
      ...(mismatched.manifest.counts ?? {}),
      operators: 999,
    };
    expect(getCatalogBundleStatus(mismatched).countMismatches).toHaveLength(1);
  });
});
