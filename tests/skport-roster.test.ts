import { describe, expect, it } from "vitest";
import { getPromotionTierRequirement, mergeLiveRosterUpdate, parseLiveRosterUpdate, remainingUpgradeMaterials } from "@endfield/data";
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

    const result = buildSkportRoster(data, "2026-08-22T12:00:00.000Z", new Set(["released-without-details"]));

    expect(isSkportPreviewItem(preview)).toBe(true);
    expect(result.operators.map((operator) => operator.name)).toEqual(["Liino"]);
    expect(result.warnings).toEqual([
      "Official operator 'Released Without Details' has no detail payload.",
    ]);
  });

  it.each([
    "Warp Plasma-Coated Slide*20",
    "Warp Plasma-Coated Slide × 20",
    "Warp Plasma-Coated Slide x20",
    "Warp Plasma-Coated Slide X 20",
    "Warp Plasma-Coated Slide＊20",
    "20 × Warp Plasma-Coated Slide",
    "20x Warp Plasma-Coated Slide",
    "Warp Plasma-Coated Slide\n*20",
  ])("discovers an unindexed material from an explicit official cost: %s", (text) => {
    const data = officialSourceData();
    data.operatorItems[0]!.name = "Si";
    data.details[0]!.document.documentMap.promotion.blockMap.promotion_cost.text.inlineElements[1] = {
      kind: "text", text: { text },
    };
    const result = buildSkportRoster(data);
    expect(result.warnings).toEqual([]);
    expect(result.pendingOperators).toEqual([]);
    expect(result.operators[0]?.id).toBe("si");
    expect(result.promotionOverrides[0]?.additionalMaterialCosts).toEqual([
      { itemId: "warp-plasma-coated-slide", quantity: 20 },
      { itemId: "talos-cap", quantity: 8 },
    ]);
  });

  it("parses entirely plain-text material lists and comma-grouped quantities", () => {
    const data = officialSourceData();
    data.details[0]!.document.documentMap.promotion.blockMap.promotion_cost.text.inlineElements = [{
      kind: "text", text: { text: "Protoset*36\nFuture Nanoflake Mk. 4*20; 8×Future Crystal, T-Creds*100,000" },
    }];
    const result = buildSkportRoster(data);
    expect(result.warnings).toEqual([]);
    expect(result.pendingOperators).toEqual([]);
    expect(result.promotionOverrides[0]?.additionalMaterialCosts).toEqual([
      { itemId: "future-nanoflake-mk-4", quantity: 20 },
      { itemId: "future-crystal", quantity: 8 },
    ]);
  });

  it.each(["text", "linked"])("preserves numbered materials in official %s costs", (format) => {
    const data = officialSourceData();
    if (format === "text") {
      data.details[0]!.document.documentMap.promotion.blockMap.promotion_cost.text.inlineElements = [{
        kind: "text", text: { text: "Future Material Ⅰ*20; Future Material Ⅱ*8" },
      }];
    } else {
      Object.assign(data.entryNamesById, { special: "Future Material Ⅰ", plant: "Future Material Ⅱ" });
    }
    const result = buildSkportRoster(data);
    expect(result.warnings).toEqual([]);
    expect(result.promotionOverrides[0]?.additionalMaterialCosts).toEqual([
      { itemId: "future-material-i", quantity: 20 },
      { itemId: "future-material-ii", quantity: 8 },
    ]);
  });

  it("joins formatted inline spans without losing material names or quantities", () => {
    const data = officialSourceData();
    const elements = data.details[0]!.document.documentMap.promotion.blockMap.promotion_cost.text.inlineElements;
    elements.splice(1, 1, ...["New ", "Material", " × ", "2", "0"].map((text) => ({ kind: "text", text: { text } })));
    const result = buildSkportRoster(data);
    expect(result.warnings).toEqual([]);
    expect(result.promotionOverrides[0]?.additionalMaterialCosts[0]).toEqual({ itemId: "new-material", quantity: 20 });
  });

  it("accepts paragraph-separated costs and punctuation between linked and plain-text items", () => {
    const data = officialSourceData();
    const blocks = data.details[0]!.document.documentMap.promotion.blockMap;
    blocks.promotion_cost.text.inlineElements = [
      { kind: "entry", entry: { id: "protoset", count: "36" } },
      { kind: "text", text: { text: ", " } },
      { kind: "entry", entry: { id: "plant", count: "8" } },
      { kind: "text", text: { text: "; " } },
    ];
    blocks.new_material = textBlock("New Lattice*20", "promotion_cost");
    blocks.table.table.cellMap.promotion_cost.childIds.push("new_material");
    const result = buildSkportRoster(data);
    expect(result.warnings).toEqual([]);
    expect(result.promotionOverrides[0]?.additionalMaterialCosts).toEqual([
      { itemId: "talos-cap", quantity: 8 }, { itemId: "new-lattice", quantity: 20 },
    ]);
  });

  it("keeps costs and the semantic hash stable when a new material becomes indexed and linked", () => {
    const data = officialSourceData();
    const elements = data.details[0]!.document.documentMap.promotion.blockMap.promotion_cost.text.inlineElements;
    elements[1] = { kind: "text", text: { text: "Future's Lattice*20" } };
    const plain = buildOfficialPrimaryLiveRosterUpdate(data, undefined, "2026-10-16T12:00:00.000Z");
    Object.assign(data.entryNamesById, { "future-material": "Future's Lattice" });
    elements[1] = { kind: "entry", entry: { id: "future-material", count: "20" } };
    const linked = buildOfficialPrimaryLiveRosterUpdate(data, undefined, "2026-10-17T12:00:00.000Z");
    expect(plain.warnings).toEqual([]);
    expect(linked.warnings).toEqual([]);
    expect(linked.promotionOverrides[0]?.additionalMaterialCosts).toEqual(plain.promotionOverrides[0]?.additionalMaterialCosts);
    expect(linked.contentHash).toBe(plain.contentHash);
  });

  it("does not double-count linked material costs repeated as text", () => {
    const data = officialSourceData();
    data.details[0]!.document.documentMap.promotion.blockMap.promotion_cost.text.inlineElements.splice(2, 0, {
      kind: "text", text: { text: "Quadrant Fitting Fluid*20" },
    });
    const result = buildSkportRoster(data);
    expect(result.warnings).toEqual([]);
    expect(result.promotionOverrides[0]?.additionalMaterialCosts).toEqual([
      { itemId: "quadrant-fitting-fluid", quantity: 20 }, { itemId: "talos-cap", quantity: 8 },
    ]);
  });

  it.each([
    "Unknown Material", "Unknown Material*0", "Unknown Material*-1", "Unknown Material*1.5",
    "Unknown Material*9,007,199,254,740,992", "Unknown Material*1,00", "Unknown Material*20 or Other Material*20",
    "Quadrant Fitting Fluid*21",
  ])("rejects missing, invalid, ambiguous, or conflicting material quantities: %s", (text) => {
    const data = officialSourceData();
    data.details[0]!.document.documentMap.promotion.blockMap.promotion_cost.text.inlineElements.splice(2, 0, {
      kind: "text", text: { text },
    });
    const result = buildSkportRoster(data);
    expect(result.operators).toEqual([]);
    expect(result.promotionOverrides).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("never silently discards unresolved linked material identities", () => {
    const data = officialSourceData();
    data.details[0]!.document.documentMap.promotion.blockMap.promotion_cost.text.inlineElements.push({
      kind: "entry", entry: { id: "not-yet-indexed", count: "20" },
    });
    const result = buildSkportRoster(data);
    expect(result.operators).toEqual([]);
    expect(result.pendingOperators).toMatchObject([{ id: "liino", reason: expect.stringContaining("not-yet-indexed") }]);
    const existing = buildSkportRoster(data, undefined, new Set(["liino"]));
    expect(existing.pendingOperators).toEqual([]);
    expect(existing.warnings).toHaveLength(1);
  });

  it.each(["0", "-1", "1.5", "NaN", "9007199254740992"])("rejects invalid linked material quantities: %s", (count) => {
    const data = officialSourceData();
    data.details[0]!.document.documentMap.promotion.blockMap.promotion_cost.text.inlineElements[1].entry.count = count;
    const result = buildSkportRoster(data);
    expect(result.operators).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("carries newly discovered materials through catalog merging and inventory subtraction", async () => {
    const data = officialSourceData();
    data.details[0]!.document.documentMap.promotion.blockMap.promotion_cost.text.inlineElements[1] = {
      kind: "text", text: { text: "Warp Plasma-Coated Slide*20" },
    };
    const update = buildOfficialPrimaryLiveRosterUpdate(data, undefined);
    expect(parseLiveRosterUpdate(update)).toBe(update);
    const catalog = mergeLiveRosterUpdate(await loadDefaultCatalog(), update).catalog;
    const costs = getPromotionTierRequirement(catalog, "liino", 4)!.materialCosts;
    expect(costs).toContainEqual({ itemId: "warp-plasma-coated-slide", quantity: 20 });
    expect(remainingUpgradeMaterials(catalog, costs, [{ id: "warp-plasma-coated-slide", ownedCount: 7 }]))
      .toContainEqual({ itemId: "warp-plasma-coated-slide", quantity: 13 });
  });

  it("defers a newly released operator with no Base Skill tables, then includes it when complete", () => {
    const data = officialSourceData();
    const si = structuredClone(data.operatorItems[0]!);
    si.itemId = "1278";
    si.name = "Si";
    Object.assign(si.brief, { dotType: "label_type_up" });
    data.operatorItems.push(si);
    const detail = structuredClone(data.details[0]!);
    detail.itemId = si.itemId;
    detail.name = si.name;
    // A published identity/promotion page is not enough to optimize an operator.
    const completeDocuments = detail.document.documentMap;
    detail.document.documentMap = { promotion: completeDocuments.promotion } as typeof completeDocuments;
    data.details.push(detail);
    const known = new Set(["liino"]);
    const pending = buildOfficialPrimaryLiveRosterUpdate(data, undefined, undefined, undefined, known);

    expect(pending.operators.map((operator) => operator.id)).toEqual(["liino"]);
    expect(pending.promotionOverrides.map((entry) => entry.operatorId)).toEqual(["liino"]);
    expect(pending.warnings).toEqual([]);
    expect(pending.pendingOperators).toEqual([{
      id: "si", name: "Si", reason: "Official operator 'Si' is awaiting two complete Base Skill tables.",
    }]);
    expect(parseLiveRosterUpdate(pending)).toBe(pending);

    detail.document.documentMap = completeDocuments;
    const complete = buildOfficialPrimaryLiveRosterUpdate(data, undefined, undefined, undefined, known);
    expect(complete.operators.map((operator) => operator.id)).toEqual(["liino", "si"]);
    expect(complete.promotionOverrides.map((entry) => entry.operatorId)).toEqual(["liino", "si"]);
    expect(complete.pendingOperators).toEqual([]);
    expect(complete.warnings).toEqual([]);
  });

  it("also waits for the second skill, both ranks, and Promotion IV costs", () => {
    for (const missing of ["second skill", "second rank", "promotion"]) {
      const data = officialSourceData();
      const documents = data.details[0]!.document.documentMap;
      if (missing === "second skill") delete (documents as any).nexus;
      if (missing === "second rank") documents.nexus.blockMap.table.table.rowIds.pop();
      if (missing === "promotion") delete (documents as any).promotion;
      const result = buildSkportRoster(data);
      expect(result.operators, missing).toEqual([]);
      expect(result.promotionOverrides, missing).toEqual([]);
      expect(result.pendingOperators, missing).toMatchObject([{ id: "liino" }]);
      expect(result.warnings, missing).toEqual([]);
    }
  });

  it("does not treat lost data on an existing operator as a pending new release", () => {
    const data = officialSourceData();
    delete (data.details[0]!.document.documentMap as any).nexus;
    const result = buildSkportRoster(data, undefined, new Set(["liino"]));
    expect(result.pendingOperators).toEqual([]);
    expect(result.warnings).toEqual(["Official operator 'Liino' is awaiting two complete Base Skill tables."]);
  });

  it("does not hide unsupported effects as incomplete new-operator data", () => {
    const data = officialSourceData();
    data.details[0]!.document.documentMap.nexus = skillDocument("nexus",
      ["New Skill β", "Assign to Control Nexus to grant a completely unknown bonus +10%", "Promote to E2 to unlock"],
      ["New Skill γ", "Assign to Control Nexus to grant a completely unknown bonus +20%", "Promote to E4 to unlock"],
    );
    const result = buildSkportRoster(data);
    expect(result.pendingOperators).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Unsupported official Base Skill effect");
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
