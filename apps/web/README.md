# Web App Plan

The web app is the main GUI target. It is browser-first so the optimizer remains easy to host locally or publish as a static app later.

The web app never asks for account login. Player state is entered manually, loaded from local scenario files, or explicitly imported once from a user-selected official SKPort response capture.
It should load the bundled catalog library at startup so the app works offline for normal use.

The optional SKPort import includes a bookmarklet that reuses Team Picks' already-loaded official request client to retrieve `user-game-data`, public character/item name catalogs, and one `user-char-data` loadout response per owned assignable operator. The compact result can be copied and pasted locally, with JSON/HAR files and older `card/detail` responses retained as fallbacks. The workflow never reads request credentials, previews changes, recommends a JSON backup, and never turns into a hidden or recurring account sync.

The UI should keep one streamlined planning surface with room recipe pickers and always-available hard assignments.

Current repo status:

- the shared solver and upgrade-advisor runtime already exist
- the browser GUI now runs both optimization and unlock recommendations in a dedicated worker so the main UI stays responsive

## Run UX

- `Optimize` runs in a dedicated worker and opens a progress modal instead of blocking the page.
- `Recommend unlocks` also runs in the worker and opens its own progress modal with candidate counts, baseline score, best delta, elapsed time, and cancel.
- Optimization shows allocation states checked, best score, elapsed time, and Cancel. Recommendations show candidate counts, baseline score, best gain, elapsed time, and Cancel. Completed popups remain open with a completion message until **View results** is selected.
- Both actions always use unlimited exact assignment search. There is no effort slider or optimization-profile selector. Older draft and imported search settings are upgraded to `exhaustive` with canonical effort 100; roster, facility, demand, and unlock-ranking preferences are preserved.
- Tied alternatives are included automatically. Hover, focus, or tap a slot's ⇄ icon to see its interchangeable operators. Alternatives apply one change at a time, with other slots fixed.
- Equal scores prefer limited 6-stars (newest banner debut first), then regular 6-stars, 5-stars, and 4-stars. This never adds points. See [assignment ties](../../docs/optimizer-ties.md).
- Exact search fixes Control Nexus support, scores room teams, then prunes incompatible allocations and branches whose upper bounds cannot beat the current result. Equivalent orders within a room are counted once. No time, node, or candidate cutoff applies.
- Recommendations re-solve the baseline and every individual unlock candidate exactly. They rank individual skill-rank targets, not sequences of upgrades.
- Large searches can still take time; Cancel terminates the worker and preserves previous completed results. Search speed, ETA/status cards, and Control-team counters are omitted from the popup because short runs do not produce useful samples.
- Results report search completion separately from data confidence. Completed search is optimal for the modeled objective; budget or candidate truncation means only the best assignment found. Unlock recommendations disclose incomplete baseline and candidate searches because these can change gains and rankings. Unlocks are evaluated individually, not as combined upgrade sequences.
- See [exact search and accuracy](../../docs/search-effort.md) for the proof strategy, exhaustive checks, and model limits.

## Primary screens

- Roster
  Portrait grid, operator search, rarity filters, level and promotion controls, and explicit base-skill rank controls.
- Dijiang
  Visual cards for Control Nexus, Manufacturing Cabins, Growth Chamber, and Reception Room, including room levels, Control Nexus unlock gating, and hard assignments.
- Priorities
  Per-room recipe pickers, saved with the scenario for future reuse.
- Results
  Best assignments, expected output mix, hard-assignment tradeoffs, and recommended upgrades.

## Control choices

- Stepper arrows for operator level and room level.
- Toggle for `Current Facilities` vs `Max Facilities`.
- `Recommend Unlocks Ranking` control with `Balanced`, `ROI`, and `Fastest` modes plus inline help text.
- Searchable global hard-assignment picker for any room.
- Optional advanced table for direct JSON-like editing.

## Image usage

- Operator portraits in roster cards and result slots.
- Facility icons or a simplified Dijiang deck map.
- Placeholder avatars when an image is missing from the current asset bundle.

## UX priorities

- Optimization and recommendation progress popups stay open after completion with final statistics and a frozen elapsed time. Select **View results** to dismiss the popup.
- The user should be able to answer "what should I put where?" in one screen.
- The user should be able to answer "who should I level next for Dijiang?" in the same run.
- The app should show why a recommendation wins, not only which recommendation wins.
