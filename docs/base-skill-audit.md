# Base Skill audit — 2026-09-13

Checked both Base Skills and both unlock ranks for all **30 released assignable operators (60 skills, 120 ranks)**. SKPORT preview entries and Endministrator are excluded, as in the live sync. The 25 operators in the bundled v1.2 snapshot were checked too; the five later operators remain supplied by the live overlay.

## Evidence and method

- Retrieved the [official SKPORT operator catalog](https://wiki.skport.com/endfield/catalog?mainTypeId=1&subTypeId=1&filterIds=&header=0) and all released operators' public Base Skill tables through the existing anonymous sync.
- Independently retrieved [EndfieldTools' extracted character index](https://endfieldtools.dev/localdb/optimized/characters/characters-list.json), each character's factory-skill records, and English translations. Compared skill names, Greek suffixes, facilities, effect types, targets, values, and slot order. Both sources returned 30 released operators without parser warnings.
- The captured official rows and expected game-data results are in [the audit fixture](../tests/fixtures/base-skill-audit.json), with individual source links. Regression coverage runs all 60 skills through official parsing, corrections, live validation, and catalog merging, and checks the same reference against every bundled operator.
- SKPORT is not uniformly current: some entries retain older lettering, a spelling error, and Avywenna's retired skill. Narrow corrections match those specific entries and their known effect values; they do not derive lettering from rarity or numeric bonuses. Future changed effects pass through normally.

## Discrepancies corrected

| Operator | Skill | Correction to SKPORT live data |
| --- | --- | --- |
| Ember | Special Northern Training | α/β → **β/γ**, operator EXP production **20%/30%** |
| Chen Qianyu | Jadeworking | α/β → **β/γ**, rare mineral growth **20%/30%** |
| Lifeng | Youthful Ambition | α/β → **β/γ**, Mood Regen **12%/16%** |
| Yvonne | Fungal Pigment Extraction | α/β → **β/γ**, fungal growth **20%/30%** |
| Yvonne | Fashionista | α/β → **β/γ**, Mood Drop reduction **14%/18%** |
| Da Pan | Worldly Wisdom | “Wordly Wisdom” α/β → **Worldly Wisdom β/γ**, Mood Regen **12%/16%**; preserve saved unlocks under the stable skill ID |
| Last Rite | Cemetery Gardening | α/β → **β/γ**, vitrified plant growth **20%/30%** |
| Avywenna | Messenger's Secret | Retired **Factory Pioneer** (Manufacturing, weapon EXP **10%/20%**) → **Messenger's Secret α/β** (Reception, small/normal **Clue 2 Rate-UP**) |

The suffix corrections agree with the [Talos Wiki skill list](https://endfield.wiki.gg/wiki/List_of_Base_Skills). Avywenna's [recorded release changelog](https://endfield.wiki.gg/wiki/Avywenna#Changelog) explicitly documents the Factory Pioneer → Messenger's Secret change. [Ember's game-data skill page](https://endfield.games/en/characters/chr-0009-azrila/talents/) also corroborates β/γ and 20%/30%.

The bundled catalog already had most of these correct, but live SKPORT overwrote them. Independently fixed the bundled first-rank labels for **Chen Qianyu's Blade Critique** and **Xaihi's Standardized Scripting** from β to **α**; their values remain **10%/20%**.

## Clue targeting values

The old code invented **8%/12%** for targeted Clue Rate-UP. Neither the official description nor extracted skill parameters establish those percentages. The extracted parameters identify the clue number and qualitative strength **1/2**. These now use `unit: "tier"`, where 1 means small Rate-UP and 2 means normal Rate-UP. The UI preserves the game's qualitative wording and the non-stacking rule. Old imported overlays using percent units remain readable, but their unsupported numbers are not displayed as probabilities. Clue targeting remains score-neutral, so this representation change does not change optimizer scoring.

This applies to Alesh, Arclight, Avywenna, Ember, Last Rite, Lifeng, Mifu, and Xaihi. It does **not** apply to general clue collection efficiency, whose published 20%/30% bonuses remain percentages. Apart from Avywenna's stale skill and these invented clue percentages, numeric skill effects agreed between the two sources.

## Complete checked roster

The table below records the final two ranks of each skill. Percent values are bonuses or Mood Drop reductions, according to the named effect. Clue entries are qualitative strengths.

| Operator | First Base Skill | Second Base Skill |
| --- | --- | --- |
| Akekuri | Coffee or Tea α 10% / β 14% | Icebreaker β 14% / γ 18% |
| Alesh | Casual Angling α 8% / β 12% | Anglers' Intel Network α small Clue 1 Rate-UP / β normal Clue 1 Rate-UP |
| Antal | Experimental Arts Unit α 10% / β 20% | Pun-isher Studies β 14% / γ 18% |
| Arcane | Pluck the Mountain, Boil the Sea β 20% / γ 30% | Botanophile β 20% / γ 30% |
| Arclight | Blade of the Wildlands α 10% / β 20% | Hanna Traditions α small Clue 6 Rate-UP / β normal Clue 6 Rate-UP |
| Ardelia | Tales of the Land β 20% / γ 30% | Mr. Dolly's Game β 14% / γ 18% |
| Avywenna | Residence Advisor α 8% / β 12% | Messenger's Secret α small Clue 2 Rate-UP / β normal Clue 2 Rate-UP |
| Camille | Hemo-Vitreography β 20% / γ 30% | Agaš'mekanaz's Manual β 20% / γ 30% |
| Catcher | Silent Caretaker α 8% / β 12% | Grounded Approach β 14% / γ 18% |
| Chen Qianyu | Blade Critique α 10% / β 20% | Jadeworking β 20% / γ 30% |
| Da Pan | Chef of Forage and Game α 10% / β 20% | Worldly Wisdom β 12% / γ 16% |
| Ember | Special Northern Training β 20% / γ 30% | Keepers of the Banner α small Clue 4 Rate-UP / β normal Clue 4 Rate-UP |
| Estella | Fragmented Rest α 8% / β 12% | Frequency Monitoring β 20% / γ 30% |
| Fluorite | Wildlands Trekker α 10% / β 20% | Reader of Emotions β 12% / γ 16% |
| Gilberta | Messengerial Processing β 14% / γ 18% | Messengerial Arms Mastery β 20% / γ 30% |
| Laevatain | Memory Crucible β 20% / γ 30% | Undying Flames β 14% / γ 18% |
| Last Rite | Cemetery Gardening β 20% / γ 30% | Fame of the Royal Courts α small Clue 7 Rate-UP / β normal Clue 7 Rate-UP |
| Lifeng | Youthful Ambition β 12% / γ 16% | Laddie Reliable α small Clue 3 Rate-UP / β normal Clue 3 Rate-UP |
| Liino | Idol Passion β 14% / γ 18% | Stage Vibe That Lingers β 12% / γ 16% |
| Mifu | Secret Informants α small Clue 3 Rate-UP / β normal Clue 3 Rate-UP | Esoteric Tisane β 20% / γ 30% |
| Perlica | Supervisor α 8% / β 12% | Protocol Redistribution β 20% / γ 30% |
| Pogranichnik | Hone the Weapons β 20% / γ 30% | Morale Boost β 14% / γ 18% |
| Rossi | Clan Etiquette β 14% / γ 18% | Scent of the Hunt β 20% / γ 30% |
| Snowshine | Rescuer's Perseverance α 10% / β 14% | Happy-Go-Lucky β 12% / γ 16% |
| Tangtang | Supreme Chief β 14% / γ 18% | River's Daughter β 20% / γ 30% |
| Typhoeus | Lithic Murmurs β 20% / γ 30% | Life in the Spores β 20% / γ 30% |
| Wulfgard | Pack Techniques α 10% / β 20% | Knack for the Wildlands β 20% / γ 30% |
| Xaihi | Standardized Scripting α 10% / β 20% | Murmuring Session α small Clue 5 Rate-UP / β normal Clue 5 Rate-UP |
| Yvonne | Fungal Pigment Extraction β 20% / γ 30% | Fashionista β 14% / γ 18% |
| Zhuang Fangyi | Viceroy Experience β 14% / γ 18% | Tianshi Chi Meditation β 20% / γ 30% |
