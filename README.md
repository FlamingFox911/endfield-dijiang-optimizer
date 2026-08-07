# Endfield Dijiang Optimizer

A local-first planner for Arknights: Endfield that recommends the best Dijiang assignments from a player's manually entered roster, unlocked base skills, facility state, and exact per-room recipe selections.

This repository now contains the full shared runtime, a packaged CLI, a browser app, a versioned bundled catalog, migration and validation flows, and regression coverage around the optimizer and catalog.

## Product goals

- Optimize Manufacturing Cabin, Growth Chamber, Control Nexus, and Reception Room assignments from the user's manually entered roster.
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
- The official site published a security warning on March 12, 2026 against using unofficial tools that request account authorization. The tool therefore only uses the internet for the public operator and base-skill catalog and never for account login or account scraping.
- Endfield is already live and updating. Version 1.1 Phase 1 started on March 12, 2026, and Phase 2 is scheduled for March 29, 2026, so all game data must be versioned instead of treated as timeless.
- Facility mechanics and established recipes remain immutable, versioned catalog snapshots. The public overlay refreshes operators and newly released rare Growth Chamber resources without cloning the entire catalog.

## Scope boundary

- Internet usage is limited to public catalog data. User account data is never requested or fetched.
- User state is always manual: owned operators, levels, unlocked base skills, room levels, and priorities are entered by the user or loaded from the user's own local JSON file.
- There is no account scraping, no GRYPHLINE login, and no attempt to read live game data.

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

The web build normalizes the current public character and item payloads into `public/roster/latest.json`. GitHub Pages rebuilds this file every six hours through the scheduled deployment workflow. Open browser tabs check the same-origin update on startup, hourly, when they come back online, and when they become visible again.

Updates are schema-validated before they can replace catalog definitions. Operator identity, rarity, class, portraits, both Base Skills, Dijiang modifiers, shared unlock costs, Elite IV material overrides, and new rare Growth Chamber resources are merged into the bundled catalog. Base Skill icons resolve to known bundled effect artwork, avoiding broken third-party icon paths. If the source is unavailable or introduces an unknown mechanic, the immutable bundled catalog stays active and the build records a warning instead of breaking the application.

Each overlay includes a stable content hash that excludes generation and retrieval timestamps. The browser remembers the last announced hash, so restarting the development server or rebuilding an unchanged Pages deployment does not repeat the catalog-update notice.

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
