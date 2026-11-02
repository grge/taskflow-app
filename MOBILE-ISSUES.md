# Mobile mode — issues list

Follow-up to `LAUNCH-REVIEW.md` (2026-08-24), after Phases 1–5 (touch foundations →
touch drag semantics).

Method: read the responsive CSS across all components, built the app, and drove the
production build with Playwright at 320 / 360 / 390 / 768 / 1024 wide plus 844×390
landscape — measuring element rects against the viewport, tap-target sizes, and
main-thread block time. Screenshots at 390×844 for each pane.

## What the mobile work already fixed

Worth stating, because the review's blocker #1 is largely done:

- Three-panel stack is gone below 760px; `MobileNav` switches Tasks / Today / Upcoming.
- A separate 760–1099px mode toggles Today/Upcoming for split-screen laptops.
- `touch-action: pan-y` on every draggable surface, `liftGate` dwell before drag.
- Coarse-pointer tap-target growth via the `::after` inset overlay.
- Hover-only affordances (`.reveal-btn`, play button) forced visible under `hover: none`.
- The Outlook empty-state hint swaps its wording for touch.
- Bottom safe-area inset handled, and correctly handed off between TimerBar and MobileNav.
- Builds clean, zero console errors on load or pane switching at every viewport tested.

---

## P0 — visibly broken on a phone

### 1. Planner toolbar overflows the viewport; "+ Block" is unreachable

**Fixed 2026-08-28.** `.planner-controls` now wraps (`flex-wrap: wrap`) rather than
clipping, so it adapts wherever it doesn't fit — this also caught **768px tablet**,
where the planner column is only 468px and "+ Block" was clipped 4px off the end,
above the phone breakpoint the original report covered. Below 760px the row stacks:
title on top, actions below, short date dropped. Measured 320/360/390: all three
buttons fully on-screen, zero document overflow.

`TodayPlanner.svelte:272` — `.planner-controls` is a single non-wrapping flex row
(day-nav + "Today" + date label + short date + three buttons) with no phone rules.

Measured at 390px: `.planner-actions` spans **203 → 439px** against a 390px viewport.
The document does not scroll horizontally, so the overflow is simply unreachable.

Concretely, on the Today pane at 390px:
- "+ Block" is entirely offscreen — **no way to add a fixed block on a phone at all**.
- The `›` next-work-day button is clipped mid-glyph.
- "Wed, Aug 26" wraps to two lines and is overlapped by the Auto-schedule button.

At 360px a second button (`Clear`) also crosses the edge. This is the same toolbar
regression the review flagged at 1024×768, never fixed — the phone breakpoint stacked
the panels but left this row alone.

Fix: below 760px, drop `.planner-label`/`.planner-date` to a second line or abbreviate,
and let `.planner-actions` wrap or collapse into an overflow menu.

### 2. Settings and Insights tabs are clipped on the right

**Fixed 2026-08-28.** `min-width: 0` on `.modal` below 760px, plus the same on
`.settings-modal` (420px floor) and `.insights-modal` (500px floor — not in the
original report, same defect). `.theme-grid` goes single-column, `.section-header`
and `.field-row` stack, hours labels narrow to fit. Insights' chart was a fixed
420px SVG that overflowed on its own; it now carries a `viewBox` and scales.
Measured at 320/360/390: no clipped or truncated elements.

`.modal { min-width: 360px }` (`styles/main.css:84`) has no phone override. On the
inline tab path the modal sits inside `.tab-panel { padding: 16px 12px }`, so it needs
360px inside a 366px box — and its internals need more than that:

- `.theme-grid` is a hard `1fr 1fr` (`SettingsModal.svelte:250`): the right column
  ("Sage Morning", "Dusk") is cut off mid-card.
- Every work-hours row truncates its range to "9:00a – 5:0…".
- The "drag the bars · 40h/wk" caption is cut to "40h/".
- The "SCHEDULING" section's controls run past the edge.

The panel clips rather than extending the document, which is why this doesn't show up as
document overflow — but half of Settings is unusable on a phone.

Fix: `min-width: 0` on `.modal` below 760px, and single-column `.theme-grid` there.

### 3. Add/Edit modals overflow below 360px

**Fixed 2026-08-28.** Same `min-width: 0` override, plus `width/max-width: 100%`
and backdrop padding so the modal fits the viewport at 320px. Tall modals now
scroll rather than run off the bottom.

Same `min-width: 360px`. At a 320px viewport the modal measures 360px wide at
`left: -20px` — clipped on both sides, and `width: 90%` never gets a chance to apply.
320px is still a live size (iPhone SE 1st gen, and any phone at 100%+ text zoom).

### 4. Landscape phone falls back to the desktop three-panel layout

**Fixed 2026-08-28.** The phone shell and `MobileNav` are now keyed on
`(max-width: 759px), (max-height: 500px) and (pointer: coarse)` — the second
condition catches a rotated phone without touching a short desktop window, which
is still a mouse. The 760–1099px two-pane rule and `TimerBar`'s safe-area handoff
(the inverse condition) carry the matching exclusion. Verified at 844×390: single
pane, bottom nav present, panels stacked.

Both the phone shell and `MobileNav` are keyed on `max-width: 759px`. Rotate a phone to
844×390 and the bottom nav computes to `display: none`, the panels un-stack, and you get
the full 380px + planner + 260px layout in **390px of height** — with no way to switch
panes, since the nav that replaced the desktop affordances is gone.

Fix: key the phone shell on height as well, or on `(pointer: coarse)`, not width alone.

