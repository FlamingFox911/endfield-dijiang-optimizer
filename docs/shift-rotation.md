# Cabin shift rotation

Enable **Cabin shift rotation (A/B)** beside **Max facilities overlay**. Rotation defaults to off, including for existing scenarios. Each cabin can use two teams, including Control Nexus and Reception Room, provided both shifts have at least one operator. A cabin with only one staffed team uses normal operation instead. Results can mix single normal facility cards and paired A/B cards. An entirely unstaffed cabin appears once as a normal facility. Each assigned operator has one placement across the whole plan, regardless of whether schedules overlap. At maximum facilities there are 30 seats; a roster of 27 cannot fill all of them.

The planner defaults to **Optimize shift times and teams**. Optimize searches assignments, shift lengths, and clock offsets together. It can give a stronger primary team a longer daily window while the other team covers recovery. Recommended times appear on the result cards; unconstrained cabin teams are labeled with the longer window as A. Hard assignments preserve the specified team. Mood carries across days, so a window that fits from full Mood can still cause downtime if its rest window is too short.

Choose **Use my fixed shift times** to supply schedules instead. Set A's start and end using the game's clock; B covers the remaining hours. Defaults are A 00:00-12:00 and B 12:00-00:00. Endpoints must be whole hours, and each team works a 1-23 hour window. Overnight windows, swapping hours, and resetting each cabin's schedule are supported. Times remain stored as minutes after midnight, in multiples of 60, without timezone conversion. Saved fixed times remain available when changing modes. Earlier saved minute-based schedules migrate to the nearest hourly start and duration, clamped to 1-23 hours, with a migration notice.

This models the complementary **daily Auto-Rotate schedule** shown in the screenshots. Repeated manual recovery swaps within a day are not modeled: the supplied interface describes one daily window for each shift, and the official notes do not establish a repeating short-cycle scheduler.

Both modes share the roster, recipes, demand weights, and maximum-facilities overlay. Hard assignments have an A/B selector; existing pins default to A. B pins remain saved when rotation is off but do not reserve operators or affect the legacy search. Unlock recommendations re-evaluate the same rotation objective and can reuse a feasible baseline's teams and schedules as a search seed.

**Unstaffed** means an actual empty seat, contributing no staffing or skill effects. Manufacturing, Growth, and Reception all count the base active throughput and +40% staffing per working operator, multiplied by matching general efficiency skills. A Reception worker does not need a clue skill to contribute. The solver leaves seats empty when there are insufficient operators or no modeled benefit. Unlocked specific-clue Rate-UP skills are excluded from automatic Reception placements, including score-equivalent alternatives. Pin an operator to Reception to request clue targeting explicitly. General clue-collection bonuses remain eligible. These rules also apply with rotation off; no clue probability or numerical penalty is invented.

Results include **Unused owned operators** with reasons for each omitted worker. These explanations evaluate adding the worker to remaining legal open seats while holding the chosen teams and schedules fixed; they do not claim that every possible reallocation has been ruled out. When Reception already covers its window, extra Mood support may add no further uptime, but the added worker still contributes staffing efficiency. Hard Assignments can reserve a seat. The regression fixture in `tests/fixtures/shift-rotation-roster.json` covers a 27-owned-operator scenario and required live catalog differences, with import metadata and inventory removed. Model v6 uses all 27 operators, fully staffs the 18 Manufacturing/Growth seats, and balances the rest between Nexus and Reception. The earlier skill-only Reception objective incorrectly left two workers unused; v5 corrected staffing but overvalued Reception, which v6 rebalances without removing the staffing benefit.

Results show each rotating team's schedule, estimated working hours per day, downtime inside its window, and estimated work time from full Mood. Normal facility cards have no shift clock: their team works until Mood is depleted, recovers fully, and resumes without waiting for a handoff. Normal facilities use the same event forecast as rotating teams, including time-varying Nexus support, and display recovery time as rest. Scores and recipe outputs are averaged over the entire day, so adding A and B does not double production. Nexus gains are credited once across its cards, proportional to positive marginal gains. Production cards show scores without Nexus support and outputs with it, consistent with legacy accounting.

## Search and guarantees

Automatic timing uses a bounded multi-start coordinate search. It starts with a balanced assignment, tries both balanced and concentrated Nexus support, and also tries reserving scarce providers before filling production. It alternates cabin schedule searches with operator additions, removals, replacements, and swaps. Each cabin schedule search compares all 24 starting hours and all 23 legal durations, except that constant support retains the current start and compares only durations. This shortcut is not generally lossless under the finite Mood forecast; see the [exact search investigation](exact-shift-search-investigation.md) for counterexamples, reproducible probes, and a proposed replacement without an effort slider. Neutral improvements to Nexus coverage can enable a subsequent longer production window. Final filling checks add every remaining operator that improves the score in an open seat.

