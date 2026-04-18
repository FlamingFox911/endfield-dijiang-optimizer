import type {
  CatalogBundle,
  CatalogGap,
  CatalogManifest,
  CatalogVersion,
  DataConfidence,
  DemandProfile,
  DemandProfilePreset,
  FacilityDefinition,
  FacilityKind,
  GameCatalog,
  ImageAsset,
  LevelProgressionMilestone,
  MaterialCost,
  OptimizationProfile,
  OptimizationScenario,
  OperatorBaseProgressionRequirement,
  OperatorExpItemDefinition,
  OperatorDefinition,
  ProgressionDocument,
  ProductKind,
  PromotionTierProgression,
  RecipeDefinition,
  SourceRef,
  UpgradeRankingMode,
  ValidationIssue,
  ValidationResult,
  MigrationChange,
  MigrationResult,
} from "@endfield/domain";

export const CURRENT_CATALOG_VERSION: CatalogVersion = "2026-04-17/v1.2";
export const CURRENT_CATALOG_BUNDLE_ID = "2026-04-17-v1.2";
export const CURRENT_SCENARIO_FORMAT_VERSION = 1 as const;
export const EXAMPLE_SCENARIOS_DIR = "scenarios/examples" as const;
export const MAX_OPERATOR_LEVEL = 90 as const;

export const CATALOG_LIBRARY_POLICY = {
  distributionModel: "bundled_with_app",
  v1UpdateFlow: "install_new_app_version_for_new_catalog",
  updateCadence: "rare_major_version_updates",
  runtimeNetworkRequirement: "none_for_normal_use",
  futureExtension: "optional_side_loadable_catalog_packs",
} as const;

export interface CatalogCoverageSummary {
  operators: number;
  facilities: number;
  recipes: number;
  assets: number;
  sources: number;
  gaps: number;
}

export interface CatalogBundleStatus {
  summary: CatalogCoverageSummary;
  countMismatches: Array<{
    key: string;
    expected: number;
    actual: number;
  }>;
  releaseBlockers: string[];
  releaseReady: boolean;
}

export interface CatalogHydrationStats {
  addedOperators: number;
  addedBaseSkillStates: number;
  preservedUnknownOperators: number;
}

export interface CatalogHydrationResult {
  scenario: OptimizationScenario;
  hydrated: boolean;
  changes: MigrationChange[];
  stats: CatalogHydrationStats;
}

const DEFAULT_SLOT_CAPS = {
  control_nexus: { 1: 1, 2: 2, 3: 3, 4: 3, 5: 3 },
  manufacturing_cabin: { 1: 1, 2: 2, 3: 3 },
  growth_chamber: { 1: 1, 2: 2, 3: 3 },
  reception_room: { 1: 1, 2: 2, 3: 3 },
} as const;

export function clampOperatorLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 1;
  }

  return Math.min(MAX_OPERATOR_LEVEL, Math.max(1, Math.trunc(level)));
}

const DEFAULT_GROWTH_SLOT_CAPS = { 1: 3, 2: 6, 3: 9 } as const;
const OPTIMIZATION_PROFILES = ["fast", "balanced", "thorough", "exhaustive", "custom"] as const satisfies OptimizationProfile[];
const OPTIMIZATION_PROFILE_EFFORTS: Record<Exclude<OptimizationProfile, "custom">, number> = {
  fast: 8,
  balanced: 18,
  thorough: 30,
  exhaustive: 45,
};
export const DEMAND_PROFILE_PRESETS = [
  "balanced",
  "operator_exp",
  "weapon_exp",
  "growth",
  "fungal",
  "vitrified_plant",
  "rare_mineral",
  "reception",
  "custom",
] as const satisfies DemandProfilePreset[];
const MAX_DEMAND_WEIGHT = 4;
const DEFAULT_OPTIMIZATION_PROFILE: OptimizationProfile = "balanced";
const DEFAULT_OPTIMIZATION_EFFORT = OPTIMIZATION_PROFILE_EFFORTS[DEFAULT_OPTIMIZATION_PROFILE];
const MAX_OPTIMIZATION_EFFORT = 100;
const DEFAULT_PRODUCT_WEIGHTS: Record<ProductKind, number> = {
  operator_exp: 1,
  weapon_exp: 1,
  fungal: 1,
  vitrified_plant: 1,
  rare_mineral: 1,
};
const DEMAND_PROFILE_PRESET_OVERRIDES: Record<
  Exclude<DemandProfilePreset, "custom">,
  {
    productWeights?: Partial<Record<ProductKind, number>>;
    receptionWeight?: number;
  }
> = {
  balanced: {},
  operator_exp: {
    productWeights: {
      operator_exp: 2.5,
      weapon_exp: 0.75,
      fungal: 0.75,
      vitrified_plant: 0.75,
      rare_mineral: 0.75,
    },
    receptionWeight: 0.75,
  },
  weapon_exp: {
    productWeights: {
      operator_exp: 0.75,
      weapon_exp: 2.5,
      fungal: 0.75,
      vitrified_plant: 0.75,
      rare_mineral: 0.75,
    },
    receptionWeight: 0.75,
  },
  growth: {
    productWeights: {
      operator_exp: 0.8,
      weapon_exp: 0.8,
      fungal: 2,
      vitrified_plant: 2,
      rare_mineral: 2,
    },
    receptionWeight: 0.75,
  },
  fungal: {
    productWeights: {
      operator_exp: 0.8,
      weapon_exp: 0.8,
      fungal: 2.5,
      vitrified_plant: 0.8,
      rare_mineral: 0.8,
    },
    receptionWeight: 0.75,
  },
  vitrified_plant: {
    productWeights: {
      operator_exp: 0.8,
      weapon_exp: 0.8,
      fungal: 0.8,
      vitrified_plant: 2.5,
      rare_mineral: 0.8,
    },
    receptionWeight: 0.75,
  },
  rare_mineral: {
    productWeights: {
      operator_exp: 0.8,
      weapon_exp: 0.8,
      fungal: 0.8,
      vitrified_plant: 0.8,
      rare_mineral: 2.5,
    },
    receptionWeight: 0.75,
  },
  reception: {
    productWeights: {
      operator_exp: 0.8,
      weapon_exp: 0.8,
      fungal: 0.8,
      vitrified_plant: 0.8,
      rare_mineral: 0.8,
    },
    receptionWeight: 2.5,
  },
};

function clampOptimizationEffort(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_OPTIMIZATION_EFFORT;
  }
  return Math.min(MAX_OPTIMIZATION_EFFORT, Math.max(1, Math.round(value)));
}

export function clampDemandWeight(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.min(MAX_DEMAND_WEIGHT, Math.max(0, Math.round(value * 4) / 4));
}

export function createDefaultDemandProfile(): DemandProfile {
  return {
    preset: "balanced",
    productWeights: { ...DEFAULT_PRODUCT_WEIGHTS },
    receptionWeight: 1,
  };
}

export function resolveDemandProfile(demandProfile?: DemandProfile): DemandProfile {
  const normalized = demandProfile ?? createDefaultDemandProfile();
  const productWeightsInput = normalized.productWeights ?? DEFAULT_PRODUCT_WEIGHTS;
  const productWeights = {
    operator_exp: clampDemandWeight(productWeightsInput.operator_exp),
    weapon_exp: clampDemandWeight(productWeightsInput.weapon_exp),
    fungal: clampDemandWeight(productWeightsInput.fungal),
    vitrified_plant: clampDemandWeight(productWeightsInput.vitrified_plant),
    rare_mineral: clampDemandWeight(productWeightsInput.rare_mineral),
  } satisfies Record<ProductKind, number>;

  if (normalized.preset === "custom") {
    return {
      preset: "custom",
      productWeights,
      receptionWeight: clampDemandWeight(normalized.receptionWeight),
      priorityRecipeId: normalized.priorityRecipeId,
    };
  }

  const preset = DEMAND_PROFILE_PRESET_OVERRIDES[normalized.preset];
  return {
    preset: normalized.preset,
    productWeights: {
      ...DEFAULT_PRODUCT_WEIGHTS,
      ...preset.productWeights,
    },
    receptionWeight: preset.receptionWeight ?? 1,
    priorityRecipeId: normalized.priorityRecipeId,
  };
}

const MAX_LAYOUT_DEFAULTS = {
  manufacturing_cabin: 2,
  growth_chamber: 1,
  reception_room: 1,
} as const;

const ROOM_UNLOCK_THRESHOLDS = {
  manufacturing_cabin: [1, 3],
  growth_chamber: [2],
  reception_room: [3],
} as const;

const ROOM_LEVEL_CAPS_BY_CONTROL_NEXUS = {
  manufacturing_cabin: { 1: 1, 2: 2, 3: 2, 4: 3, 5: 3 },
  growth_chamber: { 1: 0, 2: 1, 3: 2, 4: 2, 5: 3 },
  reception_room: { 1: 0, 2: 0, 3: 1, 4: 2, 5: 3 },
} as const;

