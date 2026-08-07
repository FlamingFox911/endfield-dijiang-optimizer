import { describe, expect, it } from "vitest";

import {
  mergeLiveRosterUpdate,
  parseLiveRosterUpdate,
} from "@endfield/data";
import { loadDefaultCatalog } from "@endfield/data/node";

import {
  buildLiveRosterUpdate,
  mapFactorySkillModifier,
} from "../scripts/sync-live-roster";

const generatedAt = "2026-08-06T12:00:00.000Z";

function rawSkill(
  id: string,
  nameId: string,
  level: 1 | 2,
  skillIndex: 0 | 1,
  overrides: Partial<{
    effectType: number;
    icon: string;
    parameters: Array<{ valueStringList: string[] }>;
    roomType: number;
  }> = {},
) {
  return {
    raw: {
      id,
      name: { id: nameId },
      desc: { id: `${nameId}-desc` },
      effectType: overrides.effectType ?? (skillIndex === 0 ? 7 : 3),
      icon: overrides.icon ?? (skillIndex === 0 ? "facskill_spaceship_manufacture_efficiency" : "facskill_spaceship_plant_mineral"),
      level,
      parameters: overrides.parameters ?? (skillIndex === 0
        ? [{ valueStringList: [level === 1 ? "0.2" : "0.3"] }, { valueStringList: ["1"] }]
        : [{ valueStringList: [level === 1 ? "0.2" : "0.3"] }, { valueStringList: ["3"] }]),
      roomType: overrides.roomType ?? (skillIndex === 0 ? 1 : 2),
      sortId: skillIndex * 2 + level,
    },
    list: { skillId: id, skillIndex },
  };
}

function sourceData() {
  const entries = [
    rawSkill("test_1_1", "first-alpha", 1, 0),
    rawSkill("test_1_2", "first-beta", 2, 0),
    rawSkill("test_2_1", "second-beta", 1, 1),
    rawSkill("test_2_2", "second-gamma", 2, 1),
  ];
  return {
    summaries: [],
    details: [{
      charId: "chr_0999_test",
      engName: "Test Operator",
      rarity: 6,
      profession: 0,
      slug: "test-operator",
      factorySkills: {
        skills: Object.fromEntries(entries.map((entry) => [entry.raw.id, entry.raw])),
        skillList: entries.map((entry) => entry.list),
      },
      talents: {
        charBreakCostMap: {
          charBreak70: {
            requiredItem: [
              { count: 36, id: "item_char_break_stage_3_4" },
              { count: 20, id: "item_char_skill_specialize_5" },
              { count: 8, id: "item_plant_mushroom_2_3" },
              { count: 100000, id: "item_gold" },
            ],
          },
        },
      },
    }],
    characterTranslations: {
      "first-alpha": "First Skill α",
      "first-beta": "First Skill β",
      "second-beta": "Second Skill β",
      "second-gamma": "Second Skill γ",
    },
    factoryTranslations: {
      "talos-cap-name": "Talos Cap",
      "crimson-spearleaf-name": "Crimson Spearleaf",
      "protocolith-name": "Protocolith",
    },
    factoryItems: [
      { id: "item_plant_mushroom_2_3", name: { id: "talos-cap-name" }, rarity: 5 },
      { id: "item_plant_crylplant_2_3", name: { id: "crimson-spearleaf-name" }, rarity: 5 },
      { id: "item_plant_spcstone_2_3", name: { id: "protocolith-name" }, rarity: 5 },
    ],
    sourceUpdatedAt: "2026-08-06T10:00:00.000Z",
  };
}

