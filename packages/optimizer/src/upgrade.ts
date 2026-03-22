import type {
  GameCatalog,
  MaterialCost,
  OptimizationResult,
  OptimizationScenario,
  UpgradeAction,
  UpgradeRankingMode,
  UpgradeRecommendation,
  UpgradeRecommendationResult,
} from "@endfield/domain";

import {
  estimateLevelingRequirement,
  getBaseSkillRankRequirement,
  getPromotionTierRequirement,
  resolveRankingMode,
} from "@endfield/data";

import { SUPPORT_WEIGHTS } from "./config.js";
import { solveScenario } from "./solver.js";
import type { RecommendUpgradesOptions } from "./types.js";

export class UpgradeRecommendationsCancelledError extends Error {
  constructor(message = "Upgrade recommendations canceled.") {
    super(message);
    this.name = "UpgradeRecommendationsCancelledError";
  }
}

function getUnlockedRank(
  ownedOperator: OptimizationScenario["roster"][number],
  skillId: string,
) {
  return ownedOperator.baseSkillStates.find((entry) => entry.skillId === skillId)?.unlockedRank ?? 0;
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

function formatItemId(itemId: string): string {
  return itemId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMaterialCosts(materialCosts: MaterialCost[]): string {
  return materialCosts
    .map((cost) => `${cost.quantity} ${formatItemId(cost.itemId)}`)
    .join(", ");
}

function getNextUpgradeActions(
  catalog: GameCatalog,
  scenario: OptimizationScenario,
): UpgradeAction[] {
  const operatorDefs = new Map(catalog.operators.map((operator) => [operator.id, operator]));
  const actions: UpgradeAction[] = [];

  for (const ownedOperator of scenario.roster) {
    if (!ownedOperator.owned) {
      continue;
    }

    const operatorDef = operatorDefs.get(ownedOperator.operatorId);
    if (!operatorDef) {
      continue;
    }

    for (let skillIndex = 0; skillIndex < operatorDef.baseSkills.length; skillIndex += 1) {
      const skill = operatorDef.baseSkills[skillIndex]!;
      const unlockedRank = getUnlockedRank(ownedOperator, skill.id);
      const nextRank = [...skill.ranks]
        .sort((left, right) => left.rank - right.rank)
        .find((rankDef) => rankDef.rank > unlockedRank);

      if (!nextRank) {
        continue;
      }

      const skillRequirement = getBaseSkillRankRequirement(
        catalog,
        (skillIndex + 1) as 1 | 2,
        nextRank.rank as 1 | 2,
      );
      const requiredPromotionTier = skillRequirement?.promotionTier;
      const requiredLevel = skillRequirement?.requiredLevel;
      const levelsToGain = Math.max((requiredLevel ?? ownedOperator.level) - ownedOperator.level, 0);
      const levelingRequirement = requiredLevel == null
        ? undefined
        : estimateLevelingRequirement(catalog, ownedOperator.level, requiredLevel);
      const promotionMaterialCosts = requiredPromotionTier == null
        ? []
        : mergeMaterialCosts(
          ...Array.from(
            {
              length: Math.max(requiredPromotionTier - ownedOperator.promotionTier, 0),
            },
            (_, offset) =>
              getPromotionTierRequirement(
                catalog,
                ownedOperator.operatorId,
                (ownedOperator.promotionTier + offset + 1) as 1 | 2 | 3 | 4,
              )?.materialCosts ?? [],
          ),
        );
      const skillMaterialCosts = nextRank.materialCosts ?? [];
      const levelMaterialCosts = levelingRequirement?.levelMaterialCosts ?? [];
      const materialCosts = mergeMaterialCosts(levelMaterialCosts, promotionMaterialCosts, skillMaterialCosts);

      actions.push({
        operatorId: ownedOperator.operatorId,
        skillId: skill.id,
        targetRank: nextRank.rank,
        currentLevel: ownedOperator.level,
        currentPromotionTier: ownedOperator.promotionTier,
        requiredLevel,
        requiredPromotionTier,
        levelsToGain,
        levelExpCost: levelingRequirement?.levelExpCost ?? 0,
        levelTCredCost: levelingRequirement?.levelTCredCost ?? 0,
        levelMaterialCosts,
        levelCostIsUpperBound: levelingRequirement?.levelCostIsUpperBound ?? false,
        promotionMaterialCosts,
        skillMaterialCosts,
        materialCosts,
        unlockHint: nextRank.unlockHint,
      });
    }
  }

  return actions;
}

function applyUpgradeActionToScenario(
  scenario: OptimizationScenario,
  action: UpgradeAction,
): OptimizationScenario {
  const nextScenario = JSON.parse(JSON.stringify(scenario)) as OptimizationScenario;
  const ownedOperator = nextScenario.roster.find((entry) => entry.operatorId === action.operatorId);
  if (!ownedOperator) {
    return nextScenario;
  }

  if (action.requiredLevel != null) {
    ownedOperator.level = Math.max(ownedOperator.level, action.requiredLevel);
  }
  if (action.requiredPromotionTier != null) {
    ownedOperator.promotionTier = Math.max(
      ownedOperator.promotionTier,
      action.requiredPromotionTier,
    ) as typeof ownedOperator.promotionTier;
  }

  const existing = ownedOperator.baseSkillStates.find((entry) => entry.skillId === action.skillId);
  if (existing) {
    existing.unlockedRank = action.targetRank;
  } else {
    ownedOperator.baseSkillStates.push({
      skillId: action.skillId,
      unlockedRank: action.targetRank,
    });
  }

  return nextScenario;
}

function scoreUpgradeEffort(action: UpgradeAction) {
  if (
    action.materialCosts.length === 0 &&
    action.levelExpCost === 0 &&
    action.levelTCredCost === 0
  ) {
    return 1;
  }

  const materialEffort = action.materialCosts.reduce((sum, cost) => {
    if (cost.itemId === "t-creds") {
      return sum + cost.quantity / 1000;
    }
    if (
      cost.itemId.endsWith("combat-record") ||
      cost.itemId.endsWith("cognitive-carrier")
    ) {
      return sum;
    }
    return sum + cost.quantity * 2;
  }, 0);

  return materialEffort + action.levelExpCost / 10000;
}

function compareRecommendations(
  mode: UpgradeRankingMode,
  left: UpgradeRecommendation,
  right: UpgradeRecommendation,
): number {
  switch (mode) {
    case "fastest":
      if ((left.estimatedDaysToUnlock ?? Number.POSITIVE_INFINITY) !== (right.estimatedDaysToUnlock ?? Number.POSITIVE_INFINITY)) {
        return (left.estimatedDaysToUnlock ?? Number.POSITIVE_INFINITY) - (right.estimatedDaysToUnlock ?? Number.POSITIVE_INFINITY);
      }
      if (right.scoreDelta !== left.scoreDelta) {
        return right.scoreDelta - left.scoreDelta;
      }
      return right.roi - left.roi;
    case "roi":
      if (right.roi !== left.roi) {
        return right.roi - left.roi;
      }
      return right.scoreDelta - left.scoreDelta;
    case "balanced":
    default:
      if (right.scoreDelta !== left.scoreDelta) {
        return right.scoreDelta - left.scoreDelta;
      }
      if (right.roi !== left.roi) {
        return right.roi - left.roi;
      }
      return (left.estimatedDaysToUnlock ?? Number.POSITIVE_INFINITY) - (right.estimatedDaysToUnlock ?? Number.POSITIVE_INFINITY);
  }
}

export function recommendUpgrades(
  catalog: GameCatalog,
  scenario: OptimizationScenario,
  baselineResult?: OptimizationResult,
  options?: RecommendUpgradesOptions,
): UpgradeRecommendationResult {
  const shouldCancel = options?.shouldCancel;
  const maybeCancel = () => {
    if (shouldCancel?.()) {
      throw new UpgradeRecommendationsCancelledError();
    }
  };

  const rankingMode = resolveRankingMode(scenario.options.upgradeRankingMode);
  maybeCancel();
  const baseline = options?.baselineResult ?? baselineResult ?? solveScenario(catalog, scenario, { shouldCancel });
  const operatorDefs = new Map(catalog.operators.map((operator) => [operator.id, operator]));
  const actions = getNextUpgradeActions(catalog, scenario);
  let completedCandidates = 0;
  let bestScoreDelta = Number.NEGATIVE_INFINITY;

  options?.onProgress?.({
    phase: "Evaluating unlock candidates",
    completedCandidates,
    totalCandidates: actions.length,
    baselineScore: baseline.totalScore,
    bestScoreDelta: 0,
  });

  const recommendations = actions
    .map((action) => {
      maybeCancel();
      const upgradedScenario = applyUpgradeActionToScenario(scenario, action);
      const upgradedResult = solveScenario(catalog, upgradedScenario, { shouldCancel });
      const scoreDelta = upgradedResult.totalScore - baseline.totalScore;
      const effortScore = scoreUpgradeEffort(action);
      const operatorDef = operatorDefs.get(action.operatorId);
      const estimatedDaysToUnlock = effortScore / SUPPORT_WEIGHTS.estimatedEffortPerDay;
      const notes = operatorDef ? [`Operator: ${operatorDef.name}`] : [];
      completedCandidates += 1;
      bestScoreDelta = Math.max(bestScoreDelta, scoreDelta);

      if (action.unlockHint) {
        notes.push(action.unlockHint);
      }
      if (action.levelsToGain > 0 && action.requiredPromotionTier != null && action.requiredLevel != null) {
        notes.push(
          `Requires ${action.levelsToGain} level(s) of EXP progression to reach Elite ${action.requiredPromotionTier} Level ${action.requiredLevel}.`,
        );
      }
      if (action.levelExpCost > 0 || action.levelTCredCost > 0) {
        const expPrefix = action.levelCostIsUpperBound ? "At most " : "";
        notes.push(
          `${expPrefix}${action.levelExpCost.toLocaleString()} Operator EXP and ${action.levelTCredCost.toLocaleString()} T-Creds for leveling.`,
        );
      }
      if (action.levelMaterialCosts.length > 0) {
        const notePrefix = action.levelCostIsUpperBound ? "Upper-bound leveling materials" : "Leveling materials";
        notes.push(`${notePrefix}: ${formatMaterialCosts(action.levelMaterialCosts)}.`);
      }
      if (action.promotionMaterialCosts.length > 0) {
        notes.push(`Includes promotion materials: ${formatMaterialCosts(action.promotionMaterialCosts)}.`);
      }
      if (action.skillMaterialCosts.length > 0) {
        notes.push(`Includes Base Skill node materials: ${formatMaterialCosts(action.skillMaterialCosts)}.`);
      }
      if (action.materialCosts.length > 0 || action.levelsToGain > 0) {
        notes.push(
          `Approximate effort score ${effortScore.toFixed(1)} derived from bundled promotion costs, Base Skill costs, and level gating.`,
        );
      } else {
        notes.push("No bundled upgrade cost data exists yet; ROI falls back to score delta.");
      }
      if (scoreDelta <= 0) {
        notes.push("This unlock does not improve the current assignment result immediately.");
      }

      options?.onProgress?.({
        phase: "Evaluating unlock candidates",
        completedCandidates,
        totalCandidates: actions.length,
        baselineScore: baseline.totalScore,
        bestScoreDelta: Number.isFinite(bestScoreDelta) ? bestScoreDelta : 0,
      });

      return {
        action,
        scoreDelta,
        roi: effortScore > 0 ? scoreDelta / effortScore : scoreDelta,
        estimatedDaysToUnlock,
        notes,
      } satisfies UpgradeRecommendation;
    })
    .sort((left, right) => compareRecommendations(rankingMode, left, right));

  return {
    catalogVersion: scenario.catalogVersion,
    baselineScore: baseline.totalScore,
    rankingMode,
    recommendations,
  };
}
