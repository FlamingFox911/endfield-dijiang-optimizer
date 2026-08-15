import type {
  GameCatalog,
  OptimizationScenario,
  SkportInventorySnapshot,
  SkportOwnedOperatorSnapshot,
  SkportSyncedCombatSkill,
  SkportSyncedGear,
  SkportSyncedTacticalItem,
  SkportSyncedWeapon,
} from "@endfield/domain";

type JsonRecord = Record<string, unknown>;

const SKPORT_OPERATOR_ID_ALIASES: Record<string, string> = {
  chr_0004_pelica: "perlica",
  chr_0005_chen: "chen-qianyu",
  chr_0006_wolfgd: "wulfgard",
  chr_0007_ikut: "arclight",
  chr_0009_azrila: "ember",
  chr_0011_seraph: "xaihi",
  chr_0012_avywen: "avywenna",
  chr_0013_aglina: "gilberta",
  chr_0014_aurora: "snowshine",
  chr_0015_lifeng: "lifeng",
  chr_0016_laevat: "laevatain",
  chr_0017_yvonne: "yvonne",
  chr_0018_dapan: "da-pan",
  chr_0019_karin: "akekuri",
  chr_0020_meurs: "catcher",
  chr_0021_whiten: "estella",
  chr_0022_bounda: "fluorite",
  chr_0023_antal: "antal",
  chr_0024_deepfin: "alesh",
  chr_0025_ardelia: "ardelia",
  chr_0026_lastrite: "last-rite",
  chr_0027_tangtang: "tangtang",
  chr_0028_wulfa: "rossi",
  chr_0029_pograni: "pogranichnik",
  chr_0030_zhuangfy: "zhuang-fangyi",
};

// Endministrator appears in account roster data but cannot be assigned to a
// Dijiang facility, so it is intentionally absent from the optimizer catalog.
const SKPORT_NON_ASSIGNABLE_OPERATOR_NAMES = new Set(["endministrator"]);

export interface SkportRosterImportCharacter {
  sourceOperatorId: string;
  sourceName: string;
  catalogOperatorId?: string;
  level: number;
  promotionTier: 0 | 1 | 2 | 3 | 4;
  snapshot: SkportOwnedOperatorSnapshot;
}

export interface SkportRosterImportPreview {
  characters: SkportRosterImportCharacter[];
  sourceOperatorCount: number;
  reportedOperatorCount?: number;
  matchedOperatorCount: number;
  completeRoster: boolean;
  sourceSavedAt?: string;
  weaponCount: number;
  gearCount: number;
  tacticalItemCount: number;
  combatSkillCount: number;
  inventorySnapshot?: SkportInventorySnapshot;
  unmatchedOperatorNames: string[];
  warnings: string[];
}

export interface SkportRosterImportResult {
  scenario: OptimizationScenario;
  updatedOperatorCount: number;
  clearedOperatorCount: number;
  warnings: string[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const numberValue = asFiniteNumber(value);
  if (numberValue == null) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.trunc(numberValue)));
}

function nestedRecord(value: unknown, key: string): JsonRecord | undefined {
  return isRecord(value) && isRecord(value[key]) ? value[key] : undefined;
}

function nestedString(value: unknown, ...keys: string[]): string | undefined {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return asString(current);
}

function normalizeOperatorKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  const numeric = asFiniteNumber(value);
  if (numeric == null || numeric <= 0) {
    return undefined;
  }
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function decodeHarContent(text: string, encoding: unknown): string {
  if (encoding !== "base64") {
    return text;
  }
  if (typeof atob !== "function") {
    throw new Error("This environment cannot decode the base64 response stored in the HAR file.");
  }
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function unwrapCardDetail(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (Array.isArray(value.chars) && isRecord(value.base)) {
    return value;
  }
  const detail = nestedRecord(value, "detail");
  if (detail) {
    const unwrapped = unwrapCardDetail(detail);
    if (unwrapped) {
      return unwrapped;
    }
  }
  const data = nestedRecord(value, "data");
  const fromData = data ? unwrapCardDetail(data) : undefined;
  if (fromData) {
    return fromData;
  }
  const response = nestedRecord(value, "response");
  return response ? unwrapCardDetail(response) : undefined;
}

function unwrapTeamUserGameData(value: unknown): JsonRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const userGameData = nestedRecord(value, "userGameData");
  if (userGameData && isRecord(userGameData.userChars)) {
    return userGameData;
  }
  for (const key of ["data", "response"]) {
    const nested = nestedRecord(value, key);
    if (nested) {
      const unwrapped = unwrapTeamUserGameData(nested);
      if (unwrapped) {
        return unwrapped;
      }
    }
  }
  return undefined;
}

