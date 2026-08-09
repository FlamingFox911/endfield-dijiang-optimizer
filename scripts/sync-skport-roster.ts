import { createHash, createHmac } from "node:crypto";

import type {
  BaseSkillDefinition,
  EffectModifier,
  FacilityKind,
  OperatorDefinition,
  OperatorPromotionOverride,
  SourceRef,
} from "@endfield/domain";

const SKPORT_API_HOST = "https://zonai.skport.com";
export const SKPORT_WIKI_URL = "https://wiki.skport.com/endfield/catalog?mainTypeId=1&subTypeId=1&filterIds=&header=0";
const REQUEST_ATTEMPTS = 3;
const OPERATOR_NAME_OVERRIDES: Record<string, string> = {
  "Mi Fu": "Mifu",
};
const SKILL_ID_OVERRIDES: Record<string, string> = {
  // Preserve saved scenario state after the earlier community source mislabeled this slot.
  "avywenna:factory-pioneer": "messengers-secret",
};

interface SkportResponse<T> {
  code: number;
  message: string;
  timestamp: string;
  data: T;
}

interface SkportCatalogItem {
  itemId: string;
  name: string;
  brief: {
    cover: string;
    subTypeList?: Array<{
      subTypeId: string;
      value: string;
    }>;
  };
  publishedAtTs?: string;
}

interface SkportFilterTag {
  id: string;
  name: string;
  children?: SkportFilterTag[];
}

interface SkportCatalogSubType {
  id: string;
  items?: SkportCatalogItem[];
  filterTagTree?: SkportFilterTag[];
}

interface SkportCatalogMainType {
  id: string;
  typeSub?: SkportCatalogSubType[];
}

interface SkportInlineElement {
  kind: string;
  text?: { text?: string };
  link?: { text?: string };
  entry?: {
    id: string;
    count?: string;
  };
}

interface SkportBlock {
  kind: string;
  text?: {
    inlineElements?: SkportInlineElement[];
  };
  table?: {
    rowIds: string[];
    columnIds: string[];
    cellMap: Record<string, {
      childIds?: string[];
    }>;
  };
}

interface SkportDocumentSection {
  blockMap: Record<string, SkportBlock>;
}

interface SkportWidget {
  tabList?: Array<{
    tabId: string;
    icon?: string;
  }>;
  tabDataMap?: Record<string, {
    content?: string;
  }>;
}

export interface SkportDetailItem {
  itemId: string;
  name: string;
  lastAuditPassedAt?: string;
  publishedAtTs?: string;
  document: {
    documentMap: Record<string, SkportDocumentSection>;
    widgetCommonMap?: Record<string, SkportWidget>;
  };
}

export interface SkportRosterSourceData {
  operatorItems: SkportCatalogItem[];
  details: SkportDetailItem[];
  entryNamesById: Record<string, string>;
  tagNamesById: Record<string, string>;
  sourceUpdatedAt?: string;
}

export interface SkportRosterBuildResult {
  source: SourceRef;
  operators: OperatorDefinition[];
  promotionOverrides: OperatorPromotionOverride[];
  warnings: string[];
  sourceUpdatedAt?: string;
}

interface ParsedCell {
  text: string;
  entries: Array<{
    id: string;
    count: number;
  }>;
}

interface ParsedTable {
  documentId: string;
  rows: ParsedCell[][];
}

