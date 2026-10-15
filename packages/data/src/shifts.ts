import type { OptimizationScenario, ShiftSchedule } from "@endfield/domain";

export const DEFAULT_SHIFT_SCHEDULE: Readonly<ShiftSchedule> = { startMinute: 0, endMinute: 720 };
export const SHIFT_SCHEDULE_STEP_MINUTES = 60;

export function isValidShiftSchedule(value: unknown): value is ShiftSchedule {
  if (value === null || typeof value !== "object") return false;
  const schedule = value as ShiftSchedule;
  return Number.isInteger(schedule.startMinute) && schedule.startMinute >= 0 && schedule.startMinute < 1440
    && Number.isInteger(schedule.endMinute) && schedule.endMinute >= 0 && schedule.endMinute < 1440
    && schedule.startMinute % SHIFT_SCHEDULE_STEP_MINUTES === 0 && schedule.endMinute % SHIFT_SCHEDULE_STEP_MINUTES === 0
    && schedule.startMinute !== schedule.endMinute;
}

/** Upgrade minute-based schedules saved by earlier optimizer versions. Keep
 * the nearest legal start and duration, including overnight windows. */
export function snapShiftScheduleToHours(value: unknown): ShiftSchedule | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const schedule = value as ShiftSchedule;
  if (![schedule.startMinute, schedule.endMinute].every((endpoint) => Number.isInteger(endpoint) && endpoint >= 0 && endpoint < 1440)
    || schedule.startMinute === schedule.endMinute) return undefined;
  const startMinute = Math.round(schedule.startMinute / 60) * 60 % 1440;
  const duration = Math.max(1, Math.min(23, Math.round(getShiftDurationMinutes(schedule) / 60))) * 60;
  return { startMinute, endMinute: (startMinute + duration) % 1440 };
}

export function getShiftDurationMinutes(schedule: ShiftSchedule): number {
  return (schedule.endMinute - schedule.startMinute + 1440) % 1440;
}

export function getRoomShiftSchedule(scenario: OptimizationScenario, roomId: string): ShiftSchedule {
  const saved = scenario.options.shiftRotation?.schedules?.[roomId];
  return isValidShiftSchedule(saved) ? { ...saved } : { ...DEFAULT_SHIFT_SCHEDULE };
}

export function formatShiftTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** Internal search id; physical ids remain unchanged in scenario files. */
export function getShiftRoomId(roomId: string, shift: "A" | "B" = "A"): string {
  return shift === "A" ? roomId : `${roomId}::shift-B`;
}