function characterNamesFromCatalog(value: unknown): Map<string, string> {
  if (!isRecord(value)) {
    return new Map();
  }
  const chars = Array.isArray(value.chars) ? value.chars : undefined;
  if (chars) {
    return new Map(chars.flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }
      const id = asString(entry.id);
      const name = asString(entry.name);
      return id && name ? [[id, name] as const] : [];
    }));
  }
  for (const key of ["data", "characterCatalog", "catalogResponse"]) {
    const nested = nestedRecord(value, key);
    if (nested) {
      const names = characterNamesFromCatalog(nested);
      if (names.size > 0) {
        return names;
      }
    }
  }
  return new Map();
}

function itemNamesFromCatalog(value: unknown, collectionKey: string): Map<string, string> {
  if (!isRecord(value)) {
    return new Map();
  }
  const collection = Array.isArray(value[collectionKey]) ? value[collectionKey] : undefined;
  if (collection) {
    return new Map(collection.flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }
      const id = asString(entry.id);
      const name = asString(entry.name);
      return id && name ? [[id, name] as const] : [];
    }));
  }
  for (const key of ["data", "weaponCatalog", "equipmentCatalog", "tacticalItemCatalog"]) {
    const nested = nestedRecord(value, key);
    if (nested) {
      const names = itemNamesFromCatalog(nested, collectionKey);
      if (names.size > 0) {
        return names;
      }
    }
  }
  return new Map();
}

interface TeamReferenceNames {
  characters: Map<string, string>;
  weapons: Map<string, string>;
  gear: Map<string, string>;
  tacticalItems: Map<string, string>;
}

function teamUserGameDataToCardDetail(
  userGameData: JsonRecord,
  referenceNames: TeamReferenceNames = {
    characters: new Map(),
    weapons: new Map(),
    gear: new Map(),
    tacticalItems: new Map(),
  },
): JsonRecord {
  const userChars = isRecord(userGameData.userChars) ? userGameData.userChars : {};
  const chars = Object.values(userChars).flatMap((entry) => {
    if (!isRecord(entry) || entry.owned !== true) {
      return [];
    }
    const charId = asString(entry.charId);
    if (!charId) {
      return [];
    }
    return [{
      id: charId,
      level: entry.level,
      evolvePhase: entry.evolvePhase,
      userSkills: entry.userSkills,
      charData: { id: charId, name: referenceNames.characters.get(charId) ?? charId },
    }];
  });
  const inventory: SkportInventorySnapshot = {
    weapons: Object.values(isRecord(userGameData.userWeapons) ? userGameData.userWeapons : {}).flatMap((entry) => {
      if (!isRecord(entry) || entry.owned !== true) {
        return [];
      }
      const id = asString(entry.weaponId);
      return id ? [{ id, name: referenceNames.weapons.get(id), ownedCount: 1 }] : [];
    }),
    gear: Object.values(isRecord(userGameData.userEquips) ? userGameData.userEquips : {}).flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }
      const id = asString(entry.equipId);
      const ownedCount = clampInteger(entry.ownedCount, 0, Number.MAX_SAFE_INTEGER, 0);
      return id && ownedCount > 0 ? [{ id, name: referenceNames.gear.get(id), ownedCount }] : [];
    }),
    tacticalItems: Object.values(isRecord(userGameData.userTacticalItems) ? userGameData.userTacticalItems : {}).flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }
      const id = asString(entry.tacticalItemId);
      const ownedCount = clampInteger(entry.ownedCount, 0, Number.MAX_SAFE_INTEGER, 0);
      return id && ownedCount > 0 ? [{ id, name: referenceNames.tacticalItems.get(id), ownedCount }] : [];
    }),
  };
  return {
    base: {
      charNum: chars.length,
      importSource: "team-user-game-data",
    },
    chars,
    inventory,
  };
}

