# Web App Plan

The web app is the main GUI target. It is browser-first so the optimizer remains easy to host locally or publish as a static app later.

The web app never asks for account login. All player state is entered manually or loaded from local scenario files.
It should load the bundled catalog library at startup so the app works offline for normal use.

The UI should expose two modes:

- `Simple`
  Fast path for choosing one recipe per room from a preselected menu.
- `Advanced`
  Same room recipe selection, but with more detailed scenario controls.

Current repo status:

- the shared solver and upgrade-advisor runtime already exist
- the browser GUI is still pending

## Primary screens

- Roster
  Portrait grid, operator search, rarity filters, level and promotion controls, and explicit base-skill rank controls.
- Dijiang
  Visual cards for Control Nexus, Manufacturing Cabins, Growth Chamber, and Reception Room, including room levels and hard assignments.
- Priorities
  Per-room recipe pickers, saved with the scenario for future reuse.
- Results
  Best assignments, expected output mix, hard-assignment tradeoffs, and recommended upgrades.

## Control choices

- Stepper arrows for operator level and room level.
- A top-level `Simple` / `Advanced` mode switch.
- In `Simple`, preselected recipe menus only.
- In `Advanced`, the same recipe menus plus more detailed hard-assignment and scenario controls.
- Toggle for `Current Facilities` vs `Max Facilities`.
- Searchable global hard-assignment picker for any room.
- Optional advanced table for direct JSON-like editing.

## Image usage

- Operator portraits in roster cards and result slots.
- Facility icons or a simplified Dijiang deck map.
- Placeholder avatars when an image is missing from the current asset bundle.

## UX priorities

- The user should be able to answer "what should I put where?" in one screen.
- The user should be able to answer "who should I level next for Dijiang?" in the same run.
- The app should show why a recommendation wins, not only which recommendation wins.
