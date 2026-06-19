# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # dev server at http://localhost:5173
npm run build    # production build → dist/
npm run preview  # preview production build
```

No lint or test scripts are configured. Playwright is installed but has no active test suite.

## Architecture

TaskFlow is a Svelte 5 SPA (no SvelteKit) that schedules tasks by minimizing accumulated "problemness" — a time-dependent urgency function per task. All state lives in localStorage (`taskflow_v1`); there is no backend.

### Layer overview

- **`src/lib/`** — pure logic: `envelope.js` (problemness math), `scheduler.js` (auto-scheduler), `scheduling.js` (block placement), `calendar.js` (work-day navigation), `dnd.js` (drag-and-drop Svelte actions), `persistence.js` (localStorage load/save/migration)
- **`src/stores/`** — Svelte 5 rune-based state (`tasks.svelte.js`, `schedule.svelte.js`, `ui.svelte.js`, `clock.svelte.js`, `estimation.svelte.js`)
- **`src/lib/components/`** — UI: `App.svelte` is the root shell; `WeekMatrix.svelte` is the 7-day drag-and-drop grid; `TaskList.svelte`/`TaskRow.svelte` is the task panel with live problemness; modals for add, settings, insights

### Key conventions

**Svelte 5 state exports:** Svelte 5 forbids exporting reassignable `$state` from `.svelte.js` modules. All stores export objects with `get value()` accessors. The persistence `$effect` must run inside a component (done via `initPersistence()` called in `App.svelte`).

**Drag-and-drop:** Uses `document.elementsFromPoint()` instead of Interact.js dropzones (more reliable for overlapping/scrolling). Preview blocks render in `previewBlock` (UI store) without touching `scheduledBlocks`. Use `interactjs` (not `@interactjs/interact`) for `.draggable()`/`.dropzone()` methods.

**Multi-day block splitting:** Tasks can span multiple days; blocks carry `partIndex`/`totalParts`. Grab-offset logic differs: single blocks use pixel offset (`grabOffsetPx`), split blocks use time offset (`grabOffsetMinutes`) with `retreatWork()`.

**Auto-scheduler:** Greedy packing first, then binary-search local optimization. Uses `estimationMultiplier` (median of elapsed/estimated ratios from completed tasks, prior 1.2× until 5 observations) to scale durations before packing.

**Timer:** Single `activeTimer` state: `{ taskId, startedAt, baseSeconds }`. `startedAt` is `null` when paused. Display = `baseSeconds + (now - startedAt)`. Written to `task.elapsedSeconds` on pause/stop.

**Problemness model:** Piecewise-linear function with grace, rise window, and plateau. Six presets (e.g. "COB Today", "Few Days"). Deadline-anchored presets compute `riseHours` at creation time and store it as a concrete number. Color is a 6-stop gradient from green → dark red.

**Task list order:** Insertion order is preserved (sorted-by-problemness was reverted — it was disorienting in practice).

**Persistence:** Soft deletes (`isDeleted: true`). Completing a task clears its `scheduledBlocks`. Disabling a work day unschedules blocks on that day. Load includes date field revival and migration from old `timeSessions` format.

### Reference docs

- `SPEC-v3.md` — full technical specification (task model, envelopes, scheduler algorithm, data model)
- `IMPLEMENTATION.md` — deviations from spec and key implementation decisions
- `SCHEDULER-BENCHMARKS.md` — greedy+local-search vs. DP solver benchmarks
