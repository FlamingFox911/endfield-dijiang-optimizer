# Application Architecture

## Scope

The application solves one thing well: given a user-controlled roster, current base-skill unlocks, current Dijiang room levels, global hard assignments, and exact per-room recipe selections, it recommends the best assignments and the next best Base Skill unlocks to chase.

The first release is intentionally local-first and offline-friendly. It does not ask for GRYPHLINE login or scrape accounts. An optional one-time import can read an official response capture that the user explicitly selects from disk.

## Chosen stack

- Language: TypeScript across the entire project.
- GUI: React in a browser-first app.
- CLI: Node-based interactive CLI plus file-driven commands.
- Core logic: a shared solver package consumed by both UIs.
- Data layer: a bundled versioned catalog library plus manual override files, source manifests, and a maintainer-side catalog build workflow.

The browser-first GUI is deliberate. It supports portraits, sliders, steppers, and facility cards without introducing Electron or Tauri too early. If a desktop wrapper is desired later, it can be added around the same web app.

## Explicit non-goals

- No credential collection, account scraping, or replay of captured requests.
- No in-game authentication.
- No direct or recurring live account sync.
- No hidden sync layer. Player state comes from manual entry or local files the player controls, including an optional official SKPort response capture.
- No runtime dependence on live guide sites for normal app use.

## Monorepo boundaries

- `apps/web`
  Purpose: visual roster editor, facility planner, and result explorer.
- `apps/cli`
  Purpose: interactive terminal workflow and scripted automation.
- `packages/domain`
  Purpose: shared types for operators, facilities, recipes, scenarios, and result payloads.
- `packages/optimizer`
  Purpose: exact solver interfaces, scoring strategy metadata, and upgrade-advisor contracts.
- `packages/data`
  Purpose: version manifests, source provenance, known gaps, normalized catalog files, and bundled asset metadata.

## Static catalog library

The app should ship with a built-in catalog library that contains the static game data needed for optimization.

Library contents:

- operator records
- operator portraits and image metadata
- base-skill definitions
- facility definitions and level data
- manufacturing recipes
- growth recipes
- source provenance and confidence flags
- unresolved-data markers and manual overrides

This library is versioned separately from user scenarios. A scenario points to a catalog version, and the app loads the matching bundled library.

## Catalog release model

Facility, established recipe, and progression snapshots remain versioned and immutable. Operator roster changes and newly released rarity-5 Growth Chamber cultivation recipes use a smaller generated overlay so routine additions do not require copying and republishing every catalog document and asset.

- push and manual web builds fetch and normalize every operator from the official SKPORT catalog; the extracted source separately discovers newly released rarity-5 Growth Chamber cultivation items and remains an outage fallback only when SKPORT is unavailable
- scheduled workflow heartbeats choose a six-hour release window, daily incomplete-data window, or weekly stable window from `catalogs/live-sync-policy.json`, and cheaply inspect the official SKPORT catalog for released operators missing from the deployed roster
- a scheduled check generates and validates a candidate before starting the Pages deployment job
- unchanged content hashes, source warnings, and regressive operator or Growth Chamber recipe counts block scheduled deployments
- official operator release dates affect cadence and completeness checks; official SKPORT Base Skill tables supply operator optimization values
- the live overlay carries the official named game version associated with the latest effective release-policy entry, so the UI does not confuse an older immutable bundle version with the active game release
- browser tabs periodically fetch the generated same-origin roster document
- the data package validates the complete document before merging it
- a timestamp-independent content hash deduplicates browser update notices across rebuilds
- the bundled catalog remains the offline and source-failure fallback
- the scenario keeps its immutable base catalog version, while hydration adds newly discovered roster entries without changing user-owned state

The frequent release-window cron remains a lightweight heartbeat because GitHub schedules are static. Outside an active release window, it only reads the deployed update document and the official SKPORT catalog listing before exiting ahead of dependency installation or source normalization. A released SKPORT entry absent from the deployment restores daily full checks, which protects against a stale manual release calendar. Once every officially released operator in the policy and SKPORT listing is present and the live document has no warnings, only the configured weekly slot performs a full catalog check. The Pages environment is attached to a separate conditional job, so skipped and unchanged checks do not create Pages deployments.

Browser clients persist the content hash plus operator and recipe identifiers from the last live overlay they observed. The first observation initializes silently; later sync notices compare consecutive overlays rather than comparing every update with the immutable bundled snapshot. Legacy hash-only state is migrated using the saved draft to avoid replaying previously added operators.

