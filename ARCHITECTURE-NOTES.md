# Architecture Notes

Observations from the 2026-07-03 code review, recorded after the dead-code
cleanup commit `536a375`.

The core design is sound: clean `lib` / `stores` / `components` layering, the
pressure model as the single source of urgency truth, and a consistent Svelte 5
rune-store pattern. The four areas below are worth attention but none are urgent.

## 1. Three schedulers with a fuzzy boundary — ADDRESSED

Resolved: free-interval computation now lives once in `scheduling.js`
(`computeFreeIntervals`), consumed by both `scheduler.js` and
`outlook-scheduler.js`. `outlook-scheduler.js`'s bespoke `advancePastFixedBlocks`
loop and its duplicated spill loop are gone; it now packs into shared free
intervals. As a side effect it became buffer-aware and, more importantly, now
carves around *other scheduled tasks* on spill days (via a new `occupiedBlocks`
param), fixing a latent bug where a bumped-forward task could land on top of an
existing block.

The two top-level schedulers were deliberately kept distinct: `scheduler.js`
*chooses* order to minimize pressure; `outlook-scheduler.js` *respects* the
user's dragged order. That is a real problem difference, not duplication —
merging them would mean one routine with a reorder flag threaded through.

The roles now: `scheduling.js` owns *where can work go*, `scheduler.js` owns
*pick the cheapest order*, `outlook-scheduler.js` owns *respect the user's
order*.

## 2. `dnd.js` is the complexity sink (~560 lines) — ADDRESSED

Resolved: split into a layered stack, each depending only downward.
- `dnd-hittest.js` — DOM reads (`*FromPoint`, `getEntriesForDay`, `cellKey`).
- `drop-placement.js` — pure placement math (`computeBlocksForCell`,
  `resolveFixedBlockDrop`) and the outlook insertion + hysteresis logic, now in
  one `computeOutlookInsertion` instead of two divergent copies.
- `commitOutlookDrop` moved to the tasks store (it mutates stores, so it belongs
  at the store layer next to `scheduleTask`/`unscheduleTask`).
- `dnd.js` — just the four `use:` actions over a single shared `makeDragCore`;
  the interact.js task/block engine and the raw-pointer outlook engine now share
  one move/drop core (~320 lines, down from 551).

The dual hysteresis blocks — the highest-risk duplication — are gone. A redundant
`unscheduleTask` before an outlook→Today drop was also dropped (`placeBlockOnTask`
overwrites `scheduledBlocks` wholesale, so it was a no-op).

Note: no automated tests exist, so this was build- and reasoning-verified.
Manual drag smoke-testing is still worthwhile before relying on it.

## 3. Big components carry too much logic — PARTLY OVER-FLAGGED, NOW ADDRESSED

The raw line counts were misleading: ~60% of both files is scoped `<style>`
(569 of 918 in TaskRow, 388 of 685 in TodayPlanner), which is exactly where
Svelte CSS belongs — co-located, not a complexity problem. The `<script>` blocks
were ~140–150 lines each and mostly cohesive *view* logic. The note's specific
suggestion (extract timer logic) didn't apply: there is almost no timer logic in
the components — they delegate to the store's timer state machine already.

What *was* real: two kinds of cross-component duplication, now factored out.
- `lib/format.js` — `formatDuration` (appeared verbatim in 4 components),
  `formatHoursMinutes`, `formatClock` (seconds), `peaksLabel`. An inline
  duration formatter in TodayPlanner was also folded in. (SettingsModal's
  `formatClock` is a *different* function — minutes→12h clock — left in place.)
- `lib/inline-edit.svelte.js` — `createInlineEdit()`, replacing the
  double-click-to-rename state machine that was copy-pasted in FOUR places
  (TaskRow, TodayPlanner ×2, OutlookSection).

Side benefit: deleting TaskRow's `editValue = $state(task.description)` removed
the codebase's only `state_referenced_locally` build warning.

The components were not split — they're CSS-heavy but cohesive, not the
complexity sink dnd.js was.

## 4. `luxon` is a dependency but unused in `src/` — ADDRESSED (dropped)

Resolved by dropping luxon, not adopting it. A full date/time correctness audit
(DST both directions in America/New_York, local-midnight parsing, rounding,
localStorage round-trips) found the hand-rolled math is essentially correct —
day-stepping, label rounding, and serialization all survive DST, and the app is
deliberately timezone-naive (local-only, minutes-within-a-workday, ≤21-day
horizon), which is exactly the slice native `Date` handles well. There was no
cluster of bugs to justify a library rewrite. luxon was imported nowhere,
tree-shaken to 0 bytes in the bundle, and a transitive dep of nothing — pure
dead weight. Removed via `npm uninstall luxon`.

Bugs the audit *did* surface:
- **Fixed:** `AddBlockModal.nowTimeStr` dropped the hour carry when minutes
  rounded up to :60 (9:53 → "9:00" instead of "10:00"; pre-filled a past start
  time for ~7 min of every hour). Now snaps whole minutes-of-day with a `% 24`
  wrap.
- **Documented, not patched (unreachable today):** `minutesToTimeString` garbles
  minutes ≥ 1440; `accumulatedPressure` and `pAt` model different curves if a
  task ever had `onset > peak` (the EnvelopeEditor prevents it). Both are guarded
  by current inputs; noted here as invariants to preserve.

Consolidation: the local-midnight parse idiom `new Date(dateStr + 'T00:00:00')`
was hand-inlined in 15 places. Replaced all with a single `parseLocalDate()` in
`calendar.js` (the documented inverse of `toISODate`), so the "parse day strings
in local time, never UTC" assumption lives in exactly one place.
