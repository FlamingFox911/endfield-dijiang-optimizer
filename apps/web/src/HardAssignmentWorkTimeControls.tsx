import type { WorkTimeGoal } from "@endfield/domain";

export function HardAssignmentWorkTimeControls({ operatorName, goal, onChange }: {
  operatorName: string;
  goal?: WorkTimeGoal;
  onChange: (goal: WorkTimeGoal | undefined) => void;
}) {
  return <div className="hardAssignmentWorkTime">
    <label className="plannerCell">
      <span>Work-time goal</span>
      <select aria-label={`Work-time goal for ${operatorName}`} value={goal?.mode ?? "placement_only"}
        onChange={(event) => onChange(event.target.value === "minimum"
          ? { mode: "minimum", hoursPerDay: goal?.mode === "minimum" ? goal.hoursPerDay : 12 }
          : event.target.value === "maximize" ? { mode: "maximize" } : undefined)}>
        <option value="placement_only">Placement only</option>
        <option value="minimum">Minimum active hours/day</option>
        <option value="maximize">Maximize active time</option>
      </select>
    </label>
    {goal?.mode === "minimum" && <label className="plannerCell">
      <span>Minimum active hours/day</span>
      <input aria-label={`Minimum active hours/day for ${operatorName}`} type="number" min="0.1" max="24" step="0.1"
        value={goal.hoursPerDay === 0 ? "" : goal.hoursPerDay}
        onChange={(event) => onChange({ mode: "minimum", hoursPerDay: Number(event.target.value) })} />
    </label>}
    <small className="workTimeHelp">{goal?.mode === "maximize"
      ? "Prioritize actual working hours, then production. This may reduce output elsewhere."
      : goal?.mode === "minimum" ? "Meet this working-time target before optimizing production. Mood and recovery count; scheduled hours alone do not."
        : "Reserve this placement; let the optimizer choose working time for production."}</small>
  </div>;
}
