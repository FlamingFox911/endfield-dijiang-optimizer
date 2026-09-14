import { describe, expect, it } from "vitest";
import { mergeLiveRosterUpdate, parseLiveRosterUpdate } from "@endfield/data";
import { loadDefaultCatalog } from "@endfield/data/node";
import audit from "./fixtures/base-skill-audit.json";
import { buildOfficialPrimaryLiveRosterUpdate } from "../scripts/sync-live-roster";
import { correctSkportBaseSkill } from "../scripts/skport-skill-corrections";

import {
  buildSkportRoster,
  createSkportSign,
  isSkportPreviewItem,
  parseSkportModifier,
} from "../scripts/sync-skport-roster";

function textBlock(text: string, parentId: string) {
  return {
    kind: "text",
    parentId,
    text: {
      inlineElements: [{ kind: "text", text: { text } }],
    },
  };
}

function skillDocument(
  documentId: string,
  first: [string, string, string],
  second: [string, string, string],
  effectHeader = "Talent Effect",
) {
  const rowIds = ["header", "first", "second"];
  const columnIds = ["name", "effect", "requirement", "cost"];
  const values = [
    ["", effectHeader, "Requirements", "Cost"],
    first,
    second,
  ];
  const blockMap: Record<string, any> = {};
  const cellMap: Record<string, any> = {};
  rowIds.forEach((rowId, rowIndex) => {
    columnIds.forEach((columnId, columnIndex) => {
      const cellId = `${rowId}_${columnId}`;
      const blockId = `${documentId}_${cellId}`;
      blockMap[blockId] = textBlock(values[rowIndex]?.[columnIndex] ?? "", cellId);
      cellMap[cellId] = { childIds: [blockId] };
    });
  });
  blockMap.table = {
    kind: "table",
    table: { rowIds, columnIds, cellMap },
  };
  return { blockMap };
}

function promotionDocument() {
  const rowIds = ["header", "promotion"];
  const columnIds = ["name", "effect", "requirement", "cost"];
  const blockMap: Record<string, any> = {
    header_name: textBlock("", "header_name"),
    header_effect: textBlock("After Activation", "header_effect"),
    header_requirement: textBlock("Requirements", "header_requirement"),
    header_cost: textBlock("Cost", "header_cost"),
    promotion_name: textBlock("Promotion IV", "promotion_name"),
    promotion_effect: textBlock("Raise level cap", "promotion_effect"),
    promotion_requirement: textBlock("Operator Lv.80", "promotion_requirement"),
    promotion_cost: {
      kind: "text",
      text: {
        inlineElements: [
          { kind: "entry", entry: { id: "protoset", count: "36" } },
          { kind: "entry", entry: { id: "special", count: "20" } },
          { kind: "entry", entry: { id: "plant", count: "8" } },
          { kind: "entry", entry: { id: "credits", count: "100000" } },
        ],
      },
    },
  };
  const cellMap = Object.fromEntries(
    rowIds.flatMap((rowId) => columnIds.map((columnId) => [
      `${rowId}_${columnId}`,
      { childIds: [`${rowId}_${columnId}`] },
    ])),
  );
  blockMap.table = { kind: "table", table: { rowIds, columnIds, cellMap } };
  return { blockMap };
}

function officialSourceData() {
  return {
    operatorItems: [{
      itemId: "1041",
      name: "Liino",
      brief: {
        cover: "https://static.skport.com/liino.png",
        subTypeList: [
          { subTypeId: "10000", value: "rarity-six" },
          { subTypeId: "10200", value: "class-supporter" },
        ],
      },
    }],
    details: [{
      itemId: "1041",
      name: "Liino",
      document: {
        documentMap: {
          reception: skillDocument(
            "reception",
            ["Idol Passion β", "Assign to Reception Room to slow Mood Drop of all operators in it by 14%", "Promote to E1 to unlock"],
            ["Idol Passion γ", "Assign to Reception Room to slow Mood Drop of all operators in it by 18%", "Promote to E3 to unlock"],
            "Base Skill Effect",
          ),
          nexus: skillDocument(
            "nexus",
            ["Stage Vibe That Lingers β", "Assign to\u00a0Control Nexus\u00a0to grant all operators' Mood Regen +12%", "Promote to E2 to unlock"],
            ["Stage Vibe That Lingers γ", "Assign to\u00a0Control Nexus\u00a0to grant all operators' Mood Regen +16%", "Promote to E4 to unlock"],
            "Advancement Effect",
          ),
          promotion: promotionDocument(),
        },
        widgetCommonMap: {
          skills: {
            tabList: [
              { tabId: "reception-tab", icon: "https://static.skport.com/reception.png" },
              { tabId: "nexus-tab", icon: "https://static.skport.com/nexus.png" },
            ],
            tabDataMap: {
              "reception-tab": { content: "reception" },
              "nexus-tab": { content: "nexus" },
            },
          },
        },
      },
    }],
    entryNamesById: {
      protoset: "Protoset",
      special: "Quadrant Fitting Fluid",
      plant: "Talos Cap",
      credits: "T-Creds",
    },
    tagNamesById: {
      "rarity-six": "6★",
      "class-supporter": "Supporter",
    },
    sourceUpdatedAt: "2026-08-09T04:00:00.000Z",
  };
}

