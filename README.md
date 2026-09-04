# Endfield Dijiang Optimizer

A local-first planner for Arknights: Endfield that recommends the best Dijiang assignments from a player's user-controlled roster, unlocked base skills, facility state, and exact per-room recipe selections.

This repository now contains the full shared runtime, a packaged CLI, a browser app, a versioned bundled catalog, migration and validation flows, and regression coverage around the optimizer and catalog.

## Product goals

- Optimize Manufacturing Cabin, Growth Chamber, Control Nexus, and Reception Room assignments from the user's manually entered or explicitly imported roster.
- Respect globally hard-assigned operators in any room and optimize around those fixed placements.
- Simulate a "max facilities" scenario without mutating the user's saved base state.
- Recommend which operators' Base Skills to unlock next to improve Dijiang output.
- Support both a CLI workflow and a richer GUI with portraits, input boxes, sliders where applicable, steppers, and facility cards.
- Keep planning centered on one exact recipe selection per room, with optional hard assignments when the user wants fixed placements.
- Save room recipe selections for reuse and support import/export of local scenario files.
- Ship with a built-in library of operators, portraits, base skills, recipes, facilities, and other static game data, then overlay validated roster updates automatically when hosted.
- Explain why a recommended assignment or upgrade wins through room score breakdowns and upgrade notes.

## Why the architecture is shaped this way

- Public Endfield data is fragmented. Operator pages expose many base-skill effects and material costs in text, but some slot caps, unlock requirements, production timings, and load values are inconsistent or image-only in public guides.
- The official site published a security warning on March 12, 2026 against using unofficial tools that request account authorization. Normal use therefore remains offline and never asks for a GRYPHLINE login. The optional roster import reads a user-selected official response capture locally and ignores authentication headers and cookies.
- Endfield is already live and updating. Version 1.1 Phase 1 started on March 12, 2026, and Phase 2 is scheduled for March 29, 2026, so all game data must be versioned instead of treated as timeless.
- Facility mechanics and established recipes remain immutable, versioned catalog snapshots. The public overlay refreshes operators and newly released rare Growth Chamber resources without cloning the entire catalog.

## Scope boundary

- Internet usage is limited to public catalog data. User account credentials are never requested, stored, replayed, or transmitted by the app.
- User state is entered manually, loaded from the user's local scenario JSON, or optionally imported once from an official SKPort `card/detail` JSON/HAR capture selected by the user.
- There is no GRYPHLINE login or live account scraping. The optional capture import is explicit, local, previewed before applying, and covered by an at-your-own-volition warning.

## Repository layout

- `docs/research.md`: dated source notes, confirmed mechanics, and unresolved gaps.
- `docs/architecture.md`: system design, solver approach, UX model, and milestone plan.
- `docs/catalog-format.md`: concrete catalog bundle and scenario file formats.
- `apps/cli/`: packaged `endfield-opt` CLI.
- `apps/web/`: browser-first React UI.
- `catalogs/2026-03-29-v1.1-phase2/`: the current bundled catalog snapshot.
- `scenarios/examples/`: starter import/export examples for saved user scenarios.
- `packages/domain/src/index.ts`: typed contracts for catalogs, scenarios, and results.
- `packages/optimizer/src/index.ts`: solver and upgrade-advisor interfaces.
- `packages/data/src/index.ts`: source manifest, known gaps, and data version metadata.

## Main commands

- `npm run validate:data`
- `npm run check:catalog:release`
- `npm test`
- `npm run build`
- `npm run optimize:example`
- `npm run recommend:example`
- `npm run sync:promotion-data`
- `npm run sync:live-roster`

## Automatic roster updates

The web build normalizes the official SKPORT operator catalog into `public/roster/latest.json`. SKPORT is the source for roster discovery, portraits, rarity, class, both Dijiang Base Skills, effect values, unlock tiers, and Promotion IV materials. Official entries marked as previews are omitted until SKPORT publishes their released data; missing fields on a released entry still block deployment. The parser accepts the official table-header and whitespace variants used across all current operator pages. The sync uses the wiki's public anonymous-token flow and never requests a user login. EndfieldTools is used separately to discover newly released rarity-5 Growth Chamber cultivation recipes and their item icons; it does not supplement operators when SKPORT succeeds. Scheduled GitHub Actions runs use `catalogs/live-sync-policy.json` to carry the current official named game version and choose an adaptive cadence: every six hours around an announced operator release, daily while released information is incomplete, and weekly after coverage is complete. Every six-hour heartbeat also compares the inexpensive official SKPORT catalog listing with the deployed roster; a newly released listing restores daily full checks even if the manually recorded release calendar is stale. Open browser tabs check the same-origin update on startup, hourly, when they come back online, and when they become visible again.

