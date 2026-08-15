import { describe, expect, it } from "vitest";

import assets from "../catalogs/2026-04-17-v1.2/assets.json";
import facilities from "../catalogs/2026-04-17-v1.2/facilities.json";
import gaps from "../catalogs/2026-04-17-v1.2/gaps.json";
import manifest from "../catalogs/2026-04-17-v1.2/manifest.json";
import operators from "../catalogs/2026-04-17-v1.2/operators.json";
import progression from "../catalogs/2026-04-17-v1.2/progression.json";
import recipes from "../catalogs/2026-04-17-v1.2/recipes.json";
import sources from "../catalogs/2026-04-17-v1.2/sources.json";
import {
  applySkportRosterImport,
  createStarterScenario,
  hydrateScenarioForCatalog,
  migrateScenario,
  parseSkportRosterImport,
  parseSkportRosterImportText,
  toGameCatalog,
  validateScenarioAgainstCatalog,
} from "@endfield/data";
import type { CatalogBundle } from "@endfield/domain";

const catalog = toGameCatalog({
  manifest,
  operators,
  facilities,
  recipes,
  sources,
  gaps,
  progression,
  assets,
} as CatalogBundle);

function character(name: string, id: string) {
  return {
    id,
    level: 67,
    evolvePhase: 3,
    potentialLevel: 2,
    charData: { id, name },
    weapon: {
      level: 50,
      refineLevel: 2,
      breakthroughLevel: 4,
      weaponData: { id: "wpn_test", name: "Test Weapon" },
    },
    userSkills: {
      skill_1: { skillId: "skill_1", level: 6, maxLevel: 12 },
    },
    bodyEquip: {
      equipId: "gear_test",
      equipData: {
        id: "gear_test",
        name: "Test Gear",
        level: { value: "40" },
        rarity: { value: "5" },
        suit: { name: "Test Set" },
      },
    },
    tacticalItem: {
      tacticalItemId: "tactical_test",
      tacticalItemData: {
        id: "tactical_test",
        name: "Test Tactical Item",
        rarity: { value: "4" },
      },
    },
  };
}

