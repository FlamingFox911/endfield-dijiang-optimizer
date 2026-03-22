import type {
  CatalogBundle,
  CatalogGap,
  CatalogManifest,
  CatalogVersion,
  DataConfidence,
  FacilityDefinition,
  FacilityKind,
  GameCatalog,
  ImageAsset,
  LevelProgressionMilestone,
  MaterialCost,
  OptimizationScenario,
  OperatorExpItemDefinition,
  OperatorDefinition,
  ProgressionDocument,
  PromotionTierProgression,
  RecipeDefinition,
  SourceRef,
  UpgradeRankingMode,
  ValidationIssue,
  ValidationResult,
  MigrationChange,
  MigrationResult,
} from "@endfield/domain";

export const CURRENT_CATALOG_VERSION: CatalogVersion = "2026-03-20/v1.1-phase1";
export const CURRENT_CATALOG_BUNDLE_ID = "2026-03-20-v1.1-phase1";
export const CURRENT_SCENARIO_FORMAT_VERSION = 1 as const;
export const EXAMPLE_SCENARIOS_DIR = "scenarios/examples" as const;

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

const DEFAULT_GROWTH_SLOT_CAPS = { 1: 3, 2: 6, 3: 9 } as const;

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

export function toGameCatalog(bundle: CatalogBundle): GameCatalog {
  const baseSkillProgressionByKey = new Map(
    bundle.progression.baseSkillRanks.map((entry) => [
      getBaseSkillProgressionKey(entry.skillSlot, entry.rank),
      entry,
    ]),
  );

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
    assets: bundle.assets.assets as ImageAsset[],
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
  validateCatalogSection("assets.json", bundle.assets, "assets", issues);

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
      planningMode: "simple",
      horizonHours: 24,
      maxFacilities: false,
      includeReceptionRoom: true,
      upgradeRankingMode: "balanced",
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

  while (facilities.manufacturingCabins.length < MAX_LAYOUT_DEFAULTS.manufacturing_cabin) {
    const roomNumber = facilities.manufacturingCabins.length + 1;
    facilities.manufacturingCabins.push({
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

  while (facilities.growthChambers.length < MAX_LAYOUT_DEFAULTS.growth_chamber) {
    const roomNumber = facilities.growthChambers.length + 1;
    facilities.growthChambers.push({
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

  for (const room of facilities.growthChambers) {
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

  if (typeof options.planningMode !== "string") {
    options.planningMode = "simple";
    changes.push({
      path: "options.planningMode",
      message: "Defaulted missing planningMode to 'simple'.",
    });
  }

  if (typeof options.horizonHours !== "number") {
    options.horizonHours = 24;
    changes.push({
      path: "options.horizonHours",
      message: "Defaulted missing horizonHours to 24.",
    });
  }

  if (typeof options.maxFacilities !== "boolean") {
    options.maxFacilities = false;
    changes.push({
      path: "options.maxFacilities",
      message: "Defaulted missing maxFacilities to false.",
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
  const roomSpecs = new Map<string, { roomKind: FacilityKind; level: number; slotCap: number }>();
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
    roomIds.add(room.id);
    roomSpecs.set(room.id, {
      roomKind: "manufacturing_cabin",
      level: room.level,
      slotCap: getRoomSlotCap(
        catalog,
        "manufacturing_cabin",
        room.level,
        scenario.facilities.controlNexus.level,
      ),
    });
    if (roomIndex >= unlockedManufacturingRooms && room.enabled) {
      issues.push(
        makeIssue(
          "room_locked",
          `facilities.manufacturingCabins.${room.id}.enabled`,
          `Manufacturing cabin '${room.id}' is locked until Control Nexus level 3.`,
        ),
      );
    }
    if (room.enabled && room.level > manufacturingLevelCap) {
      issues.push(
        makeIssue(
          "room_level_locked",
          `facilities.manufacturingCabins.${room.id}.level`,
          `Manufacturing cabin '${room.id}' cannot exceed level ${manufacturingLevelCap} at Control Nexus level ${scenario.facilities.controlNexus.level}.`,
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
    roomIds.add(room.id);
    roomSpecs.set(room.id, {
      roomKind: "growth_chamber",
      level: room.level,
      slotCap: getRoomSlotCap(
        catalog,
        "growth_chamber",
        room.level,
        scenario.facilities.controlNexus.level,
      ),
    });
    if (roomIndex >= unlockedGrowthRooms && room.enabled) {
      issues.push(
        makeIssue(
          "room_locked",
          `facilities.growthChambers.${room.id}.enabled`,
          `Growth chamber '${room.id}' is locked until Control Nexus level 2.`,
        ),
      );
    }
    if (room.enabled && room.level > growthLevelCap) {
      issues.push(
        makeIssue(
          "room_level_locked",
          `facilities.growthChambers.${room.id}.level`,
          `Growth chamber '${room.id}' cannot exceed level ${growthLevelCap} at Control Nexus level ${scenario.facilities.controlNexus.level}.`,
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
      level: scenario.facilities.receptionRoom.level,
      slotCap: getRoomSlotCap(
        catalog,
        "reception_room",
        scenario.facilities.receptionRoom.level,
        scenario.facilities.controlNexus.level,
      ),
    });
    if (unlockedReceptionRooms === 0 && scenario.facilities.receptionRoom.enabled) {
      issues.push(
        makeIssue(
          "room_locked",
          "facilities.receptionRoom.enabled",
          "Reception room is locked until Control Nexus level 3.",
        ),
      );
    }
    if (scenario.facilities.receptionRoom.enabled && scenario.facilities.receptionRoom.level > receptionLevelCap) {
      issues.push(
        makeIssue(
          "room_level_locked",
          "facilities.receptionRoom.level",
          `Reception room cannot exceed level ${receptionLevelCap} at Control Nexus level ${scenario.facilities.controlNexus.level}.`,
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
        ),
      );
    }
    const roomSpec = roomSpecs.get(assignment.roomId);
    if (roomSpec) {
      const currentCount = (roomAssignmentCounts.get(assignment.roomId) ?? 0) + 1;
      roomAssignmentCounts.set(assignment.roomId, currentCount);
      if (assignment.slotIndex != null && assignment.slotIndex >= roomSpec.slotCap) {
        issues.push(
          makeIssue(
            "hard_assignment_slot_oob",
            `facilities.hardAssignments.${assignment.operatorId}`,
            `Hard assignment for '${assignment.operatorId}' targets slot ${assignment.slotIndex}, but room '${assignment.roomId}' only has ${roomSpec.slotCap} slots.`,
          ),
        );
      }
      if (currentCount > roomSpec.slotCap) {
        issues.push(
          makeIssue(
            "hard_assignment_room_overflow",
            `facilities.hardAssignments.${assignment.operatorId}`,
            `Hard assignments exceed slot capacity for room '${assignment.roomId}'.`,
          ),
        );
      }
    }
    hardAssigned.add(assignment.operatorId);
  }

  if (!["simple", "advanced"].includes(scenario.options.planningMode)) {
    issues.push(
      makeIssue(
        "invalid_planning_mode",
        "options.planningMode",
        "Scenario options.planningMode must be 'simple' or 'advanced'.",
      ),
    );
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
    if (typeof scenario.options.horizonHours !== "number") {
      issues.push(
        makeIssue(
          "invalid_horizon",
          "options.horizonHours",
          "Scenario options.horizonHours must be a number.",
        ),
      );
    }
    if (typeof scenario.options.maxFacilities !== "boolean") {
      issues.push(
        makeIssue(
          "invalid_max_facilities",
          "options.maxFacilities",
          "Scenario options.maxFacilities must be a boolean.",
        ),
      );
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
