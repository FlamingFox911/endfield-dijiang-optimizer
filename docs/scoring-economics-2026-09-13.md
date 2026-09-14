# Scoring economics review

Research checked: September 13, 2026.

The supported correction is to value Cognitive Carrier EXP at **2.5 times Combat Record or Weapon EXP**, using the repeatable endgame Protocol Space rewards as the reference. Growth materials and Reception utility do not have an equally defensible universal conversion to EXP or Sanity. Their configurable weights remain user preferences.

This document separates observed game data, derived values, and proposals that the optimizer does not yet automate. It covers material value; staffing, applicable skills, production rates, and Mood determine how much of that value an assignment can produce.

## Material valuation matrix

One reference unit represents the replacement value of one Advanced Combat Record: 10,000 EXP for operators through level 60. Display points use 1,000 points per reference unit. These are **per-item values before output rate, staffing, Mood, or user priorities**, not fixed operator scores.

| Material | EXP per item | Reference units per item | Display points per item |
| --- | ---: | ---: | ---: |
| Elementary Combat Record | 200 | 0.02 | 20 |
| Intermediate Combat Record | 1,000 | 0.10 | 100 |
| Advanced Combat Record | 10,000 | 1.00 | 1,000 |
| Elementary Cognitive Carrier | 1,000 | 0.25 | 250 |
| Advanced Cognitive Carrier | 10,000 | 2.50 | 2,500 |
| Arms Inspector | 200 | 0.02 | 20 |
| Arms INSP Kit | 1,000 | 0.10 | 100 |
| Arms INSP Set | 10,000 | 1.00 | 1,000 |
| Growth Chamber fungi | Not an EXP material | Configurable preference; no verified EXP conversion | Derived from preference and useful output |
| Growth Chamber vitrified plants | Not an EXP material | Configurable preference; no verified EXP conversion | Derived from preference and useful output |
| Growth Chamber rare minerals | Not an EXP material | Configurable preference; no verified EXP conversion | Derived from preference and useful output |
| General Reception production | Credits and social utility | Configurable preference; no verified EXP conversion | Derived from modeled marginal benefit |
| Targeted clue drop rate | Excluded from the optimization objective | 0 | 0 |
| Trust gain | Excluded from the optimization objective | 0 | 0 |