describe("SKPort roster import", () => {
  it("previews and applies a complete roster while preserving Base Skill selections", () => {
    const preview = parseSkportRosterImport({
      code: 0,
      data: {
        detail: {
          base: { charNum: 2, saveTime: 1_786_750_000 },
          chars: [
            character("Chen Qianyu", "char_chen"),
            character("Future Operator", "char_future"),
          ],
        },
      },
    }, catalog);

    expect(preview).toMatchObject({
      sourceOperatorCount: 2,
      reportedOperatorCount: 2,
      matchedOperatorCount: 1,
      completeRoster: true,
      weaponCount: 2,
      gearCount: 2,
      tacticalItemCount: 2,
      combatSkillCount: 2,
      unmatchedOperatorNames: ["Future Operator"],
    });

    const scenario = createStarterScenario(catalog);
    const chen = scenario.roster.find((entry) => entry.operatorId === "chen-qianyu")!;
    const ardelia = scenario.roster.find((entry) => entry.operatorId === "ardelia")!;
    chen.baseSkillStates[0]!.unlockedRank = 2;
    ardelia.owned = true;
    ardelia.level = 80;

    const result = applySkportRosterImport(scenario, preview, "2026-08-15T01:00:00.000Z");
    const importedChen = result.scenario.roster.find((entry) => entry.operatorId === "chen-qianyu")!;
    const clearedArdelia = result.scenario.roster.find((entry) => entry.operatorId === "ardelia")!;

    expect(importedChen).toMatchObject({
      owned: true,
      level: 67,
      promotionTier: 3,
      skportSnapshot: {
        sourceOperatorId: "char_chen",
        potentialLevel: 2,
        weapon: { id: "wpn_test", name: "Test Weapon", level: 50 },
        gear: [{ slot: "body", id: "gear_test", name: "Test Gear" }],
        tacticalItem: { id: "tactical_test", name: "Test Tactical Item" },
        combatSkills: [{ id: "skill_1", level: 6, maxLevel: 12 }],
      },
    });
    expect(importedChen.baseSkillStates[0]!.unlockedRank).toBe(2);
    expect(clearedArdelia).toMatchObject({ owned: false, level: 1, promotionTier: 0 });
    expect(result.scenario.rosterImport).toEqual({
      provider: "skport",
      importedAt: "2026-08-15T01:00:00.000Z",
      sourceSavedAt: "2026-08-14T23:26:40.000Z",
      sourceOperatorCount: 2,
      matchedOperatorCount: 1,
      completeRoster: true,
    });
    expect(result.clearedOperatorCount).toBe(1);

    const migration = migrateScenario(JSON.parse(JSON.stringify(result.scenario)));
    const hydrated = hydrateScenarioForCatalog(catalog, migration.scenario);
    expect(validateScenarioAgainstCatalog(catalog, hydrated.scenario).ok).toBe(true);
    expect(hydrated.scenario.roster.find((entry) => entry.operatorId === "chen-qianyu")?.skportSnapshot)
      .toMatchObject({ weapon: { name: "Test Weapon" }, gear: [{ name: "Test Gear" }] });
  });

  it("reads a card-detail response from HAR and preserves absent operators when the capture is partial", () => {
    const response = {
      data: {
        detail: {
          base: { charNum: 4 },
          chars: [character("Ardelia", "char_ardelia")],
        },
      },
    };
    const preview = parseSkportRosterImportText(JSON.stringify({
      log: {
        entries: [{
          request: { url: "https://zonai.skport.com/api/v1/game/endfield/card/detail?roleId=1" },
          response: { content: { mimeType: "application/json", text: JSON.stringify(response) } },
        }],
      },
    }), catalog);
    expect(preview.completeRoster).toBe(false);
    expect(preview.warnings[0]).toContain("reports 4 owned operators");

    const scenario = createStarterScenario(catalog);
    const chen = scenario.roster.find((entry) => entry.operatorId === "chen-qianyu")!;
    chen.owned = true;
    chen.level = 44;
    const result = applySkportRosterImport(scenario, preview);
    expect(result.scenario.roster.find((entry) => entry.operatorId === "chen-qianyu")).toMatchObject({
      owned: true,
      level: 44,
    });
    expect(result.clearedOperatorCount).toBe(0);
  });

  it("imports owned progression from the official Team Picks sync response", () => {
    const preview = parseSkportRosterImport({
      captureFormat: "endfield-dijiang-skport-roster-v2",
      characterCatalog: {
        data: {
          chars: [
            { id: "hash_chen", name: "Chen Qianyu" },
            { id: "hash_ardelia", name: "Ardelia" },
            { id: "hash_endministrator", name: "Endministrator" },
          ],
        },
      },
      weaponCatalog: { data: { weapons: [{ id: "weapon_hash", name: "Test Weapon" }] } },
      equipmentCatalog: { data: { equips: [{ id: "gear_hash", name: "Test Gear" }] } },
      tacticalItemCatalog: { data: { tacticalItems: [{ id: "item_hash", name: "Test Item" }] } },
      response: {
        code: 0,
        data: {
          userGameData: {
            userChars: {
              hash_chen: {
                charId: "hash_chen",
                owned: true,
                level: "67",
                evolvePhase: 3,
                userSkills: { skill_1: { skillId: "skill_1", level: "6" } },
              },
              hash_ardelia: {
                charId: "hash_ardelia",
                owned: false,
                level: "1",
                evolvePhase: 0,
                userSkills: {},
              },
              hash_endministrator: {
                charId: "hash_endministrator",
                owned: true,
                level: "90",
                evolvePhase: 4,
                userSkills: {},
              },
            },
            userWeapons: { weapon_hash: { weaponId: "weapon_hash", owned: true } },
            userEquips: { gear_hash: { equipId: "gear_hash", ownedCount: 3 } },
            userTacticalItems: { item_hash: { tacticalItemId: "item_hash", ownedCount: 2 } },
          },
        },
      },
    }, catalog);

    expect(preview).toMatchObject({
      sourceOperatorCount: 2,
      reportedOperatorCount: 2,
      matchedOperatorCount: 1,
      completeRoster: true,
      combatSkillCount: 1,
      weaponCount: 1,
      gearCount: 3,
      tacticalItemCount: 2,
      inventorySnapshot: {
        weapons: [{ id: "weapon_hash", name: "Test Weapon", ownedCount: 1 }],
        gear: [{ id: "gear_hash", name: "Test Gear", ownedCount: 3 }],
        tacticalItems: [{ id: "item_hash", name: "Test Item", ownedCount: 2 }],
      },
    });
    expect(preview.characters[0]).toMatchObject({
      sourceOperatorId: "hash_chen",
      catalogOperatorId: "chen-qianyu",
      level: 67,
      promotionTier: 3,
      snapshot: { combatSkills: [{ id: "skill_1", level: 6 }] },
    });
    expect(preview.warnings.join(" ")).toMatch(/Team Picks reports operator progression/i);
    expect(preview.unmatchedOperatorNames).toEqual([]);
    expect(preview.warnings.join(" ")).not.toMatch(/Endministrator|No catalog match/i);

    const imported = applySkportRosterImport(createStarterScenario(catalog), preview, "2026-08-15T02:00:00.000Z");
    expect(imported.scenario.rosterImport?.inventory).toEqual(preview.inventorySnapshot);
    expect(validateScenarioAgainstCatalog(catalog, imported.scenario).ok).toBe(true);
  });

  it("rejects general SKPort captures that do not contain roster data", () => {
    expect(() => parseSkportRosterImport({
      log: {
        entries: [{
          request: { url: "https://zonai.skport.com/web/v2/user" },
          response: { content: { text: "{}" } },
        }],
      },
    }, catalog)).toThrow(/general SKPort page capture does not include roster data/i);
  });

  it("refuses to apply a capture when none of its operators match the catalog", () => {
    expect(() => parseSkportRosterImport({
      data: {
        detail: {
          base: { charNum: 1 },
          chars: [character("Future Operator", "char_future")],
        },
      },
    }, catalog)).toThrow(/none of the SKPort operators matched/i);
  });
});