interface SkportAuth {
  timestamp: string;
  token: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createSkportSign(
  path: string,
  query: string,
  timestamp: string,
  token: string,
): string {
  const signedHeaders = {
    platform: "3",
    timestamp,
    dId: "",
    vName: "1.0.0",
  };
  const message = `${path}${query}${timestamp}${JSON.stringify(signedHeaders)}`;
  const hmac = createHmac("sha256", token).update(message).digest("hex");
  return createHash("md5").update(hmac).digest("hex");
}

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < REQUEST_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw new Error(`Failed to fetch '${url}': ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

class SkportClient {
  private auth?: SkportAuth;

  private async refresh(): Promise<SkportAuth> {
    const response = await fetchWithRetry(`${SKPORT_API_HOST}/web/v1/auth/refresh`, {
      headers: {
        "User-Agent": "endfield-dijiang-optimizer-roster-sync/0.1",
      },
    });
    const document = await response.json() as SkportResponse<{ token: string }>;
    if (document.code !== 0 || !document.data?.token || !document.timestamp) {
      throw new Error(`SKPORT anonymous authentication failed: ${document.message || `code ${document.code}`}.`);
    }
    this.auth = {
      timestamp: String(document.timestamp),
      token: document.data.token,
    };
    return this.auth;
  }

  async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const query = new URLSearchParams(params).toString();
    let auth = this.auth ?? await this.refresh();
    let lastError: unknown;
    for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
      try {
        const sign = createSkportSign(path, query, auth.timestamp, auth.token);
        const response = await fetch(`${SKPORT_API_HOST}${path}?${query}`, {
          headers: {
            "sk-language": "en",
            platform: "3",
            timestamp: auth.timestamp,
            vName: "1.0.0",
            sign,
            "User-Agent": "endfield-dijiang-optimizer-roster-sync/0.1",
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (response.status === 401) {
          auth = await this.refresh();
          throw new Error("anonymous token expired");
        }
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        const document = await response.json() as SkportResponse<T>;
        if (document.code !== 0) {
          throw new Error(document.message || `code ${document.code}`);
        }
        return document.data;
      } catch (error) {
        lastError = error;
        if (attempt < REQUEST_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
      }
    }
    throw new Error(
      `SKPORT request '${path}' failed: ${lastError instanceof Error ? lastError.message : String(lastError)}.`,
    );
  }
}

function collectTagNames(tags: SkportFilterTag[] | undefined, result: Record<string, string>): void {
  for (const tag of tags ?? []) {
    result[tag.id] = tag.name;
    collectTagNames(tag.children, result);
  }
}

async function mapInBatches<T, U>(
  values: T[],
  batchSize: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const result: U[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    result.push(...await Promise.all(values.slice(index, index + batchSize).map(mapper)));
  }
  return result;
}

export async function fetchSkportRosterSource(): Promise<SkportRosterSourceData> {
  const client = new SkportClient();
  const catalog = await client.get<{ catalog: SkportCatalogMainType[] }>(
    "/web/v1/wiki/item/catalog",
    { typeMainId: "1" },
  );
  const mainType = catalog.catalog.find((entry) => entry.id === "1");
  const operatorType = mainType?.typeSub?.find((entry) => entry.id === "1");
  if (!operatorType?.items?.length) {
    throw new Error("SKPORT returned no operator catalog entries.");
  }
  const operatorItems = operatorType.items.filter((entry) => !entry.name.startsWith("Endministrator"));
  const allItems = mainType?.typeSub?.flatMap((entry) => entry.items ?? []) ?? [];
  const tagNamesById: Record<string, string> = {};
  for (const subType of mainType?.typeSub ?? []) {
    collectTagNames(subType.filterTagTree, tagNamesById);
  }
  const details = await mapInBatches(operatorItems, 5, async (entry) => {
    const data = await client.get<{ item: SkportDetailItem }>(
      "/web/v1/wiki/item/info",
      { id: entry.itemId },
    );
    return data.item;
  });
  const timestamps = details
    .flatMap((entry) => [entry.lastAuditPassedAt, entry.publishedAtTs])
    .map(Number)
    .filter(Number.isFinite);
  return {
    operatorItems,
    details,
    entryNamesById: Object.fromEntries(allItems.map((entry) => [entry.itemId, entry.name])),
    tagNamesById,
    sourceUpdatedAt: timestamps.length > 0
      ? new Date(Math.max(...timestamps) * 1000).toISOString()
      : undefined,
  };
}

function inlineText(element: SkportInlineElement): string {
  return element.text?.text ?? element.link?.text ?? "";
}

function parseTables(detail: SkportDetailItem): ParsedTable[] {
  const tables: ParsedTable[] = [];
  for (const [documentId, document] of Object.entries(detail.document.documentMap)) {
    for (const block of Object.values(document.blockMap)) {
      if (block.kind !== "table" || !block.table) {
        continue;
      }
      const rows = block.table.rowIds.map((rowId) => block.table!.columnIds.map((columnId) => {
        const cell = block.table!.cellMap[`${rowId}_${columnId}`];
        const childBlocks = (cell?.childIds ?? [])
          .map((childId) => document.blockMap[childId])
          .filter((childBlock): childBlock is SkportBlock => Boolean(childBlock));
        const elements = childBlocks.flatMap((childBlock) => childBlock.text?.inlineElements ?? []);
        return {
          text: elements.map(inlineText).filter(Boolean).join("\n").trim(),
          entries: elements
            .filter((element) => element.kind === "entry" && element.entry?.id)
            .map((element) => ({
              id: element.entry!.id,
              count: Number(element.entry!.count ?? 0),
            }))
            .filter((entry) => Number.isFinite(entry.count)),
        };
      }));
      tables.push({ documentId, rows });
    }
  }
  return tables;
}

function getContentIconMap(detail: SkportDetailItem): Map<string, string> {
  const icons = new Map<string, string>();
  for (const widget of Object.values(detail.document.widgetCommonMap ?? {})) {
    const iconByTabId = new Map((widget.tabList ?? []).map((tab) => [tab.tabId, tab.icon]));
    for (const [tabId, tabData] of Object.entries(widget.tabDataMap ?? {})) {
      const icon = iconByTabId.get(tabId);
      if (tabData.content && icon) {
        icons.set(tabData.content, icon);
      }
    }
  }
  return icons;
}

function facilityFromDescription(description: string): FacilityKind {
  const normalized = description.replace(/\s+/gu, " ").trim();
  const facility = normalized.match(/Assign to (Control Nexus|Manufacturing Cabin|Growth Chamber|Reception Room)/i)?.[1];
  const kind = ({
    "control nexus": "control_nexus",
    "manufacturing cabin": "manufacturing_cabin",
    "growth chamber": "growth_chamber",
    "reception room": "reception_room",
  } as const)[facility?.toLowerCase() as "control nexus" | "manufacturing cabin" | "growth chamber" | "reception room"];
  if (!kind) {
    throw new Error(`Unsupported official Base Skill facility description: '${description}'.`);
  }
  return kind;
}

function percentFromDescription(description: string): number {
  const value = Number(description.match(/\+?(\d+(?:\.\d+)?)%/)?.[1]);
  if (!Number.isFinite(value)) {
    throw new Error(`Official Base Skill has no percentage: '${description}'.`);
  }
  return value;
}

export function parseSkportModifier(description: string): EffectModifier {
  const normalized = description.replace(/\s+/g, " ").trim();
  const clueNumber = Number(normalized.match(/Clue\s+([1-7])\s+Rate-UP/i)?.[1]);
  if (Number.isInteger(clueNumber) && clueNumber >= 1 && clueNumber <= 7) {
    return {
      metric: "clue_rate_up",
      appliesTo: `clue_${clueNumber}` as EffectModifier["appliesTo"],
      value: /\ba small\b/i.test(normalized) ? 8 : 12,
      unit: "percent",
    };
  }
  const value = percentFromDescription(normalized);
  if (/Mood Regen/i.test(normalized)) {
    return { metric: "mood_regen", appliesTo: "all", value, unit: "percent" };
  }
  if (/Mood Drop/i.test(normalized)) {
    return { metric: "mood_drop_reduction", appliesTo: "all", value, unit: "percent" };
  }
  if (/operator EXP material production efficiency/i.test(normalized)) {
    return { metric: "production_efficiency", appliesTo: "operator_exp", value, unit: "percent" };
  }
  if (/weapon EXP material production efficiency/i.test(normalized)) {
    return { metric: "production_efficiency", appliesTo: "weapon_exp", value, unit: "percent" };
  }
  if (/fungal matter growth rate/i.test(normalized)) {
    return { metric: "growth_rate", appliesTo: "fungal", value, unit: "percent" };
  }
  if (/vitrified plant growth rate/i.test(normalized)) {
    return { metric: "growth_rate", appliesTo: "vitrified_plant", value, unit: "percent" };
  }
  if (/rare mineral growth rate/i.test(normalized)) {
    return { metric: "growth_rate", appliesTo: "rare_mineral", value, unit: "percent" };
  }
  if (/clue collecting efficiency/i.test(normalized)) {
    return { metric: "clue_collection_efficiency", appliesTo: "all", value, unit: "percent" };
  }
  throw new Error(`Unsupported official Base Skill effect: '${description}'.`);
}

function parseRankName(name: string): { name: string; label: "alpha" | "beta" | "gamma" } {
  const match = name.trim().match(/^(.*?)\s+([\u03b1\u03b2\u03b3])$/u);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Could not parse official Base Skill rank name '${name}'.`);
  }
  const label = ({
    "\u03b1": "alpha",
    "\u03b2": "beta",
    "\u03b3": "gamma",
  } as const)[match[2] as "\u03b1" | "\u03b2" | "\u03b3"];
  return { name: match[1].trim(), label };
}

