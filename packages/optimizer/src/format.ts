import type { GameCatalog, OptimizationResult, UpgradeRecommendationResult } from "@endfield/domain";

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
    `Total score: ${result.totalScore.toFixed(2)}`,
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
      `- ${room.roomId} (${formatRoomKind(room.roomKind)} Lv${room.roomLevel}) score ${room.projectedScore.toFixed(2)} | direct ${room.scoreBreakdown.directProductionScore.toFixed(2)} | support ${room.scoreBreakdown.supportRoomScore.toFixed(2)} | cross-room ${room.scoreBreakdown.crossRoomBonusContribution.toFixed(2)} | confidence ${room.dataConfidence}`,
    );
    if ((room.chosenRecipeIds ?? []).length > 0) {
      lines.push(`  recipe: ${recipeNames.join(", ")}`);
    }
    lines.push(`  operators: ${assignedOperators.join(", ") || "(none)"}`);

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
    `Baseline score: ${result.baselineScore.toFixed(2)}`,
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
      `- ${operatorName} / ${skillName} -> rank ${recommendation.action.targetRank} | delta ${recommendation.scoreDelta.toFixed(2)} | roi ${recommendation.roi.toFixed(4)} | est days ${(recommendation.estimatedDaysToUnlock ?? 0).toFixed(1)}`,
    );
    lines.push(`  gate: ${gateParts.join(" | ")}`);
    lines.push(`  level costs: ${formatMaterialCosts(recommendation.action.levelMaterialCosts)}`);
    lines.push(`  promotion costs: ${formatMaterialCosts(recommendation.action.promotionMaterialCosts)}`);
    lines.push(`  skill costs: ${formatMaterialCosts(recommendation.action.skillMaterialCosts)}`);
    if (recommendation.action.unlockHint) {
      lines.push(`  unlock: ${recommendation.action.unlockHint}`);
    }
    lines.push(`  notes: ${recommendation.notes.join(" | ")}`);
  }

  return lines.join("\n");
}
