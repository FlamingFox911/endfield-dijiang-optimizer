# CLI Plan

The CLI is intended to be the first working surface because it is faster to test and easier to use for golden scenarios.

The CLI never reads account data. It operates only on manually entered values and local scenario files.
It should use the bundled catalog library by default so normal usage has no runtime dependency on guide sites.

The CLI should use the same steady-state solver and scenario model as the web app.

Current repo status:

- `endfield-opt` now builds as a packaged Node CLI with bundled catalog and example scenarios
- `optimize`, `recommend-upgrades`, `init-scenario`, `validate-data`, and `migrate-scenario` all exist
- interactive prompts and `--json` output are both supported from the same command surface

## Planned commands

- `endfield-opt init-scenario`
  Create a starter scenario JSON file pinned to the current catalog version.
- `endfield-opt optimize --scenario ./my-base.json`
  Solve the current-base scenario.
- `endfield-opt optimize --scenario ./my-base.json --max-facilities`
  Solve the hypothetical fully upgraded Dijiang scenario.
- `endfield-opt recommend-upgrades --scenario ./my-base.json`
  Rank the next Base Skill unlocks that improve Dijiang output.
- `endfield-opt recommend-upgrades --scenario ./my-base.json --ranking roi`
  Override the unlock ranking mode with `fastest`, `roi`, or `balanced`.
- `endfield-opt validate-data`
  Validate the catalog and manual override bundles.

## Interaction model

- Searchable operator selection.
- Menu-driven recipe selection for each room.
- Hard assignments remain available as optional room overrides.
- Numeric steppers for levels, promotion tiers, and room levels.
- Table output grouped by room.
- Optional JSON output for scripting.

## Example scenario file

```json
{
  "catalogVersion": "2026-03-20/v1.1-phase1",
  "roster": [
    {
      "operatorId": "chen-qianyu",
      "owned": true,
      "level": 40,
      "promotionTier": 1,
      "baseSkillStates": [
        { "skillId": "blade-critique", "unlockedRank": 1 },
        { "skillId": "jadeworking", "unlockedRank": 1 }
      ]
    }
  ],
  "facilities": {
    "controlNexus": {
      "level": 3
    },
    "manufacturingCabins": [
      { "id": "mfg-1", "enabled": true, "level": 2, "fixedRecipeId": "advanced-cognitive-carrier" },
      { "id": "mfg-2", "enabled": true, "level": 1, "fixedRecipeId": "advanced-cognitive-carrier" }
    ],
    "growthChambers": [
      { "id": "growth-1", "enabled": true, "level": 2, "fixedRecipeId": "kalkonyx" }
    ],
    "receptionRoom": {
      "id": "reception-1",
      "enabled": true,
      "level": 1
    },
    "hardAssignments": [
      { "operatorId": "chen-qianyu", "roomId": "control_nexus" }
    ]
  },
  "options": {
    "maxFacilities": false
  }
}
```
