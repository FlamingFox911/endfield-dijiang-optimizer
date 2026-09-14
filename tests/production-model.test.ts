import { describe, expect, it } from "vitest";

import {
  getAverageControlSupport,
  getExpectedProductionMultiplier,
  getRoomWorkingUptimes,
  getWorkingUptime,
  type MoodModifiers,
} from "../packages/optimizer/src/production-model.js";

const noMood: MoodModifiers = { moodDropReductionPercent: 0, moodRegenPercent: 0 };

describe("production model", () => {
  it("uses the measured work/rest rates and caps complete drain prevention", () => {
    expect(getWorkingUptime(0, 0)).toBe(0.625);
    expect(getWorkingUptime(20, 0)).toBeCloseTo(6000 / (6000 + 2880), 12);
    expect(getWorkingUptime(0, 20)).toBeCloseTo(7200 / (7200 + 3600), 12);
    expect(getWorkingUptime(100, 0)).toBe(1);
    expect(getWorkingUptime(120, 0)).toBe(1);
    expect(getWorkingUptime(0, -100)).toBe(0);
  });

  it("produces nothing without an active operator", () => {
    expect(getExpectedProductionMultiplier([], [])).toBe(0);
    expect(getExpectedProductionMultiplier([0, 0, 0], [30, 20, 20])).toBe(0);
  });

  it("multiplies active staffing and matching skill bonuses", () => {
    expect(getExpectedProductionMultiplier([1], [20])).toBeCloseTo(1.68, 12);
    expect(getExpectedProductionMultiplier([1, 1], [30, 20])).toBeCloseTo(2.70, 12);
    expect(getExpectedProductionMultiplier([1, 1, 1], [30, 20, 20])).toBeCloseTo(3.74, 12);
  });

  it("matches the expectation over every combination of active workers", () => {
    const uptimes = [0.625, 0.71, 0.82];
    const bonuses = [30, 0, 20];
    let expected = 0;
    for (let state = 0; state < 8; state += 1) {
      let activeCount = 0;
      let activeBonus = 0;
      let probability = 1;
      for (let worker = 0; worker < 3; worker += 1) {
        if ((state & (1 << worker)) !== 0) {
          activeCount += 1;
          activeBonus += bonuses[worker]!;
          probability *= uptimes[worker]!;
        } else {
          probability *= 1 - uptimes[worker]!;
        }
      }
      if (activeCount > 0) {
        expected += probability * (1 + 0.4 * activeCount) * (1 + activeBonus / 100);
      }
    }
    expect(getExpectedProductionMultiplier(uptimes, bonuses)).toBeCloseTo(expected, 12);
    expect(expected).toBeLessThan(getExpectedProductionMultiplier([1, 1, 1], bonuses));
  });

  it("preserves the ordinary staffing benefit for a worker with no matching skill", () => {
    expect(getExpectedProductionMultiplier([0.625], [0])).toBeCloseTo(0.875, 12);
    expect(getExpectedProductionMultiplier([1, 1], [30, 0]))
      .toBeGreaterThan(getExpectedProductionMultiplier([1], [30]));
  });

  it("applies a room's mood reduction to its provider and every peer", () => {
    const provider: MoodModifiers = { moodDropReductionPercent: 18, moodRegenPercent: 0 };
    const uptimes = getRoomWorkingUptimes([provider, noMood, noMood], noMood);
    const providerUptime = getWorkingUptime(18, 0);
    expect(uptimes[0]).toBeCloseTo(providerUptime, 9);
    expect(uptimes[1]).toBeCloseTo(getWorkingUptime(18 * providerUptime, 0), 9);
    expect(uptimes[2]).toBeCloseTo(uptimes[1]!, 12);
    expect(uptimes.every((uptime) => uptime > 0.625)).toBe(true);
  });

  it("does not let a resting provider accelerate its own mood regeneration", () => {
    const provider: MoodModifiers = { moodDropReductionPercent: 0, moodRegenPercent: 16 };
    expect(getRoomWorkingUptimes([provider], noMood)).toEqual([0.625]);
    const uptimes = getRoomWorkingUptimes([provider, noMood], noMood);
    expect(uptimes[0]).toBe(0.625);
    expect(uptimes[1]).toBeCloseTo(getWorkingUptime(0, 16 * 0.625), 9);
    expect(getAverageControlSupport([provider])).toEqual({
      moodDropReductionPercent: 0,
      moodRegenPercent: 10,
    });
  });

  it("converges coupled room support and applies shipwide support on top", () => {
    const workers: MoodModifiers[] = [
      { moodDropReductionPercent: 18, moodRegenPercent: 0 },
      { moodDropReductionPercent: 14, moodRegenPercent: 0 },
      noMood,
    ];
    const global: MoodModifiers = { moodDropReductionPercent: 6, moodRegenPercent: 10 };
    const uptimes = getRoomWorkingUptimes(workers, global);
    const withoutGlobal = getRoomWorkingUptimes(workers, noMood);
    for (let index = 0; index < workers.length; index += 1) {
      const peerDrop = workers.reduce((sum, worker, peer) => peer === index
        ? sum
        : sum + worker.moodDropReductionPercent * uptimes[peer]!, 0);
      expect(uptimes[index]).toBeCloseTo(
        getWorkingUptime(workers[index]!.moodDropReductionPercent + peerDrop + 6, 10),
        8,
      );
      expect(uptimes[index]).toBeGreaterThan(withoutGlobal[index]!);
    }
  });

  it("allows control providers to support one another while retaining their rest time", () => {
    const workers: MoodModifiers[] = [
      { moodDropReductionPercent: 0, moodRegenPercent: 16 },
      { moodDropReductionPercent: 14, moodRegenPercent: 0 },
    ];
    const average = getAverageControlSupport(workers);
    expect(average.moodRegenPercent).toBeGreaterThan(16 * 0.625);
    expect(average.moodRegenPercent).toBeLessThan(16);
    expect(average.moodDropReductionPercent).toBeGreaterThan(14 * getWorkingUptime(14, 0));
    expect(average.moodDropReductionPercent).toBeLessThan(14);
    expect(getAverageControlSupport([])).toEqual(noMood);
  });
});