This is an approximate joint search, not joint enumeration of every assignment and combination of cabin schedules. The result therefore always reports `search.complete: false` and includes `search.scheduleSearch` with `resolutionMinutes: 60`, even if a seed allocation was certified. The progress counter includes evaluated team plans and schedules. A one-state certificate for a fixed noon split cannot prove the joint optimum. Hourly handoffs may cause downtime or longer-than-needed rest; the search compares estimated daily output rather than rounding a minute-level optimum after scoring it.

Fixed schedules retain the existing assignment search. When baseline Mood rates sustain every window, a matching bound can certify an allocation immediately. It matches unique operators to hypothetical fully staffed seats, with dummy seats for unnecessary workers, then checks the candidate against the actual objective. If the bound is unattainable, search continues. Maximum fixed-schedule search enumerates compatible Nexus teams before the other room teams. Search completeness refers to the modeled objective and does not verify game mechanics.

After either search, any cabin with an empty shift switches to normal operation and the planner re-solves assignments, schedules, and shipwide support. This repeats until every remaining A/B pair has two staffed teams. The result is recomputed rather than hiding an empty card with its old score. A lone Shift B hard assignment stays in its requested facility when it becomes normal; saved pins and schedules remain intact. Mode changes use a bounded repair, not enumeration of every normal/rotation combination, so a repaired result reports `search.complete: false`. Progress totals include these passes. Model `v6-rotation-v4` identifies hybrid forecasting with the rebalanced Reception preference; see the [scoring review](scoring-model-2026-09-13.md).

## Evidence and assumptions

The user's October 2026 screenshots establish complementary daily schedules, the noon default, editable endpoints, and the downtime warning. The [official October 15 update notes](https://endfield.gryphline.com/en-us/news/9560) confirm two shifts per cabin, manual activation, Auto-Rotate, and possible production halts. The [October 7 developer communication](https://endfield.gryphline.com/en-us/news/7014) describes scheduled switching.

The forecast uses community-calibrated capacity of 50,000 Mood, 3,600 Mood drained per working hour, and 6,000 restored per resting hour; see [research notes](research.md). These rates are estimates. A baseline team from full Mood lasts about 13h 53m, consistent with the supplied Nexus screenshot.

The event-driven forecast carries Mood through 14 warm-up days and measures the following 28 days. Events occur at schedule boundaries, exhaustion, full recovery, and active Nexus support changes. Mood is never reset at midnight or handoff. A depleted operator recovers to full before returning; a team that has not exhausted can resume with partial Mood. Finite averages can depend on cycle phase and are not an infinite-horizon guarantee.

Teammates start full and share room-wide drain, so their work and exhaustion are synchronized. Staffing and production skills apply together during actual work. Drain reduction applies while its provider works. Nexus support follows the active team and stops during its breaks; off-shift providers receive the other team's regeneration effects. Off-shift teams are assumed to recover in the lounge with Nexus regeneration, without local regeneration from the other cabin team. Current individual Mood and staggered teammates are not tracked. Revisit these assumptions as further in-game evidence becomes available.

## Scenario JSON

Rotation is optional in scenario format 1; older scenarios require no migration.

```json
{
  "options": {
    "maxFacilities": false,
    "shiftRotation": {
      "enabled": true,
      "scheduleMode": "fixed",
      "schedules": {
        "control_nexus": { "startMinute": 0, "endMinute": 720 },
        "mfg-1": { "startMinute": 1200, "endMinute": 480 }
      }
    }
  },
  "facilities": {
    "hardAssignments": [
      { "operatorId": "ember", "roomId": "mfg-1", "shift": "B" }
    ]
  }
}
```

This fragment belongs inside a complete scenario. `scheduleMode` defaults to `optimized`; `fixed` preserves supplied times. Both endpoints must be distinct multiples of 60 from 0 through 1380. Unknown room ids and invalid shift names or modes are rejected. A cabin without saved times uses the noon split. Automatic timing uses a saved start as an initial clock offset and returns recommended times in the result without changing the saved fixed schedule.

Recipe selections are shared between a cabin's shifts. Plans use `physicalRoomId` and `shift` for the cabin/team; `roomId` is the unique search key (A retains the physical id, B appends `::shift-B`). A null `estimatedWorkHoursFromFullMood` means no drain under estimated support. Rotation comparisons tolerate floating-point summation differences; no operator may be reused in alternatives without removing its existing placement.
