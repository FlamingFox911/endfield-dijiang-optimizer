# SKPort progression calculator integration — 2026-09-22

Inspected a user-provided HAR of the [official calculator](https://game.skport.com/tools/endfield/cost-calculator). Findings below are based on captured response bodies and the official frontend shipped in that capture. No authenticated requests were replayed. The HAR and account values are not repository fixtures.

## Available data

All paths below are relative to `https://zonai.skport.com/web/v1/game/endfield`.

| Response | Useful fields | Integration |
| --- | --- | --- |
| `calculate/user-game-data` | `userChars`, `userWeapons`, `itemCount` | Local import of roster, weapon progression, and material stock |
| `search-chars` | Operator names and `cultivationTalents` | Resolves opaque account ids and verifies Dijiang talent node ids |
| `calculate/material-list` | Material names, EXP values and level bands | Resolves opaque inventory ids to catalog item ids |
| `calculate/rules` | `charLevelRules`, `weaponLevelRules`, selected characters' promotion/skill/talent costs | Bundled operator level transitions; other costs inspected for consistency |
| `calculate/record/view` | Saved calculator targets | Not used: these are planned targets rather than actual account progression |

The rules response in this capture contains only one selected operator and one weapon. It is not a complete operator cost catalog. The official client supplies `charIds` and `weaponIds` to request the relevant rules. Shared operator level rules cover all levels.

## Level costs

Each `charLevelRules` row gives the EXP and T-Creds for **level L → L+1**. Level 90 contains `-1` terminal sentinels, not costs. The bundled `progression.levelCosts` table includes the 89 real transitions and source attribution; validation requires ordered, unique levels and nonnegative integer costs.

Summing rows with `level < targetLevel` reproduces every existing milestone:

| Target | Cumulative EXP | Cumulative T-Creds |
| --- | ---: | ---: |
| 20 | 22,860 | 820 |
| 40 | 271,400 | 13,360 |
| 60 | 747,110 | 37,260 |
| 80 | 1,212,340 | 146,440 |
| 90 | 1,792,290 | 385,420 |

No milestone correction was necessary. Costs from intermediate levels now sum actual transitions instead of rounding down to the preceding milestone. Older catalogs without the new table retain the conservative fallback. Partial EXP within the current level is not present in the capture, so costs assume the start of that level.

Combat records fund transitions below level 60. Cognitive carriers fund transitions starting at level 60. The existing EXP item values agree with the calculator. The captured operator's four Dijiang talent costs also agree with the shared Base Skill costs.

## Account import and recommendations

The existing JSON/HAR preview accepts calculator account responses. Include `search-chars` and `calculate/material-list` in a HAR, or `characterCatalog` and `materialCatalog` in a compact capture. Unknown material ids are retained with a `skport:` prefix and are not guessed. Invalid material quantities are rejected. Zero stock is valid.

`talent.latestSpaceshipSkillNodes` exposes actual Dijiang unlocks. Nodes must belong to that operator's official `cultivationTalents` list and have recognizable slot/rank suffixes. Recognized lists replace the two Base Skill states, including explicitly locked slots; absent or unfamiliar lists preserve manual selections. Account identity fields, headers, cookies, and tokens are not stored in scenarios.

The bookmarklet additionally requests calculator materials and account data through SKPort's loaded client. It combines calculator and Team Picks data only when their role and server match, retaining Team Picks equipment data. Older Team Picks and card imports still work. This remains an explicit snapshot import; there is no background account polling or optimizer login.

Recommendations retain gross leveling, promotion, and skill costs, and add **Still needed after inventory**. EXP stock is pooled within each eligible level band, so lower-value EXP items can substitute for higher-value items. The ROI/estimated acquisition effort uses remaining costs. Each candidate considers the same stock independently; selecting several recommendations requires a future shared-budget planner. Estimates remain heuristic, not exact farming schedules. Selection crates, crafting, partial-level EXP, and material reservations are not modeled. A fully covered upgrade has zero estimated acquisition time.

New operators still come from the existing live roster overlay. Calculator account data does not itself define new optimizer operators or overwrite static game rules. The bundled per-level table is a reviewed source update; imported HAR files do not replace it.