describe("automatic live roster updates", () => {
  it("maps the known Dijiang source effect types", () => {
    expect(mapFactorySkillModifier({
      id: "clue",
      effectType: 6,
      icon: "clue",
      level: 2,
      parameters: [{ valueStringList: ["5"] }, { valueStringList: ["2"] }],
      roomType: 5,
      sortId: 1,
    })).toEqual({
      metric: "clue_rate_up",
      appliesTo: "clue_5",
      value: 12,
      unit: "percent",
    });
  });

  it("normalizes a source character and its Elite IV materials", () => {
    const update = buildLiveRosterUpdate(sourceData(), generatedAt);
    expect(update.warnings).toEqual([]);
    expect(update.operators).toHaveLength(1);
    expect(update.operators[0]).toMatchObject({
      id: "test-operator",
      name: "Test Operator",
      className: "Guard",
      baseSkills: [
        {
          id: "first-skill",
          facilityKind: "manufacturing_cabin",
          ranks: [
            { rank: 1, label: "alpha", modifiers: [{ metric: "production_efficiency", appliesTo: "operator_exp", value: 20 }] },
            { rank: 2, label: "beta", modifiers: [{ metric: "production_efficiency", appliesTo: "operator_exp", value: 30 }] },
          ],
        },
        {
          id: "second-skill",
          facilityKind: "growth_chamber",
        },
      ],
    });
    expect(update.promotionOverrides[0]?.additionalMaterialCosts).toEqual([
      { itemId: "triphasic-nanoflake", quantity: 20 },
      { itemId: "talos-cap", quantity: 8 },
    ]);
    expect(update.recipes).toMatchObject([
      { id: "talos-cap", productKind: "fungal", roomLevel: 3, baseDurationMinutes: 7500, outputAmount: 1 },
      { id: "crimson-spearleaf", productKind: "vitrified_plant", roomLevel: 3, baseDurationMinutes: 7500, outputAmount: 3 },
      { id: "protocolith", productKind: "rare_mineral", roomLevel: 3, baseDurationMinutes: 7500, outputAmount: 1 },
    ]);
    expect(update.assets.map((asset) => asset.id)).toEqual([
      "material-talos-cap-icon",
      "material-crimson-spearleaf-icon",
      "material-protocolith-icon",
    ]);
    expect(parseLiveRosterUpdate(update)).toBe(update);
  });

  it("keeps the content hash stable across timestamp-only rebuilds", () => {
    const first = buildLiveRosterUpdate(sourceData(), generatedAt);
    const regenerated = buildLiveRosterUpdate(sourceData(), "2026-08-07T12:00:00.000Z");
    const changedData = sourceData();
    (changedData.details[0]!.factorySkills.skills.test_1_1.parameters[0]!.valueStringList[0] as string) = "0.25";
    const changed = buildLiveRosterUpdate(changedData, "2026-08-07T12:00:00.000Z");

    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(regenerated.generatedAt).not.toBe(first.generatedAt);
    expect(regenerated.source.retrievedOn).not.toBe(first.source.retrievedOn);
    expect(regenerated.contentHash).toBe(first.contentHash);
    expect(changed.contentHash).not.toBe(first.contentHash);
  });

  it("hydrates shared skill costs and merges new operators without changing the catalog version", async () => {
    const catalog = await loadDefaultCatalog();
    const update = buildLiveRosterUpdate(sourceData(), generatedAt);
    const merged = mergeLiveRosterUpdate(catalog, update);
    const operator = merged.catalog.operators.find((entry) => entry.id === "test-operator");

    expect(merged.addedOperatorIds).toEqual(["test-operator"]);
    expect(merged.catalog.version).toBe(catalog.version);
    expect(operator?.baseSkills[0]?.ranks[0]?.materialCosts).toEqual(
      catalog.progression.baseSkillRanks.find((entry) => entry.skillSlot === 1 && entry.rank === 1)?.materialCosts,
    );
    expect(merged.catalog.progression.promotionOverrides).toContainEqual(update.promotionOverrides[0]);
    expect(merged.addedRecipeIds).toEqual(["talos-cap", "crimson-spearleaf", "protocolith"]);
    expect(merged.catalog.recipes.find((recipe) => recipe.id === "protocolith")).toMatchObject({
      productKind: "rare_mineral",
      dataConfidence: "provisional",
    });
    expect(operator?.baseSkills.every((skill) => !skill.icon.path.startsWith("https://"))).toBe(true);
  });

  it("rejects an unsupported update before it reaches the optimizer", () => {
    const update = buildLiveRosterUpdate(sourceData(), generatedAt) as any;
    update.operators[0].baseSkills[0].ranks[0].modifiers[0].metric = "mystery_effect";
    expect(() => parseLiveRosterUpdate(update)).toThrow("unsupported metric");
  });
});
