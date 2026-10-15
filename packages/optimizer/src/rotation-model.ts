import type { ShiftSchedule } from "@endfield/domain";
import { getShiftDurationMinutes } from "@endfield/data";
import { SUPPORT_WEIGHTS } from "./config.js";
import type { MoodModifiers } from "./production-model.js";

// Calibrated Mood capacity/rates: docs/research.md. Forecasts deliberately run
// beyond day one: an imbalanced schedule can fail to recover between shifts.
export const MAX_MOOD = 50_000;
const WARMUP_HOURS = 14 * 24;
const FORECAST_DAYS = 28;
const END_HOUR = WARMUP_HOURS + FORECAST_DAYS * 24;
const EPSILON = 1e-8;

export interface RotationTeam {
  /** No schedule means normal operation: work, recover fully, then resume. */
  schedule?: ShiftSchedule;
  workers: MoodModifiers[];
}
interface SupportSegment extends MoodModifiers {
  start: number;
  end: number;
}
export interface RotationSupport {
  key: string;
  segments: SupportSegment[];
  workingHoursPerDay: number[];
  average: MoodModifiers;
}
export interface RotationUptime {
  workingHoursPerDay: number;
  scheduledHoursPerDay: number;
  downtimeHoursPerDay: number;
  estimatedWorkHoursFromFullMood: number | null;
}

const NO_SUPPORT: MoodModifiers = { moodDropReductionPercent: 0, moodRegenPercent: 0 };
export const EMPTY_ROTATION_SUPPORT: RotationSupport = {
  key: "none", segments: [{ start: 0, end: END_HOUR, ...NO_SUPPORT }],
  workingHoursPerDay: [], average: { ...NO_SUPPORT },
};

function isScheduled(schedule: ShiftSchedule | undefined, hour: number): boolean {
  if (!schedule) return true;
  const minute = ((hour * 60) % 1440 + 1440) % 1440;
  return (minute - schedule.startMinute + 1440) % 1440 < getShiftDurationMinutes(schedule);
}

function nextBoundary(schedule: ShiftSchedule | undefined, hour: number): number {
  if (!schedule) return Infinity;
  return Math.min(...[schedule.startMinute / 60, schedule.endMinute / 60].map((boundary) => {
    const day = Math.floor((hour - boundary + EPSILON) / 24) + 1;
    return boundary + day * 24;
  }));
}

function teamEffects(team: RotationTeam): MoodModifiers {
  return team.workers.reduce((sum, worker) => ({
    moodDropReductionPercent: sum.moodDropReductionPercent + worker.moodDropReductionPercent,
    moodRegenPercent: sum.moodRegenPercent + worker.moodRegenPercent,
  }), { ...NO_SUPPORT });
}

/**
 * Workers in a shift share room-wide drain rates and start at full Mood, so
 * they exhaust together. At zero they must recover to full before returning.
 * Off-shift workers recover in the lounge; only active Nexus support applies.
 * Providers cease helping immediately when their shift ends or they exhaust.
 */
export function simulateControlRotation(teams: RotationTeam[], key: string): RotationSupport {
  if (teams.every((team) => team.workers.length === 0)) {
    return { ...EMPTY_ROTATION_SUPPORT, key, workingHoursPerDay: teams.map(() => 0) };
  }
  const mood = teams.map(() => MAX_MOOD);
  const recovering = teams.map(() => false);
  const effects = teams.map(teamEffects);
  const worked = teams.map(() => 0);
  const segments: SupportSegment[] = [];
  let hour = 0;
  while (hour < END_HOUR - EPSILON) {
    const active = teams.map((team, i) => team.workers.length > 0 && !recovering[i] && isScheduled(team.schedule, hour + EPSILON));
    const support = effects.reduce((sum, effect, i) => ({
      moodDropReductionPercent: sum.moodDropReductionPercent + (active[i] ? effect.moodDropReductionPercent : 0),
      moodRegenPercent: sum.moodRegenPercent + (active[i] ? effect.moodRegenPercent : 0),
    }), { ...NO_SUPPORT });
    const rates = teams.map((_, i) => active[i]
      ? -SUPPORT_WEIGHTS.baselineMoodDrainPerHour * Math.max(0, 1 - support.moodDropReductionPercent / 100)
      : SUPPORT_WEIGHTS.baselineMoodRegenPerHour * (1 + support.moodRegenPercent / 100));
    let end = Math.min(END_HOUR, ...teams.map((team) => nextBoundary(team.schedule, hour)));
    for (let i = 0; i < teams.length; i += 1) {
      if (active[i] && rates[i]! < 0) end = Math.min(end, hour + mood[i]! / -rates[i]!);
      if (recovering[i]) end = Math.min(end, hour + (MAX_MOOD - mood[i]!) / rates[i]!);
    }
    const duration = Math.max(EPSILON, end - hour);
    const measured = Math.max(0, end - Math.max(hour, WARMUP_HOURS));
    for (let i = 0; i < teams.length; i += 1) {
      if (active[i]) worked[i]! += measured;
      mood[i] = Math.max(0, Math.min(MAX_MOOD, mood[i]! + rates[i]! * duration));
      if (active[i] && mood[i]! < EPSILON) recovering[i] = true;
      if (recovering[i] && mood[i]! >= MAX_MOOD - EPSILON) recovering[i] = false;
    }
    const previous = segments.at(-1);
    if (previous && previous.moodDropReductionPercent === support.moodDropReductionPercent && previous.moodRegenPercent === support.moodRegenPercent) {
      previous.end = end;
    } else segments.push({ start: hour, end, ...support });
    hour = end;
  }
  const average = segments.reduce((sum, segment) => {
    const fraction = Math.max(0, segment.end - Math.max(segment.start, WARMUP_HOURS)) / (FORECAST_DAYS * 24);
    return {
      moodDropReductionPercent: sum.moodDropReductionPercent + fraction * segment.moodDropReductionPercent,
      moodRegenPercent: sum.moodRegenPercent + fraction * segment.moodRegenPercent,
    };
  }, { ...NO_SUPPORT });
  return { key, segments, average, workingHoursPerDay: worked.map((hours) => hours / FORECAST_DAYS) };
}

