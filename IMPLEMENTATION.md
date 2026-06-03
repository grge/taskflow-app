# Phase 1 Implementation Notes

## Stack

- Svelte 5 (runes) + Vite
- `interactjs` for drag-and-drop (the `@interactjs/interact` scoped package lacks `.draggable()`/`.dropzone()` — use `interactjs` instead)
- LocalStorage persistence via a `taskflow_v1` key
- No TypeScript — plain JS with JSDoc-style conventions

## File Structure

```
src/
  main.js
  App.svelte
  lib/
    constants.js        # IMPORTANCE_PEAKS, URGENCY_ENVELOPES, PROBLEMNESS_SCALE, etc.
    envelope.js         # P(t), F(t), buildEnvelopeParams, getProblemnessTier
    calendar.js         # advanceWork, getVisibleWorkDays, toISODate, etc.
    tasks.js            # createTask, updateTask (pure, no reactivity)
    scheduling.js       # createScheduledBlock, placeBlockOnTask, removeBlocksForTask
    persistence.js      # loadState/saveState with Date field revival
    dnd.js              # Svelte actions: draggableTask, draggableBlock
    components/
      TaskList.svelte
      TaskRow.svelte
      WeekMatrix.svelte
      ScheduledBlock.svelte
      AddTaskModal.svelte
      SettingsModal.svelte
  stores/
    tasks.svelte.js     # _tasks $state, activeTasks, completedTasks, mutations
    schedule.svelte.js  # _workSchedule $state, updateWorkSchedule
    ui.svelte.js        # dragState, activeModal, editingTaskId, previewBlock
  styles/
    main.css
    matrix.css
    tasklist.css
```

## Decisions Not Specified

**Drag-and-drop approach**

The spec mentions Interact.js but doesn't say how to use it. Interact.js dropzones were tried first but are unreliable when the drag ghost doesn't physically overlap the dropzone element. Switched to `document.elementsFromPoint` on pointer move/end — finding the first element with `data-date` and `data-start` attributes. This is simpler and works regardless of scroll position or ghost size.

During a drag, a `previewBlock` in the UI store renders a semi-transparent block in the grid, while the actual task store is not touched until `dragend`. This prevents the drag handle from being destroyed mid-drag by Svelte re-rendering the task row (which would happen if `scheduledBlocks` changed during the drag).

Grab offset: when dragging an existing block, the pixel distance from the block's left edge to the pointer is recorded at `dragstart` and subtracted from the pointer x during `elementsFromPoint` lookup, so the block doesn't jump to left-align under the cursor.

**Grid layout**

The spec doesn't address varying work hours across days. The matrix uses a global timeline spanning from the earliest start to the latest end across all visible work days. Each row renders against this shared timeline. Off-hours portions of each row (before the day starts, after it ends, and the area right of the last schedulable hour) are shaded `#EDEDED`. The area below the last row is also shaded via a grey background on `.matrix-panel`.

Drop targets are quarter-hour cells (`data-start` every 15 min) nested inside visual hour columns. The blocks overlay is a sibling of the cells div, not a child, so percentage-based block positioning is calculated against a fixed pixel width (`hourCount × 80px`) rather than the flexed container width — this was the root cause of an early scaling bug where blocks drifted rightward across the day.

**Block duration in the grid**

`ScheduledBlock` stores `startMinutes` and `taskId` but block width is rendered from `task.estimatedMinutes` at render time, not from a stored `durationMinutes`. This means changing the duration in the task list immediately updates the block width without any extra logic.

**Task list ordering**

The spec calls for sorting by current problemness. This was implemented and then disabled — it was disorienting in practice because tasks jump around whenever you change urgency/importance. The list now preserves insertion order. Manual reordering is noted as a future addition.

**Svelte 5 store pattern**

Svelte 5 forbids exporting reassignable `$state` from `.svelte.js` modules. All stores export plain objects with `get value()` accessors instead. The persistence `$effect` must run inside a component context — it's called via `initPersistence()` from `App.svelte`'s `<script>` block, not from the module's top level.

**Completing and deleting tasks**

Completing a task clears its `scheduledBlocks` in the same update so no orphan block is left in the grid. Deleted tasks are soft-deleted (`isDeleted: true`) and filtered out of all views.

