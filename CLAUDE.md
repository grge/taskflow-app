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

TaskFlow is a Svelte 5 SPA (no SvelteKit) that schedules tasks by minimizing accumulated "pressure" — a time-dependent urgency function per task that rises from an `onset` date toward a `peak` date/value. All state lives in localStorage (`taskflow_v2`); there is no backend.

### Layer overview

- **`src/lib/`** — pure logic: `envelope.js` (pressure math: `pAt`, `accumulatedPressure`, `getPressureTier`, `pToColor`), `scheduler.js` (auto-scheduler: greedy + local search), `outlook-scheduler.js` (reorder/bump-forward packing for the Outlook backlog), `scheduling.js` (block placement, multi-day splitting), `calendar.js` (work-day navigation, date formatting), `dnd.js` (drag-and-drop Svelte actions), `persistence.js` (localStorage load/save/migration), `tasks.js` (task factory), `constants.js` (storage key, pressure scale/color stops, default work schedule)
- **`src/stores/`** — Svelte 5 rune-based state: `tasks.svelte.js`, `schedule.svelte.js` (work hours + fixed blocks), `ui.svelte.js` (active tab/modal), `clock.svelte.js` (ticking now/today), `estimation.svelte.js` (learned duration multiplier), `theme.svelte.js` (selected color theme)
- **`src/lib/components/`** — UI: `App.svelte` is the root shell with Plan/Insights/Settings tabs; `TodayPlanner.svelte` is today's vertical timeline; `OutlookSection.svelte` is the future-day backlog with drag-to-reorder; `TaskList.svelte`/`TaskRow.svelte` is the task panel with `PressureSparkline.svelte`; `EnvelopeEditor.svelte` is the drag-to-edit onset/peak chart; `AddTaskModal.svelte`/`AddBlockModal.svelte`/`SettingsModal.svelte`/`InsightsModal.svelte`; `TimerBar.svelte` for active time tracking

### Key conventions

**Svelte 5 state exports:** Svelte 5 forbids exporting reassignable `$state` from `.svelte.js` modules. All stores export objects with `get value()` accessors. The persistence `$effect` must run inside a component (done via `initPersistence()` called in `App.svelte`).

**Drag-and-drop:** Uses `document.elementsFromPoint()` instead of Interact.js dropzones (more reliable for overlapping/scrolling). Preview blocks render in `previewBlock` (UI store) without touching `scheduledBlocks`. Use `interactjs` (not `@interactjs/interact`) for `.draggable()`/`.dropzone()` methods.

**Multi-day block splitting:** Tasks can span multiple days; blocks carry `partIndex`/`totalParts`. Grab-offset logic differs: single blocks use pixel offset (`grabOffsetPx`), split blocks use time offset (`grabOffsetMinutes`) with `retreatWork()`.

**Auto-scheduler:** Greedy packing first, then binary-search local optimization. Uses `estimationMultiplier` (median of elapsed/estimated ratios from completed tasks, prior 1.2× until 5 observations) to scale durations before packing. The Outlook backlog uses a separate, simpler sequential-packing scheduler (`outlook-scheduler.js`) for reorder/bump-forward, spilling overflow to subsequent work days.

**Timer:** Single `activeTimer` state: `{ taskId, startedAt, baseSeconds }`. `startedAt` is `null` when paused. Display = `baseSeconds + (now - startedAt)`. Written to `task.elapsedSeconds` on pause/stop.

**Pressure model:** Each task has `onset`, `peak` (Dates) and `peakPressure` (0–1). `pAt()` rises via a smoothstep curve from 0 at onset to `peakPressure` at peak, then holds flat. Five tiers (Low/Building/Elevated/High/Critical) and a matching 6-stop color gradient (green → dark red) are defined in `constants.js` (`PRESSURE_SCALE`, `ENVELOPE_COLOR_STOPS`). `EnvelopeEditor.svelte` lets onset/peak/peakPressure be dragged directly on a 7-day chart — there are no presets.

**Task list order:** Insertion order is preserved (sorted-by-pressure was reverted — it was disorienting in practice).

**Theming:** `theme.svelte.js` stores the selected theme name (`warm-parchment` default, plus `sage-morning`, `ember-night`, `dusk`) in localStorage under `taskflow_theme` and sets `data-theme` on `<html>`; `themes.css` defines the CSS variables per theme. Selected from `SettingsModal.svelte`.

**Persistence:** Soft deletes (`isDeleted: true`). Completing a task clears its `scheduledBlocks`. Disabling a work day unschedules blocks on that day. Load includes date field revival and migration from old `timeSessions` format.
