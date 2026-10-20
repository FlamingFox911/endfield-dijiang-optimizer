import type { OptimizationResult, OptimizationScenario, WorkTimeGoalResult } from "@endfield/domain";

/** A lexicographic objective: goals never borrow production points as hours. */
export interface WorkTimeObjective {
  minimumShortfallHours: number;
  maximizedHours: number;
  productionScore: number;
}

export const WORK_TIME_TOLERANCE = 1e-7;

export function summarizeWorkTimeGoals(goals: WorkTimeGoalResult[]) {
  const active = goals.filter((goal) => goal.status !== "inactive");
  return {
    minimumShortfallHours: active.reduce((sum, goal) => sum
      + (goal.mode === "minimum" ? Math.max(0, goal.requestedHoursPerDay! - goal.workingHoursPerDay - WORK_TIME_TOLERANCE) : 0), 0),
    maximizedHours: active.reduce((sum, goal) => sum + (goal.mode === "maximize" ? goal.workingHoursPerDay : 0), 0),
  };
}

export function resultWorkTimeObjective(result: OptimizationResult): WorkTimeObjective {
  return { ...summarizeWorkTimeGoals(result.workTimeGoals ?? []), productionScore: result.totalScore };
}

export function compareWorkTimeObjectives(left: WorkTimeObjective, right: WorkTimeObjective): number {
  if (Math.abs(left.minimumShortfallHours - right.minimumShortfallHours) > WORK_TIME_TOLERANCE) {
    return right.minimumShortfallHours - left.minimumShortfallHours;
  }
  if (Math.abs(left.maximizedHours - right.maximizedHours) > WORK_TIME_TOLERANCE) {
    return left.maximizedHours - right.maximizedHours;
  }
  return Math.abs(left.productionScore - right.productionScore) > 1e-11
    ? left.productionScore - right.productionScore : 0;
}

export function hasWorkTimeGoals(scenario: OptimizationScenario): boolean {
  return scenario.facilities.hardAssignments.some((pin) => pin.workTimeGoal
    && pin.workTimeGoal.mode !== "placement_only"
    && (pin.shift !== "B" || scenario.options.shiftRotation?.enabled));
}