const PRODUCT_KINDS = [
  "operator_exp",
  "weapon_exp",
  "fungal",
  "vitrified_plant",
  "rare_mineral",
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeIssue(
  code: string,
  path: string,
  message: string,
  severity: "error" | "warning" = "error",
): ValidationIssue {
  return { code, path, message, severity };
}

function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.severity}:${issue.code}:${issue.path}:${issue.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function inferConfidenceFromSources(sourceRefs: SourceRef[] | undefined): DataConfidence {
  if (!sourceRefs || sourceRefs.length === 0) {
    return "heuristic";
  }
  if (sourceRefs.some((ref) => ref.confidence === "manual_override" || ref.confidence === "inferred")) {
    return "provisional";
  }
  return "verified";
}

function withConfidence<T extends { sourceRefs?: SourceRef[]; dataConfidence?: DataConfidence }>(record: T): T {
  return {
    ...record,
    dataConfidence: record.dataConfidence ?? inferConfidenceFromSources(record.sourceRefs),
  };
}

function dedupeSourceRefs(sourceRefs: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const merged: SourceRef[] = [];
  for (const sourceRef of sourceRefs) {
    if (seen.has(sourceRef.id)) {
      continue;
    }
    seen.add(sourceRef.id);
    merged.push(sourceRef);
  }
  return merged;
}

function requireAsset(assetById: Map<string, ImageAsset>, assetId: string, context: string): ImageAsset {
  const asset = assetById.get(assetId);
  if (!asset) {
    throw new Error(`${context} references missing asset '${assetId}'.`);
  }

  return asset;
}

export function createProjectedOutputs(): Record<(typeof PRODUCT_KINDS)[number], number> {
  return {
    operator_exp: 0,
    weapon_exp: 0,
    fungal: 0,
    vitrified_plant: 0,
    rare_mineral: 0,
  };
}

function getBaseSkillProgressionKey(skillSlot: number, rank: number): string {
  return `${skillSlot}:${rank}`;
}

function getPromotionTierProgressionKey(promotionTier: number): string {
  return `${promotionTier}`;
}

function createBaseSkillUnlockHint(
  operatorName: string,
  skillName: string,
  label: string,
  promotionTier: number,
  requiredLevel: number,
): string {
  return `Raise ${operatorName} to Elite ${promotionTier} Level ${requiredLevel} to unlock ${skillName} ${label}.`;
}

function mergeMaterialCosts(...materialCostLists: MaterialCost[][]): MaterialCost[] {
  const merged = new Map<string, number>();
  for (const materialCosts of materialCostLists) {
    for (const cost of materialCosts) {
      merged.set(cost.itemId, (merged.get(cost.itemId) ?? 0) + cost.quantity);
    }
  }

  return Array.from(merged.entries()).map(([itemId, quantity]) => ({ itemId, quantity }));
}

function decomposeExpToMaterials(
  expAmount: number,
  items: OperatorExpItemDefinition[],
): MaterialCost[] {
  if (expAmount <= 0) {
    return [];
  }

  let remaining = expAmount;
  const materialCosts: MaterialCost[] = [];
  const sortedItems = [...items].sort((left, right) => right.expValue - left.expValue);

  for (const item of sortedItems) {
    if (remaining <= 0) {
      break;
    }

    const quantity = Math.floor(remaining / item.expValue);
    if (quantity > 0) {
      materialCosts.push({ itemId: item.itemId, quantity });
      remaining -= quantity * item.expValue;
    }
  }

  if (remaining > 0 && sortedItems.length > 0) {
    const fallbackItem = sortedItems[sortedItems.length - 1]!;
    materialCosts.push({
      itemId: fallbackItem.itemId,
      quantity: Math.ceil(remaining / fallbackItem.expValue),
    });
  }

  return materialCosts;
}

function getMilestoneFloor(
  milestones: LevelProgressionMilestone[],
  level: number,
): LevelProgressionMilestone | undefined {
  return [...milestones]
    .filter((milestone) => milestone.level <= level)
    .sort((left, right) => right.level - left.level)[0];
}

export function getPromotionTierRequirement(
  catalog: GameCatalog,
  operatorId: string,
  promotionTier: 1 | 2 | 3 | 4,
): PromotionTierProgression | undefined {
  const sharedRequirement = catalog.progression.promotionTiers.find(
    (entry) => entry.promotionTier === promotionTier,
  );

  if (!sharedRequirement) {
    return undefined;
  }

  const operatorOverride = catalog.progression.promotionOverrides.find(
    (entry) => entry.operatorId === operatorId && entry.promotionTier === promotionTier,
  );

  return {
    ...sharedRequirement,
    materialCosts: mergeMaterialCosts(
      sharedRequirement.materialCosts,
      operatorOverride?.additionalMaterialCosts ?? [],
    ),
    sourceRefs: dedupeSourceRefs([
      ...sharedRequirement.sourceRefs,
      ...(operatorOverride?.sourceRefs ?? []),
    ]),
  };
}

export function getBaseSkillRankRequirement(
  catalog: GameCatalog,
  skillSlot: 1 | 2,
  rank: 1 | 2,
) {
  return catalog.progression.baseSkillRanks.find(
    (entry) => entry.skillSlot === skillSlot && entry.rank === rank,
  );
}

export function estimateLevelingRequirement(
  catalog: GameCatalog,
  currentLevel: number,
  targetLevel: 20 | 40 | 60 | 80 | 90,
): {
  levelExpCost: number;
  levelTCredCost: number;
  levelMaterialCosts: MaterialCost[];
  levelCostIsUpperBound: boolean;
} | undefined {
  if (currentLevel >= targetLevel) {
    return {
      levelExpCost: 0,
      levelTCredCost: 0,
      levelMaterialCosts: [],
      levelCostIsUpperBound: false,
    };
  }

  const milestones = [...catalog.progression.levelMilestones].sort((left, right) => left.level - right.level);
  const targetMilestone = milestones.find((milestone) => milestone.level === targetLevel);
  if (!targetMilestone) {
    return undefined;
  }

  const floorMilestone = getMilestoneFloor(milestones, currentLevel);
  const floorLevel = floorMilestone?.level ?? 1;
  const floorExp = floorMilestone?.cumulativeExp ?? 0;
  const floorTCreds = floorMilestone?.cumulativeTCreds ?? 0;
  const levelExpCost = Math.max(targetMilestone.cumulativeExp - floorExp, 0);
  const levelTCredCost = Math.max(targetMilestone.cumulativeTCreds - floorTCreds, 0);

  const combatExpItems = catalog.progression.expItems.filter((item) => item.maxLevel === 60);
  const cognitiveExpItems = catalog.progression.expItems.filter((item) => item.minLevel === 61);

  const combatUpperBoundExp =
    floorLevel < 60
      ? Math.max(
        Math.min(targetLevel, 60) === 60
          ? (milestones.find((milestone) => milestone.level === 60)?.cumulativeExp ?? 0) - floorExp
          : targetMilestone.cumulativeExp - floorExp,
        0,
      )
      : 0;
  const cognitiveUpperBoundExp =
    targetLevel > 60
      ? Math.max(
        targetMilestone.cumulativeExp - (
          floorLevel >= 60
            ? floorExp
            : milestones.find((milestone) => milestone.level === 60)?.cumulativeExp ?? 0
        ),
        0,
      )
      : 0;

  const levelMaterialCosts = mergeMaterialCosts(
    decomposeExpToMaterials(combatUpperBoundExp, combatExpItems),
    decomposeExpToMaterials(cognitiveUpperBoundExp, cognitiveExpItems),
    levelTCredCost > 0 ? [{ itemId: "t-creds", quantity: levelTCredCost }] : [],
  );

  return {
    levelExpCost,
    levelTCredCost,
    levelMaterialCosts,
    levelCostIsUpperBound: currentLevel !== floorLevel,
  };
}

export function estimateOperatorMaxBaseProgressionRequirement(
  catalog: GameCatalog,
  operatorId: string,
  currentState?: Pick<OptimizationScenario["roster"][number], "level" | "promotionTier" | "baseSkillStates">,
): OperatorBaseProgressionRequirement | undefined {
  const operatorDef = catalog.operators.find((operator) => operator.id === operatorId);
  if (!operatorDef) {
    return undefined;
  }

  const levelingRequirement = estimateLevelingRequirement(catalog, currentState?.level ?? 1, 90);
  if (!levelingRequirement) {
    return undefined;
  }

  const promotionMaterialCosts = mergeMaterialCosts(
    ...Array.from(
      { length: Math.max(4 - (currentState?.promotionTier ?? 0), 0) },
      (_, offset) =>
        getPromotionTierRequirement(
          catalog,
          operatorId,
          ((currentState?.promotionTier ?? 0) + offset + 1) as 1 | 2 | 3 | 4,
        )?.materialCosts ?? [],
    ),
  );

  const skillMaterialCosts = mergeMaterialCosts(
    ...operatorDef.baseSkills.flatMap((skill) => {
      const currentRank = currentState?.baseSkillStates.find((state) => state.skillId === skill.id)?.unlockedRank ?? 0;
      return skill.ranks
        .filter((rankDef) => rankDef.rank > currentRank)
        .map((rankDef) => rankDef.materialCosts);
    }),
  );

  return {
    operatorId,
    targetLevel: 90,
    targetPromotionTier: 4,
    levelExpCost: levelingRequirement.levelExpCost,
    levelTCredCost: levelingRequirement.levelTCredCost,
    levelMaterialCosts: levelingRequirement.levelMaterialCosts,
    promotionMaterialCosts,
    skillMaterialCosts,
    materialCosts: mergeMaterialCosts(
      levelingRequirement.levelMaterialCosts,
      promotionMaterialCosts,
      skillMaterialCosts,
    ),
  };
}

export function toGameCatalog(bundle: CatalogBundle): GameCatalog {
  const baseSkillProgressionByKey = new Map(
    bundle.progression.baseSkillRanks.map((entry) => [
      getBaseSkillProgressionKey(entry.skillSlot, entry.rank),
      entry,
    ]),
  );
  const assets = bundle.assets.assets as ImageAsset[];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  return {
    version: bundle.manifest.catalogVersion,
    manifest: bundle.manifest,
    progression: {
      catalogVersion: bundle.progression.catalogVersion,
      baseSkillRanks: bundle.progression.baseSkillRanks.map((entry) => ({
        ...entry,
        sourceRefs: dedupeSourceRefs(entry.sourceRefs),
      })),
      promotionTiers: bundle.progression.promotionTiers.map((entry) => ({
        ...entry,
        sourceRefs: dedupeSourceRefs(entry.sourceRefs),
      })),
      promotionOverrides: bundle.progression.promotionOverrides.map((entry) => ({
        ...entry,
        sourceRefs: dedupeSourceRefs(entry.sourceRefs),
      })),
      levelMilestones: bundle.progression.levelMilestones.map((entry) => ({
        ...entry,
        sourceRefs: dedupeSourceRefs(entry.sourceRefs),
      })),
      expItems: bundle.progression.expItems.map((entry) => ({
        ...entry,
        sourceRefs: dedupeSourceRefs(entry.sourceRefs),
      })),
    },
    operators: bundle.operators.operators.map((operator) => ({
      ...withConfidence(operator),
      baseSkills: operator.baseSkills.map((skill, skillIndex) => ({
        ...withConfidence(skill),
        icon: requireAsset(assetById, skill.iconAssetId, `Base Skill '${operator.id}:${skill.id}'`),
        sourceRefs: dedupeSourceRefs(skill.sourceRefs),
        ranks: skill.ranks.map((rank) => {
          const progression = baseSkillProgressionByKey.get(
            getBaseSkillProgressionKey(skillIndex + 1, rank.rank),
          );
          const materialCosts = rank.materialCosts ?? progression?.materialCosts ?? [];
          const unlockHint = rank.unlockHint ?? (
            progression
              ? createBaseSkillUnlockHint(
                operator.name,
                skill.name,
                rank.label,
                progression.promotionTier,
                progression.requiredLevel,
              )
              : undefined
          );

          return {
            ...withConfidence(rank),
            materialCosts,
            unlockHint,
            sourceRefs: dedupeSourceRefs([
              ...rank.sourceRefs,
              ...(progression?.sourceRefs ?? []),
            ]),
            modifiers: rank.modifiers.map((modifier) => ({
              ...modifier,
              dataConfidence: modifier.dataConfidence ?? "verified",
            })),
          };
        }),
      })),
    })) as OperatorDefinition[],
    recipes: bundle.recipes.recipes.map((recipe) => withConfidence(recipe)) as RecipeDefinition[],
    facilities: bundle.facilities.facilities.map((facility) => ({
      ...withConfidence(facility),
      levels: facility.levels.map((level) => withConfidence(level)),
    })) as FacilityDefinition[],
    sources: bundle.sources.sources,
    gaps: bundle.gaps.gaps as CatalogGap[],
    assets,
  };
}

function validateSourceRefArray(
  sourceRefs: unknown,
  issuePrefix: string,
  knownSourceIds: Set<string> | undefined,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    issues.push(makeIssue("missing_source_refs", issuePrefix, `${issuePrefix} must include at least one source ref.`));
    return;
  }

  for (const ref of sourceRefs) {
    if (!isObject(ref) || typeof ref.id !== "string") {
      issues.push(makeIssue("invalid_source_ref", issuePrefix, `${issuePrefix} contains an invalid source ref.`));
      continue;
    }
    if (knownSourceIds && !knownSourceIds.has(ref.id)) {
      issues.push(
        makeIssue(
          "unknown_source_ref",
          issuePrefix,
          `${issuePrefix} references unknown source id '${ref.id}'.`,
        ),
      );
    }
  }
}