describe("official SKPORT roster source", () => {
  it("reproduces the public client's anonymous request signature", () => {
    expect(createSkportSign(
      "/web/v1/wiki/item/catalog",
      "typeMainId=1&typeSubId=1",
      "1786313343",
      "636fb7b7512d821d88a5831937ec6453",
    )).toBe("30c35ed9ba10a9b88ec2fd0b293657a4");
  });

  it("maps percentage and implicit clue-rate descriptions", () => {
    expect(parseSkportModifier(
      "Assign to Reception Room to grant operators a small Clue 3 Rate-UP: HAS",
    )).toEqual({
      metric: "clue_rate_up",
      appliesTo: "clue_3",
      value: 1,
      unit: "tier",
    });
    expect(parseSkportModifier(
      "Assign to Control Nexus to grant all operators' Mood Regen +16%",
    )).toEqual({
      metric: "mood_regen",
      appliesTo: "all",
      value: 16,
      unit: "percent",
    });
  });

  it("normalizes official Base Skill header variants, non-breaking spaces, and Promotion IV materials", () => {
    const result = buildSkportRoster(officialSourceData(), "2026-08-09T12:00:00.000Z");

    expect(result.warnings).toEqual([]);
    expect(result.source.confidence).toBe("official");
    expect(result.operators).toMatchObject([{
      id: "liino",
      name: "Liino",
      rarity: 6,
      className: "Supporter",
      baseSkills: [
        {
          id: "idol-passion",
          facilityKind: "reception_room",
          ranks: [
            { label: "beta", modifiers: [{ metric: "mood_drop_reduction", value: 14 }] },
            { label: "gamma", modifiers: [{ metric: "mood_drop_reduction", value: 18 }] },
          ],
        },
        {
          id: "stage-vibe-that-lingers",
          facilityKind: "control_nexus",
          ranks: [
            { label: "beta", modifiers: [{ metric: "mood_regen", value: 12 }] },
            { label: "gamma", modifiers: [{ metric: "mood_regen", value: 16 }] },
          ],
        },
      ],
    }]);
    expect(result.promotionOverrides).toMatchObject([{
      operatorId: "liino",
      promotionTier: 4,
      additionalMaterialCosts: [
        { itemId: "quadrant-fitting-fluid", quantity: 20 },
        { itemId: "talos-cap", quantity: 8 },
      ],
    }]);
  });

  it("ignores announced preview operators without weakening released-operator validation", () => {
    const data: any = officialSourceData();
    const preview = {
      itemId: "1174",
      name: "Purrchena",
      brief: {
        cover: "https://static.skport.com/purrchena.png",
        dotType: "label_type_preview",
      },
    };
    data.operatorItems.push(preview, {
      itemId: "released-without-details",
      name: "Released Without Details",
      brief: {
        cover: "https://static.skport.com/released.png",
        dotType: "",
      },
    });

    const result = buildSkportRoster(data, "2026-08-22T12:00:00.000Z");

    expect(isSkportPreviewItem(preview)).toBe(true);
    expect(result.operators.map((operator) => operator.name)).toEqual(["Liino"]);
    expect(result.warnings).toEqual([
      "Official operator 'Released Without Details' has no detail payload.",
    ]);
  });

  it("matches all 60 audited skills after parsing and merging the captured official rows", async () => {
    const catalog = await loadDefaultCatalog();
    expect(audit.operators).toHaveLength(30);
    for (const operator of audit.operators) {
      const data = officialSourceData();
      data.operatorItems[0]!.name = operator.name;
      const documents = data.details[0]!.document.documentMap;
      const [first, second] = operator.officialRows;
      documents.reception = skillDocument("reception", first![0] as [string, string, string], first![1] as [string, string, string]);
      documents.nexus = skillDocument("nexus", second![0] as [string, string, string], second![1] as [string, string, string]);
      const update = buildOfficialPrimaryLiveRosterUpdate(data, undefined, `${audit.retrievedOn}T12:00:00.000Z`);
      expect(update.warnings, operator.name).toEqual([]);
      expect(parseLiveRosterUpdate(update)).toBe(update);
      const merged = mergeLiveRosterUpdate(catalog, update).catalog;
      const actual = merged.operators.find((entry) => entry.id === operator.id)!;
      expect(actual.baseSkills, operator.name).toMatchObject(operator.expectedSkills);
      actual.baseSkills.forEach((skill, slot) => skill.ranks.forEach((rank, index) => {
        expect(rank.rank).toBe(index + 1);
        expect(rank.unlockHint).toContain(`Elite ${slot + 1 + index * 2}`);
      }));
      // The offline bundle must match the same reference for every bundled operator.
      const bundled = catalog.operators.find((entry) => entry.id === operator.id);
      if (bundled) expect(bundled.baseSkills, `${operator.name} offline`).toMatchObject(operator.expectedSkills);
    }
  });

  it("leaves corrected upstream ranks and future balance changes intact", async () => {
    const ember = (await loadDefaultCatalog()).operators.find((operator) => operator.id === "ember")!;
    const skill = ember.baseSkills[0]!;
    expect(correctSkportBaseSkill(ember.id, skill)).toBe(skill);
    const changed = structuredClone(skill);
    changed.ranks[0]!.label = "alpha";
    changed.ranks[1]!.label = "beta";
    changed.ranks[0]!.modifiers[0]!.value = 25;
    expect(correctSkportBaseSkill(ember.id, changed)).toBe(changed);
  });
});
