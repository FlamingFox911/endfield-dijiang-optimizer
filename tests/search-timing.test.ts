import { describe, expect, it } from "vitest";
import { createSearchTiming } from "../packages/optimizer/src/search-timing.js";

describe("search timing estimates", () => {
  it("measures throughput and time to the bounded search limit, excluding preparation", () => {
    let now = 50_000;
    const timing = createSearchTiming(1_000_000, () => now);
    expect(timing.snapshot(0).nodesPerSecond).toBeNull();
    timing.start();
    now += 500;
    expect(timing.snapshot(100).estimatedRemainingMs).toBeNull();
    now += 9_500;
    expect(timing.snapshot(200_000)).toMatchObject({
      elapsedMs: 10_000, nodesPerSecond: 20_000, estimatedRemainingMs: 40_000, estimateBasis: "budget",
    });
    expect(timing.snapshot(1_000_000).estimatedRemainingMs).toBe(0);
  });

  it("does not extrapolate an unlimited run from visited nodes alone", () => {
    let now = 0;
    const timing = createSearchTiming(null, () => now);
    timing.start();
    timing.setTotalBranches(30);
    now = 240_000;
    expect(timing.snapshot(44_410_000)).toMatchObject({
      nodesPerSecond: 44_410_000 / 240, estimatedRemainingMs: null, estimateBasis: null,
      completedBranches: 0, totalBranches: 30,
    });
    timing.completeBranch();
    timing.completeBranch();
    expect(timing.snapshot(44_410_000).estimatedRemainingMs).toBeNull();
  });

  it("estimates remaining branch time after multiple samples and withdraws a stale estimate", () => {
    let now = 0;
    const timing = createSearchTiming(null, () => now);
    timing.start();
    timing.setTotalBranches(8);
    for (now = 2_000; now <= 6_000; now += 2_000) timing.completeBranch();
    now = 7_000;
    expect(timing.snapshot(70_000)).toMatchObject({
      completedBranches: 3, totalBranches: 8, estimateBasis: "branches", estimatedRemainingMs: 9_000,
    });
    now = 10_000;
    expect(timing.snapshot(100_000).estimatedRemainingMs).toBeNull();
    timing.completeBranch();
    expect(timing.snapshot(100_000)).toMatchObject({ estimateBasis: "branches", estimatedRemainingMs: 10_000 });
  });

  it("never presents the end of DFS as the end of final result processing", () => {
    let now = 0;
    const timing = createSearchTiming(1_000_000, () => now);
    timing.start();
    now = 10_000;
    timing.finish();
    now = 50_000;
    expect(timing.snapshot(10_000)).toMatchObject({
      searchFinished: true, elapsedMs: 10_000, nodesPerSecond: 1_000, estimatedRemainingMs: null, estimateBasis: null,
    });
  });
});