**Work schedule changes**

When the work schedule is saved, `unscheduleTasksOnDisabledDays` removes blocks for any task scheduled on a day of the week that is now disabled. The spec doesn't specify this — it seemed like the right behaviour vs. silently leaving orphan blocks.

## Multi-day block splitting

The spec defers multi-day splits to Phase 2 (auto-allocate), but splitting was implemented for manual scheduling ahead of that.

When a task is dropped onto the matrix, `splitTaskAcrossDays` (in `scheduling.js`) walks forward through visible work days from the drop point, filling each day up to its `endMinutes` and carrying the remainder to the next day. It returns an array of 1..N `ScheduledBlock` objects. Blocks with N>1 parts are annotated with `partIndex`/`totalParts`.

If the drop point is too late for the task to fit within the visible window, `latestValidDropPosition` scans backwards through visible days/slots to find the latest valid start and the task snaps there ("gets stuck"). If the task is longer than the total available work time in the window, the drop is a no-op.

`placeBlockOnTask` accepts either a single block or an array. `unscheduleTasksOnDisabledDays` checks all blocks on a task (not just `[0]`) when the work schedule changes.

Block width in the matrix uses `block.durationMinutes` for split parts and `task.estimatedMinutes` for unsplit blocks, preserving the live-update behaviour for the common case.

**Drag-and-drop with split blocks**

The pixel-offset approach (`grabOffsetPx`) that worked for single blocks breaks down for split blocks because the parts live on separate row elements with no shared pixel coordinate space.

The replacement is time-based: `grabOffsetMinutes` is computed at drag start as the sum of all preceding parts' durations plus the pixel distance into the grabbed block converted to minutes (via the grid's quarter-cell width). During move/end, `cellFromPoint` finds the cell under the raw pointer, then `retreatWork` (a new reverse of `advanceWork` in `calendar.js`) walks back through work time by `grabOffsetMinutes` to find the task's intended start. The same code path handles dragging from the task list, an unsplit block, or any part of a split block.

## Auto Schedule (Phase 2)

`src/lib/scheduler.js` implements the greedy + local search scheduler from the spec.

**`packSequence`** pre-computes a list of free intervals across the visible 7-day work window — contiguous stretches of work time not covered by manual blocks, never spanning day boundaries. For each task it tries each interval start in order and accepts the first position where `splitTaskAcrossDays` produces blocks that all land within free intervals. Intervals too small to fit the task are skipped entirely rather than partially filled. Returns `null` if no gap is large enough for a task.

**`autoSchedule`** operates only on tasks with `scheduledBlocks.length === 0`; all already-scheduled tasks are treated as immovable anchors. If the full sequence doesn't fit in the window, a binary search finds the longest fitting prefix — that prefix is optimised and the remainder left unscheduled. Logs greedy cost, scheduled count, and final cost to the console.

**No data model distinction** between manually-placed and auto-placed blocks. "Auto Schedule" fills whatever is unscheduled; running it twice does nothing the second time. "Clear Schedule" removes all blocks from all tasks, giving the scheduler free reign on the next run.

**Task list sort bar** sits between the header and the task list. Sorts by: date added (default), name, urgency, importance, current problemness, or scheduled time. Unscheduled tasks sort to the bottom of the scheduled-time view.

## Time Tracking (Phase 3)

A timer bar sits at the bottom of the screen. Clicking ▶ on any task row starts the timer; the bar shows the task name, elapsed time (seconds-accurate, monospace), and Pause/Resume/Stop buttons.

**Timer state** lives in `activeTimer` in `ui.svelte.js`: `{ taskId, startedAt, baseSeconds }`. `baseSeconds` is `task.elapsedSeconds` at the moment play was pressed. Display is always `baseSeconds + (now - startedAt)` when running, `baseSeconds` when paused. There is no session array to sum — elapsed is a single arithmetic expression.

`task.elapsedSeconds` is the single source of truth for total time worked on a task. It is written on pause and on stop so it survives reloads correctly — including the case where the tab is closed while the timer is running (elapsed is recovered from `startedAt` on reload).

Starting a timer on a different task automatically stops and saves the current one first.

