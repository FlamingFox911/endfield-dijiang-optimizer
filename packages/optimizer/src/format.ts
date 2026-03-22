import type { OptimizationResult, UpgradeRecommendationResult } from "@endfield/domain";

export function formatOptimizationResultText(result: OptimizationResult): string {
  const lines = [
    `Catalog: ${result.catalogVersion}`,
    `Total score: ${result.totalScore.toFixed(2)}`,
    `Support weights: ${result.supportWeightsVersion}`,
    "",
    "Room plans",
  ];

  for (const room of result.roomPlans) {
    lines.push(
      `- ${room.roomId} (${room.roomKind}) score ${room.projectedScore.toFixed(2)} | direct ${room.scoreBreakdown.directProductionScore.toFixed(2)} | support ${room.scoreBreakdown.supportRoomScore.toFixed(2)} | cross-room ${room.scoreBreakdown.crossRoomBonusContribution.toFixed(2)}`,
    );
    if (room.chosenRecipeId) {
      lines.push(`  recipe: ${room.chosenRecipeId}`);
    }
    lines.push(`  operators: ${room.assignedOperatorIds.join(", ") || "(none)"}`);
    if (room.warnings.length > 0) {
      lines.push(`  warnings: ${room.warnings.join(" | ")}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("", "Warnings", ...result.warnings.map((warning) => `- ${warning}`));
  }

  return lines.join("\n");
}

export function formatUpgradeRecommendationsText(result: UpgradeRecommendationResult): string {
  const lines = [
    `Catalog: ${result.catalogVersion}`,
    `Ranking mode: ${result.rankingMode}`,
    `Baseline score: ${result.baselineScore.toFixed(2)}`,
    "",
    "Recommendations",
  ];

  for (const recommendation of result.recommendations) {
    lines.push(
      `- ${recommendation.action.operatorId}/${recommendation.action.skillId} -> rank ${recommendation.action.targetRank} | delta ${recommendation.scoreDelta.toFixed(2)} | roi ${recommendation.roi.toFixed(4)} | est days ${(recommendation.estimatedDaysToUnlock ?? 0).toFixed(1)}`,
    );
    lines.push(`  notes: ${recommendation.notes.join(" | ")}`);
  }

  return lines.join("\n");
}