### 5. No left/right safe-area insets

**Fixed 2026-08-28.** The header takes `safe-area-inset-top` and left/right;
`.plan-layout` and `.tab-panel` take left/right; `MobileNav` adds left/right to the
bottom inset it already had.

`index.html` sets `viewport-fit=cover`, but only `safe-area-inset-bottom` is ever used
(MobileNav, TimerBar). In landscape on a notched phone the notch eats into the header,
the task panel, and the planner gutter. The header also takes no
`safe-area-inset-top`.

---

## P1 — mobile polish

### 6. Tap targets in the toolbar are well under 44px

Measured at 390px, none of these get the coarse-pointer `::after` treatment (it only
covers `.btn-icon` and `.reveal-btn`):

| Control | Measured |
|---|---|
| `‹` / `›` day nav | 22 × 24 |
| "Today" | 51 × 24 |
| "✦ Auto-schedule" | 110 × 26 |
| "Clear" | 52 × 26 |
| "+ Block" | 62 × 26 |
| Header "Insights" / "Settings" | ~70 × 28 |

The `.btn-sm` and `.day-nav-btn` classes need the same coarse-pointer growth
`.schedule-btn` already got in `TaskRow.svelte:930`.

**Fixed 2026-08-28** for the planner toolbar and header tabs — the day-nav buttons,
"Today", the three action buttons and the header's Insights/Settings tabs all
measure ≥40px tall under `pointer: coarse` (verified 36–236 × 40). Done with real
padding rather than the `::after` overlay, since these sit in a flow row where
growing them is free. Untouched elsewhere: any remaining `.btn-sm` outside the
planner toolbar.

### 7. Task titles truncate at ~24 characters

At 390px the task row still carries the desktop's chip, `✦`, `▶`, and duration controls,
leaving the title about 190px: "Draft the quarterly b…", "Fix the onboarding e…". The
title is the only thing that identifies the task. Consider dropping the duration chip to
a second line on phone.

### 8. `▶` disclosure and `✦` schedule sit adjacent at glyph size

Two ~14px glyphs about 60px apart, doing very different things (expand vs. immediately
schedule). Mis-taps here are destructive-ish — `✦` schedules with no confirmation. The
`Undo` link mitigates it, but the spacing should grow under `pointer: coarse`.

### 9. Empty timeline leaves a large dead area

On the Today pane the grid ends at 5pm and roughly 450px of empty panel sits below it
before the bottom nav. The planner body should flex to fill.

**Fixed 2026-08-28.** `.today-planner` and `.planner-body` now flex to fill the
panel; dead space below the grid is 17px (the panel's own padding), down from ~450.

Worth noting for anyone touching this: the first attempt (`flex: 1; min-height: 0`)
desynced the time gutter from the timeline card in landscape — the card held its
`min-height: 420px` while the gutter stretched only to the 190px container, so every
hour label pointed at the wrong line. `flex: 1 0 auto` with `align-items: stretch`
sizes both children to the taller one. Card and gutter heights now match at every
viewport tested.

---

## Carried over from LAUNCH-REVIEW — still open

Re-verified against current `master`. Items 10 and 11 have since moved — see the notes
on each.

### 10. Auto-schedule still freezes the tab, with no feedback

*Under active work — see [`SCHEDULER-DIRECTIONS.md`](SCHEDULER-DIRECTIONS.md). The
button still needs its pending state regardless of how fast the scheduler gets.*

No iteration cap, no busy state, no worker (`scheduler.js:98–213`). Re-measured on the
phone viewport: **25 tasks blocks the main thread 1,886 ms**. There is no `disabled`
attribute and no "Scheduling…" state anywhere. On a phone this reads as a crashed tab
more readily than on desktop.

Minimum: disable the button and show a pending state. Real fix: cap the Phase 3 local
search, which is the superlinear part.

### 11. Four `console.log` calls ship in the production bundle

~~`scheduler.js:107,149,153,212`~~ — **fixed 2026-08-27**, removed alongside the
scheduler investigation.

### 12. Empty state points at a button that doesn't exist

`TaskList.svelte:124` still says *"Click **+ Add Task** to get started"*; the control is
a bare `＋`. Still no explanation of the pressure model anywhere in the UI.

### 13. No favicon, OG tags, or meta description

`index.html` has `<title>TaskFlow</title>` and nothing else. Every share renders blank.

### 14. No export/import

Still localStorage-only, no serialization path.

### 15. Accessibility

Still only two `:focus` rules in the codebase (`main.css:257–258`), both on form inputs.
No visible focus ring on any button, tab, or nav item.

---

## Suggested order

~~**Before anyone sees this on a phone:** 1, 2, 3~~ — **done 2026-08-28**, along with
4, 5 (shell correctness), 6 (toolbar and header tap targets) and 9 (timeline fill).

**Remaining:**

- **10's pending-state button** — cheap, and independent of the scheduler rewrite
  tracked in `SCHEDULER-DIRECTIONS.md`.
- **7, 8** — task-row polish (title truncation, `▶`/`✦` spacing). Both live in
  `TaskRow.svelte` and were left alone in this pass.
- **12–15** — carried-over launch items (empty-state copy, favicon/meta,
  export/import, focus rings).

Verification for the fixed items: production build driven with Playwright at
320×568, 360×800, 390×844, 844×390, 768×1024, 1024×768 and 1440×900, measuring
element rects against the viewport, panel scroll overflow, and truncation.
Desktop and laptop metrics are unchanged from before the pass.