function validateManifest(manifest: unknown, issues: ValidationIssue[]): manifest is CatalogManifest {
  if (!isObject(manifest)) {
    issues.push(makeIssue("invalid_manifest", "manifest", "manifest.json must contain an object."));
    return false;
  }

  for (const key of ["catalogId", "catalogVersion", "gameVersion", "snapshotDate", "files"]) {
    if (!(key in manifest)) {
      issues.push(makeIssue("manifest_missing_key", `manifest.${key}`, `manifest.json is missing required key '${key}'.`));
    }
  }

  if (!isObject(manifest.files)) {
    issues.push(makeIssue("invalid_manifest_files", "manifest.files", "manifest.json files must be an object."));
    return false;
  }

  for (const key of ["progression", "operators", "facilities", "recipes", "sources", "gaps", "assets"]) {
    if (typeof manifest.files[key] !== "string") {
      issues.push(
        makeIssue("manifest_file_path", `manifest.files.${key}`, `manifest.json files.${key} must be a string path.`),
      );
    }
  }

  return true;
}

function validateCatalogSection<T extends keyof CatalogBundle>(
  sectionName: string,
  data: CatalogBundle[T],
  key: string,
  issues: ValidationIssue[],
): unknown[] {
  if (!isObject(data)) {
    issues.push(makeIssue("invalid_catalog_section", sectionName, `${sectionName} must contain an object root.`));
    return [];
  }

  if (typeof data.catalogVersion !== "string") {
    issues.push(makeIssue("missing_catalog_version", sectionName, `${sectionName} is missing catalogVersion.`));
  }

  const entries = data[key as keyof typeof data];
  if (!Array.isArray(entries)) {
    issues.push(makeIssue("missing_section_entries", sectionName, `${sectionName} must contain an array at '${key}'.`));
    return [];
  }

  return entries;
}

export function validateCatalogBundle(bundle: CatalogBundle): ValidationResult {
  const issues: ValidationIssue[] = [];
  validateManifest(bundle.manifest, issues);

  const sourceEntries = validateCatalogSection("sources.json", bundle.sources, "sources", issues);
  const sourceIds = new Set<string>();
  for (const source of sourceEntries) {
    if (!isObject(source) || typeof source.id !== "string") {
      issues.push(makeIssue("invalid_source_entry", "sources", "sources.json contains an invalid source entry."));
      continue;
    }
    if (sourceIds.has(source.id)) {
      issues.push(makeIssue("duplicate_source", `sources.${source.id}`, `sources.json contains duplicate source id '${source.id}'.`));
    }
    sourceIds.add(source.id);
  }

  const assetEntries = validateCatalogSection("assets.json", bundle.assets, "assets", issues);
  const assetIds = new Set<string>();
  for (const asset of assetEntries) {
    if (!isObject(asset) || typeof asset.id !== "string") {
      issues.push(makeIssue("invalid_asset_entry", "assets", "assets.json contains an invalid asset entry."));
      continue;
    }
    if (assetIds.has(asset.id)) {
      issues.push(makeIssue("duplicate_asset", `assets.${asset.id}`, `assets.json contains duplicate asset id '${asset.id}'.`));
    }
    assetIds.add(asset.id);
    if (typeof asset.path !== "string" || asset.path.length === 0) {
      issues.push(makeIssue("invalid_asset_path", `assets.${asset.id}.path`, `assets.json asset '${asset.id}' must contain a path.`));
    }
    if (asset.kind !== "portrait" && asset.kind !== "facility" && asset.kind !== "icon") {
      issues.push(makeIssue("invalid_asset_kind", `assets.${asset.id}.kind`, `assets.json asset '${asset.id}' must use kind portrait, facility, or icon.`));
    }
  }

  const progression = bundle.progression;
  if (!isObject(progression)) {
    issues.push(makeIssue("invalid_progression", "progression", "progression.json must contain an object root."));
  } else {
    if (typeof progression.catalogVersion !== "string") {
      issues.push(makeIssue("missing_catalog_version", "progression", "progression.json is missing catalogVersion."));
    }
    if (!Array.isArray(progression.baseSkillRanks) || progression.baseSkillRanks.length === 0) {
      issues.push(
        makeIssue(
          "missing_base_skill_progression",
          "progression.baseSkillRanks",
          "progression.json must contain baseSkillRanks.",
        ),
      );
    } else {
      const progressionKeys = new Set<string>();
      for (const entry of progression.baseSkillRanks) {
        if (!isObject(entry)) {
          issues.push(
            makeIssue(
              "invalid_base_skill_progression_entry",
              "progression.baseSkillRanks",
              "progression.json contains an invalid Base Skill progression entry.",
            ),
          );
          continue;
        }

        const skillSlot = entry.skillSlot;
        const rank = entry.rank;
        if ((skillSlot !== 1 && skillSlot !== 2) || (rank !== 1 && rank !== 2)) {
          issues.push(
            makeIssue(
              "invalid_base_skill_progression_key",
              "progression.baseSkillRanks",
              "progression.json Base Skill progression entries must use skillSlot 1|2 and rank 1|2.",
            ),
          );
          continue;
        }

        const key = getBaseSkillProgressionKey(skillSlot, rank);
        if (progressionKeys.has(key)) {
          issues.push(
            makeIssue(
              "duplicate_base_skill_progression",
              `progression.baseSkillRanks.${key}`,
              `progression.json contains duplicate Base Skill progression '${key}'.`,
            ),
          );
        }
        progressionKeys.add(key);
        validateSourceRefArray(
          entry.sourceRefs,
          `progression.json Base Skill progression '${key}'`,
          sourceIds,
          issues,
        );
      }
    }

    if (!Array.isArray(progression.promotionTiers)) {
      issues.push(
        makeIssue(
          "missing_promotion_tiers",
          "progression.promotionTiers",
          "progression.json must contain promotionTiers.",
        ),
      );
    } else {
      const promotionTierKeys = new Set<string>();
      for (const entry of progression.promotionTiers) {
        if (!isObject(entry)) {
          issues.push(
            makeIssue(
              "invalid_promotion_tier_entry",
              "progression.promotionTiers",
              "progression.json contains an invalid promotion tier entry.",
            ),
          );
          continue;
        }

        const promotionTier = entry.promotionTier;
        if (promotionTier !== 1 && promotionTier !== 2 && promotionTier !== 3 && promotionTier !== 4) {
          issues.push(
            makeIssue(
              "invalid_promotion_tier_key",
              "progression.promotionTiers",
              "progression.json promotion tier entries must use promotionTier 1|2|3|4.",
            ),
          );
          continue;
        }

        const key = getPromotionTierProgressionKey(promotionTier);
        if (promotionTierKeys.has(key)) {
          issues.push(
            makeIssue(
              "duplicate_promotion_tier",
              `progression.promotionTiers.${key}`,
              `progression.json contains duplicate promotion tier '${key}'.`,
            ),
          );
        }
        promotionTierKeys.add(key);
        validateSourceRefArray(
          entry.sourceRefs,
          `progression.json promotion tier '${key}'`,
          sourceIds,
          issues,
        );
      }
    }

    if (!Array.isArray(progression.promotionOverrides)) {
      issues.push(
        makeIssue(
          "missing_promotion_overrides",
          "progression.promotionOverrides",
          "progression.json must contain promotionOverrides.",
        ),
      );
    } else {
      const promotionOverrideKeys = new Set<string>();
      for (const [index, entry] of progression.promotionOverrides.entries()) {
        if (!isObject(entry) || typeof entry.operatorId !== "string") {
          issues.push(
            makeIssue(
              "invalid_promotion_override_entry",
              "progression.promotionOverrides",
              "progression.json contains an invalid promotion override entry.",
            ),
          );
          continue;
        }

        if (
          entry.promotionTier !== 1 &&
          entry.promotionTier !== 2 &&
          entry.promotionTier !== 3 &&
          entry.promotionTier !== 4
        ) {
          issues.push(
            makeIssue(
              "invalid_promotion_override_tier",
              `progression.promotionOverrides.${index}`,
              "progression.json promotion overrides must use promotionTier 1|2|3|4.",
            ),
          );
        }

        const key = `${entry.operatorId}:${entry.promotionTier}`;
        if (promotionOverrideKeys.has(key)) {
          issues.push(
            makeIssue(
              "duplicate_promotion_override",
              `progression.promotionOverrides.${index}`,
              `progression.json contains duplicate promotion override '${key}'.`,
            ),
          );
        }
        promotionOverrideKeys.add(key);

        if (!Array.isArray(entry.additionalMaterialCosts) || entry.additionalMaterialCosts.length === 0) {
          issues.push(
            makeIssue(
              "missing_promotion_override_costs",
              `progression.promotionOverrides.${index}`,
              `progression.json promotion override '${key}' must contain additionalMaterialCosts.`,
            ),
          );
        }

        validateSourceRefArray(
          entry.sourceRefs,
          `progression.json promotion override '${key}'`,
          sourceIds,
          issues,
        );
      }
    }

    if (!Array.isArray(progression.levelMilestones)) {
      issues.push(
        makeIssue(
          "missing_level_milestones",
          "progression.levelMilestones",
          "progression.json must contain levelMilestones.",
        ),
      );
    } else {
      const milestoneLevels = new Set<number>();
      for (const [index, entry] of progression.levelMilestones.entries()) {
        if (
          !isObject(entry) ||
          typeof entry.level !== "number" ||
          typeof entry.cumulativeExp !== "number" ||
          typeof entry.cumulativeTCreds !== "number"
        ) {
          issues.push(
            makeIssue(
              "invalid_level_milestone",
              `progression.levelMilestones.${index}`,
              "progression.json contains an invalid level milestone entry.",
            ),
          );
          continue;
        }

        if (milestoneLevels.has(entry.level)) {
          issues.push(
            makeIssue(
              "duplicate_level_milestone",
              `progression.levelMilestones.${entry.level}`,
              `progression.json contains duplicate level milestone '${entry.level}'.`,
            ),
          );
        }
        milestoneLevels.add(entry.level);
        validateSourceRefArray(
          entry.sourceRefs,
          `progression.json level milestone '${entry.level}'`,
          sourceIds,
          issues,
        );
      }
    }

    if (!Array.isArray(progression.expItems)) {
      issues.push(
        makeIssue(
          "missing_exp_items",
          "progression.expItems",
          "progression.json must contain expItems.",
        ),
      );
    } else {
      const expItemIds = new Set<string>();
      for (const [index, entry] of progression.expItems.entries()) {
        if (
          !isObject(entry) ||
          typeof entry.itemId !== "string" ||
          typeof entry.name !== "string" ||
          typeof entry.expValue !== "number"
        ) {
          issues.push(
            makeIssue(
              "invalid_exp_item",
              `progression.expItems.${index}`,
              "progression.json contains an invalid EXP item entry.",
            ),
          );
          continue;
        }

        if (expItemIds.has(entry.itemId)) {
          issues.push(
            makeIssue(
              "duplicate_exp_item",
              `progression.expItems.${entry.itemId}`,
              `progression.json contains duplicate EXP item '${entry.itemId}'.`,
            ),
          );
        }
        expItemIds.add(entry.itemId);
        validateSourceRefArray(
          entry.sourceRefs,
          `progression.json EXP item '${entry.itemId}'`,
          sourceIds,
          issues,
        );
      }
    }
  }

  const progressionKeys = new Set(
    Array.isArray(bundle.progression?.baseSkillRanks)
      ? bundle.progression.baseSkillRanks
        .filter((entry): entry is ProgressionDocument["baseSkillRanks"][number] => isObject(entry))
        .map((entry) => getBaseSkillProgressionKey(entry.skillSlot, entry.rank))
      : [],
  );

  const operators = validateCatalogSection("operators.json", bundle.operators, "operators", issues);
  const operatorIds = new Set<string>();
  for (const operator of operators) {
    if (!isObject(operator) || typeof operator.id !== "string") {
      issues.push(makeIssue("invalid_operator", "operators", "operators.json contains an invalid operator entry."));
      continue;
    }
    if (operatorIds.has(operator.id)) {
      issues.push(makeIssue("duplicate_operator", `operators.${operator.id}`, `operators.json contains duplicate operator id '${operator.id}'.`));
    }
    operatorIds.add(operator.id);
    validateSourceRefArray(operator.sourceRefs, `operators.json operator '${operator.id}'`, sourceIds, issues);

    if (!Array.isArray(operator.baseSkills)) {
      issues.push(makeIssue("missing_base_skills", `operators.${operator.id}.baseSkills`, `operators.json operator '${operator.id}' must contain baseSkills.`));
      continue;
    }

    for (let skillIndex = 0; skillIndex < operator.baseSkills.length; skillIndex += 1) {
      const skill = operator.baseSkills[skillIndex];
      if (!isObject(skill) || typeof skill.id !== "string") {
        issues.push(makeIssue("invalid_skill", `operators.${operator.id}`, `operators.json operator '${operator.id}' contains an invalid Base Skill.`));
        continue;
      }
      if (typeof skill.iconAssetId !== "string" || skill.iconAssetId.length === 0) {
        issues.push(
          makeIssue(
            "missing_skill_icon_asset",
            `operators.${operator.id}.baseSkills.${skill.id}.iconAssetId`,
            `operators.json Base Skill '${skill.id}' must contain iconAssetId.`,
          ),
        );
      } else if (!assetIds.has(skill.iconAssetId)) {
        issues.push(
          makeIssue(
            "unknown_skill_icon_asset",
            `operators.${operator.id}.baseSkills.${skill.id}.iconAssetId`,
            `operators.json Base Skill '${skill.id}' references unknown asset id '${skill.iconAssetId}'.`,
          ),
        );
      }
      validateSourceRefArray(skill.sourceRefs, `operators.json Base Skill '${skill.id}'`, sourceIds, issues);
      if (!Array.isArray(skill.ranks) || skill.ranks.length === 0) {
        issues.push(
          makeIssue(
            "missing_skill_ranks",
            `operators.${operator.id}.baseSkills.${skill.id}.ranks`,
            `operators.json Base Skill '${skill.id}' must contain ranks.`,
          ),
        );
        continue;
      }

      for (let rankIndex = 0; rankIndex < skill.ranks.length; rankIndex += 1) {
        const rank = skill.ranks[rankIndex];
        if (!isObject(rank) || typeof rank.rank !== "number") {
          issues.push(
            makeIssue(
              "invalid_skill_rank",
              `operators.${operator.id}.baseSkills.${skill.id}.ranks`,
              `operators.json Base Skill '${skill.id}' contains an invalid rank entry.`,
            ),
          );
          continue;
        }
        validateSourceRefArray(
          rank.sourceRefs,
          `operators.json Base Skill rank '${skill.id}:${rank.rank}'`,
          sourceIds,
          issues,
        );

        if (
          !rank.materialCosts &&
          !rank.unlockHint &&
          !progressionKeys.has(getBaseSkillProgressionKey(skillIndex + 1, rank.rank))
        ) {
          issues.push(
            makeIssue(
              "missing_rank_progression",
              `operators.${operator.id}.baseSkills.${skill.id}.ranks.${rank.rank}`,
              `operators.json Base Skill rank '${skill.id}:${rank.rank}' must provide rank progression directly or via progression.json.`,
            ),
          );
        }
      }
    }
  }

  for (const override of Array.isArray(bundle.progression?.promotionOverrides)
    ? bundle.progression.promotionOverrides
    : []) {
    if (!isObject(override) || typeof override.operatorId !== "string") {
      continue;
    }

    if (!operatorIds.has(override.operatorId)) {
      issues.push(
        makeIssue(
          "unknown_promotion_override_operator",
          `progression.promotionOverrides.${override.operatorId}`,
          `progression.json promotion override references unknown operator id '${override.operatorId}'.`,
        ),
      );
    }
  }

  const facilities = validateCatalogSection("facilities.json", bundle.facilities, "facilities", issues);
  const facilityIds = new Set<string>();
  for (const facility of facilities) {
    if (!isObject(facility) || typeof facility.id !== "string") {
      issues.push(makeIssue("invalid_facility", "facilities", "facilities.json contains an invalid facility entry."));
      continue;
    }
    if (facilityIds.has(facility.id)) {
      issues.push(makeIssue("duplicate_facility", `facilities.${facility.id}`, `facilities.json contains duplicate facility id '${facility.id}'.`));
    }
    facilityIds.add(facility.id);
    validateSourceRefArray(facility.sourceRefs, `facilities.json facility '${facility.id}'`, sourceIds, issues);
    if (!Array.isArray(facility.levels) || facility.levels.length === 0) {
      issues.push(makeIssue("missing_facility_levels", `facilities.${facility.id}.levels`, `facilities.json facility '${facility.id}' must contain levels.`));
    }
  }

  const recipes = validateCatalogSection("recipes.json", bundle.recipes, "recipes", issues);
  const recipeIds = new Set<string>();
  for (const recipe of recipes) {
    if (!isObject(recipe) || typeof recipe.id !== "string") {
      issues.push(makeIssue("invalid_recipe", "recipes", "recipes.json contains an invalid recipe entry."));
      continue;
    }
    if (recipeIds.has(recipe.id)) {
      issues.push(makeIssue("duplicate_recipe", `recipes.${recipe.id}`, `recipes.json contains duplicate recipe id '${recipe.id}'.`));
    }
    recipeIds.add(recipe.id);
    validateSourceRefArray(recipe.sourceRefs, `recipes.json recipe '${recipe.id}'`, sourceIds, issues);
  }

  validateCatalogSection("gaps.json", bundle.gaps, "gaps", issues);

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues: dedupeIssues(issues),
  };
}

