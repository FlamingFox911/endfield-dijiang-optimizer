import { describe, expect, it } from "vitest";
import { formatProjectedOutputChange, formatScorePoints } from "@endfield/optimizer";

describe("score presentation", () => {
  it.each([
    [1.6, false, "1,600"],
    [0.003, true, "+3"],
    [0.0001, true, "+<1"],
    [0.0009, true, "+<1"],
    [-0.0001, true, "-<1"],
    [-0.003, true, "-3"],
    [0, true, "0"],
    [-0, true, "0"],
  ])("formats %s without hiding a nonzero gain", (value, signed, expected) => {
    expect(formatScorePoints(value, signed)).toBe(expected);
  });

  it("keeps small output improvements and losses visible", () => {
    expect(formatProjectedOutputChange({ productKind: "operator_exp", before: 1, after: 1.001 }))
      .toContain("(+<0.01/hr)");
    expect(formatProjectedOutputChange({ productKind: "weapon_exp", before: 1, after: 0.999 }))
      .toContain("(-<0.01/hr)");
  });
});