export function getRotationUptime(team: RotationTeam, support = EMPTY_ROTATION_SUPPORT): RotationUptime {
  const effects = teamEffects(team);
  const scheduledHoursPerDay = team.schedule ? getShiftDurationMinutes(team.schedule) / 60 : 24;
  const drainFromFull = SUPPORT_WEIGHTS.baselineMoodDrainPerHour * Math.max(0,
    1 - (effects.moodDropReductionPercent + support.average.moodDropReductionPercent) / 100);
  const estimatedWorkHoursFromFullMood = drainFromFull === 0 ? null : MAX_MOOD / drainFromFull;
  if (team.workers.length > 0 && support.segments.length === 1) {
    const regen = SUPPORT_WEIGHTS.baselineMoodRegenPerHour * (1 + support.average.moodRegenPercent / 100);
    if (scheduledHoursPerDay * drainFromFull <= MAX_MOOD + EPSILON
      && scheduledHoursPerDay * drainFromFull <= (24 - scheduledHoursPerDay) * regen + EPSILON) {
      return { scheduledHoursPerDay, workingHoursPerDay: scheduledHoursPerDay,
        downtimeHoursPerDay: 0, estimatedWorkHoursFromFullMood };
    }
  }
  let mood = MAX_MOOD;
  let recovering = false;
  let worked = 0;
  let hour = 0;
  let segmentIndex = 0;
  if (team.workers.length > 0) {
    while (hour < END_HOUR - EPSILON) {
      while (segmentIndex < support.segments.length - 1 && support.segments[segmentIndex]!.end <= hour + EPSILON) segmentIndex += 1;
      const segment = support.segments[segmentIndex]!;
      const active = !recovering && isScheduled(team.schedule, hour + EPSILON);
      const rate = active
        ? -SUPPORT_WEIGHTS.baselineMoodDrainPerHour * Math.max(0, 1 - (effects.moodDropReductionPercent + segment.moodDropReductionPercent) / 100)
        : SUPPORT_WEIGHTS.baselineMoodRegenPerHour * (1 + segment.moodRegenPercent / 100);
      let end = Math.min(END_HOUR, segment.end, nextBoundary(team.schedule, hour));
      if (active && rate < 0) end = Math.min(end, hour + mood / -rate);
      if (recovering) end = Math.min(end, hour + (MAX_MOOD - mood) / rate);
      if (active) worked += Math.max(0, end - Math.max(hour, WARMUP_HOURS));
      mood = Math.max(0, Math.min(MAX_MOOD, mood + rate * Math.max(EPSILON, end - hour)));
      if (active && mood < EPSILON) recovering = true;
      if (recovering && mood >= MAX_MOOD - EPSILON) recovering = false;
      hour = end;
    }
  }
  const workingHoursPerDay = Math.min(scheduledHoursPerDay, worked / FORECAST_DAYS);
  return { scheduledHoursPerDay, workingHoursPerDay,
    downtimeHoursPerDay: Math.max(0, scheduledHoursPerDay - workingHoursPerDay),
    estimatedWorkHoursFromFullMood };
}