function firstUnlockTier(skill: BaseSkillDefinition): number {
  return Number(skill.ranks[0]?.unlockHint?.match(/E([1-4])/i)?.[1] ?? 9);
}

function stabilizeSkills(officialSkills: BaseSkillDefinition[]): BaseSkillDefinition[] {
  return [...officialSkills].sort((left, right) => firstUnlockTier(left) - firstUnlockTier(right));
}

function createOperatorSource(item: SkportCatalogItem, retrievedOn: string): SourceRef {
  return {
    id: `skport-${slugify(OPERATOR_NAME_OVERRIDES[item.name] ?? item.name)}`,
    label: `Official SKPORT ${item.name} operator data`,
    url: `https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=${item.itemId}&header=0`,
    retrievedOn,
    confidence: "official",
    notes: "Automatically normalized from the official SKPORT operator catalog and Base Skill tables.",
  };
}

function createSkportOperator(
  item: SkportCatalogItem,
  detail: SkportDetailItem,
  tagNamesById: Record<string, string>,
  retrievedOn: string,
): OperatorDefinition {
  const name = OPERATOR_NAME_OVERRIDES[item.name] ?? item.name;
  const operatorId = slugify(name);
  const rarityTagId = item.brief.subTypeList?.find((entry) => entry.subTypeId === "10000")?.value;
  const classTagId = item.brief.subTypeList?.find((entry) => entry.subTypeId === "10200")?.value;
  const rarity = Number(tagNamesById[rarityTagId ?? ""]?.match(/[4-6]/)?.[0]);
  const className = tagNamesById[classTagId ?? ""];
  if (![4, 5, 6].includes(rarity) || !className) {
    throw new Error(`Official operator '${name}' has unsupported rarity or class tags.`);
  }
  if (!item.brief.cover?.startsWith("https://")) {
    throw new Error(`Official operator '${name}' has no HTTPS portrait.`);
  }
  const source = createOperatorSource(item, retrievedOn);
  const iconByDocumentId = getContentIconMap(detail);
  const officialSkills: BaseSkillDefinition[] = [];
  for (const table of parseTables(detail)) {
    const rankRows = table.rows.slice(1).filter((row) => /Assign\s+to\s+/iu.test(row[1]?.text ?? ""));
    if (rankRows.length !== 2) {
      continue;
    }
    const parsedRanks = rankRows.map((row) => ({
      ...parseRankName(row[0]?.text ?? ""),
      description: row[1]?.text ?? "",
      unlockHint: row[2]?.text || undefined,
    }));
    if (parsedRanks[0]?.name !== parsedRanks[1]?.name) {
      throw new Error(`Official operator '${name}' has inconsistent Base Skill rank names.`);
    }
    const facilityKind = facilityFromDescription(parsedRanks[0]!.description);
    if (facilityFromDescription(parsedRanks[1]!.description) !== facilityKind) {
      throw new Error(`Official operator '${name}' Base Skill '${parsedRanks[0]!.name}' changes facilities.`);
    }
    const parsedSkillId = slugify(parsedRanks[0]!.name);
    const skillId = SKILL_ID_OVERRIDES[`${operatorId}:${parsedSkillId}`] ?? parsedSkillId;
    const iconPath = iconByDocumentId.get(table.documentId);
    if (!iconPath?.startsWith("https://")) {
      throw new Error(`Official operator '${name}' Base Skill '${parsedRanks[0]!.name}' has no HTTPS icon.`);
    }
    officialSkills.push({
      id: skillId,
      name: parsedRanks[0]!.name,
      facilityKind,
      icon: {
        id: `skill-${operatorId}-${skillId}-official-icon`,
        kind: "icon",
        path: iconPath,
        attribution: `Base Skill icon served by the official SKPORT wiki (${iconPath}).`,
      },
      ranks: parsedRanks.map((rank, index) => ({
        rank: (index + 1) as 1 | 2,
        label: rank.label,
        modifiers: [parseSkportModifier(rank.description)],
        materialCosts: [],
        unlockHint: rank.unlockHint,
        sourceRefs: [source],
        dataConfidence: "verified",
      })),
      sourceRefs: [source],
      dataConfidence: "verified",
    });
  }
  const uniqueSkills = Array.from(new Map(officialSkills.map((skill) => [skill.id, skill])).values());
  if (uniqueSkills.length !== 2) {
    throw new Error(`Official operator '${name}' did not expose two supported Base Skill tables.`);
  }
  const baseSkills = stabilizeSkills(uniqueSkills);
  return {
    id: operatorId,
    name,
    rarity: rarity as 4 | 5 | 6,
    className,
    images: [{
      id: `operator-${operatorId}-official-portrait`,
      kind: "portrait",
      path: item.brief.cover,
      attribution: `Operator portrait served by the official SKPORT wiki (${item.brief.cover}).`,
    }],
    baseSkills,
    sourceRefs: [source],
    dataConfidence: "verified",
  };
}

