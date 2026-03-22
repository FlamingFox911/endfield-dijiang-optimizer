export type CatalogVersion = string;
export type ScenarioFormatVersion = 1;

export type FacilityKind =
  | "control_nexus"
  | "manufacturing_cabin"
  | "growth_chamber"
  | "reception_room";

export type ProductKind =
  | "operator_exp"
  | "weapon_exp"
  | "fungal"
  | "vitrified_plant"
  | "rare_mineral";

export type EffectMetric =
  | "production_efficiency"
  | "growth_rate"
  | "mood_regen"
  | "mood_drop_reduction"
  | "clue_collection_efficiency"
  | "clue_rate_up";

export type SourceConfidence =
  | "official"
  | "guide_site"
  | "community"
  | "manual_override"
  | "inferred";

export type DataConfidence = "verified" | "provisional" | "heuristic";
export type SkillRank = 0 | 1 | 2;
export type PlanningMode = "simple" | "advanced";
export type ValidationSeverity = "error" | "warning";
export type UpgradeRankingMode = "fastest" | "roi" | "balanced";
export type OptimizationProfile = "fast" | "balanced" | "thorough" | "exhaustive" | "custom";

export interface SourceRef {
  id: string;
  label: string;
  url: string;
  retrievedOn: string;
  confidence: SourceConfidence;
  notes?: string;
}

export interface ImageAsset {
  id: string;
  kind: "portrait" | "facility" | "icon";
  path: string;
  attribution?: string;
}

export interface MaterialCost {
  itemId: string;
  quantity: number;
}

export interface EffectModifier {
  metric: EffectMetric;
  appliesTo: ProductKind | "all";
  value: number;
  unit: "percent";
  dataConfidence?: DataConfidence;
}

export interface BaseSkillRankDefinition {
  rank: Exclude<SkillRank, 0>;
  label: "alpha" | "beta" | "gamma";
  modifiers: EffectModifier[];
  materialCosts: MaterialCost[];
  unlockHint?: string;
  sourceRefs: SourceRef[];
  dataConfidence?: DataConfidence;
}

export interface BaseSkillDefinition {
  id: string;
  name: string;
  facilityKind: FacilityKind;
  icon: ImageAsset;
  ranks: BaseSkillRankDefinition[];
  sourceRefs: SourceRef[];
  dataConfidence?: DataConfidence;
}

export interface CatalogBaseSkillRankDefinition {
  rank: Exclude<SkillRank, 0>;
  label: "alpha" | "beta" | "gamma";
  modifiers: EffectModifier[];
  materialCosts?: MaterialCost[];
  unlockHint?: string;
  sourceRefs: SourceRef[];
  dataConfidence?: DataConfidence;
}

export interface CatalogBaseSkillDefinition {
  id: string;
  name: string;
  facilityKind: FacilityKind;
  iconAssetId: string;
  ranks: CatalogBaseSkillRankDefinition[];
  sourceRefs: SourceRef[];
  dataConfidence?: DataConfidence;
}

export interface OperatorDefinition {
  id: string;
  name: string;
  rarity: 4 | 5 | 6;
  className: string;
  images: ImageAsset[];
  baseSkills: BaseSkillDefinition[];
  sourceRefs: SourceRef[];
  dataConfidence?: DataConfidence;
}

export interface RecipeDefinition {
  id: string;
  name: string;
  facilityKind: Extract<FacilityKind, "manufacturing_cabin" | "growth_chamber">;
  productKind: ProductKind;
  roomLevel: number;
  baseDurationMinutes?: number;
  loadCost?: number;
  outputAmount?: number;
  sourceRefs: SourceRef[];
  unresolvedFields?: string[];
  dataConfidence?: DataConfidence;
}

export interface FacilityLevelDefinition {
  level: number;
  slotCap?: number;
  productCapacity?: number;
  growthSlotCap?: number;
  sourceRefs: SourceRef[];
  unresolvedFields?: string[];
  dataConfidence?: DataConfidence;
}

