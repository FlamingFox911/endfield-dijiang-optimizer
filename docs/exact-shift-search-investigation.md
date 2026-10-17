# Exact search for automatic daily shifts

Investigation date: 2026-10-16. This document proposes a production solver change;
the accompanying script is an offline experiment, not a replacement solver.

## Recommendation

Use exact branch-and-bound over facility teams, normal/rotation modes, and all
legal hourly schedules. Run until the optimum is proved or the user cancels.
Keep one Optimize action, progress reporting, and cancellation; do not restore
the effort slider or silently impose a time, candidate, iteration, or node limit.

Retain the current heuristic to produce a feasible starting plan quickly. Follow
it with a complete search that may discard alternatives only when a valid upper
bound or a proved equivalence rules them out. Finding no local improvement is
not a stopping certificate.

The best fit to the current code is a decomposed search using the existing
TypeScript event forecast and matching bounds. A solver library remains a useful
option for stronger bounds or the assignment subproblem. It does not remove the
need to model the Mood forecast and search the full set of facility alternatives.
Full-roster exact runtime remains unmeasured, so this recommendation is an
architecture choice, not a claim that every roster will finish in seconds.

## What currently limits the result

The limits are in the algorithm, even when the scenario requests exhaustive
search:

- `rotation-search.ts` caps its fixed-schedule seed search at 3,000 states, tries
  several starting assignments, and performs at most eight improvement passes
  per seed. It changes a facility's time while holding other facilities fixed,
  then makes local operator changes. It does not enumerate joint solutions.
- The timing search skips other starting hours under constant Nexus support.
  This is not generally lossless under the current finite forecast; see below.
- `hybrid-rotation.ts` changes a facility to normal operation after finding an
  empty shift. It never compares every legal normal/rotation combination.
- `upgrade.ts` previously described a candidate as incomplete whenever its
  assignment result lacked an optimality certificate. Automatic rotation always
  returns `search.complete: false`, even after finishing normally. Recommendation
  messaging now reserves limit warnings for actual budget or candidate limits
  and states the lack of an optimality proof once in the summary.

Removing the eight-pass limit, adding more seeds, or setting `complete: true`
would not establish global optimality.

## Reproducible evidence

Run from the repository root after building workspace packages:

```powershell
npx tsx scripts/investigate-shift-search.ts --output docs/exact-shift-search-results.json
```

The [script](../scripts/investigate-shift-search.ts) compares the production
heuristic with a restricted exhaustive oracle. The oracle enumerates normal
operation, every ordered pair of distinct workers, all 24 starts and 23
durations, and legal sharing of workers across facilities. Its scope is one-seat
manufacturing teams, no Nexus skills, and no hard assignments. The winning plan
is replayed through the production scorer; assertions check that its score
matches and that it is no worse than the heuristic.

Scores below use the presentation scale of 1,000 points per internal score unit,
with decimals retained for comparison. These are synthetic counterexamples,
not a measured improvement to the user's account.

| Probe | Current search | Exhaustive oracle | Improvement |
| --- | ---: | ---: | ---: |
| One worker with +60% production and 100% Mood drain reduction, plus a generic worker | 172.602740 | 175.342466 | 1.5873% |
| One worker with +60% production and 20% Mood drain reduction, plus a generic worker | 153.424658 | 153.424658 | 0% |
| Four workers shared between two facilities with different recipes | 354.566210 | 354.903240 | 0.0951% |

In the first case, normal operation by the stronger worker beats the selected
23/1 rotation. Both shifts are staffed, so the existing empty-shift repair does
not discover it. In the last case, changing a start hour improves the score with
the same teams and durations. The ordinary Mood case provides a matching result
as a control. Exhaustive probe times were about 11-20 ms in the recorded run;
these tiny instances do not predict full-roster runtime.

The existing 27-operator regression fixture took about 6.3 seconds in the recorded
Node 20 / Windows run, visited 102,636 states, and evaluated 88,964 schedules.
Its score was 1,505.904596 points. This investigation did not solve that fixture
to proven optimality. The [raw results](exact-shift-search-results.json) include
the environment, individual plans, timings, and search metadata.