export function listSelectableRecipes(
  catalog: GameCatalog,
  facilityKind: Extract<FacilityKind, "manufacturing_cabin" | "growth_chamber">,
  roomLevel: number,
): RecipeDefinition[] {
  return [...catalog.recipes]
    .filter((recipe) => recipe.facilityKind === facilityKind && recipe.roomLevel <= roomLevel)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getFacilityDefinition(catalog: GameCatalog, kind: FacilityKind) {
  return catalog.facilities.find((facility) => facility.kind === kind);
}

function getFacilityLevelDefinition(catalog: GameCatalog, kind: FacilityKind, level: number) {
  return getFacilityDefinition(catalog, kind)?.levels.find((entry) => entry.level === level);
}

export function getRoomSlotCap(
  catalog: GameCatalog,
  roomKind: FacilityKind,
  roomLevel: number,
  controlNexusLevel: number,
): number {
  if (roomKind === "control_nexus") {
    return (
      getFacilityLevelDefinition(catalog, roomKind, roomLevel)?.slotCap ??
      DEFAULT_SLOT_CAPS.control_nexus[controlNexusLevel as 1 | 2 | 3 | 4 | 5] ??
      0
    );
  }

  return (
    getFacilityLevelDefinition(catalog, roomKind, roomLevel)?.slotCap ??
    DEFAULT_SLOT_CAPS[roomKind][roomLevel as keyof (typeof DEFAULT_SLOT_CAPS)[typeof roomKind]] ??
    0
  );
}

export function getMaxFacilityRoomCounts(): typeof MAX_LAYOUT_DEFAULTS {
  return MAX_LAYOUT_DEFAULTS;
}

export function getUnlockedFacilityRoomCount(
  roomKind: Exclude<FacilityKind, "control_nexus">,
  controlNexusLevel: number,
): number {
  const thresholds = ROOM_UNLOCK_THRESHOLDS[roomKind];
  return thresholds.filter((threshold) => controlNexusLevel >= threshold).length;
}

export function getFacilityLevelCapForControlNexus(
  roomKind: Exclude<FacilityKind, "control_nexus">,
  controlNexusLevel: number,
): number {
  return (
    ROOM_LEVEL_CAPS_BY_CONTROL_NEXUS[roomKind][controlNexusLevel as 1 | 2 | 3 | 4 | 5] ??
    0
  );
}

export function getGrowthSlotCap(
  catalog: GameCatalog,
  roomLevel: number,
): number {
  return (
    getFacilityLevelDefinition(catalog, "growth_chamber", roomLevel)?.growthSlotCap ??
    DEFAULT_GROWTH_SLOT_CAPS[roomLevel as 1 | 2 | 3] ??
    0
  );
}

export function createStarterScenario(catalog: GameCatalog): OptimizationScenario {
  const firstManufacturingRecipe = listSelectableRecipes(catalog, "manufacturing_cabin", 1)[0];

  return {
    scenarioFormatVersion: CURRENT_SCENARIO_FORMAT_VERSION,
    catalogVersion: catalog.version,
    roster: catalog.operators.map((operator) => ({
      operatorId: operator.id,
      owned: false,
      level: 1,
      promotionTier: 0,
      baseSkillStates: operator.baseSkills.map((skill) => ({
        skillId: skill.id,
        unlockedRank: 0,
      })),
    })),
    facilities: {
      controlNexus: { level: 1 },
      manufacturingCabins: [
        {
          id: "mfg-1",
          enabled: true,
          level: 1,
          fixedRecipeId: firstManufacturingRecipe?.id,
        },
        {
          id: "mfg-2",
          enabled: false,
          level: 1,
        },
      ],
      growthChambers: [
        {
          id: "growth-1",
          enabled: false,
          level: 1,
          fixedRecipeIds: [],
        },
      ],
      receptionRoom: {
        id: "reception-1",
        enabled: false,
        level: 1,
      },
      hardAssignments: [],
    },
    options: {
      maxFacilities: false,
      upgradeRankingMode: "balanced",
      optimizationProfile: DEFAULT_OPTIMIZATION_PROFILE,
      optimizationEffort: DEFAULT_OPTIMIZATION_EFFORT,
      demandProfile: createDefaultDemandProfile(),
    },
  };
}

function createRosterEntryForOperator(
  operator: OperatorDefinition,
): OptimizationScenario["roster"][number] {
  return {
    operatorId: operator.id,
    owned: false,
    level: 1,
    promotionTier: 0,
    baseSkillStates: operator.baseSkills.map((skill) => ({
      skillId: skill.id,
      unlockedRank: 0,
    })),
  };
}

export function hydrateScenarioForCatalog(
  catalog: GameCatalog,
  scenario: OptimizationScenario,
): CatalogHydrationResult {
  const nextScenario = structuredClone(scenario);
  const changes: MigrationChange[] = [];
  const stats: CatalogHydrationStats = {
    addedOperators: 0,
    addedBaseSkillStates: 0,
    preservedUnknownOperators: 0,
  };

  const rosterById = new Map(nextScenario.roster.map((entry) => [entry.operatorId, entry]));
  const catalogOperatorIds = new Set(catalog.operators.map((operator) => operator.id));
  const unknownOperators = nextScenario.roster.filter((entry) => !catalogOperatorIds.has(entry.operatorId));

  if (nextScenario.catalogVersion !== catalog.version) {
    changes.push({
      path: "catalogVersion",
      message: `Updated scenario catalogVersion from '${nextScenario.catalogVersion}' to '${catalog.version}'.`,
    });
    nextScenario.catalogVersion = catalog.version;
  }

  nextScenario.roster = catalog.operators.map((operator) => {
    const existing = rosterById.get(operator.id);
    if (!existing) {
      stats.addedOperators += 1;
      changes.push({
        path: `roster.${operator.id}`,
        message: `Added missing operator '${operator.name}' from catalog '${catalog.version}'.`,
      });
      return createRosterEntryForOperator(operator);
    }

    const skillStateById = new Map(existing.baseSkillStates.map((state) => [state.skillId, state]));
    const extraSkillStates = existing.baseSkillStates.filter(
      (state) => !operator.baseSkills.some((skill) => skill.id === state.skillId),
    );
    const baseSkillStates = operator.baseSkills.map((skill) => {
      const existingState = skillStateById.get(skill.id);
      if (existingState) {
        return existingState;
      }

      stats.addedBaseSkillStates += 1;
      changes.push({
        path: `roster.${operator.id}.baseSkillStates.${skill.id}`,
        message: `Added missing Base Skill state '${skill.name}' for '${operator.name}'.`,
      });
      return {
        skillId: skill.id,
        unlockedRank: 0 as const,
      };
    });

    return {
      operatorId: existing.operatorId,
      owned: existing.owned,
      level: existing.level,
      promotionTier: existing.promotionTier,
      baseSkillStates: [...baseSkillStates, ...extraSkillStates],
    };
  });

  if (unknownOperators.length > 0) {
    stats.preservedUnknownOperators = unknownOperators.length;
    changes.push({
      path: "roster",
      message: `Preserved ${unknownOperators.length} operator entr${unknownOperators.length === 1 ? "y" : "ies"} that are not present in catalog '${catalog.version}'.`,
    });
    nextScenario.roster.push(...unknownOperators);
  }

  while (nextScenario.facilities.manufacturingCabins.length < MAX_LAYOUT_DEFAULTS.manufacturing_cabin) {
    const roomNumber = nextScenario.facilities.manufacturingCabins.length + 1;
    nextScenario.facilities.manufacturingCabins.push({
      id: `mfg-${roomNumber}`,
      enabled: roomNumber === 1,
      level: 1,
    });
    changes.push({
      path: `facilities.manufacturingCabins.${roomNumber - 1}`,
      message: `Added missing Manufacturing Cabin placeholder 'mfg-${roomNumber}'.`,
    });
  }

  while (nextScenario.facilities.growthChambers.length < MAX_LAYOUT_DEFAULTS.growth_chamber) {
    const roomNumber = nextScenario.facilities.growthChambers.length + 1;
    nextScenario.facilities.growthChambers.push({
      id: `growth-${roomNumber}`,
      enabled: false,
      level: 1,
      fixedRecipeIds: [],
    });
    changes.push({
      path: `facilities.growthChambers.${roomNumber - 1}`,
      message: `Added missing Growth Chamber placeholder 'growth-${roomNumber}'.`,
    });
  }

  if (!nextScenario.facilities.receptionRoom) {
    nextScenario.facilities.receptionRoom = {
      id: "reception-1",
      enabled: false,
      level: 1,
    };
    changes.push({
      path: "facilities.receptionRoom",
      message: "Added missing Reception Room placeholder 'reception-1'.",
    });
  }

  return {
    scenario: nextScenario,
    hydrated: changes.length > 0,
    changes,
    stats,
  };
}

export function migrateScenario(input: unknown): MigrationResult {
  const raw = isObject(input) ? structuredClone(input) as Record<string, unknown> : {};
  const issues: ValidationIssue[] = [];
  const changes: { path: string; message: string }[] = [];

  const inferredVersion =
    typeof raw.scenarioFormatVersion === "number" ? raw.scenarioFormatVersion : 0;

  if (inferredVersion !== CURRENT_SCENARIO_FORMAT_VERSION) {
    raw.scenarioFormatVersion = CURRENT_SCENARIO_FORMAT_VERSION;
    changes.push({
      path: "scenarioFormatVersion",
      message: `Set scenarioFormatVersion to ${CURRENT_SCENARIO_FORMAT_VERSION}.`,
    });
  }

  if (!isObject(raw.options)) {
    raw.options = {};
    changes.push({
      path: "options",
      message: "Created missing options object during migration.",
    });
  }

  const options = raw.options as Record<string, unknown>;
  if (options.upgradeRankingMode == null) {
    options.upgradeRankingMode = "balanced";
    changes.push({
      path: "options.upgradeRankingMode",
      message: "Defaulted missing upgradeRankingMode to 'balanced'.",
    });
  }
  if (options.optimizationProfile == null || !OPTIMIZATION_PROFILES.includes(options.optimizationProfile as OptimizationProfile)) {
    options.optimizationProfile = DEFAULT_OPTIMIZATION_PROFILE;
    changes.push({
      path: "options.optimizationProfile",
      message: `Defaulted missing optimizationProfile to '${DEFAULT_OPTIMIZATION_PROFILE}'.`,
    });
  }
  const normalizedProfile = options.optimizationProfile as OptimizationProfile;
  const defaultEffortForProfile = normalizedProfile === "custom"
    ? DEFAULT_OPTIMIZATION_EFFORT
    : OPTIMIZATION_PROFILE_EFFORTS[normalizedProfile];
  const nextEffort = options.optimizationEffort == null
    ? defaultEffortForProfile
    : clampOptimizationEffort(options.optimizationEffort);
  if (options.optimizationEffort !== nextEffort) {
    options.optimizationEffort = nextEffort;
    changes.push({
      path: "options.optimizationEffort",
      message: `Defaulted optimizationEffort to ${nextEffort}.`,
    });
  }
  if (!isObject(options.demandProfile)) {
    options.demandProfile = createDefaultDemandProfile();
    changes.push({
      path: "options.demandProfile",
      message: "Defaulted missing demandProfile to the balanced objective preset.",
    });
  }
  else {
    const demandProfile = options.demandProfile as Record<string, unknown>;
    const nextPreset = demandProfile.preset != null && DEMAND_PROFILE_PRESETS.includes(demandProfile.preset as DemandProfilePreset)
      ? demandProfile.preset as DemandProfilePreset
      : "balanced";
    if (demandProfile.preset !== nextPreset) {
      demandProfile.preset = nextPreset;
      changes.push({
        path: "options.demandProfile.preset",
        message: `Defaulted invalid demandProfile preset to '${nextPreset}'.`,
      });
    }

    const currentProductWeights = isObject(demandProfile.productWeights)
      ? demandProfile.productWeights as Record<string, unknown>
      : {};
    const nextProductWeights = {
      operator_exp: clampDemandWeight(currentProductWeights.operator_exp),
      weapon_exp: clampDemandWeight(currentProductWeights.weapon_exp),
      fungal: clampDemandWeight(currentProductWeights.fungal),
      vitrified_plant: clampDemandWeight(currentProductWeights.vitrified_plant),
      rare_mineral: clampDemandWeight(currentProductWeights.rare_mineral),
    };
    if (JSON.stringify(demandProfile.productWeights) !== JSON.stringify(nextProductWeights)) {
      demandProfile.productWeights = nextProductWeights;
      changes.push({
        path: "options.demandProfile.productWeights",
        message: "Normalized demandProfile product weights.",
      });
    }

    const nextReceptionWeight = clampDemandWeight(demandProfile.receptionWeight);
    if (demandProfile.receptionWeight !== nextReceptionWeight) {
      demandProfile.receptionWeight = nextReceptionWeight;
      changes.push({
        path: "options.demandProfile.receptionWeight",
        message: `Normalized demandProfile receptionWeight to ${nextReceptionWeight}.`,
      });
    }

    if (demandProfile.priorityRecipeId != null && typeof demandProfile.priorityRecipeId !== "string") {
      delete demandProfile.priorityRecipeId;
      changes.push({
        path: "options.demandProfile.priorityRecipeId",
        message: "Removed invalid priorityRecipeId because it was not a string.",
      });
    }
  }

  if (typeof raw.catalogVersion !== "string") {
    issues.push(
      makeIssue(
        "missing_catalog_version",
        "catalogVersion",
        "Scenario is missing catalogVersion and still needs manual repair after migration.",
        "warning",
      ),
    );
    raw.catalogVersion = CURRENT_CATALOG_VERSION;
    changes.push({
      path: "catalogVersion",
      message: `Defaulted missing catalogVersion to '${CURRENT_CATALOG_VERSION}'.`,
    });
  }

  if (!Array.isArray(raw.roster)) {
    raw.roster = [];
    changes.push({
      path: "roster",
      message: "Defaulted missing roster to an empty array during migration.",
    });
  }

  if (!isObject(raw.facilities)) {
    raw.facilities = {};
    changes.push({
      path: "facilities",
      message: "Created missing facilities object during migration.",
    });
  }

  const facilities = raw.facilities as Record<string, unknown>;
  if (!isObject(facilities.controlNexus)) {
    facilities.controlNexus = { level: 1 };
    changes.push({
      path: "facilities.controlNexus",
      message: "Defaulted missing controlNexus to level 1.",
    });
  }

  if (!Array.isArray(facilities.manufacturingCabins)) {
    facilities.manufacturingCabins = [];
    changes.push({
      path: "facilities.manufacturingCabins",
      message: "Defaulted missing manufacturingCabins to an empty array.",
    });
  }

  const manufacturingCabins = facilities.manufacturingCabins as Record<string, unknown>[];

  while (manufacturingCabins.length < MAX_LAYOUT_DEFAULTS.manufacturing_cabin) {
    const roomNumber = manufacturingCabins.length + 1;
    manufacturingCabins.push({
      id: `mfg-${roomNumber}`,
      enabled: roomNumber === 1,
      level: 1,
    });
    changes.push({
      path: `facilities.manufacturingCabins.${roomNumber - 1}`,
      message: `Added missing Manufacturing Cabin placeholder 'mfg-${roomNumber}'.`,
    });
  }

  if (!Array.isArray(facilities.growthChambers)) {
    facilities.growthChambers = [];
    changes.push({
      path: "facilities.growthChambers",
      message: "Defaulted missing growthChambers to an empty array.",
    });
  }

  const growthChambers = facilities.growthChambers as Record<string, unknown>[];

  while (growthChambers.length < MAX_LAYOUT_DEFAULTS.growth_chamber) {
    const roomNumber = growthChambers.length + 1;
    growthChambers.push({
      id: `growth-${roomNumber}`,
      enabled: false,
      level: 1,
      fixedRecipeIds: [],
    });
    changes.push({
      path: `facilities.growthChambers.${roomNumber - 1}`,
      message: `Added missing Growth Chamber placeholder 'growth-${roomNumber}'.`,
    });
  }

  for (const room of growthChambers) {
    if (isObject(room) && Array.isArray(room.fixedRecipeIds)) {
      continue;
    }
    if (isObject(room) && typeof room.fixedRecipeId === "string") {
      room.fixedRecipeIds = [room.fixedRecipeId];
      delete room.fixedRecipeId;
      changes.push({
        path: "facilities.growthChambers[].fixedRecipeIds",
        message: "Migrated Growth Chamber fixedRecipeId to fixedRecipeIds[].",
      });
    } else if (isObject(room) && room.fixedRecipeIds == null) {
      room.fixedRecipeIds = [];
      changes.push({
        path: "facilities.growthChambers[].fixedRecipeIds",
        message: "Defaulted missing Growth Chamber fixedRecipeIds to an empty array.",
      });
    }
  }

  if (!isObject(facilities.receptionRoom)) {
    facilities.receptionRoom = {
      id: "reception-1",
      enabled: false,
      level: 1,
    };
    changes.push({
      path: "facilities.receptionRoom",
      message: "Added missing Reception Room placeholder 'reception-1'.",
    });
  }

  if (!Array.isArray(facilities.hardAssignments)) {
    facilities.hardAssignments = [];
    changes.push({
      path: "facilities.hardAssignments",
      message: "Defaulted missing hardAssignments to an empty array.",
    });
  }
  else {
    for (const assignment of facilities.hardAssignments) {
      if (isObject(assignment) && "slotIndex" in assignment) {
        delete assignment.slotIndex;
        changes.push({
          path: "facilities.hardAssignments[].slotIndex",
          message: "Removed deprecated hard-assignment slotIndex field.",
        });
      }
    }
  }

  if (typeof options.maxFacilities !== "boolean") {
    options.maxFacilities = false;
    changes.push({
      path: "options.maxFacilities",
      message: "Defaulted missing maxFacilities to false.",
    });
  }

  if (typeof options.includeReceptionRoom === "boolean") {
    if (options.includeReceptionRoom === false && isObject(facilities.receptionRoom)) {
      facilities.receptionRoom.enabled = false;
      changes.push({
        path: "facilities.receptionRoom.enabled",
        message: "Migrated deprecated options.includeReceptionRoom=false to facilities.receptionRoom.enabled=false.",
      });
    }

    delete options.includeReceptionRoom;
    changes.push({
      path: "options.includeReceptionRoom",
      message: "Removed deprecated includeReceptionRoom option.",
    });
  }

  if ("planningMode" in options) {
    delete options.planningMode;
    changes.push({
      path: "options.planningMode",
      message: "Removed deprecated planningMode option.",
    });
  }

  if ("horizonHours" in options) {
    delete options.horizonHours;
    changes.push({
      path: "options.horizonHours",
      message: "Removed deprecated horizonHours option; solver now assumes steady-state planning.",
    });
  }

  const scenario = raw as unknown as OptimizationScenario;
  const structuralValidation = validateScenarioShape(scenario);
  issues.push(...structuralValidation);

  return {
    ok: structuralValidation.every((issue) => issue.severity !== "error"),
    fromFormatVersion: inferredVersion,
    toFormatVersion: CURRENT_SCENARIO_FORMAT_VERSION,
    migrated: changes.length > 0,
    scenario,
    changes,
    warnings: issues,
  };
}

export function validateScenarioAgainstCatalog(
  catalog: GameCatalog,
  scenario: OptimizationScenario,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const structuralIssues = validateScenarioShape(scenario);
  issues.push(...structuralIssues);
  if (structuralIssues.some((issue) => issue.severity === "error")) {
    return {
      ok: false,
      issues: dedupeIssues(issues),
    };
  }
  const operatorIds = new Set(catalog.operators.map((operator) => operator.id));
  const recipeIds = new Set(catalog.recipes.map((recipe) => recipe.id));
  const recipesById = new Map(catalog.recipes.map((recipe) => [recipe.id, recipe]));
  const roomIds = new Set<string>(["control_nexus"]);
  const roomSpecs = new Map<string, { roomKind: FacilityKind; level: number; slotCap: number; active: boolean }>();
  const ownedOperatorIds = new Set<string>();

  roomSpecs.set("control_nexus", {
    roomKind: "control_nexus",
    level: scenario.facilities.controlNexus.level,
    slotCap: getRoomSlotCap(
      catalog,
      "control_nexus",
      scenario.facilities.controlNexus.level,
      scenario.facilities.controlNexus.level,
    ),
    active: true,
  });

  if (scenario.scenarioFormatVersion !== CURRENT_SCENARIO_FORMAT_VERSION) {
    issues.push(
      makeIssue(
        "scenario_format_mismatch",
        "scenarioFormatVersion",
        `Scenario format ${scenario.scenarioFormatVersion} does not match supported format ${CURRENT_SCENARIO_FORMAT_VERSION}.`,
      ),
    );
  }

  if (scenario.catalogVersion !== catalog.version) {
    issues.push(
      makeIssue(
        "catalog_version_mismatch",
        "catalogVersion",
        `Scenario catalogVersion '${scenario.catalogVersion}' does not match installed bundle '${catalog.version}'.`,
      ),
    );
  }

  for (const operator of scenario.roster) {
    if (!operatorIds.has(operator.operatorId)) {
      issues.push(
        makeIssue(
          "unknown_operator",
          `roster.${operator.operatorId}`,
          `Scenario references unknown operator '${operator.operatorId}'.`,
        ),
      );
    }
    if (operator.owned) {
      ownedOperatorIds.add(operator.operatorId);
    }
  }

  const unlockedManufacturingRooms = getUnlockedFacilityRoomCount(
    "manufacturing_cabin",
    scenario.facilities.controlNexus.level,
  );
  const manufacturingLevelCap = getFacilityLevelCapForControlNexus(
    "manufacturing_cabin",
    scenario.facilities.controlNexus.level,
  );

  for (const [roomIndex, room] of scenario.facilities.manufacturingCabins.entries()) {
    const roomUnlocked = roomIndex < unlockedManufacturingRooms;
    const effectiveLevel = roomUnlocked ? Math.min(room.level, manufacturingLevelCap) : 0;
    roomIds.add(room.id);
    roomSpecs.set(room.id, {
      roomKind: "manufacturing_cabin",
      level: effectiveLevel,
      slotCap: roomUnlocked
        ? getRoomSlotCap(
          catalog,
          "manufacturing_cabin",
          effectiveLevel,
          scenario.facilities.controlNexus.level,
        )
        : 0,
      active: room.enabled && roomUnlocked,
    });
    if (roomIndex >= unlockedManufacturingRooms && room.enabled) {
      issues.push(
        makeIssue(
          "room_locked",
          `facilities.manufacturingCabins.${room.id}.enabled`,
          `Manufacturing cabin '${room.id}' is saved as enabled, but stays inactive until Control Nexus level 3.`,
          "warning",
        ),
      );
    }
    if (room.enabled && room.level > manufacturingLevelCap) {
      issues.push(
        makeIssue(
          "room_level_locked",
          `facilities.manufacturingCabins.${room.id}.level`,
          `Manufacturing cabin '${room.id}' is set to level ${room.level}, but Control Nexus level ${scenario.facilities.controlNexus.level} only supports level ${manufacturingLevelCap}. Optimization uses level ${manufacturingLevelCap} for now.`,
          "warning",
        ),
      );
    }
    if (room.fixedRecipeId && !recipeIds.has(room.fixedRecipeId)) {
      issues.push(
        makeIssue(
          "unknown_recipe",
          `facilities.manufacturingCabins.${room.id}.fixedRecipeId`,
          `Scenario room '${room.id}' references unknown recipe '${room.fixedRecipeId}'.`,
        ),
      );
    }
    if (room.fixedRecipeId) {
      const recipe = recipesById.get(room.fixedRecipeId);
      if (recipe && recipe.facilityKind !== "manufacturing_cabin") {
        issues.push(
          makeIssue(
            "invalid_recipe_room_kind",
            `facilities.manufacturingCabins.${room.id}.fixedRecipeId`,
            `Recipe '${room.fixedRecipeId}' is not valid for manufacturing cabin '${room.id}'.`,
          ),
        );
      }
      if (recipe && recipe.roomLevel > room.level) {
        issues.push(
          makeIssue(
            "recipe_level_too_high",
            `facilities.manufacturingCabins.${room.id}.fixedRecipeId`,
            `Recipe '${room.fixedRecipeId}' requires room level ${recipe.roomLevel}, but '${room.id}' is level ${room.level}.`,
            "warning",
          ),
        );
      }
      if (recipe && room.enabled && roomUnlocked && recipe.roomLevel > effectiveLevel) {
        issues.push(
          makeIssue(
            "recipe_level_current_cap",
            `facilities.manufacturingCabins.${room.id}.fixedRecipeId`,
            `Recipe '${room.fixedRecipeId}' requires room level ${recipe.roomLevel}, but current optimization only uses level ${effectiveLevel} for '${room.id}' at Control Nexus level ${scenario.facilities.controlNexus.level}.`,
            "warning",
          ),
        );
      }
    }
  }

  const unlockedGrowthRooms = getUnlockedFacilityRoomCount(
    "growth_chamber",
    scenario.facilities.controlNexus.level,
  );
  const growthLevelCap = getFacilityLevelCapForControlNexus(
    "growth_chamber",
    scenario.facilities.controlNexus.level,
  );

  for (const [roomIndex, room] of scenario.facilities.growthChambers.entries()) {
    const roomUnlocked = roomIndex < unlockedGrowthRooms;
    const effectiveLevel = roomUnlocked ? Math.min(room.level, growthLevelCap) : 0;
    roomIds.add(room.id);
    roomSpecs.set(room.id, {
      roomKind: "growth_chamber",
      level: effectiveLevel,
      slotCap: roomUnlocked
        ? getRoomSlotCap(
          catalog,
          "growth_chamber",
          effectiveLevel,
          scenario.facilities.controlNexus.level,
        )
        : 0,
      active: room.enabled && roomUnlocked,
    });
    if (roomIndex >= unlockedGrowthRooms && room.enabled) {
      issues.push(
        makeIssue(
          "room_locked",
          `facilities.growthChambers.${room.id}.enabled`,
          `Growth chamber '${room.id}' is saved as enabled, but stays inactive until Control Nexus level 2.`,
          "warning",
        ),
      );
    }
    if (room.enabled && room.level > growthLevelCap) {
      issues.push(
        makeIssue(
          "room_level_locked",
          `facilities.growthChambers.${room.id}.level`,
          `Growth chamber '${room.id}' is set to level ${room.level}, but Control Nexus level ${scenario.facilities.controlNexus.level} only supports level ${growthLevelCap}. Optimization uses level ${growthLevelCap} for now.`,
          "warning",
        ),
      );
    }
    const growthSlotCap = getGrowthSlotCap(catalog, room.level);
    if ((room.fixedRecipeIds?.length ?? 0) > growthSlotCap) {
      issues.push(
        makeIssue(
          "growth_slot_overflow",
          `facilities.growthChambers.${room.id}.fixedRecipeIds`,
          `Growth chamber '${room.id}' has ${(room.fixedRecipeIds?.length ?? 0)} selected growth materials, but level ${room.level} only supports ${growthSlotCap} growth slots.`,
          "warning",
        ),
      );
    }
    const effectiveGrowthSlotCap = roomUnlocked ? getGrowthSlotCap(catalog, effectiveLevel) : 0;
    if (room.enabled && roomUnlocked && (room.fixedRecipeIds?.length ?? 0) > effectiveGrowthSlotCap) {
      issues.push(
        makeIssue(
          "growth_slot_current_cap",
          `facilities.growthChambers.${room.id}.fixedRecipeIds`,
          `Growth chamber '${room.id}' has ${(room.fixedRecipeIds?.length ?? 0)} selected growth materials, but current optimization only uses ${effectiveGrowthSlotCap} slot${effectiveGrowthSlotCap === 1 ? "" : "s"} at Control Nexus level ${scenario.facilities.controlNexus.level}.`,
          "warning",
        ),
      );
    }
    for (const [recipeIndex, recipeId] of (room.fixedRecipeIds ?? []).entries()) {
      if (!recipeIds.has(recipeId)) {
        issues.push(
          makeIssue(
            "unknown_recipe",
            `facilities.growthChambers.${room.id}.fixedRecipeIds.${recipeIndex}`,
            `Scenario room '${room.id}' references unknown recipe '${recipeId}'.`,
          ),
        );
        continue;
      }
      const recipe = recipesById.get(recipeId);
      if (recipe && recipe.facilityKind !== "growth_chamber") {
        issues.push(
          makeIssue(
            "invalid_recipe_room_kind",
            `facilities.growthChambers.${room.id}.fixedRecipeIds.${recipeIndex}`,
            `Recipe '${recipeId}' is not valid for growth chamber '${room.id}'.`,
          ),
        );
      }
      if (recipe && recipe.roomLevel > room.level) {
        issues.push(
          makeIssue(
            "recipe_level_too_high",
            `facilities.growthChambers.${room.id}.fixedRecipeIds.${recipeIndex}`,
            `Recipe '${recipeId}' requires room level ${recipe.roomLevel}, but '${room.id}' is level ${room.level}.`,
            "warning",
          ),
        );
      }
      if (recipe && room.enabled && roomUnlocked && recipe.roomLevel > effectiveLevel) {
        issues.push(
          makeIssue(
            "recipe_level_current_cap",
            `facilities.growthChambers.${room.id}.fixedRecipeIds.${recipeIndex}`,
            `Recipe '${recipeId}' requires room level ${recipe.roomLevel}, but current optimization only uses level ${effectiveLevel} for '${room.id}' at Control Nexus level ${scenario.facilities.controlNexus.level}.`,
            "warning",
          ),
        );
      }
    }
  }

  if (scenario.facilities.receptionRoom) {
    const unlockedReceptionRooms = getUnlockedFacilityRoomCount(
      "reception_room",
      scenario.facilities.controlNexus.level,
    );
    const receptionLevelCap = getFacilityLevelCapForControlNexus(
      "reception_room",
      scenario.facilities.controlNexus.level,
    );
    roomIds.add(scenario.facilities.receptionRoom.id);
    roomSpecs.set(scenario.facilities.receptionRoom.id, {
      roomKind: "reception_room",
      level: unlockedReceptionRooms > 0
        ? Math.min(scenario.facilities.receptionRoom.level, receptionLevelCap)
        : 0,
      slotCap: unlockedReceptionRooms > 0
        ? getRoomSlotCap(
          catalog,
          "reception_room",
          Math.min(scenario.facilities.receptionRoom.level, receptionLevelCap),
          scenario.facilities.controlNexus.level,
        )
        : 0,
      active: scenario.facilities.receptionRoom.enabled && unlockedReceptionRooms > 0,
    });
    if (unlockedReceptionRooms === 0 && scenario.facilities.receptionRoom.enabled) {
      issues.push(
        makeIssue(
          "room_locked",
          "facilities.receptionRoom.enabled",
          "Reception room is saved as enabled, but stays inactive until Control Nexus level 3.",
          "warning",
        ),
      );
    }
    if (scenario.facilities.receptionRoom.enabled && scenario.facilities.receptionRoom.level > receptionLevelCap) {
      issues.push(
        makeIssue(
          "room_level_locked",
          "facilities.receptionRoom.level",
          `Reception room is set to level ${scenario.facilities.receptionRoom.level}, but Control Nexus level ${scenario.facilities.controlNexus.level} only supports level ${receptionLevelCap}. Optimization uses level ${receptionLevelCap} for now.`,
          "warning",
        ),
      );
    }
  }

  const hardAssigned = new Set<string>();
  const roomAssignmentCounts = new Map<string, number>();
  for (const assignment of scenario.facilities.hardAssignments) {
    if (!ownedOperatorIds.has(assignment.operatorId)) {
      issues.push(
        makeIssue(
          "hard_assignment_not_owned",
          `facilities.hardAssignments.${assignment.operatorId}`,
          `Hard assignment references non-owned operator '${assignment.operatorId}'.`,
          "warning",
        ),
      );
    }
    if (!roomIds.has(assignment.roomId)) {
      issues.push(
        makeIssue(
          "hard_assignment_unknown_room",
          `facilities.hardAssignments.${assignment.operatorId}`,
          `Hard assignment references unknown room '${assignment.roomId}'.`,
        ),
      );
    }
    if (hardAssigned.has(assignment.operatorId)) {
      issues.push(
        makeIssue(
          "hard_assignment_duplicate",
          `facilities.hardAssignments.${assignment.operatorId}`,
          `Operator '${assignment.operatorId}' is hard-assigned more than once.`,
          "warning",
        ),
      );
    }
    const roomSpec = roomSpecs.get(assignment.roomId);
    if (roomSpec) {
      if (!roomSpec.active) {
        issues.push(
          makeIssue(
            "hard_assignment_inactive_room",
            `facilities.hardAssignments.${assignment.operatorId}`,
            `Hard assignment targets room '${assignment.roomId}', but that room is currently inactive and will be ignored by optimization.`,
            "warning",
          ),
        );
      }
      const currentCount = (roomAssignmentCounts.get(assignment.roomId) ?? 0) + 1;
      roomAssignmentCounts.set(assignment.roomId, currentCount);
      if (currentCount > roomSpec.slotCap) {
        issues.push(
          makeIssue(
            "hard_assignment_room_overflow",
            `facilities.hardAssignments.${assignment.operatorId}`,
            `Hard assignments exceed slot capacity for room '${assignment.roomId}'.`,
            "warning",
          ),
        );
      }
    }
    hardAssigned.add(assignment.operatorId);
  }

  const rankingMode = scenario.options.upgradeRankingMode ?? "balanced";
  if (!["fastest", "roi", "balanced"].includes(rankingMode)) {
    issues.push(
      makeIssue(
        "invalid_ranking_mode",
        "options.upgradeRankingMode",
        "Scenario options.upgradeRankingMode must be 'fastest', 'roi', or 'balanced'.",
      ),
    );
  }
  const optimizationProfile = scenario.options.optimizationProfile ?? DEFAULT_OPTIMIZATION_PROFILE;
  if (!OPTIMIZATION_PROFILES.includes(optimizationProfile)) {
    issues.push(
      makeIssue(
        "invalid_optimization_profile",
        "options.optimizationProfile",
        "Scenario options.optimizationProfile must be 'fast', 'balanced', 'thorough', 'exhaustive', or 'custom'.",
      ),
    );
  }
  if (
    scenario.options.optimizationEffort != null &&
    clampOptimizationEffort(scenario.options.optimizationEffort) !== scenario.options.optimizationEffort
  ) {
    issues.push(
        makeIssue(
          "invalid_optimization_effort",
          "options.optimizationEffort",
          `Scenario options.optimizationEffort must be an integer from 1 to ${MAX_OPTIMIZATION_EFFORT}.`,
        ),
      );
    }
  const inputDemandProfile = scenario.options.demandProfile;
  const resolvedDemandProfile = resolveDemandProfile(inputDemandProfile);
  if (
    inputDemandProfile?.preset != null &&
    inputDemandProfile.preset !== resolvedDemandProfile.preset
  ) {
    issues.push(
      makeIssue(
        "invalid_demand_profile_preset",
        "options.demandProfile.preset",
        `Scenario options.demandProfile.preset must be one of: ${DEMAND_PROFILE_PRESETS.join(", ")}.`,
      ),
    );
  }
  for (const productKind of PRODUCT_KINDS) {
    if (
      inputDemandProfile?.productWeights?.[productKind] != null &&
      clampDemandWeight(inputDemandProfile.productWeights[productKind]) !== inputDemandProfile.productWeights[productKind]
    ) {
      issues.push(
        makeIssue(
          "invalid_demand_profile_weight",
          `options.demandProfile.productWeights.${productKind}`,
          `Scenario options.demandProfile.productWeights.${productKind} must be a number from 0 to ${MAX_DEMAND_WEIGHT} in 0.25 increments.`,
        ),
      );
    }
  }
  if (
    inputDemandProfile?.receptionWeight != null &&
    clampDemandWeight(inputDemandProfile.receptionWeight) !== inputDemandProfile.receptionWeight
  ) {
    issues.push(
      makeIssue(
        "invalid_demand_profile_reception_weight",
        "options.demandProfile.receptionWeight",
        `Scenario options.demandProfile.receptionWeight must be a number from 0 to ${MAX_DEMAND_WEIGHT} in 0.25 increments.`,
      ),
    );
  }
  if (
    inputDemandProfile?.priorityRecipeId != null &&
    !catalog.recipes.some((recipe) => recipe.id === inputDemandProfile.priorityRecipeId)
  ) {
    issues.push(
      makeIssue(
        "invalid_demand_profile_priority_recipe",
        "options.demandProfile.priorityRecipeId",
        "Scenario options.demandProfile.priorityRecipeId must reference a bundled recipe id.",
      ),
    );
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues: dedupeIssues(issues),
  };
}

function validateScenarioShape(scenario: OptimizationScenario): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!scenario || typeof scenario !== "object") {
    return [
      makeIssue("invalid_scenario", "scenario", "Scenario must be an object."),
    ];
  }

  if (!Array.isArray(scenario.roster)) {
    issues.push(makeIssue("invalid_roster", "roster", "Scenario roster must be an array."));
  }
  else {
    for (const [index, operator] of scenario.roster.entries()) {
      const rosterPath = typeof operator?.operatorId === "string" ? `roster.${operator.operatorId}` : `roster.${index}`;
      if (!operator || typeof operator !== "object") {
        issues.push(makeIssue("invalid_roster_entry", rosterPath, "Each roster entry must be an object."));
        continue;
      }
      if (typeof operator.level !== "number" || !Number.isFinite(operator.level)) {
        issues.push(makeIssue("invalid_operator_level", `${rosterPath}.level`, "Scenario operator level must be a number."));
        continue;
      }
      if (operator.level < 1 || operator.level > MAX_OPERATOR_LEVEL) {
        issues.push(
          makeIssue(
            "invalid_operator_level",
            `${rosterPath}.level`,
            `Scenario operator level must be between 1 and ${MAX_OPERATOR_LEVEL}.`,
          ),
        );
      }
    }
  }

  if (!scenario.facilities || typeof scenario.facilities !== "object") {
    issues.push(makeIssue("invalid_facilities", "facilities", "Scenario facilities must be an object."));
    return issues;
  }

  if (!Array.isArray(scenario.facilities.manufacturingCabins)) {
    issues.push(
      makeIssue(
        "invalid_manufacturing_rooms",
        "facilities.manufacturingCabins",
        "Scenario facilities.manufacturingCabins must be an array.",
      ),
    );
  }
  else {
    for (const room of scenario.facilities.manufacturingCabins) {
      if (!room || typeof room.id !== "string" || typeof room.level !== "number" || typeof room.enabled !== "boolean") {
        issues.push(
          makeIssue(
            "invalid_manufacturing_room",
            "facilities.manufacturingCabins",
            "Each manufacturing cabin must include id, enabled, and level fields.",
          ),
        );
        break;
      }
    }
  }

  if (!Array.isArray(scenario.facilities.growthChambers)) {
    issues.push(
      makeIssue(
        "invalid_growth_rooms",
        "facilities.growthChambers",
        "Scenario facilities.growthChambers must be an array.",
      ),
    );
  }
  else {
    for (const room of scenario.facilities.growthChambers) {
      if (!room || typeof room.id !== "string" || typeof room.level !== "number" || typeof room.enabled !== "boolean") {
        issues.push(
          makeIssue(
            "invalid_growth_room",
            "facilities.growthChambers",
            "Each growth chamber must include id, enabled, and level fields.",
          ),
        );
        break;
      }
    }
  }

  if (!Array.isArray(scenario.facilities.hardAssignments)) {
    issues.push(
      makeIssue(
        "invalid_hard_assignments",
        "facilities.hardAssignments",
        "Scenario facilities.hardAssignments must be an array.",
      ),
    );
  }
  else {
    for (const assignment of scenario.facilities.hardAssignments) {
      if (!assignment || typeof assignment.operatorId !== "string" || typeof assignment.roomId !== "string") {
        issues.push(
          makeIssue(
            "invalid_hard_assignment",
            "facilities.hardAssignments",
            "Each hard assignment must include operatorId and roomId.",
          ),
        );
        break;
      }
    }
  }

  if (!scenario.options || typeof scenario.options !== "object") {
    issues.push(makeIssue("invalid_options", "options", "Scenario options must be an object."));
  }
  else {
    if (typeof scenario.options.maxFacilities !== "boolean") {
      issues.push(
        makeIssue(
          "invalid_max_facilities",
          "options.maxFacilities",
          "Scenario options.maxFacilities must be a boolean.",
        ),
      );
    }
    if (
      scenario.options.optimizationProfile != null &&
      !OPTIMIZATION_PROFILES.includes(scenario.options.optimizationProfile)
    ) {
      issues.push(
        makeIssue(
          "invalid_optimization_profile",
          "options.optimizationProfile",
          "Scenario options.optimizationProfile must be a supported profile string.",
        ),
      );
    }
    if (
      scenario.options.optimizationEffort != null &&
      (typeof scenario.options.optimizationEffort !== "number" || !Number.isFinite(scenario.options.optimizationEffort))
    ) {
      issues.push(
        makeIssue(
          "invalid_optimization_effort",
          "options.optimizationEffort",
          "Scenario options.optimizationEffort must be a number.",
        ),
      );
    }
    if (scenario.options.demandProfile != null) {
      if (typeof scenario.options.demandProfile !== "object") {
        issues.push(
          makeIssue(
            "invalid_demand_profile",
            "options.demandProfile",
            "Scenario options.demandProfile must be an object.",
          ),
        );
      }
      else {
        if (
          scenario.options.demandProfile.preset != null &&
          !DEMAND_PROFILE_PRESETS.includes(scenario.options.demandProfile.preset)
        ) {
          issues.push(
            makeIssue(
              "invalid_demand_profile_preset",
              "options.demandProfile.preset",
              "Scenario options.demandProfile.preset must be a supported profile string.",
            ),
          );
        }
        if (
          scenario.options.demandProfile.receptionWeight != null &&
          (typeof scenario.options.demandProfile.receptionWeight !== "number"
            || !Number.isFinite(scenario.options.demandProfile.receptionWeight))
        ) {
          issues.push(
            makeIssue(
              "invalid_demand_profile_reception_weight",
              "options.demandProfile.receptionWeight",
              "Scenario options.demandProfile.receptionWeight must be a number.",
            ),
          );
        }
        if (
          scenario.options.demandProfile.priorityRecipeId != null &&
          typeof scenario.options.demandProfile.priorityRecipeId !== "string"
        ) {
          issues.push(
            makeIssue(
              "invalid_demand_profile_priority_recipe",
              "options.demandProfile.priorityRecipeId",
              "Scenario options.demandProfile.priorityRecipeId must be a string.",
            ),
          );
        }
        if (
          !scenario.options.demandProfile.productWeights
          || typeof scenario.options.demandProfile.productWeights !== "object"
        ) {
          issues.push(
            makeIssue(
              "invalid_demand_profile_weights",
              "options.demandProfile.productWeights",
              "Scenario options.demandProfile.productWeights must be an object.",
            ),
          );
        }
      }
    }
  }

  if (!scenario.facilities.controlNexus || typeof scenario.facilities.controlNexus.level !== "number") {
    issues.push(
      makeIssue(
        "invalid_control_nexus",
        "facilities.controlNexus.level",
        "Scenario facilities.controlNexus.level must be a number.",
      ),
    );
  }

  return issues;
}