export interface FacilityDefinition {
  id: string;
  name: string;
  kind: FacilityKind;
  unlockHint?: string;
  levels: FacilityLevelDefinition[];
  sourceRefs: SourceRef[];
  dataConfidence?: DataConfidence;
}

export interface CatalogGap {
  id: string;
  summary: string;
  impact: "low" | "medium" | "high";
  mitigation: string;
  sourceRefs: SourceRef[];
}

export interface BaseSkillRankProgression {
  skillSlot: 1 | 2;
  rank: Exclude<SkillRank, 0>;
  promotionTier: 1 | 2 | 3 | 4;
  requiredLevel: 20 | 40 | 60 | 80;
  materialCosts: MaterialCost[];
  sourceRefs: SourceRef[];
}

export interface PromotionTierProgression {
  promotionTier: 1 | 2 | 3 | 4;
  requiredLevel: 20 | 40 | 60 | 80;
  materialCosts: MaterialCost[];
  sourceRefs: SourceRef[];
}

export interface OperatorPromotionOverride {
  operatorId: string;
  promotionTier: 1 | 2 | 3 | 4;
  additionalMaterialCosts: MaterialCost[];
  sourceRefs: SourceRef[];
}

export interface LevelProgressionMilestone {
  level: 20 | 40 | 60 | 80 | 90;
  cumulativeExp: number;
  cumulativeTCreds: number;
  sourceRefs: SourceRef[];
}

export interface OperatorExpItemDefinition {
  itemId: string;
  name: string;
  expValue: number;
  minLevel: 1 | 61;
  maxLevel: 60 | 90;
  sourceRefs: SourceRef[];
}

export interface CatalogManifest {
  catalogId: string;
  catalogVersion: CatalogVersion;
  gameVersion: string;
  snapshotDate: string;
  appCompatibility?: {
    minVersion: string;
    notes?: string;
  };
  files: {
    progression: string;
    operators: string;
    facilities: string;
    recipes: string;
    sources: string;
    gaps: string;
    assets: string;
  };
  counts?: Record<string, number>;
  notes?: string[];
}

export interface OperatorsDocument {
  catalogVersion: CatalogVersion;
  operators: Array<
    Omit<OperatorDefinition, "baseSkills"> & {
      baseSkills: CatalogBaseSkillDefinition[];
    }
  >;
}

export interface FacilitiesDocument {
  catalogVersion: CatalogVersion;
  facilities: FacilityDefinition[];
}

export interface RecipesDocument {
  catalogVersion: CatalogVersion;
  recipes: RecipeDefinition[];
}

export interface SourcesDocument {
  catalogVersion: CatalogVersion;
  sources: SourceRef[];
}

export interface GapsDocument {
  catalogVersion: CatalogVersion;
  gaps: CatalogGap[];
}

export interface ProgressionDocument {
  catalogVersion: CatalogVersion;
  baseSkillRanks: BaseSkillRankProgression[];
  promotionTiers: PromotionTierProgression[];
  promotionOverrides: OperatorPromotionOverride[];
  levelMilestones: LevelProgressionMilestone[];
  expItems: OperatorExpItemDefinition[];
}

export interface AssetsDocument {
  catalogVersion: CatalogVersion;
  assets: ImageAsset[];
}

export interface CatalogBundle {
  manifest: CatalogManifest;
  progression: ProgressionDocument;
  operators: OperatorsDocument;
  facilities: FacilitiesDocument;
  recipes: RecipesDocument;
  sources: SourcesDocument;
  gaps: GapsDocument;
  assets: AssetsDocument;
}

export interface GameCatalog {
  version: CatalogVersion;
  manifest: CatalogManifest;
  progression: ProgressionDocument;
  operators: OperatorDefinition[];
  recipes: RecipeDefinition[];
  facilities: FacilityDefinition[];
  sources: SourceRef[];
  gaps: CatalogGap[];
  assets: ImageAsset[];
}

export interface OwnedBaseSkillState {
  skillId: string;
  unlockedRank: SkillRank;
}

export interface OwnedOperatorState {
  operatorId: string;
  owned: boolean;
  level: number;
  promotionTier: 0 | 1 | 2 | 3 | 4;
  baseSkillStates: OwnedBaseSkillState[];
}

