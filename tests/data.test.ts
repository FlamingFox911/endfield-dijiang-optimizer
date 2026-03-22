import { describe, expect, it } from "vitest";

import {
  CURRENT_SCENARIO_FORMAT_VERSION,
  createStarterScenario,
  estimateLevelingRequirement,
  getCatalogBundleStatus,
  getPromotionTierRequirement,
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
  });

  it("validates the updated example scenario set", async () => {
    const catalog = await loadDefaultCatalog();
    const scenario = await loadScenarioFile(resolveRepoPath("scenarios", "examples", "current-base.simple.json"));
    const validation = validateScenarioAgainstCatalog(catalog, scenario);

    expect(validation.ok).toBe(true);
    expect(validation.issues).toHaveLength(0);
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
      slotIndex: 1,
    });

    const validation = validateScenarioAgainstCatalog(catalog, scenario);
    expect(validation.ok).toBe(false);
    expect(validation.issues.some((issue) => issue.code === "invalid_recipe_room_kind")).toBe(true);
    expect(validation.issues.some((issue) => issue.code === "hard_assignment_slot_oob")).toBe(true);
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