## Data model

The catalog is versioned and immutable for a given snapshot. User scenarios are stored separately and refer to the catalog by version string.

Only public catalog data is fetched by the optimizer. The hosted browser reads a same-origin, build-generated catalog overlay. Optional account-derived state enters through a user-selected local response capture and is never transmitted by the app. On Team Picks, the capture bookmarklet reuses SKPort's already-loaded request client to retrieve `user-game-data`, public name catalogs, and `user-char-data` for each owned assignable operator. It removes account identifiers, compacts the responses, and offers local clipboard or JSON transfer before restoring its Fetch/XHR fallback hooks. Older `card/detail` responses remain supported.

Core catalog entities:

- Operator definitions
  Includes rarity, searchable names, portraits, and all Dijiang base skills.
- Base skill definitions
  Includes facility target, Greek-letter ranks, effect modifiers, unlock hints, and material costs.
- Facility definitions
  Includes room type, level caps, slot caps, unlock dependencies, and any unresolved-data flags.
- Recipe definitions
  Includes product family, room compatibility, base duration, load cost, and per-level production data.
- Shared progression data
  Includes Base Skill node costs, shared Elite promotion tiers, per-operator Promotion IV overrides, level milestones, and EXP item values.
- Source references
  Every catalog record keeps the URL, retrieval date, and confidence level of the source it came from.

Core user-scenario entities:

- Owned operator state
  Includes current level, promotion tier, and explicit base-skill rank per skill. Optional SKPort snapshots preserve equipped loadout details for reference without affecting scoring.
- Facility state
  Includes room levels, enabled rooms, user-selected room recipes where applicable, and hard assignments.
- Production plan
  Stores the exact recipe the user wants each Manufacturing Cabin and Growth Chamber to run.
- Solver options
  Includes the max-facilities toggle, unlock ranking mode, and search profile settings.

## Optimization model

The default objective is output and facility-value maximization in steady state, using per-hour production rates rather than a user-selected finite horizon.

Recipe choice is not part of the optimization problem in v1. The user specifies the exact recipe each Manufacturing Cabin and Growth Chamber should run, such as `ARMS INSP Set` or `Advanced Cognitive Carrier`, and the solver optimizes operator assignments around that room plan.

For each room, the solver chooses:

- Which operators fill the available room slots.
- Which operators are unavailable because they are hard-assigned elsewhere.

The score for a room is modeled from:

- Base output for the chosen recipe and room level.
- Baseline occupancy efficiency in production rooms, currently modeled as `40%` extra base output per assigned operator seat in Manufacturing Cabin and Growth Chamber rooms.
- Matching production or growth bonuses from assigned operators.
- Mood sustain effects such as room mood regen, room mood-drop reduction, and Control Nexus ship-wide sustain.
- Reception Room and Control Nexus effects that improve clue or facility-wide value when applicable.

V1 still does not run a full time-based Mood simulation with current Mood state, explicit rest schedules, or rotation planning. It now does use the community-derived long-run Mood rates as a calibrated uptime model:

- baseline Mood drain while working is treated as `3,600` per hour
- baseline Mood recovery while resting is treated as `6,000` per hour
- the implied baseline long-run working uptime is `62.5%`
- production-room Mood effects preserve the staffed-seat `+40%` value and the operator's own direct production bonus over the long run
- Control Nexus Mood effects are treated as ship-wide sustain that improves the long-run uptime of production-room operator value

The optimization objective is still total score, not raw projected output totals. Projected outputs are derived after scoring, but they are now kept aligned with the production-side effects of the Mood model, including ship-wide Control Nexus Mood support.

The result payload returns:

- Recommended operator assignments per room.
- The room recipe plan used for the run.
- Estimated output by exact recipe and by broader product family, including production-side gains preserved by the current Mood model.
- Opportunity-cost warnings when hard assignments reduce production.
- The source catalog version used for the run.

## Long-run objective direction

The long-run Dijiang objective is not a single universal weight table. Different players will want different mixes of:

- Operator EXP
- Weapon EXP
- Growth Chamber materials by family or exact recipe
  Examples: `Pink Bolete` at operator level `20`, `Red Bolete` at `40`, `Ruby Bolete` at `60`, `Bloodcap` at `80`, and weapon minerals such as `Kalkonyx` `20 → 40`, `Auronyx` `40 → 60`, `Umbronyx` `60 → 80`, and `Wulingstone` `80 → 90`