EXP item values and the separate operator level bands are documented in the [Operator progression reference](https://endfield.wiki.gg/wiki/Operator) and [Weapon progression reference](https://endfield.wiki.gg/wiki/Weapon). Cognitive and Combat EXP are separate demand pools despite sharing a valuation reference. Hard Assignments remain the way to request particular clues or passive Trust farming.

## Repeatable EXP replacement costs

| Endgame Protocol Space reward | Sanity cost | Reward quantity | Total relevant EXP | Reference value per 10,000 EXP |
| --- | ---: | --- | ---: | ---: |
| Manifested Nightmares: Combat Records | 80 | 17 Advanced Combat Records | 170,000 | 1.0 |
| Manifested Nightmares: Cognitive Carriers | 80 | 6 Advanced and 8 Elementary Cognitive Carriers | 68,000 | 2.5 |
| Gunsmith's Mound: Weapon EXP | 80 | 16 Arms INSP Sets and 10 Arms INSP Kits | 170,000 | 1.0 |

Sources: [Manifested Nightmares](https://endfield.wiki.gg/wiki/Manifested_Nightmares), [Gunsmith's Mound](https://endfield.wiki.gg/wiki/Gunsmith%27s_Mound). The live rendered tables were inspected with their material icon identities and quantities; plain search excerpts omit those identities. Both stage pages retain February 14, 2026 revisions. This is checked community data, not official confirmation of numerical rewards. Each stage also grants Operational EXP, which is not Operator EXP and is excluded from these totals.

The derived replacement cost of 10,000 Combat or Weapon EXP is `80 / 17 = 4.705882...` Sanity. For 10,000 Cognitive EXP it is `80 / 6.8 = 11.764706...` Sanity. Their ratio is exactly 2.5.

The catalog's screenshot-backed Manufacturing timings also make Advanced Cognitive Carrier production approximately 2.5 times slower than Advanced Combat Record or Arms INSP Set production: 1,466.67 versus 586.67 minutes per item. Correcting the value multiplier therefore makes their baseline replacement value per manufacturing hour approximately equal. See the provenance on recipes in [the v1.2 catalog](../catalogs/2026-04-17-v1.2/recipes.json).

These are endgame reference rates. Accounts that cannot clear those stages can face different replacement costs. The full assignment score also includes preference-valued growth and Reception components, so it must not be labeled “Sanity saved.”

## Growth demand depends on the exact upgrade

| Upgrade target | Growth-material consumption |
| --- | --- |
| Operator promotion at levels 20 / 40 / 60 | 3 Pink / 5 Red / 5 Ruby Boletes |
| Operator promotion at level 80 | 8 operator-specific high-tier fungi |
| All four combat skills through rank 9 | 12 Kalkodendra / 16 Chrysodendra / 16 Vitrodendra |
| All four combat skills through Mastery 3 | A further 84 high-tier plants; required species depend on operator and skill |
| Weapon tuning at levels 20 / 40 / 60 | 3 Kalkonyx / 5 Auronyx / 5 Umbronyx |
| Weapon tuning at level 80 | 8 weapon-specific high-tier minerals |

Sources: [Operator upgrade costs](https://endfield.wiki.gg/wiki/Operator), [Weapon tuning costs](https://endfield.wiki.gg/wiki/Weapon). These are growth-material portions of the costs, not complete upgrade bills. Other required currencies and materials can remain the limiting resource.

Three plants from a cultivation output do not automatically have three times the economic value of one fungus: their consumption patterns differ. Equally, a high-tier material need not be valuable to an account whose relevant upgrades are already complete. Current output quantities should remain real quantities; scarcity should not be invented through an undocumented family multiplier.

## External sources and limits

| Alternative source | Verified evidence | Scoring implication |
| --- | --- | --- |
| Rare gathering and mining sites | [Exploration Level](https://endfield.wiki.gg/wiki/Exploration_Level) reports one regrowth per site daily at levels 1–4 and two at levels 5–7, with stored regrowth caps from four to eight. | Count accessible sites and intended collection over the planning horizon. Regrowth counts are not a verified universal item yield. |
| Gathering versus cultivation | [Kalkodendra](https://endfield.wiki.gg/wiki/Kalkodendra) and [Kalkonyx](https://endfield.wiki.gg/wiki/Kalkonyx) list both wilderness and Growth Chamber sources. | Growth Chamber is not the sole repeatable source of rare materials. Gathering time, node access, and existing stock affect its marginal value. |
| Material conversion | [Crafting recipe data](https://endfield.wiki.gg/wiki/Module%3ARecipe/Crafting) lists Ruby Bolete to two Pink or Red Boletes, with similar Vitrodendra and Umbronyx conversions; an optional ten Sanity produces three instead of two. | Formula unlocks were not verified. Do not assume every account can convert, or assign every growth material a fixed Sanity value from these conditional recipes. |
| Events and permanent challenges | Official [Homecoming notes](https://endfield.gryphline.com/en-us/news/5200) confirm rewards including Cognitive Carriers and Arms INSP Sets. | Subtract known, eligible, unclaimed rewards from demand. An event reward is not a permanent hourly income. |
| Exploration rewards, missions, and shops | [Progression material acquisition](https://endfield.wiki.gg/wiki/Item/Progression_Materials) lists crates, missions, Stock Redistribution, Acquisition Center, manufacturing, and Protocol Spaces. | Availability, purchase limits, ownership, and competing uses of shop currency matter. Do not assume an unlimited free substitute. |
| Sanity rewards or promotions | Repeatable Protocol Space rewards provide the reference above. | Apply a discount only for a verified promotion and its actual claim limits. Sanity Usage Permits alone consume double Sanity for double rewards; they improve collection speed, not resource value per Sanity. See [the item description](https://endfield.wiki.gg/wiki/Module%3AItem/Currency). |

Except for the official update notice, these are community references. The official anonymous SKPORT item catalog also confirms the EXP material families and the wilderness/cultivation roles of growth materials, but its summaries did not provide numerical EXP yields or node regrowth rates. No universal “events supply X%” or “gathering reduces value by Y%” discount is supported.

## Reception value and excluded preferences

The [Credits reference](https://endfield.wiki.gg/wiki/Credits) records 20 credits per collected clue, plus conditional gift and exchange income. It also records substantial daily and social income outside the room, and a 300-credit carryover limit. Those external earnings must not be credited to an assigned operator.

The [Credit Store](https://endfield.wiki.gg/wiki/Store#Credit_Store) rotates goods, applies variable discounts, and charges increasing prices for manual refreshes. Its useful purchases and spending limits depend on the account, so there is no single dependable Credits-to-EXP exchange rate. Extra clue efficiency can have productive value, but targeted clue drops and Trust are intentionally assigned zero objective weight for this scoring scope.

Official [Homecoming notes](https://endfield.gryphline.com/en-us/news/5200) shortened clue exchanges from 24 to 20 hours. Older Reception assumptions need to account for that change when estimating exchange throughput.

## Proposed account-demand model — not automated yet

For each exact material `m` and planning horizon `H`:

```text
remainingDemand(m, H) = max(
  0,
  targetConsumption(m, H)
  - availableInventory(m)
  - guaranteedExternalAcquisitions(m, H)
)

usefulDijiangOutput(m, H) = min(
  projectedDijiangOutput(m, H),
  remainingDemand(m, H)
)

materialUtility(m, H) = usefulDijiangOutput(m, H) * valuePerItem(m)
```

Targets must cover the upgrades the user intends to perform. External acquisitions must count each reward once and only include sources available within the horizon. A reserve or stockpiling preference can be an explicit additional target. Alternative recipes and EXP denominations must share their relevant demand pool so that the same need is not counted twice.

This formula is a proposed extension, not a claim that the optimizer currently knows the account's complete inventory, future upgrades, gathering schedule, or event claims. Until those inputs exist, Growth and Reception weights should remain transparent preferences and projected output should be described as production, not guaranteed useful consumption.

## Source vetting notes

- Some generic guides claim Advanced Combat Records grant 2,000 EXP; the checked Operator reference and existing catalog specify 10,000. Do not import the lower figure without new in-game evidence.
- Older promotion tables can contain obsolete, higher costs. Use exact current operator requirements for high-tier materials rather than treating every operator as consuming the same species.
- Claims that Growth Chamber is the only repeatable rare-material source conflict with documented gathering and mining sites.
- Stronger source confidence for one input does not make preference weights or unmodeled account demand empirically verified.
