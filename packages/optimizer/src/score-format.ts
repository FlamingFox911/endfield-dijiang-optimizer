// Presentation only: solver scores and ranking comparisons retain full precision.
export const SCORE_POINTS_PER_UNIT = 1_000;

export function formatScorePoints(value: number, signed = false): string {
  const points = value * SCORE_POINTS_PER_UNIT;
  const prefix = points < 0 ? "-" : signed && points > 0 ? "+" : "";
  const magnitude = Math.abs(points);
  if (magnitude > 0 && magnitude < 1) {
    return `${prefix}<1`;
  }
  return `${prefix}${Math.round(magnitude).toLocaleString("en-US")}`;
}