function createSkportPromotionOverride(
  operator: OperatorDefinition,
  detail: SkportDetailItem,
  entryNamesById: Record<string, string>,
): OperatorPromotionOverride {
  const promotionTable = parseTables(detail).find((table) => (
    table.rows.some((row) => row[0]?.text === "Promotion IV")
  ));
  const promotionRow = promotionTable?.rows.find((row) => row[0]?.text === "Promotion IV");
  const costs = promotionRow?.flatMap((cell) => cell.entries) ?? [];
  const additionalMaterialCosts = costs
    .map((entry) => ({
      itemId: slugify(entryNamesById[entry.id] ?? ""),
      quantity: entry.count,
    }))
    .filter((entry) => entry.itemId && !["protoset", "t-creds"].includes(entry.itemId));
  if (additionalMaterialCosts.length !== 2) {
    throw new Error(`Official operator '${operator.name}' has unsupported Promotion IV material data.`);
  }
  return {
    operatorId: operator.id,
    promotionTier: 4,
    additionalMaterialCosts,
    sourceRefs: operator.sourceRefs,
  };
}

export function buildSkportRoster(
  data: SkportRosterSourceData,
  generatedAt = new Date().toISOString(),
): SkportRosterBuildResult {
  const retrievedOn = generatedAt.slice(0, 10);
  const source: SourceRef = {
    id: "skport-official-live-roster",
    label: "Official SKPORT Endfield Wiki",
    url: SKPORT_WIKI_URL,
    retrievedOn,
    confidence: "official",
    notes: "Primary live source for operator identity, portraits, classes, rarity, Dijiang Base Skills, and Promotion IV materials.",
  };
  const detailById = new Map(data.details.map((detail) => [detail.itemId, detail]));
  const operators: OperatorDefinition[] = [];
  const promotionOverrides: OperatorPromotionOverride[] = [];
  const warnings: string[] = [];
  for (const item of data.operatorItems) {
    const detail = detailById.get(item.itemId);
    if (!detail) {
      warnings.push(`Official operator '${item.name}' has no detail payload.`);
      continue;
    }
    try {
      const operator = createSkportOperator(
        item,
        detail,
        data.tagNamesById,
        retrievedOn,
      );
      operators.push(operator);
      try {
        promotionOverrides.push(createSkportPromotionOverride(operator, detail, data.entryNamesById));
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    source,
    operators,
    promotionOverrides,
    warnings,
    sourceUpdatedAt: data.sourceUpdatedAt,
  };
}