- Reception Room clue throughput or specific clue targeting
- Credit-oriented support value derived from clue loops and related systems

The optimizer should therefore move toward a demand-aware score model rather than a static global priority order.

Each output should eventually be scored against three questions:

- what is it used for in long-run account progression
- how much of it does a player plausibly need over a full-build horizon
- how efficiently can it be obtained through Dijiang versus outside sources such as farming, gathering, social systems, or shops

That means future weighting work should be user-configurable and constraint-aware:

- let the user express what they currently value, such as Operator EXP, Weapon EXP, a specific rare material, or Reception utility
- keep item-level constraints in view, such as Combat Records only applying to levels `1-60` and Cognitive Carriers only applying to levels `61-90`
- keep Growth recipe thresholds in view, since many fungi and minerals are tied to specific promotion or tuning stages rather than a single interchangeable bucket
- compare Dijiang production against external procurement paths instead of treating every produced unit as equally valuable
- retain explainability so the UI can show why a room or operator combination won under the active objective

The current solver only partially satisfies that direction. It now values Manufacturing recipes by item value instead of raw unit count, and the data layer can estimate a full Dijiang base-build path, but the final objective is still not yet driven by a user-selected long-run demand profile.

## Why not start with CP-SAT

The problem is small enough to solve exactly without introducing a heavy native dependency on day one. An exact branch-and-bound search over room slot assignments keeps the core portable across CLI and browser builds.

The solver interface is still abstracted so a future CP-SAT backend can replace the search strategy if Endfield adds more complex cross-room synergies.

## Upgrade recommendation model

The upgrade advisor uses the same scoring function as the assignment solver.

It is intentionally advisory only. It does not try to model the full player progression path, exact leveling route, or material farming plan. It only answers which next Base Skill unlock would improve the solved assignment the most if the user chooses to pursue it.

Candidate actions are generated from every owned operator's next locked base-skill rank:

- skill rank 0 to 1
- skill rank 1 to 2

Each candidate carries:

- the operator and skill being targeted
- the required level and promotion tier exposed by the catalog
- the bundled material cost exposed by the catalog
- any known unlock hint or prerequisite note
- the projected score delta after re-solving the scenario

The advisor should expose three ranking modes:

- `fastest`
  Sort by estimated unlock effort first, then score gain.
- `roi`
  Sort by score gain per material-cost unit.
- `balanced`
  Blend absolute impact and effort.

Current runtime status:

- the packaged CLI and web app both expose counterfactual next-unlock evaluation
- bundled Base Skill costs, Elite promotion costs, and Promotion IV operator overrides are used directly
- bundled level milestones and EXP item values are used to estimate the leveling gate
- bundled EXP item level bands are respected when estimating progression materials, so Combat Records cover levels `1-60` and Cognitive Carriers cover levels `61-90`
- leveling costs are exact at bundled milestone caps and conservative upper bounds between those caps
- explicit user-selectable ranking modes are implemented across CLI, shared runtime, and web
- the web app runs both optimization and upgrade recommendation work in a dedicated worker and shows progress/cancel UI for each run
- the data layer can estimate a full Dijiang base-build path from the current operator state to level `90`, Promotion `4`, and all known Base Skill ranks, but the solver does not yet weight room value against that full-build demand model

## Max-facilities scenario

The `max facilities` option is a pure scenario overlay, not a mutation of the saved base state.

When enabled, it should:

- simulate a fully upgraded Dijiang with all known maxed rooms, room levels, and slot caps from the active catalog
- keep the player's roster and base-skill unlock state unchanged

This produces a clean answer to two separate questions:

- "What is best for me right now?"
- "What would be best if my Dijiang were fully upgraded?"

## Global hard assignment

Hard assignment is a first-class constraint, not an afterthought.

The user can hard-assign specific operators to any valid room slot, including Control Nexus or Reception Room when they want to preserve a manual assignment. The solver then treats those placements as fixed and optimizes the remaining slots around them.

Validation rules:

- hard-assigned operators must be owned
- a hard assignment must target a valid room and slot for the active scenario
- duplicate assignment of one operator to multiple rooms is illegal
- a room cannot exceed its slot cap after hard assignments are applied
- explicit empty assignments are not supported; if a usable operator exists, the solver should fill the slot

## CLI design

The CLI is designed for both one-off interactive use and repeatable file-driven runs based on manually maintained scenario files.

Primary commands:

