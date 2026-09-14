import { SUPPORT_WEIGHTS } from "./config.js";

export interface MoodModifiers {
  moodDropReductionPercent: number;
  moodRegenPercent: number;
}

const NO_MOOD_MODIFIERS: MoodModifiers = {
  moodDropReductionPercent: 0,
  moodRegenPercent: 0,
};
const MAX_MOOD_ITERATIONS = 200;
const MOOD_CONVERGENCE_TOLERANCE = 1e-10;

/** Fraction of a full work/rest cycle spent working at the supplied rates. */
export function getWorkingUptime(
  moodDropReductionPercent: number,
  moodRegenPercent: number,
): number {
  const drain = SUPPORT_WEIGHTS.baselineMoodDrainPerHour
    * Math.max(0, 1 - moodDropReductionPercent / 100);
  const regen = SUPPORT_WEIGHTS.baselineMoodRegenPerHour
    * Math.max(0, 1 + moodRegenPercent / 100);

  if (drain === 0) return 1;
  if (regen === 0) return 0;
  return regen / (regen + drain);
}

/**
 * Estimate unsynchronized work/rest cycles using average support from peers.
 * A provider is active throughout its own work, so its own drain reduction
 * applies fully. It is inactive during its own rest, so its regeneration
 * modifier can help peers but cannot improve its own recovery.
 *
 * The resulting rates are a steady-state approximation, not a rotation plan.
 * Global modifiers are already averaged over their providers' active time.
 */
export function getRoomWorkingUptimes(
  workers: MoodModifiers[],
  global: MoodModifiers,
): number[] {
  let uptimes = workers.map((worker) => getWorkingUptime(
    global.moodDropReductionPercent + worker.moodDropReductionPercent,
    global.moodRegenPercent,
  ));

  for (let iteration = 0; iteration < MAX_MOOD_ITERATIONS; iteration += 1) {
    const averageDropReduction = workers.reduce(
      (sum, worker, index) => sum + worker.moodDropReductionPercent * uptimes[index]!,
      0,
    );
    const averageRegen = workers.reduce(
      (sum, worker, index) => sum + worker.moodRegenPercent * uptimes[index]!,
      0,
    );
    let largestChange = 0;
    const nextUptimes = workers.map((worker, index) => {
      const current = uptimes[index]!;
      const target = getWorkingUptime(
        global.moodDropReductionPercent
          + worker.moodDropReductionPercent
          + averageDropReduction - worker.moodDropReductionPercent * current,
        global.moodRegenPercent
          + averageRegen - worker.moodRegenPercent * current,
      );
      // Damping stabilizes coupled providers without assuming their phases sync.
      const next = (current + target) / 2;
      largestChange = Math.max(largestChange, Math.abs(next - current));
      return next;
    });

    uptimes = nextUptimes;
    if (largestChange < MOOD_CONVERGENCE_TOLERANCE) break;
  }

  return uptimes;
}

/**
 * Exact expectation, given independent active probabilities, of
 * 1(N > 0) * (1 + 0.4N) * (1 + sum of active matching skill bonuses).
 * The cross term matters: staffing and skill efficiency multiply in game.
 */
export function getExpectedProductionMultiplier(
  uptimes: number[],
  productionBonusesPercent: number[],
): number {
  const occupancyBonus = SUPPORT_WEIGHTS.assignedOperatorProductionEfficiencyPercent / 100;
  const expectedActiveCount = uptimes.reduce((sum, uptime) => sum + uptime, 0);
  const probabilityAnyActive = 1 - uptimes.reduce((probability, uptime) => probability * (1 - uptime), 1);
  let expectedSkillBonus = 0;
  let expectedCountTimesSkillBonus = 0;

  for (let index = 0; index < uptimes.length; index += 1) {
    const uptime = uptimes[index]!;
    const weightedBonus = uptime * ((productionBonusesPercent[index] ?? 0) / 100);
    expectedSkillBonus += weightedBonus;
    expectedCountTimesSkillBonus += weightedBonus * (1 + expectedActiveCount - uptime);
  }

  return probabilityAnyActive
    + occupancyBonus * expectedActiveCount
    + expectedSkillBonus
    + occupancyBonus * expectedCountTimesSkillBonus;
}

/** Mean shipwide support, accounting for each Control Nexus provider's rest. */
export function getAverageControlSupport(workers: MoodModifiers[]): MoodModifiers {
  const uptimes = getRoomWorkingUptimes(workers, NO_MOOD_MODIFIERS);
  return workers.reduce<MoodModifiers>((average, worker, index) => ({
    moodDropReductionPercent: average.moodDropReductionPercent
      + worker.moodDropReductionPercent * uptimes[index]!,
    moodRegenPercent: average.moodRegenPercent
      + worker.moodRegenPercent * uptimes[index]!,
  }), { ...NO_MOOD_MODIFIERS });
}
