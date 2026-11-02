# Scheduler — algorithmic directions

Written 2026-08-26, revised 2026-08-27 after prototyping. Follows the auto-schedule
performance finding in `LAUNCH-REVIEW.md` (blocker #2) and `MOBILE-ISSUES.md` (item 10).

Prior art: `scripts/benchmark.js` (repaired 2026-08-27, see §7) and
`SCHEDULER-BENCHMARKS.md`, which was **deleted** in `20ac097` and is recoverable with
`git show ab5a6ae:SCHEDULER-BENCHMARKS.md`. That document established the current
heuristic is O(n³) via the insertion-move phase and accepted it as a tradeoff up to ~30
tasks. This note revisits that ceiling, not that decision.

**Status:** the design in §3–§5 is validated by prototype (`.proto/work-axis.js`,
untracked) against the exact DP oracle. It is not implemented in `src/`. The conclusion
is that `scheduler.js` and its neighbours want a rewrite rather than a patch.

---

## 1. The structural facts

**(a) The objective is separable.** `accumulatedPressure(task, completionTime)`
(`envelope.js:19`) depends only on that task's own completion time. No term references
any other task.

**(b) The makespan is order-invariant.** Across all 120 permutations of a 5-task set,
`packSequence` produced **one distinct final end time**. Order does not change *when the
work ends* — only *which task lands where inside a fixed makespan*.

So the ordering problem is single-machine sequencing with separable, non-decreasing
completion-time costs: minimize `Σ fᵢ(Cᵢ)`. Each `fᵢ` is convex in `Cᵢ` — the marginal
ramps up through onset→peak, then plateaus flat at `peakPressure`.

**(c) But pressure lives on the calendar axis, and scheduling lives on the work axis.**
This is the finding that reframed everything below.

---

## 2. The axis mismatch (the real problem)

`accumulatedPressure` integrates over **calendar time**. Every scheduling decision is
about **workable time**. Pressure therefore accrues when no work was possible:

| Interval | Workable minutes | Pressure accrued |
|---|---|---|
| Thu 5pm → Fri 9am | 0 | 3.56 pressure-hours |
| Fri 5pm → Mon 9am | 0 | **64.0** pressure-hours |

This is not a constant offset — it changes the decision. The marginal cost of displacing
the same 60 minutes of work depends on where the gap falls:

| Pushing a 60-min task back one slot | Cost |
|---|---|
| Thu morning | 0.0300 |
| Thu near close | 0.0562 |
| Fri near close (weekend next) | **0.2363** |

**8x more expensive across a weekend.** The optimizer is partly minimizing "how many
overnights and weekends did tasks straddle" rather than pressure endured.

Measured consequence: a first attempt that put the *search* on a flat work-minute model
while `totalCost` integrated *calendar* time regressed badly, and the bad cases were
**6.5x concentrated in weekend-spanning schedules** (7/108 vs 2/192). The two axes
disagree hardest exactly where non-work gaps are largest.

### Pressure stays on the calendar axis

This is a product decision, already taken: users author the envelope on a calendar chart
(`EnvelopeEditor`), tiers read against wall-clock ("Critical · peaks today"), and a
deadline-driven task genuinely does get worse over a weekend. **`envelope.js` does not
change.** The fix is to give the scheduler a bridge, not to redefine pressure.

---

## 3. The work axis (validated)

A lookup table built once per schedule, mapping work-minutes-elapsed → calendar instant.
One entry per work day: **21 entries** over the default horizon.

```
workMinutes → (binary search, 21 entries) → calendar instant → accumulatedPressure()
```

Measured:

| | |
|---|---|
| Grid build | 0.084ms |
| `workToCalendar` vs `advanceWork` | 41ms vs 1512ms per 200k — **37x faster** |
| Full cost lookup (transform + analytic integral) | **0.49µs** per call |

It *removes* work from the hot path: a day-walking loop becomes a binary search.

### Why not "rebuild pressure as a piecewise-linear function"

Tested and rejected. The true function has **68 slope changes** over 21 days (onset and
peak land mid-day and add their own kinks, on top of the 21 day boundaries), and
approximating it as linear within each day gives **max error 55.8, mean 10.1**
pressure-hours — useless.

But that only matters if you want to *represent* the function. The search only ever
samples it pointwise, so the kinks are free and the exact analytic integral is kept. **No
piecewise reconstruction is needed.** The infrastructure is the 21-entry table, nothing
more.

The one property the search actually needs — **cost is monotonic non-decreasing in
work-minutes** — was verified and survives the axis change.

---

## 4. Naive placement, day breaks as rendering

With the axis in place, day boundaries stop being scheduling constraints. Lay a sequence
out contiguously on the work axis, then split blocks only where they cross a boundary
(`layoutOnAxis` in the prototype). Placement becomes trivial; day structure is applied on
the way out.

This is the "pretend day boundaries don't exist, repair afterwards" approach, and it
worked: given the DP's optimal order, the layout **reproduced the optimal cost exactly**.

---

## 5. What the prototype measured

Both the search *and* the objective on the same axis, so they cannot disagree.

The decisive result is the failure diagnosis. On the prototype's worst cases:

```
DP optimal=41.4306   ours=46.2049   gap=11.52%
DP order laid out on our axis costs: 41.4306   ← reproduces the optimum exactly
model says: ours=46.2049  dpOrder=41.4306     ← model agrees DP order is cheaper
```

The model now **prefers the DP's order**, and the layout reproduces the optimal cost. The
residual gap is the *search* settling in a local optimum — not the model being wrong
about what things cost, which is what sank the earlier attempt.

### Against the oracle, 150 trials at n=14

| | mean | p95 | max | imperfect | time |
|---|---|---|---|---|---|
| Prototype (work axis) | 0.296% | 1.85% | 15.87% | 9/150 | **294ms** |
| Current (calendar repack) | 0.147% | 0.15% | 5.73% | 9/150 | 4,836ms |

**16x faster, same count of imperfect trials, worse tail.** At n=18 the prototype's tail
was better than current's (9.6% vs 36.5% max in one run). Not yet a strict win: the axis
is validated, the search on top of it is not tuned.

### Search findings

- **Pairwise-exchange seed helps** and is *exact* on this axis (compare `ab` vs `ba`
  completion costs). It closed most of the gap versus starting from input order.
- **An adjacent-swap phase made things worse** — it fights the insertion moves, keeps
  `moved` true, and burns passes without converging. Dropped.
- Remaining tails are local optima. Cheap to attack now that scoring never repacks:
  restarts, or an Or-opt move that relocates adjacent pairs.

---

## 6. Approaches ruled out

- **Branch and bound / exact solve in production.** Infeasible past n≈22 (n=25 ≈ 4 min,
  256MB), and the heuristic is already at or near optimal on most instances.
- **Simulated annealing, genetic, tabu.** Determinism and tuning burden for no measured
  quality gain.
- **A simple sort rule alone.** Pairwise exchange was optimal on 87.5% of random triples,
  with gaps to 1478% at n=8 without a follow-up search. Good seed, not a solution.
- **Capping the existing local search.** `SCHEDULER-BENCHMARKS.md` proposed this ("a
  restart cap would help if needed"). Tested: 80x faster but **30–40% worse cost**. That
  doc's gap distribution was measured at n=15 where the search converges quickly; at
  n≥25 a capped search stops far from convergence. Do not ship.
- **Removing the local-search restart** (both phases `break` to the top of
  `while (improved)`). Tested: only ~1.2x faster, and it perturbed results — cost at
  n=25 got *worse* (486→531).
- **Moving the current algorithm to a Web Worker.** Hides an O(n⁴) computation without
  making it finish. Reconsider only after the rewrite, if profiling still justifies it.
- **Moving pressure itself onto the work axis.** Rejected on product grounds (§2).
- **Piecewise-linear reconstruction of pressure.** Rejected on accuracy (§3).

---

## 7. State of the tree

Done and in the working tree (not committed):

- **`scripts/benchmark.js` repaired.** Was broken at import (`accumulatedProblemness`,
  old `urgencyProfile`/`importance` task model, `taskflow_v1`). Now runs against the
  current model, packs the DP against `schedulableMinutes` so both sides measure the same
  problem, and skips the DP comparison when not all tasks fit the window. This is the
  regression oracle — **every quality claim above is reproducible from it.**
- **`SCHEDULING_HORIZON_DAYS = 21`** in `constants.js`, replacing per-call-site literals
  (7 / 7 / 21). The outlook could previously park a task 14 work days beyond what
  `autoSchedule` could see (Sep 24 vs Sep 4).
- **Outlook no longer silently discards a drag.** Tasks >480min (one work day) were
  dropped — and since a cross-day move calls `unscheduleTask` first, the drag *destroyed
  the existing schedule*. `reorderAndBumpForward` now returns `unplaceable`;
  `commitOutlookDrop` restores the prior blocks.
- **The four `console.log` calls are gone** (`LAUNCH-REVIEW.md` item 11).

Reverted: a first attempt at the fast search inside `scheduler.js` (kept for reference at
`.proto/step3-attempt.js.bak`). It was 67x faster but regressed quality, for the axis
reason in §2.

Not started: the rewrite itself.

---

## 8. Open questions for the rewrite

1. **Fixed and manual blocks.** `layoutOnAxis` ignores them, and this is the part that
   genuinely does not fit the naive model: fixed blocks are calendar-anchored (a 2pm
   meeting is at 2pm regardless of work-minute position) and fragment the axis. Keep
   `packSequence` as the feasibility authority rather than deleting it.
2. **Grid invalidation.** The axis depends on the work schedule; changing work hours
   makes it stale. Cheap to rebuild (0.084ms), but it is a cache with a rule.
3. **Horizon boundary.** Work-minutes only mean something inside the built grid.
4. **`totalCost` must move with the search.** If the search optimizes one axis and the
   objective scores another, the §2 mismatch returns. This is why the change is atomic
   for `scheduler.js` rather than incremental.
5. **Search tuning.** Restarts or Or-opt to close the tail (§5).

Out of scope, deliberately: the wider `(date, startMinutes)` → work-minute substrate
migration across storage, `dnd.js`, and components. That is 54 coupled references plus a
persistence migration, with no test suite and no export/import to make it safe. Revisit
after the rewrite lands and export/import ships.

---

## Suggested order

1. Rewrite `scheduler.js` on the work axis (§3–§5), keeping `packSequence` for
   feasibility.
2. Move `totalCost` onto the same axis, in the same change.
3. Tune the search to close the tail; require the oracle's gap to be no worse than the
   current baseline before landing.
4. Resolve fixed/manual block handling (§8.1).
5. Revisit the Web Worker and the substrate migration only if still justified.
