import type { OperatorDefinition } from "@endfield/domain";

// First featured banners, never reruns. Separate from skills and scoring.
// Sources and maintenance notes: docs/optimizer-ties.md.
const LIMITED_BANNER_DEBUTS: Readonly<Record<string, string>> = {
  laevatain: "2026-01-22",
  gilberta: "2026-02-07",
  yvonne: "2026-02-24",
  tangtang: "2026-03-12",
  rossi: "2026-03-29",
  "zhuang-fangyi": "2026-04-17",
  mifu: "2026-06-05",
  camille: "2026-06-26",
  arcane: "2026-07-16",
  liino: "2026-08-09",
  typhoeus: "2026-09-02",
};

export function createOperatorPreference(operators: OperatorDefinition[]) {
  const byId = new Map(operators.map((operator) => [operator.id, operator]));
  return (leftId: string, rightId: string): number => {
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    const leftDebut = left?.rarity === 6 ? left.limitedBannerDebut ?? LIMITED_BANNER_DEBUTS[leftId] : undefined;
    const rightDebut = right?.rarity === 6 ? right.limitedBannerDebut ?? LIMITED_BANNER_DEBUTS[rightId] : undefined;
    const tier = Number(Boolean(rightDebut)) - Number(Boolean(leftDebut));
    return tier
      || (leftDebut && rightDebut ? rightDebut.localeCompare(leftDebut) : 0)
      || (right?.rarity ?? 0) - (left?.rarity ?? 0)
      || leftId.localeCompare(rightId);
  };
}