export interface ControlNexusState {
  level: 1 | 2 | 3 | 4 | 5;
}

export interface ManufacturingCabinState {
  id: string;
  enabled: boolean;
  level: 1 | 2 | 3;
  fixedRecipeId?: string;
}

export interface GrowthChamberState {
  id: string;
  enabled: boolean;
  level: 1 | 2 | 3;
  fixedRecipeIds?: string[];
}

export interface ReceptionRoomState {
  id: string;
  enabled: boolean;
  level: 1 | 2 | 3;
}

export interface HardAssignment {
  operatorId: string;
  roomId: string;
}

export interface FacilityState {
  controlNexus: ControlNexusState;
  manufacturingCabins: ManufacturingCabinState[];
  growthChambers: GrowthChamberState[];
  receptionRoom?: ReceptionRoomState;
  hardAssignments: HardAssignment[];
}

export interface BaseOptimizationOptions {
  planningMode: PlanningMode;
  horizonHours: number;
  maxFacilities: boolean;
  includeReceptionRoom?: boolean;
  upgradeRankingMode?: UpgradeRankingMode;
  optimizationProfile?: OptimizationProfile;
  optimizationEffort?: number;
}

export interface OptimizationScenario {
  scenarioFormatVersion: ScenarioFormatVersion;
  catalogVersion: CatalogVersion;
  roster: OwnedOperatorState[];
  facilities: FacilityState;
  options: BaseOptimizationOptions;
}

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: ValidationSeverity;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface MigrationChange {
  path: string;
  message: string;
}

export interface MigrationResult {
  ok: boolean;
  fromFormatVersion: number;
  toFormatVersion: ScenarioFormatVersion;
  migrated: boolean;
  scenario: OptimizationScenario;
  changes: MigrationChange[];
  warnings: ValidationIssue[];
}

export interface AssignmentExplanation {
  operatorId: string;
  roomId: string;
  projectedContribution: number;
  reasons: string[];
  dataConfidence: DataConfidence;
}

export interface ScoreBreakdown {
  directProductionScore: number;
  supportRoomScore: number;
  crossRoomBonusContribution: number;
  totalScore: number;
}

export interface RoomPlan {
  roomId: string;
  roomKind: FacilityKind;
  roomLevel: number;
  chosenRecipeIds?: string[];
  chosenProductKind?: ProductKind;
  assignedOperatorIds: string[];
  scoreBreakdown: ScoreBreakdown;
  projectedScore: number;
  projectedOutputs: Record<ProductKind, number>;
  warnings: string[];
  usedFallbackHeuristics: boolean;
  dataConfidence: DataConfidence;
}

export interface OptimizationResult {
  catalogVersion: CatalogVersion;
  totalScore: number;
  projectedRecipeOutputs: Record<string, number>;
  projectedOutputs: Record<ProductKind, number>;
  roomPlans: RoomPlan[];
  explanations: AssignmentExplanation[];
  warnings: string[];
  supportWeightsVersion: string;
}

export interface UpgradeAction {
  operatorId: string;
  skillId: string;
  targetRank: Exclude<SkillRank, 0>;
  currentLevel: number;
  currentPromotionTier: 0 | 1 | 2 | 3 | 4;
  requiredLevel?: number;
  requiredPromotionTier?: 1 | 2 | 3 | 4;
  levelsToGain: number;
  levelExpCost: number;
  levelTCredCost: number;
  levelMaterialCosts: MaterialCost[];
  levelCostIsUpperBound: boolean;
  promotionMaterialCosts: MaterialCost[];
  skillMaterialCosts: MaterialCost[];
  materialCosts: MaterialCost[];
  unlockHint?: string;
}

export interface UpgradeRecommendation {
  action: UpgradeAction;
  scoreDelta: number;
  roi: number;
  estimatedDaysToUnlock?: number;
  notes: string[];
}

export interface UpgradeRecommendationResult {
  catalogVersion: CatalogVersion;
  baselineScore: number;
  rankingMode: UpgradeRankingMode;
  recommendations: UpgradeRecommendation[];
}
