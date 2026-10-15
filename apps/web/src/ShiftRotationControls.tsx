import type { OptimizationScenario, ShiftSchedule } from "@endfield/domain";
import { DEFAULT_SHIFT_SCHEDULE, formatShiftTime, getShiftDurationMinutes } from "@endfield/data";

interface Props {
  scenario: OptimizationScenario;
  rooms: Array<{ id: string; label: string }>;
  onChange: (roomId: string, schedule: ShiftSchedule) => void;
  onModeChange: (mode: "optimized" | "fixed") => void;
}

export function ShiftRotationControls({ scenario, rooms, onChange, onModeChange }: Props) {
  const automatic = scenario.options.shiftRotation?.scheduleMode !== "fixed";
  return <article className="roomCard shiftRotationCard" aria-label="Cabin shift schedules">
    <div className="panelHeader">
      <div><p className="eyebrow">Cabin: Auto-Rotate</p><h3>Shift schedules</h3></div>
      <span className="miniStat">Up to two teams per cabin</span>
    </div>
    <label className="plannerCell">
      <span>Schedule mode</span>
      <select aria-label="Shift schedule mode" value={automatic ? "optimized" : "fixed"}
        onChange={(event) => onModeChange(event.target.value as "optimized" | "fixed")}>
        <option value="optimized">Optimize shift times and teams</option>
        <option value="fixed">Use my fixed shift times</option>
      </select>
    </label>
    <p className="subtle">Shift times use whole hours. Hourly handoffs can leave some downtime or extra rest; forecasts still show actual work and recovery time.</p>
    <p className="subtle">Both shifts need operators. A facility with only one team uses normal operation instead, so results can mix normal facilities and A/B shifts.</p>
    {automatic ? <>
      <p>Optimize searches team assignments and complementary daily work windows together. Stronger teams can work longer while the other team covers their recovery. Each operator has one placement across the entire base, with up to 30 distinct operators at maximum facilities.</p>
      <p className="subtle">Recommended times appear on the result cards. Mood carries across days. This searches the daily Auto-Rotate schedule; repeated manual swaps within a day are not modeled. The best plan found is an estimate, not a proven global optimum.</p>
    </> : <>
    <p>Set Shift A’s start and end in the game’s schedule clock. Shift B covers the remaining hours. Optimize assigns separate operators to both teams, with each operator used once across the plan.</p>
    <p className="subtle">Defaults: A 00:00–12:00, B 12:00–00:00. Overnight shifts are supported. Mood forecasts include recovery between shifts; short rest windows can still cause downtime.</p>
    <div className="shiftScheduleList">
      {rooms.map((room) => {
        const schedule = scenario.options.shiftRotation?.schedules?.[room.id] ?? DEFAULT_SHIFT_SCHEDULE;
        const duration = getShiftDurationMinutes(schedule);
        const points = [...new Set([0, schedule.startMinute, schedule.endMinute, 1440])].sort((a, b) => a - b);
        return <div className="shiftScheduleRow" key={room.id} id={`validation-target-shift-${room.id}`} tabIndex={-1}>
          <strong>{room.label}</strong>
          <div className="shiftScheduleFields">
            {(["startMinute", "endMinute"] as const).map((field) => <label key={field}>
              <span>A {field === "startMinute" ? "starts" : "ends"}</span>
              <select aria-label={`${room.label} Shift A ${field === "startMinute" ? "start" : "end"}`}
                value={formatShiftTime(schedule[field])}
                onChange={(event) => {
                  if (!event.target.value) return;
                  const [hours, minutes] = event.target.value.split(":").map(Number);
                  onChange(room.id, { ...schedule, [field]: hours! * 60 + minutes! });
                }}>
                {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={formatShiftTime(hour * 60)}>{formatShiftTime(hour * 60)}</option>)}
              </select>
            </label>)}
            <button type="button" className="secondary" aria-label={`Swap ${room.label} shift hours`}
              onClick={() => onChange(room.id, { startMinute: schedule.endMinute, endMinute: schedule.startMinute })}>Swap hours</button>
            <button type="button" className="secondary" aria-label={`Reset ${room.label} shift hours`}
              onClick={() => onChange(room.id, { ...DEFAULT_SHIFT_SCHEDULE })}>Reset</button>
          </div>
          {duration === 0 ? <p className="warningText">Choose different start and end times.</p> : <>
            <div className="shiftTimeline" aria-label={`${room.label}: Shift A ${(duration / 60).toFixed(1)} hours, Shift B ${((1440 - duration) / 60).toFixed(1)} hours`}>
              {points.slice(0, -1).map((start, index) => {
                const active = (start - schedule.startMinute + 1440) % 1440 < duration;
                return <span key={start} className={active ? "shiftTimelineA" : "shiftTimelineB"}
                  style={{ flexGrow: points[index + 1]! - start }}>{active ? "A" : "B"}</span>;
              })}
            </div>
            <small>A {formatShiftTime(schedule.startMinute)}–{formatShiftTime(schedule.endMinute)} ({(duration / 60).toFixed(1)}h) · B {formatShiftTime(schedule.endMinute)}–{formatShiftTime(schedule.startMinute)} ({((1440 - duration) / 60).toFixed(1)}h)</small>
          </>}
        </div>;
      })}
    </div>
    </>}
  </article>;
}