function extractCardDetail(value: unknown): JsonRecord {
  const direct = unwrapCardDetail(value);
  if (direct) {
    return direct;
  }
  const directTeamData = unwrapTeamUserGameData(value);
  if (directTeamData) {
    return teamUserGameDataToCardDetail(directTeamData, {
      characters: characterNamesFromCatalog(value),
      weapons: itemNamesFromCatalog(value, "weapons"),
      gear: itemNamesFromCatalog(value, "equips"),
      tacticalItems: itemNamesFromCatalog(value, "tacticalItems"),
    });
  }

  const log = nestedRecord(value, "log");
  const entries = log?.entries;
  if (Array.isArray(entries)) {
    const harReferenceNames: TeamReferenceNames = {
      characters: new Map(),
      weapons: new Map(),
      gear: new Map(),
      tacticalItems: new Map(),
    };
    for (const entry of entries) {
      const request = nestedRecord(entry, "request");
      const url = asString(request?.url);
      if (!url || !/\/game\/endfield\/search-(?:chars|weapons|equipments|tactical-items)(?:[/?#]|$)/i.test(url)) {
        continue;
      }
      const response = nestedRecord(entry, "response");
      const content = nestedRecord(response, "content");
      const responseText = asString(content?.text);
      if (!responseText) {
        continue;
      }
      try {
        const parsed = JSON.parse(decodeHarContent(responseText, content?.encoding));
        const characterNames = characterNamesFromCatalog(parsed);
        const weaponNames = itemNamesFromCatalog(parsed, "weapons");
        const gearNames = itemNamesFromCatalog(parsed, "equips");
        const tacticalItemNames = itemNamesFromCatalog(parsed, "tacticalItems");
        if (characterNames.size > 0) harReferenceNames.characters = characterNames;
        if (weaponNames.size > 0) harReferenceNames.weapons = weaponNames;
        if (gearNames.size > 0) harReferenceNames.gear = gearNames;
        if (tacticalItemNames.size > 0) harReferenceNames.tacticalItems = tacticalItemNames;
      } catch {
        // Continue without the optional catalog-name response.
      }
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const request = nestedRecord(entry, "request");
      const url = asString(request?.url);
      if (!url || !/(?:\/game\/endfield\/card\/detail|\/game\/endfield\/team\/user-game-data)(?:[/?#]|$)/i.test(url)) {
        continue;
      }
      const response = nestedRecord(entry, "response");
      const content = nestedRecord(response, "content");
      const responseText = asString(content?.text);
      if (!responseText) {
        continue;
      }
      try {
        const parsed = JSON.parse(decodeHarContent(responseText, content?.encoding));
        const detail = unwrapCardDetail(parsed);
        if (detail) {
          return detail;
        }
        const teamData = unwrapTeamUserGameData(parsed);
        if (teamData) {
          return teamUserGameDataToCardDetail(teamData, harReferenceNames);
        }
      } catch {
        // Continue looking for another successful card-detail response in the capture.
      }
    }
  }

  throw new Error(
    "No Endfield roster response was found. Use the Team Picks capture helper, a card-detail JSON response, or a HAR containing one of those responses; a general SKPort page capture does not include roster data.",
  );
}

function parseWeapon(value: unknown): SkportSyncedWeapon | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const weaponData = nestedRecord(value, "weaponData");
  const id = asString(weaponData?.id);
  if (!id) {
    return undefined;
  }
  return {
    id,
    name: asString(weaponData?.name),
    level: asFiniteNumber(value.level),
    refinementLevel: asFiniteNumber(value.refineLevel),
    breakthroughLevel: asFiniteNumber(value.breakthroughLevel),
  };
}

function parseGear(value: unknown, slot: SkportSyncedGear["slot"]): SkportSyncedGear | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const equipData = nestedRecord(value, "equipData");
  const id = asString(equipData?.id) ?? asString(value.equipId);
  if (!id) {
    return undefined;
  }
  return {
    slot,
    id,
    name: asString(equipData?.name),
    level: nestedString(equipData, "level", "value"),
    rarity: nestedString(equipData, "rarity", "value"),
    setName: nestedString(equipData, "suit", "name"),
  };
}

function parseTacticalItem(value: unknown): SkportSyncedTacticalItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const itemData = nestedRecord(value, "tacticalItemData");
  const id = asString(itemData?.id) ?? asString(value.tacticalItemId);
  if (!id) {
    return undefined;
  }
  return {
    id,
    name: asString(itemData?.name),
    rarity: nestedString(itemData, "rarity", "value"),
  };
}

function parseCombatSkills(value: unknown): SkportSyncedCombatSkill[] {
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : isRecord(value)
      ? Object.entries(value)
      : [];
  return entries.flatMap(([key, entry]) => {
    if (!isRecord(entry)) {
      return [];
    }
    const id = asString(entry.skillId) ?? key;
    const level = asFiniteNumber(entry.level);
    if (!id || level == null) {
      return [];
    }
    return [{
      id,
      level,
      maxLevel: asFiniteNumber(entry.maxLevel),
    }];
  });
}

function createOperatorLookup(catalog: GameCatalog): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const operator of catalog.operators) {
    lookup.set(normalizeOperatorKey(operator.id), operator.id);
    lookup.set(normalizeOperatorKey(operator.name), operator.id);
  }
  for (const [sourceId, catalogOperatorId] of Object.entries(SKPORT_OPERATOR_ID_ALIASES)) {
    if (catalog.operators.some((operator) => operator.id === catalogOperatorId)) {
      lookup.set(normalizeOperatorKey(sourceId), catalogOperatorId);
    }
  }
  return lookup;
}

