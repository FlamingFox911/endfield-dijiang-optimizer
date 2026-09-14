# Operator scoring review: model v4

Reviewed September 13, 2026. The implementation uses the same assignment objective during search and final reporting. Display points remain 1,000 times internal utility units; calculations retain full precision.

An operator does not have a fixed intrinsic score. Its value is the difference it makes to the whole assignment, including the worker it displaces, the selected recipes, other workers, and Control Nexus support. A +10% production skill and a +10% Mood skill are not interchangeable percentages.

## Findings and implemented corrections

| Aspect | Previous behavior | v4 treatment |
| --- | --- | --- |
| Staffed slots | Final output included +40% per assigned worker, but assignment search omitted that contribution | Search and results evaluate the same complete assignment, including active staffing and the option to leave any room empty |
| Limited searches | Could stop on a partial assignment or return a worse arrangement after an upgrade | Start from a greedy complete assignment, improve moves/swaps, fill useful empty slots, and retain the rescored baseline assignment as an upgrade incumbent |
| Empty or fully resting rooms | Received the unstaffed baseline production rate | Zero production when nobody works |
| Production skills | Added skill percentages to staffing percentages | Matching skill bonuses sum together, then multiply the staffing factor |
| Mixed Growth recipes | Pooled skill gains and redistributed them across every product | Each recipe receives only matching active bonuses; quantities and production times remain recipe-specific |
| Local Mood skills | Credited only the owner's contribution | Room-wide effects benefit every worker in that room |
| Sustainable output | Full active output plus an uplift for Mood skills | Expected working/resting output, including the chance that all workers rest |
| Control Nexus | Flat ranking proxies and inconsistent relative-uptime gains | Recompute whole-ship output with and without its average support; credit the difference once |
| Cognitive Carriers | Valued only by EXP, penalizing slower production | 2.5 times Combat Record reference value per EXP, based on checked endgame replacement costs |
| Unknown skill/recipe data | Invented fallback skill bonuses or production rates | No quantified benefit for unsupported data; surface the gap |
| Clue targeting and Trust | Targeted clue weight was already zero | Both remain outside the objective; use Hard Assignments |

Core implementation: [production model](../packages/optimizer/src/production-model.ts), [assignment scorer](../packages/optimizer/src/assignment-scoring.ts), [search](../packages/optimizer/src/solver.ts). Material economics and the external-supply review are in [the companion matrix](scoring-economics-2026-09-13.md).

## Production formula and evidence

For recipe `r`, let `q_r = outputAmount * 60 / baseDurationMinutes` in items per hour. For a particular set of active operators:

```
output_r = q_r * I(N > 0) * (1 + 0.40*N) * (1 + sum of matching active skill bonuses)
```