### A bound that can support a proof

The script also prototypes a schedule-independent upper bound:

1. A rotating facility's average output cannot exceed its stronger team's
   fully active output: the two teams' working fractions sum to at most one.
2. Those selected stronger teams remain disjoint across physical facilities.
3. Relax Mood, Nexus staffing costs, eligibility, and hard assignments, and
   allow every productive facility to be fully staffed, using dummy workers
   where necessary. All modeled production bonuses are nonnegative.
4. With staffing fixed at capacity, each worker's production contribution is
   additive. Maximize those contributions with the existing Hungarian matching
   routine, then add the fully staffed base rates.

The result bounds every legal combination of teams, schedules, and modes, not
just the combinations already sampled. The implementation adds a small upward
numerical allowance. It recovers base rates using a generic worker present in
these fixtures; production code should expose the base rates directly.

For the 27-operator fixture the bound is 1,629.396600 points, 8.2005% above the
current plan. This does **not** show that an 8.2% improvement exists. It shows
that this initial bound has not ruled it out. The 100% Mood reduction probe's
oracle attains its bound, within the numerical allowance, illustrating a case
where a certificate is available immediately.

## Exact decomposition

Fix the complete Control Nexus plan first: its workers, mode, and hourly window.
This determines a time-varying support profile. Given that profile, each other
facility can be scored independently; the remaining connection is that an
operator may be assigned only once across the plan. Preserve the full support
timeline rather than replacing it with average daily support.

Represent a local facility alternative as a **column**: its operator set, teams,
normal or rotation mode, schedule, and modeled score. Include empty facilities,
single normal teams, and rotations with both teams staffed. Enforce facility
capacity, eligibility, fixed recipes, and hard assignments during generation.
A normal-mode alternative must satisfy the combined applicable pins within its
single capacity; it must not drop a pin to make the alternative feasible.

For fixed Nexus support and an identical local operator set, only the best
feasible local alternative is needed for the score objective: other facilities
cannot observe that facility's team split or schedule. Preserve the preferred
alternative on score ties. Globally, choose one column per physical facility,
with no repeated operator. Search every Nexus context as well, accounting for
the workers it consumes. The strongest average Nexus support alone does not
identify the best global plan.

Generate alternatives lazily inside branch-and-bound. Naively precomputing
everything is unsuitable: with 27 workers and up to three per team, there are
7,798,752 ordered disjoint nonempty team pairs, or 4,304,911,104 pair/window
combinations for one facility before any pruning. With 32 workers the latter
count is 12,522,424,704. These are raw counts, not runtime projections.

Use the full-uptime matching bound first, then tighter bounds conditioned on
reserved workers, Nexus choices, team effects, and schedule restrictions. Cache
local Mood simulations by their actual effect profile and support timeline.
The real fixture has 11-14 distinct complete local worker profiles per room
among its 27 workers, so there is repeated scoring work to share. Keep worker
identities in the global search: equivalence in one room does not imply
equivalence in another room or under hard assignments.

Do not discard a Nexus worker merely because its own support effect is zero;
staffing both shifts can make a different support/rest schedule feasible.
Likewise, team swaps, clock shifts, identical rooms, and worker substitutions
need equivalence proofs before they can remove alternatives. Respect pins and
the existing secondary preferences when applying symmetry reductions.

## Forecast accuracy is a separate question

The current forecast starts at full Mood, warms up for 14 days, then measures
28 days. With constant support, a 19-hour shift and 20% local drain reduction,
changing only the starting hour changes predicted working time from
14.952381 to 15.250000 hours/day. The difference is about 17.86 minutes/day.

Consequently, treating every clock phase as equivalent changes the objective
that is actually being optimized. An exact solver preserving today's forecast
must consider these phases, or prove a narrower equivalence for a particular
case, such as fully sustainable windows.

The forecast's finite horizon also deserves a separate model review. If the
intended objective is indefinite daily output, phase effects from initialization
and the measurement window may be undesirable. Do not silently change to an
average-support formula, shorten the simulation, or round scores to obtain a
certificate. First preserve the current scorer for solver comparisons; then
validate any steady-state replacement independently.

