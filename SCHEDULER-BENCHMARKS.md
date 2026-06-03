# Scheduler Benchmark Findings

**Date:** 2026-06-04  
**Script:** `scripts/benchmark.js`  
**Method:** Random synthetic tasks (profiles, importances, durations uniformly sampled; creation times within the past 24h). Default Mon–Fri 9–17 work schedule, no buffer.

---

## Heuristic vs Exact DP

The exact DP solver uses bitmask dynamic programming: O(n·2^n) time, O(2^n) space.

| n  | Heuristic cost | Optimal cost | Gap    | DP time | DP memory |
|----|---------------|--------------|--------|---------|-----------|
| 5  | 30.969        | 30.969       | 0.000% | 1ms     | <1MB      |
| 8  | 27.456        | 27.456       | 0.000% | 2ms     | <1MB      |
| 10 | 72.278        | 72.278       | 0.000% | 8ms     | <1MB      |
| 12 | 96.007        | 96.007       | 0.000% | 14ms    | <1MB      |
| 15 | 83.301        | 83.301       | 0.000% | 128ms   | <1MB      |
| 18 | 214.572       | 214.572      | 0.000% | 1175ms  | ~2MB      |
| 20 | 186.699       | 186.634      | 0.034% | 4944ms  | ~8MB      |
| 22 | 110.805       | 110.805      | 0.000% | 21850ms | ~32MB     |

DP is impractical beyond n≈22 (n=25 takes ~4 minutes and uses 256MB; n=28+ would require GB of memory).

---

## Gap Distribution (n=15, 50 trials)

| Metric        | Value  |
|---------------|--------|
| Mean gap      | 0.099% |
| Max gap       | 3.313% |
| Non-zero gaps | 3/50 trials (6%) |

The heuristic is optimal on 94% of random trials at n=15. The worst observed gap was 3.3% — a single outlier. Typical non-zero gaps are <0.5%.

---

## Heuristic Scaling

The heuristic (greedy + local search) is O(n³) in the worst case due to the insertion-move phase. Observed wall-clock times:

| n   | Time    | Scheduled |
|-----|---------|-----------|
| 20  | 124ms   | 20/20     |
| 30  | 374ms   | 30/30     |
| 50  | 4280ms  | 50/50     |
| 75  | 12727ms | 58/75     |
| 100 | 4763ms  | 47/100    |

**Note:** At n=75 and n=100, not all tasks fit within the 7-day visible window, so the scheduler places as many as possible. The drop in time at n=100 vs n=75 is because fewer tasks are schedulable, making the local search cheaper.

Performance is fine for typical use (≤20 tasks). At n=50 it starts to feel slow (~4s). If this becomes an issue, the local search could be capped (e.g. max 3 restarts) without much cost to solution quality given the gap distribution.

---

## Why O(n·2^n)?

The optimal sequencing problem is NP-hard (equivalent to TSP in complexity). To find the true optimum you must consider all possible orderings — that's n! permutations. The DP over subsets is the clever approach: it exploits the fact that the *end time* of a set of tasks depends only on *which* tasks are in the set, not their order (same total work minutes → same calendar end time). This collapses n! states to 2^n, each costing O(n) to evaluate: O(n·2^n) total. This is the best known exact algorithm for this problem class.

For n=20: 20·2^20 ≈ 20M operations — feasible.  
For n=30: 30·2^30 ≈ 32B operations — impractical.

---

## Conclusions

1. **The heuristic is essentially optimal for realistic task lists.** At n≤15 (typical in-app use) it hits optimal in >94% of random trials. The mean gap is under 0.1%.

2. **The local search does real work.** Greedy-only cost is consistently higher than final cost; the swap and insertion phases close most of the remaining gap.

3. **The DP is a validation tool, not a production component.** It confirms the heuristic quality but is infeasible for n>22 in time and n>28 in memory.

4. **Performance is adequate up to ~30 tasks.** Beyond 50 tasks the local search becomes noticeably slow; a restart cap would help if needed.