export async function fetchCatalogBundle(baseUrl = `/catalogs/${CURRENT_CATALOG_BUNDLE_ID}`): Promise<CatalogBundle> {
  const manifest = await fetchJson<CatalogManifest>(`${baseUrl}/manifest.json`);

  const [progression, operators, facilities, recipes, sources, gaps, assets] = await Promise.all([
    fetchJson<CatalogBundle["progression"]>(`${baseUrl}/${manifest.files.progression}`),
    fetchJson<CatalogBundle["operators"]>(`${baseUrl}/${manifest.files.operators}`),
    fetchJson<CatalogBundle["facilities"]>(`${baseUrl}/${manifest.files.facilities}`),
    fetchJson<CatalogBundle["recipes"]>(`${baseUrl}/${manifest.files.recipes}`),
    fetchJson<CatalogBundle["sources"]>(`${baseUrl}/${manifest.files.sources}`),
    fetchJson<CatalogBundle["gaps"]>(`${baseUrl}/${manifest.files.gaps}`),
    fetchJson<CatalogBundle["assets"]>(`${baseUrl}/${manifest.files.assets}`),
  ]);

  return {
    manifest,
    progression,
    operators,
    facilities,
    recipes,
    sources,
    gaps,
    assets,
  };
}

export async function fetchGameCatalog(baseUrl?: string): Promise<GameCatalog> {
  return toGameCatalog(await fetchCatalogBundle(baseUrl));
}