Even a proven optimum remains conditional on Mood rates, recovery rules,
recipes, fixed demand preferences, and the hourly schedule interface. Keep
model confidence separate from search optimality. A proof removes the search
qualification, not the fact that game output is forecast from a model.

## Solver alternatives reviewed

| Approach | Fit here | Decision |
| --- | --- | --- |
| More heuristic passes or seeds | May improve the starting plan, with no global certificate | Keep only as a warm start |
| Full materialization of facility alternatives | Correct in principle, billions of raw combinations per facility | Avoid eager generation |
| Exact decomposed branch-and-bound with current scorer | Preserves event forecasting and existing browser worker; can use admissible bounds and lazy alternatives | Recommended first implementation |
| HiGHS MILP over facility columns | Useful for the column selection problem and LP bounds; still needs complete generation or exact pricing | Benchmark if stronger bounds are needed |
| Direct CP-SAT scheduling model | Requires a faithful reformulation of the continuous Mood event forecast | Larger model change; not an immediate replacement |

HiGHS supports linear and mixed-integer linear models and convex quadratic
models; its documentation excludes general nonlinear optimization. The current
event simulator therefore needs a formulation or scored columns before it can
be used with HiGHS. See the [official HiGHS documentation](https://ergo-code.github.io/HiGHS/dev/).

The [highs-js project](https://github.com/lovasoa/highs-js/blob/main/README.md)
provides a WebAssembly build for browser and Node use, so a browser solver does
not inherently require a backend. Its current WASM build is single-threaded and
the project recommends a Web Worker. It was reviewed, not installed or benchmarked.

CP-SAT requires integer constraint formulations and distinguishes feasible
solutions from optimal ones. It cannot directly call the existing arbitrary
event simulation as a mathematical constraint. See [Google's CP-SAT guide](https://developers.google.com/optimization/cp/cp_solver).

Solving a MILP over only the currently discovered columns does not certify the
original problem. Column generation would need exact pricing and an integer
search that preserves completeness, such as branch-and-price. SCIP's
[bin-packing example](https://www.scipopt.org/doc/html/BINPACKING_MAIN.php)
demonstrates that architecture. Introducing it would be a substantial solver
integration, rather than a dependency swap.

## Product contract and implementation order

The default action should mean: search the complete legal problem and finish
only when no better modeled plan remains. Expose elapsed time, best score, and
a valid remaining upper bound when available. Do not invent a completion ETA
from local progress. Keep cancellation responsive, preserve previous completed
results, and identify any exposed interrupted incumbent as unproved.

Distinguish computation status from its guarantee, for example `running`,
`optimal`, `canceled`, and `failed`, with an upper bound and gap while searching.
Use conservative numerical comparisons and documented tolerances, retaining
full score precision. Close the score bound and resolve required tie preferences
before reporting completion. Bounded caches are acceptable; dropping unexplored
branches to save memory is not.

Unlock rankings require an exact baseline and an exact solve for each candidate.
Rescore the baseline's plan as a candidate seed and reuse unaffected calculations,
but do not treat the seed as the counterfactual answer. Mark the batch proven
only after every candidate is certified. An automatic rotation heuristic finishing
normally should not be described as a candidate that failed to complete.

Implement in this order:

1. Extend the small exhaustive oracle to multi-seat teams, Nexus timelines,
   mixed modes, pins, and deterministic tie preferences.
2. Add exact local alternatives and Nexus contexts, then the lazy global search
   with independently checked upper bounds. Preserve the current scorer.
3. Add progress certificates and cancellation, followed by exact unlock solves
   with shared scoring caches.
4. Benchmark full 27- and 32-operator fixtures, varied skills, fixed schedules,
   and maximum facilities, including memory use and mobile browser behavior.
   Choose tighter bounds or WASM acceleration from that evidence.

The investigation validates counterexamples and one useful bound. It does not
establish practical full-roster exact runtime. No algorithm can promise both
unrestricted combinatorial optimality and a fixed short runtime for every
future roster. The proposed contract honors the requested preference by keeping
the search complete and leaving cancellation to the user.