export function parseSkportRosterImport(input: unknown, catalog: GameCatalog): SkportRosterImportPreview {
  const detail = extractCardDetail(input);
  const base = nestedRecord(detail, "base")!;
  const isTeamUserGameData = base.importSource === "team-user-game-data";
  const inventorySnapshot = isRecord(detail.inventory)
    ? detail.inventory as unknown as SkportInventorySnapshot
    : undefined;
  const rawCharacters = Array.isArray(detail.chars) ? detail.chars : [];
  if (rawCharacters.length === 0) {
    throw new Error("The Endfield card-detail response contains no operators.");
  }

  const operatorLookup = createOperatorLookup(catalog);
  const matchedCatalogIds = new Set<string>();
  const characters = rawCharacters.flatMap((rawCharacter): SkportRosterImportCharacter[] => {
    if (!isRecord(rawCharacter)) {
      return [];
    }
    const charData = nestedRecord(rawCharacter, "charData");
    const sourceOperatorId = asString(rawCharacter.id) ?? asString(charData?.id);
    const sourceName = asString(charData?.name);
    if (!sourceOperatorId || !sourceName) {
      return [];
    }
    const catalogOperatorId = operatorLookup.get(normalizeOperatorKey(sourceName))
      ?? operatorLookup.get(normalizeOperatorKey(sourceOperatorId));
    const uniqueCatalogOperatorId = catalogOperatorId && !matchedCatalogIds.has(catalogOperatorId)
      ? catalogOperatorId
      : undefined;
    if (uniqueCatalogOperatorId) {
      matchedCatalogIds.add(uniqueCatalogOperatorId);
    }
    const gear = [
      parseGear(rawCharacter.bodyEquip, "body"),
      parseGear(rawCharacter.armEquip, "arm"),
      parseGear(rawCharacter.firstAccessory, "accessory_1"),
      parseGear(rawCharacter.secondAccessory, "accessory_2"),
    ].filter((entry): entry is SkportSyncedGear => entry != null);
    const snapshot: SkportOwnedOperatorSnapshot = {
      sourceOperatorId,
      potentialLevel: asFiniteNumber(rawCharacter.potentialLevel),
      weapon: parseWeapon(rawCharacter.weapon),
      gear,
      tacticalItem: parseTacticalItem(rawCharacter.tacticalItem),
      combatSkills: parseCombatSkills(rawCharacter.userSkills),
    };
    return [{
      sourceOperatorId,
      sourceName,
      catalogOperatorId: uniqueCatalogOperatorId,
      level: clampInteger(rawCharacter.level, 1, 90, 1),
      promotionTier: clampInteger(rawCharacter.evolvePhase, 0, 4, 0) as 0 | 1 | 2 | 3 | 4,
      snapshot,
    }];
  });

  if (characters.length === 0) {
    throw new Error("The Endfield card-detail response did not contain recognizable operator records.");
  }
  if (matchedCatalogIds.size === 0) {
    throw new Error("None of the SKPort operators matched the active catalog. Confirm that the response is for Endfield and uses operator names supported by this catalog.");
  }

  const reportedOperatorCount = asFiniteNumber(base.charNum);
  const completeRoster = reportedOperatorCount != null
    && reportedOperatorCount >= 0
    && characters.length >= reportedOperatorCount;
  const unmatchedOperatorNames = characters
    .filter((character) => !character.catalogOperatorId
      && !SKPORT_NON_ASSIGNABLE_OPERATOR_NAMES.has(normalizeOperatorKey(character.sourceName)))
    .map((character) => character.sourceName);
  const warnings: string[] = [];
  if (!completeRoster) {
    warnings.push(
      reportedOperatorCount == null
        ? "SKPort did not report a total roster size. Operators absent from this capture will be preserved."
        : `SKPort reports ${reportedOperatorCount} owned operators, but this capture contains ${characters.length}. Operators absent from this partial capture will be preserved.`,
    );
  }
  if (unmatchedOperatorNames.length > 0) {
    warnings.push(`No catalog match was found for: ${unmatchedOperatorNames.join(", ")}.`);
  }
  warnings.push("SKPort does not expose Dijiang Base Skill unlocks in this payload, so existing Base Skill selections will be preserved.");
  warnings.push(isTeamUserGameData
    ? "SKPort Team Picks reports operator progression and inventory ownership, but not each operator's equipped loadout; existing equipped-loadout snapshots are replaced with the reported combat-skill levels."
    : "Only equipped weapons, gear, and tactical items are present; unequipped inventory and essences are not available in this payload.");

  return {
    characters,
    sourceOperatorCount: characters.length,
    reportedOperatorCount,
    matchedOperatorCount: characters.filter((character) => character.catalogOperatorId).length,
    completeRoster,
    sourceSavedAt: normalizeTimestamp(base.saveTime),
    weaponCount: inventorySnapshot?.weapons.length ?? characters.filter((character) => character.snapshot.weapon).length,
    gearCount: inventorySnapshot?.gear.reduce((count, entry) => count + entry.ownedCount, 0) ?? characters.reduce((count, character) => count + character.snapshot.gear.length, 0),
    tacticalItemCount: inventorySnapshot?.tacticalItems.reduce((count, entry) => count + entry.ownedCount, 0) ?? characters.filter((character) => character.snapshot.tacticalItem).length,
    combatSkillCount: characters.reduce((count, character) => count + character.snapshot.combatSkills.length, 0),
    inventorySnapshot,
    unmatchedOperatorNames,
    warnings,
  };
}