export function formatValidationIssues(issues: ValidationIssue[]): string {
  if (issues.length === 0) {
    return "No validation issues.";
  }
  return issues
    .map((issue) => `[${issue.severity}] ${issue.path}: ${issue.message}`)
    .join("\n");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch '${url}' (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export function getCatalogCoverageSummary(catalog: GameCatalog): CatalogCoverageSummary {
  return {
    operators: catalog.operators.length,
    facilities: catalog.facilities.length,
    recipes: catalog.recipes.length,
    assets: catalog.assets.length,
    sources: catalog.sources.length,
    gaps: catalog.gaps.length,
  };
}

export function getCatalogBundleStatus(bundle: CatalogBundle): CatalogBundleStatus {
  const summary = getCatalogCoverageSummary(toGameCatalog(bundle));
  const expectedCounts = bundle.manifest.counts ?? {};
  const countMismatches = Object.entries(expectedCounts)
    .filter(([key, expected]) => typeof expected === "number")
    .map(([key, expected]) => ({
      key,
      expected,
      actual: summary[key as keyof CatalogCoverageSummary] ?? 0,
    }))
    .filter((entry) => entry.expected !== entry.actual);

  const releaseBlockers = [...countMismatches.map(
    (entry) => `Manifest count '${entry.key}' expected ${entry.expected} but resolved ${entry.actual}.`,
  )];
  const normalizedNotes = (bundle.manifest.notes ?? []).map((note) => note.toLowerCase());

  if (bundle.gaps.gaps.length > 0) {
    releaseBlockers.push(
      `Bundle declares ${bundle.gaps.gaps.length} unresolved catalog gap${bundle.gaps.gaps.length === 1 ? "" : "s"}.`,
    );
  }

  if (normalizedNotes.some((note) => /\b(seed|incomplete|partial)\b/.test(note))) {
    releaseBlockers.push("Manifest notes mark the bundle as seed or incomplete.");
  }

  return {
    summary,
    countMismatches,
    releaseBlockers,
    releaseReady: releaseBlockers.length === 0,
  };
}

export function resolveRankingMode(mode: UpgradeRankingMode | undefined): UpgradeRankingMode {
  return mode ?? "balanced";
}
