import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  EffectModifier,
  FacilityKind,
  ImageAsset,
  LiveRosterUpdateDocument,
  OperatorDefinition,
  OperatorPromotionOverride,
  ProductKind,
  RecipeDefinition,
  SourceRef,
} from "@endfield/domain";

const DEFAULT_SOURCE_BASE_URL = "https://endfieldtools.dev";
const DEFAULT_OUTPUT_PATH = path.resolve("apps", "web", "public", "roster", "latest.json");
const EXCLUDED_CHARACTER_IDS = new Set(["chr_0002_endminm", "chr_0003_endminf", "chr_9000_endmin"]);
const RETRY_ATTEMPTS = 3;

function createLiveCatalogContentHash(content: {
  operators: OperatorDefinition[];
  promotionOverrides: OperatorPromotionOverride[];
  recipes: RecipeDefinition[];
  assets: ImageAsset[];
}): string {
  const canonicalContent = {
    operators: [...content.operators].sort((left, right) => left.id.localeCompare(right.id)),
    promotionOverrides: [...content.promotionOverrides].sort((left, right) => (
      `${left.operatorId}:${left.promotionTier}`.localeCompare(`${right.operatorId}:${right.promotionTier}`)
    )),
    recipes: [...content.recipes].sort((left, right) => left.id.localeCompare(right.id)),
    assets: [...content.assets].sort((left, right) => left.id.localeCompare(right.id)),
  };
  const serialized = JSON.stringify(canonicalContent, (key, value) => {
    if (key === "retrievedOn") {
      return undefined;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)),
      );
    }
    return value;
  });
  return createHash("sha256").update(serialized).digest("hex");
}

const PROFESSION_NAMES: Record<number, string> = {
  0: "Guard",
  2: "Defender",
  4: "Supporter",
  5: "Caster",
  7: "Vanguard",
  8: "Striker",
};

const ROOM_KINDS: Record<number, FacilityKind> = {
  0: "control_nexus",
  1: "manufacturing_cabin",
  2: "growth_chamber",
  5: "reception_room",
};

const PROMOTION_ITEM_IDS: Record<string, string> = {
  item_char_skill_specialize_1: "metadiastima-photoemission-tube",
  item_char_skill_specialize_2: "d96-steel-sample-4",
  item_char_skill_specialize_3: "tachyon-screening-lattice",
  item_char_skill_specialize_4: "quadrant-fitting-fluid",
  item_char_skill_specialize_5: "triphasic-nanoflake",
  item_plant_mushroom_2_1: "bloodcap",
  item_plant_mushroom_2_2: "cosmagaric",
  item_plant_mushroom_2_3: "talos-cap",
};
const BUNDLED_RARE_RESOURCE_ITEM_IDS = new Set([
  "item_plant_mushroom_2_1",
  "item_plant_mushroom_2_2",
  "item_plant_crylplant_2_1",
  "item_plant_crylplant_2_2",
  "item_plant_spcstone_2_1",
  "item_plant_spcstone_2_2",
]);
const RARE_RESOURCE_FAMILIES: Record<string, { productKind: ProductKind; outputAmount: number }> = {
  mushroom: { productKind: "fungal", outputAmount: 1 },
  crylplant: { productKind: "vitrified_plant", outputAmount: 3 },
  spcstone: { productKind: "rare_mineral", outputAmount: 1 },
};

type TranslationTable = Record<string, string>;

interface RemoteCharacterSummary {
  charId: string;
  engName: string;
  rarity: number;
  profession: number;
  slug?: string;
}

interface RemoteParameter {
  valueFloatList?: Array<number | string> | null;
  valueIntList?: number[] | null;
  valueStringList?: string[] | null;
}

interface RemoteFactorySkill {
  desc?: { id?: string | number };
  effectType: number;
  icon: string;
  id: string;
  level: number;
  name?: { id?: string | number };
  parameters: RemoteParameter[];
  roomType: number;
  sortId: number;
}