export function parseSkportRosterImportText(text: string, catalog: GameCatalog): SkportRosterImportPreview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("SKPort roster import requires a valid JSON or HAR file.");
  }
  return parseSkportRosterImport(parsed, catalog);
}

export function applySkportRosterImport(
  scenario: OptimizationScenario,
  preview: SkportRosterImportPreview,
  importedAt = new Date().toISOString(),
): SkportRosterImportResult {
  const importedByCatalogId = new Map(
    preview.characters.flatMap((character) => character.catalogOperatorId
      ? [[character.catalogOperatorId, character] as const]
      : []),
  );
  let updatedOperatorCount = 0;
  let clearedOperatorCount = 0;
  const roster = scenario.roster.map((entry) => {
    const imported = importedByCatalogId.get(entry.operatorId);
    if (imported) {
      updatedOperatorCount += 1;
      return {
        ...entry,
        owned: true,
        level: imported.level,
        promotionTier: imported.promotionTier,
        skportSnapshot: imported.snapshot,
      };
    }
    if (preview.completeRoster) {
      if (entry.owned || entry.skportSnapshot) {
        clearedOperatorCount += 1;
      }
      return {
        ...entry,
        owned: false,
        level: 1,
        promotionTier: 0 as const,
        skportSnapshot: undefined,
      };
    }
    return entry;
  });

  return {
    scenario: {
      ...scenario,
      roster,
      rosterImport: {
        provider: "skport",
        importedAt,
        sourceSavedAt: preview.sourceSavedAt,
        sourceOperatorCount: preview.sourceOperatorCount,
        matchedOperatorCount: preview.matchedOperatorCount,
        completeRoster: preview.completeRoster,
        inventory: preview.inventorySnapshot,
      },
    },
    updatedOperatorCount,
    clearedOperatorCount,
    warnings: preview.warnings,
  };
}
