# Exact search and accuracy

The web app always uses unlimited exact assignment search for **Optimize** and every **Recommend unlocks** counterfactual. It no longer exposes an effort slider or optimization profile. Existing drafts and imported scenarios are upgraded to `optimizationProfile: "exhaustive"` and `optimizationEffort: 100`, retaining their other preferences. There is no hidden time, node, or candidate cutoff. Users can cancel an active worker.

Fast completion is possible because the solver need not visit every slot permutation separately. Swapping the same operators between equivalent slots in one room leaves its score unchanged. The solver enumerates each team once, then proves that entire groups of allocations cannot improve the incumbent before skipping them.

Maximum effort uses an exact room-team search. It enumerates Control Nexus teams first, fixing shipwide Mood support. It then scores all eligible operator subsets for each remaining room, including empty and partially staffed rooms, and searches for disjoint teams. For any partial allocation, the best compatible team in each remaining room supplies an admissible upper bound: ignoring overlap between those future teams can only overestimate the attainable score. Equal-score pruning also bounds worker count, preferred workforce, and room placement, preserving deterministic ties rather than discarding them.

This replaces the former maximum-effort slot enumeration, whose always-active bound and Control Nexus-last ordering could revisit millions of losing assignments without proving the incumbent optimal. Bounded settings retain their slot and candidate budgets. Maximum's state counter now counts partial room allocations, not individual slot choices; rates and state counts are not directly comparable between the two methods. Combination preparation and scoring are also shown as progress phases. Current branch depth describes only the current partial plan, never percent completion.

## Independent exhaustive checks

`tests/team-search.test.ts` independently enumerates each operator's room or unassigned status, subject only to capacity and hard assignments. It does not use the room-team solver's candidate eligibility or bound pruning. The checks compare score, worker count, workforce preference, and room-placement ties against the exact solver.

The suite covers 10 catalog scenarios and 24 synthetic scenarios with overlapping production and Mood effects, saturated support, near-equal scores, zero weights, empty/partial teams, and hard assignments. Three additional synced-catalog scenarios enumerate the baseline and every eligible future skill-rank target independently, verifying that recommendations omit no candidates and match every exhaustive score gain. A full-roster, 15-slot regression also checks completion and a practical state-count bound.

This proves correctness against the implemented score on the tested cases, complementing the bound argument above. It does not independently validate the game's underlying production data or the steady-state Mood model. ?Optimal? means the best modeled assignment for the owned roster, selected facilities, selected recipes, priorities, and hard assignments. Recommend unlocks evaluates individual targets, not combined upgrade sequences; estimated unlock times and ROI remain estimates.

## Library and CLI compatibility

The shared solver and CLI retain bounded configurations for existing callers. Below the roster-dependent endpoint, effort `e` gives a node budget of `1,000 + 2,000 ? e?` and a candidate cap of `min(30, ceil(4 + 0.35 ? e))`. Profiles provide Fast 8, Balanced 18, Thorough 30, and Maximum 100. Reaching the endpoint removes both limits, represented by `null` in search configuration, progress, and JSON results. The web app always chooses this unlimited path.

## Roster-dependent maximum

The bound uses known owned operators after valid hard assignments, and free slots after facility normalization (including the max-facilities overlay). It counts possible unordered operator subsets for each room, including empty rooms, without reusing an operator. A dynamic program accumulates these allocations with binomial coefficients. Multiplying the allocation count by `free slots + 1` bounds the number of search-tree nodes, since every root-to-leaf path has at most that many nodes. Counts saturate just above the largest bounded budget (effort 99); larger numbers are unnecessary for choosing the endpoint.

The endpoint is the smallest bounded effort whose budget would cover that bound and whose candidate cap cannot exclude operators, or 100 if none suffices. Reaching that endpoint selects unlimited search regardless of its numeric value. This bounds the control's range, not the work performed at maximum. The bound ignores current skill eligibility and score pruning deliberately: it remains safe for every individual unlock counterfactual and every room search order. It is conservative, not the exact smallest effort that a particular run needs. Search always stops when it completes.

The shared solver computes this endpoint after facility normalization and roster filtering. Explicit library-level `searchConfig` overrides remain available for callers that need independent limits. This legacy effort scale is not shown in the web UI.

## Lower effort and result quality

The solver establishes a feasible assignment with greedy filling, explores assignments with branch-and-bound, then checks bounded local moves and swaps. Lower effort can stop enumeration early or exclude operator choices. Those local improvements cannot prove global optimality. There is no fixed accuracy percentage, and increasing effort does not guarantee a strictly better score because candidate ordering and the final local search can differ.

Each result reports visited nodes, node-budget exhaustion, candidate truncation, and whether search completed without either limit. Completed searches establish optimality for the current modeled objective and constraints, subject to the game's data and scoring assumptions. Incomplete bounded searches report the best assignment found. At maximum, an uninterrupted successful solve completes the search; cancellation does not return a partial result as an optimum.

Recommendations compare a baseline solve against each upgraded solve. At bounded settings, incomplete baseline search can exaggerate an unlock's benefit, and incomplete candidate search can hide benefit. Gains and rankings can move either way. The baseline assignment seeds each candidate solve and is rescored, but this does not remove search uncertainty. Recommendations disclose incomplete or unverified baseline/candidate searches. At maximum, every solve is unlimited; an incomplete or unverified supplied baseline is re-solved first. Progress is reported during both baseline and candidate searches. A zero gain in a bounded search means no improvement was found at that effort, not proof that the unlock can never help.

Maximum effort can take substantially longer, especially for recommendations, which require multiple complete solves. The browser remains responsive because work runs in a dedicated worker; Cancel terminates it immediately and retains previously completed results. Full assignment-search completion does not turn heuristic ROI estimates into exact farming schedules or make individual unlock rankings a combined upgrade plan.

## Diagnostic timing

The shared solver retains timing diagnostics for library consumers and benchmarking; the web popups omit search-speed, ETA/status, and Control-team cards. Diagnostics measure average nodes per second during assignment enumeration, excluding initial preparation and final result processing. A bounded run estimates **time to the search limit** as remaining budget divided by that observed rate. The search may finish earlier through pruning; this is not an estimate of when all result processing ends.

Unlimited search has no known total node count. After at least three top-level branches and five seconds of search, it estimates remaining search time using the average duration of those completed branches, subtracting time already spent in the active branch. This is a rough extrapolation: branches are explored in score order and can vary greatly in size. The estimate is withheld before enough samples exist, and withdrawn if the active branch takes more than 1.5 times the sampled average. Finished-branch counts are diagnostic, not a percentage of total work. These diagnostics are not a guaranteed finish time.

In the room-team search, these top-level branches are Control Nexus teams; each includes scoring and allocation search for that support context. Combination scoring contributes to elapsed search time even though it does not add allocation states. The solver still proves optimality by completing or safely pruning every eligible control/team allocation.

`npx tsx scripts/benchmark-search.ts` benchmarks the locally synced full roster and a 15-slot base. `--rank=0`, `--rank=1`, and `--rank=2` exercise different unlock states; `--legacy` uses the former slot traversal for comparison. This diagnostic script alone has a 30-second watchdog. The production maximum has no time limit. Regression tests also compare the exact result and tie choices with independent operator-to-room enumeration on small scenarios.

Each recommendation's timing applies only to its current assignment search (baseline or one unlock), not to the entire list. No pre-run duration is claimed from roster size alone. Assignment search completion precedes final explanation generation. Timing never changes traversal or imposes a cutoff. Search progress messages are throttled to at most roughly four per second, except phase transitions, to keep UI updates from consuming substantial runtime.