The observed 374%, 270%, and 168% production examples fit respectively three workers/+70%, two/+50%, and one/+20%. The same firsthand discussion reports zero output during an all-resting interval and additive Mood modifiers. This is strong community observation, not a retrieved engine implementation. Sources: [operator syncing observations](https://www.reddit.com/r/Endfield/comments/1rfo6b2/dijiang_operator_syncing/), [independent cost-benefit discussion](https://www.reddit.com/r/Endfield/comments/1rb2224/some_basic_costbenefit_analysis_of_base_skills/).

Room scope and product applicability are better supported: Laevatain's live extracted description explicitly applies Mood reduction to all operators in the Manufacturing Cabin and limits her production skill to operator EXP. Sources: [extracted skill record](https://endfieldtools.dev/localdb/optimized/characters/details/chr_0016_laevat.json), [English game strings](https://endfieldtools.dev/localdb/optimized/i18n/characters/I18nTextTable_EN.json), [official SKPORT entry](https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=11&header=0). The repository's [same-day skill audit](base-skill-audit.md) records the official rows and cross-checks.

## Mood model and its limits

The community rates are 3,600 Mood/hour drained while working and 6,000/hour restored while resting. Their ratio gives baseline working uptime `U = R/(R+D) = 0.625`. The reported maximum of 50,000 Mood affects cycle duration, but cancels from the long-run fraction. These raw units remain community measurements; the independently published 12:20 constants agree on the ratio but do not establish the same units. Sources: [measurements](https://www.reddit.com/r/Endfield/comments/1rfo6b2/dijiang_operator_syncing/), [END Wiki constants](https://end.wiki/en/spaceship/).

For a constant effective reduction `d` and regeneration bonus `g`:

```
D = 3600 * max(0, 1-d)
R = 6000 * max(0, 1+g)
U = R/(R+D)
```

Assignment skills stop during rest, and operators automatically resume work after recovery. See [Talos Wiki's Dijiang description](https://endfield.wiki.gg/wiki/Dijang). The model therefore includes the owner's Mood Drop reduction in full during its working phase, averages peer reductions by their uptime, and excludes a provider's own regeneration skill during its rest. This conditional treatment is a modeling inference from skill inactivity. It solves the coupled uptime estimates iteratively, including Control Nexus providers' own downtime.

Expected production uses joint staffing/skill terms. For independent working probabilities `u_i` and matching skill fractions `b_i`, the exact expectation **under that assumption** is:

```
P(any working) + 0.4*sum(u_i)
  + sum(b_i*u_i * (1.4 + 0.4*sum(u_j for j != i)))
```

This is an estimate for unsynchronized cycles, not a shift simulator or guaranteed hourly forecast. Current Mood, synchronized starts, manual rotation, Mood assists, queue exhaustion, and collection caps are not inputs. Strongly synchronized teams can differ materially. Applying separately averaged staffing and skill bonuses would introduce a second error, so the model retains their shared-worker correlation.

## Aspect score matrix

The numeric benchmark below isolates mechanics: one room, three assigned workers, no existing production/Mood skills, and a recipe whose unboosted rate times unit value is **1 reference unit/hour**. Baseline expected production is **1,697 points/hour**. Change only the listed aspect. These are computed examples, not universal operator weights.

| Aspect | Scoring rule | Benchmark gain, points/hour |
| --- | --- | ---: |
| First worker in an empty room | Working chance times 140% active efficiency | +875 |
| Second worker, after the first | Joint activity and reduced all-resting risk | +484 |
| Third worker, after the second | Joint activity and reduced all-resting risk | +338 |
| +10 percentage points of matching production skill on one worker | Skill multiplies active staffing | +119 |
| +10% room-wide Mood Drop reduction on one worker | Owner's work plus peers' work preserved | +30 |
| +10% shipwide Mood Drop reduction from one otherwise unskilled Control worker | Provider's duty cycle times benefit across staffed rooms | +25 per benchmark room |
| +10% shipwide Mood Regen from one otherwise unskilled Control worker | Provider's duty cycle times shorter peer rest | +23 per benchmark room |
| Skill for a product absent from the room | No matching production | 0 |
| Specific Clue Rate-UP | Outside objective | 0 |
| Trust progression | Outside objective | 0 |

Control workers can affect several productive rooms and Reception simultaneously, so their total depends on the entire base and the alternative use of that operator. Existing production bonuses increase the value of preserving working time. Output-rate and material-value multipliers scale the production rows; existing Mood effects require recomputation rather than adding fixed point awards.

## Material demand and alternative sources

Combat and Cognitive EXP serve different level ranges, so equal replacement value does not make them interchangeable for an account's current upgrades. Fungi, plants, and minerals likewise have exact threshold/species requirements. The [economics matrix](scoring-economics-2026-09-13.md) gives those consumption bands and repeatable alternatives.

Current growth defaults remain **1 utility unit per produced item**, multiplied by the selected demand profile and optional recipe priority. General clue collection remains **0.01 utility units per active percentage point per hour**, multiplied by the Reception preference. Neither is a measured conversion to EXP or Sanity. The default is transparent and configurable, but is not an account-specific scarcity model. A three-item plant recipe can consequently outrank a one-item fungus recipe until priorities reflect demand.

A complete demand model needs a planning horizon, chosen operator/weapon/skill upgrades, inventory, and intended external acquisitions. Over that horizon:

```
remainingDemand_r = max(0, targetConsumption_r - inventory_r - externalSupply_r)
usefulOutput_r = min(predictedDijiangOutput_r, remainingDemand_r)
```

Count confirmed unclaimed event/exploration rewards once. Count reachable rare nodes only when the player plans to collect them. Treat shop stock, stage access, event Sanity discounts, and conversion unlocks as constraints. There is no evidence for a permanent generic event or exploration discount. This residual-demand cap is documented as the next model layer; it is **not implemented or inferred from roster level alone**. Current user product/recipe priorities express these preferences manually.

Unlock ROI and ETA still use the existing approximate bundled-effort model; they are not measured Sanity payback or a calendar guarantee. Scores are normalized utility per hour, not percentages, and their growth/Reception portions prevent interpreting the total as Sanity saved. Search can truncate candidates or reach its node budget; results disclose those limits. Greedy completion and four bounded move/swap passes establish and improve a feasible assignment around the node-limited search; these do not establish global optimality.
