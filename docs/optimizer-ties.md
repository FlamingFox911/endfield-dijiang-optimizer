# Assignment ties

Equal-scoring plans prefer limited-banner 6-star operators, newest **first featured banner** first, followed by regular 6-stars, 5-stars, and 4-stars. Reruns do not reset this order. Operator IDs provide a deterministic fallback within a category. The existing preference for fewer workers at equal score remains, so idle workers are not added just for their rarity. Hard assignments remain fixed.

The preference is a separate comparison; it never changes skills, point values, projected output calculations, or the score objective. Ties require equal unrounded scores, not equal displayed points. Search profiles still control search limits and do not guarantee globally optimal assignments when truncated.

Optimize automatically includes every unassigned owned operator who can replace each displayed slot while leaving the whole-base score unchanged. Hover, focus, or tap the slot's **⇄** icon to open a scrollable list of alternatives; Escape, moving away, or clicking outside closes it. Slots without alternatives have no icon. This includes neutral choices for empty slots. Hard-assigned workers have no alternatives. Alternatives are checked against the complete chosen plan, including Control Nexus effects, without the search's candidate cap. Each alternative applies individually: combining them can change the score or reuse an operator. This is not enumeration of every tied base layout.

There is no setting or CLI flag to enable alternatives. The old `options.showTiedOptions` value, if present in a saved scenario, is ignored. CLI text and JSON results include alternatives by default. Results expose `roomPlans[].alternativeOperatorIdsBySlot`, aligned with the displayed assigned operators followed by empty slots; each list excludes the current worker.

## Banner metadata

`packages/optimizer/src/operator-preference.ts` supplies first-featured-banner dates for the currently released roster, independently of immutable skill snapshots and live roster ordering. The sequence was checked against [banner history](https://endfieldhub.org/tools/banner-history), with Arcane before Liino confirmed by the [official Homecoming notes](https://endfield.gryphline.com/en-us/news/5200). These dates describe featured-banner debuts, even where an operator could appear off-rate earlier.

For future operators, add a sourced entry to that table or supply `OperatorDefinition.limitedBannerDebut` as `YYYY-MM-DD` in the catalog/live overlay. Explicit metadata takes precedence. Unknown operators fall back to their rarity; the optimizer does not guess limited status from roster order or retrieval timestamps.
