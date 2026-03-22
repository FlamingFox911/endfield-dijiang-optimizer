# Catalog And Scenario Format

This document turns the architecture into concrete on-disk files.

## Directory layout

```text
catalogs/
  2026-03-20-v1.1-phase1/
    manifest.json
    progression.json
    operators.json
    facilities.json
    recipes.json
    sources.json
    gaps.json
    assets.json
    assets/
      README.md
scenarios/
  examples/
    current-base.simple.json
    current-base.advanced.json
    max-facilities.simple.json
schemas/
  catalog-manifest.schema.json
  scenario.schema.json
```

## Catalog bundle rules

- One directory equals one immutable catalog bundle.
- The directory name is file-system friendly.
- `manifest.json` is the entrypoint.
- All other files are resolved relative to the manifest.
- Asset paths in `assets.json` are also relative to the bundle root.

## Manifest shape

`manifest.json` records:

- catalog id and version
- game version and snapshot date
- app compatibility
- file map for progression, operators, facilities, recipes, sources, gaps, and assets
- bundle counts
- bundle notes and release status

## Operators file

`operators.json` contains:

- `catalogVersion`
- `operators`

Each operator record includes:

- stable id
- display name
- rarity and class
- portrait asset refs
- Base Skill definitions
- source refs

Shared progression defaults should not be duplicated in every operator record when they can live in `progression.json`. The loader expands shared defaults back into the fully resolved runtime shape.

## Progression file

`progression.json` contains:

- `catalogVersion`
- shared Base Skill unlock table
- shared promotion tier table
- shared level milestone table
- shared Operator EXP item values
- per-operator promotion overrides where the shared table is not enough

Each shared Base Skill progression entry includes:

- skill slot (`1` or `2`)
- rank (`1` or `2`)
- required Elite tier and operator level
- shared material costs
- source refs

Each shared promotion tier entry includes:

- promotion tier (`1` through `4`)
- required operator level
- shared material costs
- source refs

Each shared level milestone entry includes:

- milestone level
- cumulative EXP from level 1
- cumulative T-Cred cost from level 1
- source refs

Each shared EXP item entry includes:

- item id and display name
- EXP value
- level band where the item is used
- source refs

Each promotion override entry includes:

- operator id
- promotion tier
- additional per-operator material costs layered on top of the shared promotion tier
- source refs

Operator records may still override rank costs or unlock hints when a future catalog needs a true per-operator exception, but the default expectation is to keep shared progression here instead of repeating it per operator.

If a future catalog release is incomplete, missing values should be made explicit through notes, `gaps.json`, or `unresolvedFields` in the relevant file rather than being silently omitted.

## Facilities file

`facilities.json` contains:

- `catalogVersion`
- `facilities`

Each facility record includes:

- stable id and room kind
- unlock hint
- level table
- slot-cap and unresolved-field notes

## Recipes file

`recipes.json` contains:

- `catalogVersion`
- `recipes`

Each recipe record includes:

- stable recipe id
- display name
- facility kind
- product family
- compatible room level
- duration, output, and load when known
- unresolved field notes when not known yet

## Sources and gaps

- `sources.json` is the top-level source index for the bundle.
- `gaps.json` captures disputed or missing values that the maintainer still needs to verify.

## Assets file

`assets.json` contains logical asset records:

- portrait ids
- facility icon ids
- placeholder ids
- relative file paths
- attribution when needed

The asset files themselves live under `assets/`.

## Scenario file rules

Saved scenarios are user-owned files and use the same format for:

- autosave
- manual save/load
- export/import

Each scenario contains:

- `catalogVersion`
- owned operators and Base Skill unlock state
- facility levels
- per-room selected recipes
- global hard assignments
- solver options including `planningMode`

The room recipe plan is user-owned scenario data. The solver does not choose recipes in v1; it optimizes operator placement around the user's exact per-room recipe choices.

## Planning mode semantics

- `simple`
  The scenario still stores explicit room recipe selections, but the UI is menu-driven and intentionally constrained.
- `advanced`
  The same room recipe selections exist, but the UI may expose more detailed scenario controls.

Planning mode does not change the underlying solver semantics for v1.

## Validation expectations

At minimum, validation must confirm:

- referenced recipe ids exist
- recipe ids are valid for the target room type
- hard-assigned operators exist in the roster
- no operator is assigned more than once
- scenario `catalogVersion` matches the installed bundle or triggers explicit migration