`pauseTimer` writes `elapsedSeconds` back to the task immediately so a reload while paused shows the correct total. `finishTimer` does the same and clears `activeTimer`.

**Clock:** `clock.svelte.js` provides a shared `clock.now` ticking once per second. Components use `void clock.now` to subscribe to ticks for reactivity, but use `Date.now()` for the actual arithmetic — this avoids a first-tick negative display that occurred when `clock.now` was behind `startedAt` by up to one second.

Stopping the timer does not complete the task — the user completes it separately via the ✓ button.

## Current Time Indicator (off-spec)

Two visual aids on today's row in the week matrix:

- **Red time rule**: thin vertical line with a dot at the top, positioned at the current minute. Uses `clock.now` from `clock.svelte.js` so it updates every second. Only rendered when current time falls within the day's work hours.
- **Elapsed overlay**: semi-transparent grey wash from work-day start to `min(now, dayEnd)`, rendered behind blocks (z-index 3) so past scheduled blocks remain fully visible. Skipped when now is before work start.

Blocks were bumped from z-index `i+1` to `i+10` to ensure they always sit above the overlay.

## Scheduling Buffer (off-spec)

`WorkSchedule` has a `bufferMinutes` field (default 15, persisted). Old saved schedules are migrated on load via `{ bufferMinutes: 15, ...parsed.workSchedule }`.

In `scheduler.js`, `computeFreeIntervals` expands each manual block's exclusion zone by `bufferMinutes` on both sides (clamped to day boundaries), so auto-placed tasks are never placed within the buffer of a manual block. `packSequence` advances the cursor by `bufferMinutes` after each placed task (except the last), creating a gap between consecutive auto-scheduled tasks.

The buffer setting is exposed in the Settings modal as a segmented button group: None / 5m / 10m / 15m / 30m.

## Task Row Design

Redesigned from a two-row layout with unlabelled controls to:

- **Primary row**: drag handle · description (dominant, click to edit) · hover-revealed play + complete buttons
- **Meta strip**: problemness badge · divider · `‹ urgency ›` picker · L/M/H importance · duration chip · scheduled time (if scheduled) · elapsed time (if any)

Both the problemness badge and urgency label have fixed pixel widths (96px and 92px respectively) so that cycling through urgency profiles or watching problemness change doesn't cause the row to reflow and shift the arrow buttons.

The drag handle uses an SVG dot-grid icon (grey, brightens on hover). Scheduled tasks replace it with a green SVG checkmark. Action buttons (play, complete) are hidden at rest and fade in on row hover.

## Settings Modal Design

Redesigned from a flat list to a sectioned layout:

- Header bar with title + × close button
- **Work Hours** section: day toggles + time range inputs
- **Scheduling** section: buffer between tasks (segmented buttons)
- Footer bar: "Reset all data" as a quiet ghost link (left), Cancel + Save (right)

## Insights & Estimation (Phase 3 completion / Phase 4 partial)

Completed timed tasks feed an estimation multiplier used by the auto-scheduler. The multiplier is the median of `actual / estimated` ratios across all completed tasks with `elapsedSeconds > 0`, falling back to a prior of 1.2× when fewer than 5 observations exist. It lives in `estimation.svelte.js` and derives reactively from `completedTasks` — no separate history array is maintained.

`autoSchedule` accepts the multiplier and scales each task's `estimatedMinutes` before packing, so the scheduler books realistic time. Stored blocks retain the original duration (matrix rendering is unaffected).

The **Insights modal** (header button) shows: number of timed completed tasks, median and mean actual/estimated ratio, current multiplier, and a scatter plot of ratio vs estimated minutes coloured by importance with a fitted regression line and y=1 reference.

Estimation data is intentionally sparse at first — the prior of 1.2× is a reasonable starting point until ~5 tasks have been completed and timed.

## Known Deferred Items (from spec)

- Exact DP solver and optimality gap measurement (Phase 4 benchmarking)
- Timeseries accuracy chart in Insights (needs data density to be useful)
- Stratified multiplier by importance/duration (investigate empirically first)
- Manual task reordering
- Y-stagger for overlapping blocks in the matrix
- Custom envelope editor
- Resize blocks by dragging their edges