- `optimize`
  Read a scenario and output the best current assignment.
- `optimize --max-facilities`
  Apply the max-room overlay before solving.
- `recommend-upgrades`
  Rank the next Base Skill unlocks using the current scenario.
- `init-scenario`
  Generate a starter JSON file with the current catalog version.
- `validate-data`
  Run schema validation against catalog and override files.

Current repo scripts:

- `npm run validate:data`
  Validate the bundled catalog and example scenarios.
- `npm run optimize:example`
  Solve the bundled example scenario and emit JSON.
- `npm run recommend:example`
  Rank next Base Skill unlocks for the bundled example scenario and emit JSON.
- `npm run check:catalog:release`
  Enforce release completeness for the bundled catalog.

Interaction style:

- searchable operator prompts
- numeric steppers for levels and room levels
- menu-driven recipe selection for each room
- optional hard assignments when the user wants to pin placements
- table output with per-room reasoning and projected gains

## Web GUI design

The GUI should be task-oriented instead of spreadsheet-oriented.

Main layout:

- Left column: roster editor with portraits, filters, and per-operator steppers.
- Center column: Dijiang planner with Control Nexus, Manufacturing Cabin, Growth Chamber, and Reception Room cards where applicable.
- Right column: optimization results, projected outputs, and upgrade recommendations.

Controls:

- recipe pickers only, one recipe per room
- hard assignments always available as optional overrides
- stepper arrows for operator level, promotion tier, and room level
- toggles for `current facilities` vs `max facilities`
- a `Recommend Unlocks Ranking` selector with `balanced`, `roi`, and `fastest` modes plus inline help text
- a named optimization profile selector plus a `Search effort` slider from `1` to `100`
- searchable global hard-assignment picker for any room
- explicit base-skill rank controls so the user can override level-based assumptions

Image usage:

- operator portraits in the roster and output cards
- small facility icons or a simplified Dijiang schematic
- graceful fallback to text avatars when art is missing

## Catalog build and validation

The catalog build pipeline should be source-aware, override-friendly, and separated from the runtime app.

Flow:

1. Pull raw values from source adapters for operator pages and facility guides.
2. Normalize them into typed records with source provenance.
3. Apply manual override files for missing or disputed values.
4. Copy referenced image assets or map them into an asset manifest.
5. Emit a versioned catalog library bundle.
6. Run golden-scenario tests against known expected outcomes.
7. Ship the new catalog with the next app release, or publish it as an optional side-load pack later.

Manual overrides are still expected for future catalog releases when:

- public sources disagree on a mechanic
- newly released operators or recipes are not fully documented yet
- art or provenance needs temporary placeholders pending a later catalog refresh

At runtime, the app should read only the emitted catalog library, never the raw source adapters.

## Persistence and import/export

Scenarios should live in plain JSON so users can back them up and share them. These files are the source of truth for player state.

Minimum file shape:

- catalog version
- operator ownership and unlock state
- facility levels and hard assignments
- per-room recipe selections
- solver options

When a scenario references an older catalog version:

- v1 should report the version mismatch clearly
- v1 should offer an explicit migration step instead of silently changing assumptions
- keeping multiple installed catalogs is a later enhancement, not a v1 requirement

The web app can cache drafts locally, but JSON import and export should stay the source of truth. Saved scenarios preserve room recipe selections, hard assignments, and any explicitly imported SKPort snapshot so users can reuse the same production plan later. SKPort import remains a user-initiated, one-time local file operation rather than a recurring account connection.

## Asset strategy

Operator and Dijiang images should be catalog assets, stored and versioned alongside the static data library.

- Keep image metadata in the catalog.
- Bundle all available portraits and facility assets with the app catalog, not as hotlinked runtime URLs.
- Do not couple the solver to image availability.
- Support placeholder avatars so the tool remains usable without an art pack.
- Keep attribution fields because community guide images are not safe to redistribute blindly.

## Testing plan

- Unit tests for schema validation and scenario normalization.
- Solver invariants: no duplicate assignments, hard-assignment compliance, stable output for fixed inputs.
- Golden scenarios based on curated public examples.
- Regression tests for data-version upgrades so the same scenario can be re-run on a new catalog.

## Milestones

1. Maintain the pinned catalog as new game snapshots release.
2. Improve support-room scoring where future game mechanics justify more exact modeling.
3. Expand golden scenarios and broader regression coverage.
4. Add optional future catalog side-loading or desktop packaging if needed.