Updates are schema-validated before they can replace catalog definitions. Operator identity, rarity, class, portraits, both Base Skills, Dijiang modifiers, shared unlock costs, Elite IV material overrides, and new rarity-5 Growth Chamber cultivation recipes are merged into the bundled catalog. Remote portraits are converted during the build to sharp 256-pixel WebP thumbnails and served from the same GitHub Pages deployment; Base Skill icons resolve to known bundled effect artwork. If the source is unavailable or introduces an unknown mechanic, the immutable bundled catalog stays active and the build records a warning instead of breaking the application.

Each overlay includes a stable content hash that excludes generation and retrieval timestamps. The browser remembers the last announced hash, so restarting the development server or rebuilding an unchanged Pages deployment does not repeat the catalog-update notice.

## Optional SKPort roster import

The web app can perform a one-time, local import from SKPort's official Team Picks data sync. Its included bookmarklet uses the request client already loaded by Team Picks to retrieve `/game/endfield/team/user-game-data`, then automatically requests `/game/endfield/team/user-char-data` for each owned assignable operator. It produces a compact capture that can be copied into the optimizer or downloaded as JSON. An older `card/detail` response or a manually saved response/HAR remains available as a fallback. Before applying it, the app recommends exporting a backup, explains the third-party risk, and previews whether the capture represents the complete roster or only a selected showcase.

- A complete capture replaces operator ownership, level, promotion, and saved equipped-loadout snapshots. Operators absent from it are marked unowned.
- A partial capture updates matched operators but preserves operators that are absent, because their ownership cannot be inferred safely.
- Team Picks weapon ownership, gear and tactical-item quantities, combat-skill levels, and per-operator equipped loadouts are preserved in scenario JSON for reference, but do not affect Dijiang scoring.
- Base Skill unlocks, essences, weapon progression, and item enhancement rolls are not exposed by these Team Picks responses and are not guessed. Existing Base Skill selections are preserved.
- The bookmarklet reuses SKPort's already-loaded request client; it does not recreate request signing or read/export headers, cookies, passwords, or tokens.
- HAR request headers, cookies, and tokens are ignored. Only the matching response body is parsed, entirely in the browser.

Scheduled checks generate and validate a candidate before the Pages deployment job can start. An unchanged hash, a source warning, or a reduction in live operators or Growth Chamber recipes produces no deployment. Pushes and manual workflow runs still deploy immediately so application changes are not held behind the catalog cadence. Official release dates control check frequency and expected coverage; the official wiki supplies all operator values, while the extracted data source is limited to discovery of newly released rarity-5 Growth Chamber cultivation items.

## License

This repository is licensed under the MIT License. Reuse, modification, redistribution, and commercial use are allowed.

That license covers the repository's original code, schemas, docs, normalization work, and authored catalog structure. Arknights: Endfield names, trademarks, and any third-party source-attributed art or other upstream content remain subject to their respective owners and source terms.

## Current status

The repo now contains:

- architecture and format docs
- starter schemas and example scenarios
- a versioned bundled catalog for the pinned `2026-03-29 / v1.1-phase2` snapshot
- shared catalog and scenario validation/migration services
- a branch-and-bound assignment solver with room score breakdowns
- a long-run Mood-aware scoring model for production rooms and Control Nexus ship-wide support, with projected outputs aligned to those production-side gains
- a next-unlock recommender that includes level gating, Elite promotions, and Base Skill node costs
- a packaged CLI and browser app using the same shared runtime
- tests covering data services, optimizer behavior, CLI packaging, and the web app

The current repo verify path should pass after normal install and build steps. The stricter catalog release gate remains intentionally blocked by one declared Growth Chamber demand-modeling gap in [`catalogs/2026-03-29-v1.1-phase2/gaps.json`](catalogs/2026-03-29-v1.1-phase2/gaps.json). The main remaining work is future-facing refinement: more golden scenarios, future catalog refreshes for new game snapshots, and better exactness if a full per-level EXP table becomes source-backed.
