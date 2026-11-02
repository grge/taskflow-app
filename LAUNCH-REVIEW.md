# TaskFlow — Pre-Launch UX/UI Review

Prepared 2026-08-24, ahead of a Show HN / public launch.

Method: read the full source (~7,000 lines), built the app, and drove it with Playwright
across six viewports (390 → 1440px) — empty state, populated state, auto-scheduled state,
Insights, Settings — plus a 40-task stress test with main-thread timing.

---

## Headline

The craft here is real. The Warm Parchment palette, Hanken Grotesk, the pressure-colored
spines on scheduled blocks, "Critical · peaks today" as a phrase, the work-hours drag
editor — this looks and reads better than most Show HN submissions. The scheduler works:
five tasks, one click of Auto-schedule, and it packed the day sensibly and spilled the
overflow to Wednesday. Builds clean at 73KB gzipped, zero console errors in normal use.

The problem isn't quality. It's that **three specific things will cost the launch**, and
all three are fixable in a day or two.

---

## The three blockers

### 1. Mobile is not degraded — it's broken

There are **zero `@media` queries** in the entire codebase. The layout is a fixed
`380px` task panel + flex planner + fixed `260px` outlook panel (`src/App.svelte:177,197`).

At 390px wide, the task panel consumes the entire viewport. The planner and the Outlook
backlog — the actual product — are pushed offscreen with no way to reach them. The header
counter clips mid-word ("5 tota / unsch").

Show HN gets very heavy phone traffic. A large share of visitors will see a task list that
appears to do nothing, and bounce.

This also breaks well above phone size: at **1024×768** (a common laptop) the toolbar
degrades — "Mon, Aug 24" wraps to two lines and the "+ Block" button is squeezed out of
the toolbar entirely.

The cheap fix is not a mobile redesign. It's a `@media (max-width: 900px)` rule that stacks
the three panels and switches between them. Roughly a day's work.

### 2. Auto-schedule freezes the tab, and degrades fast

The scheduler runs synchronously on the main thread. Measured block time:

| Tasks | Main thread blocked |
|-------|--------------------|
| 10    | 116 ms             |
| 20    | 443 ms             |
| 30    | 1,670 ms           |
| 40    | **5,757 ms**       |

That is roughly 4× per additional 10 tasks. At 40 tasks — a very plausible backlog — the
tab is dead for about six seconds with no spinner, no disabled button, and no feedback of
any kind. It reads as a crash, not as work.

- **Minimum viable fix:** disable the button and show a "Scheduling…" state so the pause
  reads as work in progress.
- **Real fix:** cap the local-search iterations, or move the optimizer to a Web Worker.

> **Update 2026-08-27 — see [`SCHEDULER-DIRECTIONS.md`](SCHEDULER-DIRECTIONS.md).**
> Both "real fix" options above were tested and neither is right. Capping the local
> search is 80x faster but costs 30–40% schedule quality; a Web Worker hides an O(n⁴)
> computation without making it finish.
>
> The root cause turned out to be deeper than complexity: **pressure is defined on the
> calendar axis while scheduling happens on the workable-time axis.** 64 pressure-hours
> accrue over a weekend in which no work was possible, and displacing the same 60 minutes
> of work costs 8x more across a weekend than mid-week. A prototype putting the search
> and the objective on one work-time axis (a 21-entry lookup table; `envelope.js`
> unchanged) is **16x faster and reproduces the exact optimum when given the right
> order**. `scheduler.js` and its neighbours are heading for a rewrite rather than a
> patch — the linked note carries the validated design, the measurements, and the
> ruled-out approaches.
>
> Already fixed on the way: `scripts/benchmark.js` now runs again (it is the regression
> oracle), the placement horizon is unified, an outlook drag can no longer silently
> destroy a task's schedule, and the four `console.log` calls below are gone.
>
> The timings in the table above were measured through the browser and include Svelte
> re-render; the scheduler alone is ~470ms at 25 tasks, roughly 4x less than shown.

### 3. The first-run experience explains nothing

The empty state is three blank panels and an empty grid.

It says *"Click **+ Add Task** to get started"* — but there is no "+ Add Task" button
anywhere in the UI. The actual control is a bare `＋` icon (`TaskList.svelte`).

More importantly, nothing on screen explains what "pressure" is — the single idea the
entire app is built on, and the whole differentiation for an HN audience. That pitch
currently exists only in the README.

Fix: seed two or three demo tasks on first load, and/or put one sentence explaining the
pressure model into the empty state.

---

## Smaller items worth fixing before posting

- **Insights and Settings render modal chrome as tabs.** Both show a stray `×` close button
  and a "Done" button that do nothing meaningful when rendered as full tabs. Visible on
  first click, and reads as unfinished.

- **The envelope editor is nearly undiscoverable.** The single most distinctive feature is
  hidden behind a hover-only `▶` disclosure. Clicking the task title does not open it. Most
  visitors will never find it. Expand the first task card by default.

- ~~**Four `console.log` calls ship in the production bundle** —
  `src/lib/scheduler.js:107,149,153,212`. HN readers open devtools.~~ *Fixed 2026-08-27.*

- **No export/import.** All state is localStorage-only. One cache clear and everything is
  gone — and the app is asking strangers to trust it with their planning. A JSON export
  button is ~20 lines and buys real credibility.

- **No favicon, no OG tags, no meta description** (`index.html`). Every HN and social share
  renders as a blank-square link with no preview.

- **Accessibility is thin.** Only two `:focus` rules exist in the codebase. Tab order starts
  inside the task list and skips the header nav entirely, and the first focusable elements
  are unlabeled `▶` / `✓` glyph buttons. Not a launch blocker, but it will draw comments.

### Credit where due

Destructive actions are handled well: "Reset all data" sits behind a `confirm()`, and task
deletion is a soft delete (`isDeleted: true`). The theme system, the work-hours bar editor,
and the pressure-tier phrasing are genuinely strong.

---

## Recommended plan

**If there is only one day:**

1. Responsive breakpoint (stack panels below ~900px)
2. Auto-schedule loading / disabled state
3. First-run demo tasks + one-sentence pressure explanation
4. Favicon, OG tags, meta description

These four are the difference between "this is broken" and "this is nice."

**If there are two days, add:**

5. JSON export/import — note this also unblocks `scripts/benchmark.js`, which loads real
   task data from an export (see [`SCHEDULER-DIRECTIONS.md`](SCHEDULER-DIRECTIONS.md) §7)
6. Expand the first task card by default
7. ~~Strip the four `console.log` calls~~ — done 2026-08-27
8. Remove the modal chrome (`×` / "Done") from the Insights and Settings tabs

---

The product is stronger than its first thirty seconds currently suggest — and on Show HN,
the first thirty seconds are the entire review.