interface RemoteCharacterDetail extends RemoteCharacterSummary {
  factorySkills?: {
    skills: Record<string, RemoteFactorySkill>;
    skillList: Array<{
      skillId: string;
      skillIndex: number;
    }>;
  };
  talents?: {
    charBreakCostMap?: {
      charBreak70?: {
        requiredItem?: Array<{
          count: number;
          id: string;
        }>;
      };
    };
  };
}

interface RemoteFactoryItem {
  id: string;
  name?: { id?: string | number };
  rarity?: number;
}

interface RemoteFactoryData {
  items?: Record<string, RemoteFactoryItem>;
}

export interface LiveRosterSourceData {
  summaries: RemoteCharacterSummary[];
  details: RemoteCharacterDetail[];
  characterTranslations: TranslationTable;
  factoryTranslations: TranslationTable;
  factoryItems: RemoteFactoryItem[];
  sourceUpdatedAt?: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readOutputArgument(argv: string[]): string {
  const outputIndex = argv.indexOf("--output");
  if (outputIndex < 0) {
    return DEFAULT_OUTPUT_PATH;
  }
  const output = argv[outputIndex + 1];
  if (!output) {
    throw new Error("--output requires a file path.");
  }
  return path.resolve(output);
}

function translate(
  id: string | number | undefined,
  characterTranslations: TranslationTable,
  factoryTranslations: TranslationTable,
): string | undefined {
  if (id === undefined) {
    return undefined;
  }
  const value = characterTranslations[String(id)] ?? factoryTranslations[String(id)];
  if (!value || !/[ÃÅÎ]/.test(value)) {
    return value;
  }
  return Buffer.from(value, "latin1").toString("utf8");
}

function getParameterNumber(skill: RemoteFactorySkill, parameterIndex: number): number {
  const parameter = skill.parameters[parameterIndex];
  const raw = parameter?.valueStringList?.[0]
    ?? parameter?.valueFloatList?.[0]
    ?? parameter?.valueIntList?.[0];
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Factory skill '${skill.id}' has no numeric parameter at index ${parameterIndex}.`);
  }
  return value;
}

function toPercent(value: number): number {
  return Math.round(value * 10_000) / 100;
}

export function mapFactorySkillModifier(skill: RemoteFactorySkill): EffectModifier {
  switch (skill.effectType) {
    case 0:
      return {
        metric: "mood_regen",
        appliesTo: "all",
        value: toPercent(getParameterNumber(skill, 0)),
        unit: "percent",
      };
    case 1:
      return {
        metric: "mood_drop_reduction",
        appliesTo: "all",
        value: toPercent(getParameterNumber(skill, 0)),
        unit: "percent",
      };
    case 3: {
      const target = {
        1: "fungal",
        2: "vitrified_plant",
        3: "rare_mineral",
      }[getParameterNumber(skill, 1)] as EffectModifier["appliesTo"] | undefined;
      if (!target) {
        throw new Error(`Factory skill '${skill.id}' has an unsupported Growth Chamber target.`);
      }
      return {
        metric: "growth_rate",
        appliesTo: target,
        value: toPercent(getParameterNumber(skill, 0)),
        unit: "percent",
      };
    }
    case 4:
      return {
        metric: "clue_collection_efficiency",
        appliesTo: "all",
        value: toPercent(getParameterNumber(skill, 0)),
        unit: "percent",
      };
    case 6: {
      const clueNumber = getParameterNumber(skill, 0);
      if (!Number.isInteger(clueNumber) || clueNumber < 1 || clueNumber > 7) {
        throw new Error(`Factory skill '${skill.id}' has an unsupported clue target.`);
      }
      return {
        metric: "clue_rate_up",
        appliesTo: `clue_${clueNumber}` as EffectModifier["appliesTo"],
        value: skill.level === 1 ? 8 : 12,
        unit: "percent",
      };
    }
    case 7: {
      const productKind = {
        1: "operator_exp",
        2: "weapon_exp",
      }[getParameterNumber(skill, 1)] as EffectModifier["appliesTo"] | undefined;
      if (!productKind) {
        throw new Error(`Factory skill '${skill.id}' has an unsupported Manufacturing Cabin target.`);
      }
      return {
        metric: "production_efficiency",
        appliesTo: productKind,
        value: toPercent(getParameterNumber(skill, 0)),
        unit: "percent",
      };
    }
    default:
      throw new Error(`Factory skill '${skill.id}' uses unsupported effect type ${skill.effectType}.`);
  }
}

function parseSkillName(translatedName: string): {
  name: string;
  label: "alpha" | "beta" | "gamma";
} {
  const match = translatedName.trim().match(/^(.*?)\s+([αβγ])$/u);
  const [, name, greekLabel] = match ?? [];
  if (!name || !greekLabel) {
    throw new Error(`Could not parse Base Skill name and rank from '${translatedName}'.`);
  }
  const label = ({ α: "alpha", β: "beta", γ: "gamma" } as const)[greekLabel as "α" | "β" | "γ"];
  return { name, label };
}

export function createLiveRosterOperator(
  detail: RemoteCharacterDetail,
  characterTranslations: TranslationTable,
  factoryTranslations: TranslationTable,
  source: SourceRef,
  sourceBaseUrl = DEFAULT_SOURCE_BASE_URL,
): OperatorDefinition {
  const operatorId = slugify(detail.engName);
  const className = PROFESSION_NAMES[detail.profession];
  if (!className) {
    throw new Error(`Operator '${detail.engName}' uses unsupported profession ${detail.profession}.`);
  }
  if (![4, 5, 6].includes(detail.rarity)) {
    throw new Error(`Operator '${detail.engName}' uses unsupported rarity ${detail.rarity}.`);
  }
  const factorySkills = detail.factorySkills;
  if (!factorySkills) {
    throw new Error(`Operator '${detail.engName}' has no factorySkills payload.`);
  }

  const skillIndexById = new Map(factorySkills.skillList.map((entry) => [entry.skillId, entry.skillIndex]));
  const rawSkills = Object.values(factorySkills.skills).sort((left, right) => left.sortId - right.sortId);
  const skillsByIndex = new Map<number, RemoteFactorySkill[]>();
  for (const rawSkill of rawSkills) {
    const skillIndex = skillIndexById.get(rawSkill.id);
    if (skillIndex === undefined) {
      throw new Error(`Factory skill '${rawSkill.id}' has no skillList entry.`);
    }
    const current = skillsByIndex.get(skillIndex) ?? [];
    current.push(rawSkill);
    skillsByIndex.set(skillIndex, current);
  }
  if (skillsByIndex.size !== 2) {
    throw new Error(`Operator '${detail.engName}' must have exactly two Base Skill slots.`);
  }

  const operatorSource: SourceRef = {
    ...source,
    id: `endfieldtools-${operatorId}`,
    label: `EndfieldTools ${detail.engName} character data`,
    url: `${sourceBaseUrl}/characters/${detail.slug ?? operatorId}/`,
    notes: "Automatically normalized from EndfieldTools' extracted character and Dijiang factory-skill data.",
  };

  const baseSkills = [0, 1].map((skillIndex) => {
    const ranks = [...(skillsByIndex.get(skillIndex) ?? [])].sort((left, right) => left.level - right.level);
    if (ranks.length !== 2 || ranks[0]?.level !== 1 || ranks[1]?.level !== 2) {
      throw new Error(`Operator '${detail.engName}' Base Skill slot ${skillIndex + 1} must have levels 1 and 2.`);
    }
    const parsedRanks = ranks.map((rank) => {
      const translatedName = translate(rank.name?.id, characterTranslations, factoryTranslations);
      if (!translatedName) {
        throw new Error(`Factory skill '${rank.id}' has no English name translation.`);
      }
      return { rank, ...parseSkillName(translatedName) };
    });
    const [firstRank, secondRank] = parsedRanks;
    if (!firstRank || !secondRank || firstRank.name !== secondRank.name) {
      throw new Error(`Operator '${detail.engName}' Base Skill slot ${skillIndex + 1} has inconsistent names.`);
    }
    const facilityKind = ROOM_KINDS[firstRank.rank.roomType];
    if (!facilityKind || secondRank.rank.roomType !== firstRank.rank.roomType) {
      throw new Error(`Operator '${detail.engName}' Base Skill '${firstRank.name}' has an unsupported room mapping.`);
    }
    const skillId = slugify(firstRank.name);
    const iconPath = `${sourceBaseUrl}/assets/images/endfield/facskillicon/${firstRank.rank.icon}.png`;
    return {
      id: skillId,
      name: firstRank.name,
      facilityKind,
      icon: {
        id: `skill-${operatorId}-${skillId}-live-icon`,
        kind: "icon" as const,
        path: iconPath,
        attribution: `Factory-skill icon served by EndfieldTools (${iconPath}).`,
      },
      ranks: parsedRanks.map(({ rank, label }) => ({
        rank: rank.level as 1 | 2,
        label,
        modifiers: [mapFactorySkillModifier(rank)],
        materialCosts: [],
        sourceRefs: [operatorSource],
        dataConfidence: "verified" as const,
      })),
      sourceRefs: [operatorSource],
      dataConfidence: "verified" as const,
    };
  });

  const portraitPath = `${sourceBaseUrl}/assets/images/endfield/charremoteicon/icon_${detail.charId}.png`;
  return {
    id: operatorId,
    name: detail.engName,
    rarity: detail.rarity as 4 | 5 | 6,
    className,
    images: [{
      id: `operator-${operatorId}-live-portrait`,
      kind: "portrait",
      path: portraitPath,
      attribution: `Character portrait served by EndfieldTools (${portraitPath}).`,
    }],
    baseSkills,
    sourceRefs: [operatorSource],
    dataConfidence: "verified",
  };
}

export function createPromotionOverride(
  operator: OperatorDefinition,
  detail: RemoteCharacterDetail,
  source: SourceRef,
): OperatorPromotionOverride | undefined {
  const requiredItems = detail.talents?.charBreakCostMap?.charBreak70?.requiredItem;
  if (!requiredItems) {
    return undefined;
  }
  const additionalMaterialCosts = requiredItems
    .filter((item) => PROMOTION_ITEM_IDS[item.id])
    .map((item) => ({
      itemId: PROMOTION_ITEM_IDS[item.id]!,
      quantity: item.count,
    }));
  if (additionalMaterialCosts.length !== 2) {
    throw new Error(`Operator '${operator.name}' has unsupported Elite IV material IDs.`);
  }
  return {
    operatorId: operator.id,
    promotionTier: 4,
    additionalMaterialCosts,
    sourceRefs: operator.sourceRefs.length > 0 ? operator.sourceRefs : [source],
  };
}

export function createLiveRareResource(
  item: RemoteFactoryItem,
  characterTranslations: TranslationTable,
  factoryTranslations: TranslationTable,
  generatedAt: string,
  sourceBaseUrl = DEFAULT_SOURCE_BASE_URL,
): { recipe: RecipeDefinition; asset: ImageAsset } | undefined {
  if (item.rarity !== 5 || BUNDLED_RARE_RESOURCE_ITEM_IDS.has(item.id)) {
    return undefined;
  }
  const match = item.id.match(/^item_plant_(mushroom|crylplant|spcstone)_2_\d+$/);
  const family = match?.[1] ? RARE_RESOURCE_FAMILIES[match[1]] : undefined;
  if (!family) {
    return undefined;
  }
  const name = translate(item.name?.id, characterTranslations, factoryTranslations);
  if (!name) {
    throw new Error(`Rare Growth Chamber item '${item.id}' has no English name translation.`);
  }
  const recipeId = slugify(name);
  const source: SourceRef = {
    id: `endfieldtools-live-resource-${recipeId}`,
    label: `EndfieldTools ${name} item data`,
    url: `${sourceBaseUrl}/localdb/optimized/factory/factory-data.json`,
    retrievedOn: generatedAt.slice(0, 10),
    confidence: "inferred",
    notes: "The item identity and Growth Chamber family come from the extracted game database. Level, duration, and output inherit the bundled verified values for other rarity-5 resources in the same family pending direct in-game verification.",
  };
  const iconPath = `${sourceBaseUrl}/assets/images/endfield/itemicon/${item.id}.png`;
  return {
    recipe: {
      id: recipeId,
      name,
      facilityKind: "growth_chamber",
      productKind: family.productKind,
      roomLevel: 3,
      baseDurationMinutes: 7500,
      outputAmount: family.outputAmount,
      sourceRefs: [source],
      dataConfidence: "provisional",
    },
    asset: {
      id: `material-${recipeId}-icon`,
      kind: "icon",
      path: iconPath,
      attribution: `Item icon served by EndfieldTools (${iconPath}).`,
    },
  };
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "endfield-dijiang-optimizer-roster-sync/0.1",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw new Error(`Failed to fetch '${url}': ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function fetchJson<T>(url: string): Promise<T> {
  return await (await fetchWithRetry(url)).json() as T;
}

export async function fetchLiveRosterSource(sourceBaseUrl = DEFAULT_SOURCE_BASE_URL): Promise<LiveRosterSourceData> {
  const optimizedBaseUrl = `${sourceBaseUrl}/localdb/optimized`;
  const listResponse = await fetchWithRetry(`${optimizedBaseUrl}/characters/characters-list.json`);
  const summariesDocument = await listResponse.json() as Record<string, RemoteCharacterSummary>;
  const summaries = Object.values(summariesDocument).filter(
    (summary) => !EXCLUDED_CHARACTER_IDS.has(summary.charId) && summary.engName !== "Endministrator",
  );
  const [characterTranslations, coreTranslations, factoryTranslations, factoryResponse, details] = await Promise.all([
    fetchJson<TranslationTable>(`${optimizedBaseUrl}/i18n/characters/I18nTextTable_EN.json`),
    fetchJson<TranslationTable>(`${optimizedBaseUrl}/i18n/core/I18nTextTable_EN.json`),
    fetchJson<TranslationTable>(`${optimizedBaseUrl}/i18n/factory/I18nTextTable_EN.json`),
    fetchWithRetry(`${optimizedBaseUrl}/factory/factory-data.json`),
    Promise.all(summaries.map((summary) => (
      fetchJson<RemoteCharacterDetail>(`${optimizedBaseUrl}/characters/details/${summary.charId}.json`)
    ))),
  ]);
  const factoryData = await factoryResponse.json() as RemoteFactoryData;
  const sourceTimestamps = [listResponse, factoryResponse]
    .map((response) => response.headers.get("last-modified"))
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .map((timestamp) => new Date(timestamp).getTime())
    .filter(Number.isFinite);
  return {
    summaries,
    details,
    characterTranslations,
    factoryTranslations: { ...coreTranslations, ...factoryTranslations },
    factoryItems: Object.values(factoryData.items ?? {}),
    sourceUpdatedAt: sourceTimestamps.length > 0 ? new Date(Math.max(...sourceTimestamps)).toISOString() : undefined,
  };
}

export function buildLiveRosterUpdate(
  data: LiveRosterSourceData,
  generatedAt = new Date().toISOString(),
  sourceBaseUrl = DEFAULT_SOURCE_BASE_URL,
): LiveRosterUpdateDocument {
  const retrievedOn = generatedAt.slice(0, 10);
  const source: SourceRef = {
    id: "endfieldtools-live-roster",
    label: "EndfieldTools extracted character database",
    url: `${sourceBaseUrl}/characters/`,
    retrievedOn,
    confidence: "community",
    notes: "Public character, factory-skill, translation, image, and promotion data used by the automatic roster sync.",
  };
  const warnings: string[] = [];
  const operators: OperatorDefinition[] = [];
  const promotionOverrides: OperatorPromotionOverride[] = [];
  const recipes: RecipeDefinition[] = [];
  const assets: ImageAsset[] = [];
  for (const detail of data.details) {
    try {
      const operator = createLiveRosterOperator(
        detail,
        data.characterTranslations,
        data.factoryTranslations,
        source,
        sourceBaseUrl,
      );
      operators.push(operator);
      try {
        const override = createPromotionOverride(operator, detail, source);
        if (override) {
          promotionOverrides.push(override);
        } else {
          warnings.push(`${operator.name}: Elite IV promotion data was unavailable.`);
        }
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const item of data.factoryItems) {
    try {
      const resource = createLiveRareResource(
        item,
        data.characterTranslations,
        data.factoryTranslations,
        generatedAt,
        sourceBaseUrl,
      );
      if (resource) {
        recipes.push(resource.recipe);
        assets.push(resource.asset);
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    schemaVersion: 1,
    generatedAt,
    sourceUpdatedAt: data.sourceUpdatedAt,
    contentHash: createLiveCatalogContentHash({ operators, promotionOverrides, recipes, assets }),
    source,
    operators,
    promotionOverrides,
    recipes,
    assets,
    warnings,
  };
}

function createEmptyUpdate(error: unknown, generatedAt = new Date().toISOString()): LiveRosterUpdateDocument {
  const operators: OperatorDefinition[] = [];
  const promotionOverrides: OperatorPromotionOverride[] = [];
  const recipes: RecipeDefinition[] = [];
  const assets: ImageAsset[] = [];
  return {
    schemaVersion: 1,
    generatedAt,
    contentHash: createLiveCatalogContentHash({ operators, promotionOverrides, recipes, assets }),
    source: {
      id: "endfieldtools-live-roster",
      label: "EndfieldTools extracted character database",
      url: `${DEFAULT_SOURCE_BASE_URL}/characters/`,
      retrievedOn: generatedAt.slice(0, 10),
      confidence: "community",
    },
    operators,
    promotionOverrides,
    recipes,
    assets,
    warnings: [`Roster sync unavailable; the bundled catalog remains active. ${error instanceof Error ? error.message : String(error)}`],
  };
}

async function main(): Promise<void> {
  const outputPath = readOutputArgument(process.argv.slice(2));
  if (process.env.SYNC_LIVE_ROSTER_REUSE_EXISTING === "1") {
    const existing = JSON.parse(await fs.readFile(outputPath, "utf8")) as Partial<LiveRosterUpdateDocument>;
    if (!existing.contentHash?.match(/^[a-f0-9]{64}$/) || !Array.isArray(existing.operators)) {
      throw new Error(`Cannot reuse invalid live catalog at '${outputPath}'.`);
    }
    if (!Array.isArray(existing.warnings) || existing.warnings.length > 0) {
      throw new Error(`Cannot reuse live catalog with warnings at '${outputPath}'.`);
    }
    console.log(
      `reused validated live catalog -> ${path.relative(process.cwd(), outputPath)} (${existing.operators.length} operators)`,
    );
    return;
  }
  let update: LiveRosterUpdateDocument;
  try {
    if (process.env.SYNC_LIVE_ROSTER_DISABLE === "1") {
      throw new Error("Network sync was disabled by SYNC_LIVE_ROSTER_DISABLE=1.");
    }
    update = buildLiveRosterUpdate(await fetchLiveRosterSource());
  } catch (error) {
    console.warn(error instanceof Error ? error.message : String(error));
    update = createEmptyUpdate(error);
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(update, null, 2)}\n`, "utf8");
  console.log(
    `synced live catalog -> ${path.relative(process.cwd(), outputPath)} (${update.operators.length} operators, ${update.recipes.length} resource nodes, ${update.warnings.length} warnings)`,
  );
  update.warnings.forEach((warning) => console.warn(`roster sync warning: ${warning}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
