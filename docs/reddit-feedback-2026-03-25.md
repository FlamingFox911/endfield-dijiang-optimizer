# Reddit Feedback Backlog (2026-03-25)

Source thread: https://www.reddit.com/r/Endfield/comments/1s259qo/made_a_manual_dijiang_planner_for_endfield/

This document records the issues raised in the Reddit feedback thread so they can be tracked and addressed in batches later. Maintainer replies by `FlamingFox911` were reviewed and noted where they clarify intent or likely direction.

Resolved items are removed from this active backlog once they are shipped.

Effort buckets:

- `Small`: localized copy, styling, or interaction polish.
- `Medium`: contained workflow or layout changes that touch multiple handlers or tests.
- `Large`: multi-pass work, broader redesign, or optimizer tuning that needs scenario coverage.

Change-type tags:

- `onboarding`
- `navigation_copy`
- `visual_accessibility`
- `interaction_model`
- `responsive_layout`
- `optimizer_logic`
- `product_value`

Primary source comments:

- `voiddp` on setup friction: https://www.reddit.com/r/Endfield/comments/1s259qo/made_a_manual_dijiang_planner_for_endfield/oc6y8p3/
- `Amasoken` on UI/UX, accessibility, and mockups: https://www.reddit.com/r/Endfield/comments/1s259qo/made_a_manual_dijiang_planner_for_endfield/oc7nggy/
- `jhm550` on optimizer behavior and weighting: https://www.reddit.com/r/Endfield/comments/1s259qo/made_a_manual_dijiang_planner_for_endfield/oc7ut26/

Maintainer reply references:

- `FlamingFox911` reply to `voiddp`: https://www.reddit.com/r/Endfield/comments/1s259qo/made_a_manual_dijiang_planner_for_endfield/oc6yyd8/
- `FlamingFox911` reply to `Amasoken`: https://www.reddit.com/r/Endfield/comments/1s259qo/made_a_manual_dijiang_planner_for_endfield/oc94nff/
- `FlamingFox911` reply to `jhm550`: https://www.reddit.com/r/Endfield/comments/1s259qo/made_a_manual_dijiang_planner_for_endfield/oc932n9/

## Onboarding and setup friction

- `RF-001` Initial roster setup is too tedious. Users do not want to click ownership, level, promotion, and base skill states operator by operator.
  Type: `onboarding`
  Effort: `Medium`
  Sources: `oc6y8p3`, `oc7nggy`
  Notes: Maintainer already acknowledged this and mentioned a quick max-out option.

- `RF-002` There is no fast-start mode for evaluating the tool. Users want an `everything maxed` option, starter templates, or a workflow that starts fully enabled and lets them remove what they do not have.
  Type: `onboarding`
  Effort: `Medium`
  Sources: `oc6y8p3`

- `RF-003` The default empty-state onboarding is weak. Starting from everything unset or locked makes first-time use feel high-effort.
  Type: `onboarding`
  Effort: `Medium`
  Sources: `oc7nggy`

- `RF-004` The tool is currently hard for average users to utilize properly, even if the underlying idea is useful.
  Type: `product_value`
  Effort: `Large`
  Sources: `oc7nggy`

## Navigation, clarity, and layout

- `RF-005` The overall design does not make the next step obvious. `Roster`, `Planner`, and `Results` are not self-explanatory enough as primary actions.
  Type: `navigation_copy`
  Effort: `Medium`
  Sources: `oc7nggy`

- `RF-006` The roster editing flow requires too much pointer travel between checkboxes, text inputs, and skill controls.
  Type: `interaction_model`
  Effort: `Medium`
  Sources: `oc7nggy`

- `RF-009` Some labels are ambiguous or under-explained, including `Owned`, `Sources`, `Gaps`, and `Search effort`.
  Type: `navigation_copy`
  Effort: `Small`
  Sources: `oc7nggy`

- `RF-010` The roster layout wastes space. Labels and controls are too far apart, reducing scannability.
  Type: `visual_accessibility`
  Effort: `Medium`
  Sources: `oc7nggy`

- `RF-012` Mobile usability likely needs work. The current layout appears scroll-heavy and awkward on smaller screens.
  Type: `responsive_layout`
  Effort: `Medium`
  Sources: `oc7nggy`

- `RF-015` Accessibility and general UI clarity need improvement as a broader theme.
  Type: `visual_accessibility`
  Effort: `Large`
  Sources: `oc7nggy`

## Roster interaction and batch operations

- `RF-016` Batch operations are missing. Users want actions like select-all, multi-select, or bulk apply for ownership, level, and unlocked skills.
  Type: `interaction_model`
  Effort: `Large`
  Sources: `oc7nggy`
  Notes: Maintainer explicitly called batch operations interesting and worth exploring.

- `RF-018` Tooltip behavior is too slow because it relies on default system timing rather than fast custom hover behavior.
  Type: `interaction_model`
  Effort: `Small`
  Sources: `oc7nggy`
  Notes: Maintainer already leaned toward custom on-hover tooltips.

- `RF-021` The roster card layout could reduce pointer travel by moving ownership and skill controls closer to portraits.
  Type: `interaction_model`
  Effort: `Large`
  Sources: `oc7nggy`
  Notes: This feedback came with a mockup example attached in the Reddit comment.

## Optimizer behavior and trust

- `RF-022` Reception-room clue logic appears to overvalue generic clue-rate-up effects instead of respecting clue-specific usefulness.
  Type: `optimizer_logic`
  Effort: `Large`
  Sources: `oc7ut26`
  Notes: Maintainer replied that clue-rate-up was intended to be net-neutral and likely needs weight review.

- `RF-023` Some room weighting appears off. One reported case prioritized mineral output on Fluorite over stronger mood regeneration, even when mood sustain was more valuable in practice.
  Type: `optimizer_logic`
  Effort: `Large`
  Sources: `oc7ut26`

- `RF-024` The optimizer may over-prefer Growth Chamber assignments relative to player priorities in manufacturing or other rooms.
  Type: `optimizer_logic`
  Effort: `Large`
  Sources: `oc7ut26`

- `RF-025` Advanced users may need to hard-assign too many operators manually for the result to match practical preferences, which reduces trust in the recommendation quality.
  Type: `optimizer_logic`
  Effort: `Large`
  Sources: `oc7ut26`
  Notes: Maintainer said preserving hard assignment was intentional for trust farming, clue room choices, and Control Nexus preferences.

- `RF-026` For at least one user, the optimizer did not provide much new insight outside Growth Chamber optimization.
  Type: `product_value`
  Effort: `Large`
  Sources: `oc7ut26`

## Likely implementation batches

- `Batch A`: setup acceleration and onboarding (`RF-001` to `RF-004`)
- `Batch B`: navigation, labels, layout, and accessibility (`RF-005`, `RF-006`, `RF-009`, `RF-010`, `RF-012`, `RF-014`, `RF-015`)
- `Batch C`: roster controls, batch editing, tooltip behavior, and layout follow-up (`RF-016`, `RF-018`, `RF-019`, `RF-021`)
- `Batch D`: optimizer weighting, room valuation, and recommendation trust (`RF-022` to `RF-026`)
