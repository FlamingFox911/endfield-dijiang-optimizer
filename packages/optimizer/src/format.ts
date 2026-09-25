import type { GameCatalog, OptimizationResult, UpgradeRecommendationResult } from "@endfield/domain";

import { formatScorePoints } from "./score-format.js";

export function formatProjectedOutputChange(change: { productKind: string; before: number; after: number }): string {
  const delta = change.after - change.before;
  const magnitude = Math.abs(delta);
  const gain = magnitude > 0 && magnitude < 0.01 ? "<0.01" : magnitude.toFixed(2);
  return `${formatProductKind(change.productKind)}: ${change.before.toFixed(2)} → ${change.after.toFixed(2)} units/hr (${delta < 0 ? "-" : delta > 0 ? "+" : ""}${gain}/hr)`;
}

function formatRoomKind(roomKind: string): string {
  return roomKind
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatProductKind(productKind: string): string {
  return productKind
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatMaterialCosts(
  materialCosts: Array<{ itemId: string; quantity: number }>,
): string {
  if (materialCosts.length === 0) {
    return "(none)";
  }

  return materialCosts
    .map((cost) => `${cost.quantity}x ${cost.itemId}`)
    .join(", ");
}

function buildCatalogLookups(catalog?: GameCatalog) {
  return {
    operatorsById: new Map(catalog?.operators.map((operator) => [operator.id, operator]) ?? []),
    recipesById: new Map(catalog?.recipes.map((recipe) => [recipe.id, recipe]) ?? []),
  };
}

export function formatOptimizationResultText(
  result: OptimizationResult,
  catalog?: GameCatalog,
): string {
  const { operatorsById, recipesById } = buildCatalogLookups(catalog);
  const lines = [
    `Catalog: ${result.catalogVersion}`,
    `Total score (pts): ${formatScorePoints(result.totalScore)}`,
    `Score model: ${result.supportWeightsVersion}`,
    "",
    "Room plans",
  ];

  for (const room of result.roomPlans) {
    const recipeNames = (room.chosenRecipeIds ?? []).map(
      (recipeId) => recipesById.get(recipeId)?.name ?? recipeId,
    );
    const assignedOperators = room.assignedOperatorIds.map(
      (operatorId) => operatorsById.get(operatorId)?.name ?? operatorId,
    );

    lines.push(
      `- ${room.roomId} (${formatRoomKind(room.roomKind)} Lv${room.roomLevel}) score ${formatScorePoints(room.projectedScore)} pts | direct ${formatScorePoints(room.scoreBreakdown.directProductionScore)} pts | support ${formatScorePoints(room.scoreBreakdown.supportRoomScore)} pts | cross-room ${formatScorePoints(room.scoreBreakdown.crossRoomBonusContribution)} pts | confidence ${room.dataConfidence}`,
    );
    if ((room.chosenRecipeIds ?? []).length > 0) {
      lines.push(`  recipe: ${recipeNames.join(", ")}`);
    }
    lines.push(`  operators: ${assignedOperators.join(", ") || "(none)"}`);
    room.alternativeOperatorIdsBySlot?.forEach((alternatives, index) => {
      if (alternatives.length === 0) return;
      const names = alternatives.map((id) => operatorsById.get(id)?.name ?? id);
      lines.push(`  slot ${index + 1} alternatives (one change at a time): ${names.join(", ")}`);
    });

    const projectedOutputs = Object.entries(room.projectedOutputs)
      .filter(([, value]) => value > 0)
      .map(([productKind, value]) => `${formatProductKind(productKind)} ${value.toFixed(2)}/hr`);
    if (projectedOutputs.length > 0) {
      lines.push(`  projected rate: ${projectedOutputs.join(" | ")}`);
    }

    if (room.usedFallbackHeuristics) {
      lines.push("  note: fallback heuristics were used for at least one contribution.");
    }

    if (room.warnings.length > 0) {
      lines.push(`  warnings: ${room.warnings.join(" | ")}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("", "Warnings", ...result.warnings.map((warning) => `- ${warning}`));
  }

  return lines.join("\n");
}

export function formatUpgradeRecommendationsText(
  result: UpgradeRecommendationResult,
  catalog?: GameCatalog,
): string {
  const { operatorsById } = buildCatalogLookups(catalog);
  const skillNameByKey = new Map<string, string>();
  for (const operator of catalog?.operators ?? []) {
    for (const skill of operator.baseSkills) {
      skillNameByKey.set(`${operator.id}:${skill.id}`, skill.name);
    }
  }

  const lines = [
    `Catalog: ${result.catalogVersion}`,
    `Ranking mode: ${result.rankingMode}`,
    `Baseline score (pts): ${formatScorePoints(result.baselineScore)}`,
    "",
    "Recommendations",
  ];

  for (const recommendation of result.recommendations) {
    const operatorName =
      operatorsById.get(recommendation.action.operatorId)?.name ?? recommendation.action.operatorId;
    const skillName =
      skillNameByKey.get(`${recommendation.action.operatorId}:${recommendation.action.skillId}`) ??
      recommendation.action.skillId;
    const gateParts: string[] = [];

    if (recommendation.action.requiredPromotionTier != null || recommendation.action.requiredLevel != null) {
      gateParts.push(
        `target Elite ${recommendation.action.requiredPromotionTier ?? recommendation.action.currentPromotionTier} Lv${recommendation.action.requiredLevel ?? recommendation.action.currentLevel}`,
      );
    }
    gateParts.push(
      `current Elite ${recommendation.action.currentPromotionTier} Lv${recommendation.action.currentLevel}`,
    );

    lines.push(
      `- ${operatorName} / ${skillName} -> rank ${recommendation.action.targetRank} | score gain ${formatScorePoints(recommendation.scoreDelta, true)} pts | roi ${formatScorePoints(recommendation.roi)} pts/effort | est days ${(recommendation.estimatedDaysToUnlock ?? 0).toFixed(1)}`,
    );
    lines.push(`  gate: ${gateParts.join(" | ")}`);
    lines.push(`  level costs: ${formatMaterialCosts(recommendation.action.levelMaterialCosts)}`);
    lines.push(`  promotion costs: ${formatMaterialCosts(recommendation.action.promotionMaterialCosts)}`);
    lines.push(`  skill costs: ${formatMaterialCosts(recommendation.action.skillMaterialCosts)}`);
    if (recommendation.action.unlockHint) {
      lines.push(`  unlock: ${recommendation.action.unlockHint}`);
    }
    for (const change of recommendation.projectedOutputChanges ?? []) {
      lines.push(`  output: ${formatProjectedOutputChange(change)}`);
    }
    lines.push(`  notes: ${recommendation.notes.join(" | ")}`);
  }

  return lines.join("\n");
}
