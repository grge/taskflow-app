// Pure placement math for drag-and-drop. No DOM access and no store mutation:
// callers pass descriptors read from the hit-test layer plus current schedule /
// tasks, and get back the blocks or insertion point that a drop would produce.
// This is the domain logic that used to live inline in the drag actions.

import { splitTaskAcrossDays } from './scheduling.js';
import { schedulableMinutes } from './tasks.js';
import { getVisibleWorkDays, retreatWork, toISODate, getDaySchedule, parseLocalDate } from './calendar.js';
import { SNAP_MINUTES, SCHEDULING_HORIZON_DAYS } from './constants.js';

// ─── Today-planner placement ─────────────────────────────────────────────────

// Walk back grabOffsetMinutes of work-time from a pointer cell to find where the
// task should start. `cell` is { date, start } (start = minutes-into-day).
// Returns { date, startMinutes } or null.
function resolveTaskStart(cell, grabOffsetMinutes, schedule) {
  const pointerDate = parseLocalDate(cell.date);
  pointerDate.setMinutes(cell.start);

  const taskStart = retreatWork(pointerDate, grabOffsetMinutes, schedule);
  const totalMinutes = taskStart.getHours() * 60 + taskStart.getMinutes();
  const snapped = Math.round(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;

  const day = getDaySchedule(taskStart, schedule);
  if (!day) return null;

  const clampedStart = Math.max(day.startMinutes, Math.min(snapped, day.endMinutes - SNAP_MINUTES));
  return { date: toISODate(taskStart), startMinutes: clampedStart };
}

// Compute the ScheduledBlock[] a task would occupy if dropped at `cell`
// (Today-planner slot). `cell` is { date, start }. Returns blocks or null.
export function computeBlocksForCell(task, cell, grabOffsetMinutes, schedule) {
  const visibleDays = getVisibleWorkDays(schedule, SCHEDULING_HORIZON_DAYS);

  const taskStart = grabOffsetMinutes > 0
    ? resolveTaskStart(cell, grabOffsetMinutes, schedule)
    : { date: cell.date, startMinutes: cell.start };

  if (!taskStart) return null;

  const rem = schedulableMinutes(task);
  let blocks = splitTaskAcrossDays(task.id, taskStart.date, taskStart.startMinutes, rem, visibleDays);
  if (blocks === null) {
    // taskStart resolved before the visible window (grab offset retreated past
    // today's start) — clamp to the earliest available slot, not the latest.
    const first = visibleDays[0];
    if (first && taskStart.date < toISODate(first.date)) {
      blocks = splitTaskAcrossDays(task.id, toISODate(first.date), first.daySchedule.startMinutes, rem, visibleDays);
    }
  }
  return blocks;
}

// ─── fixed-block placement ───────────────────────────────────────────────────

// Fixed blocks live on a single day and never split. `cell` is { date, start }.
// Returns { date, startMinutes } snapped and clamped to the work day, or null.
export function resolveFixedBlockDrop(cell, grabOffsetMinutes, durationMinutes, schedule) {
  const daySchedule = getDaySchedule(parseLocalDate(cell.date), schedule);
  if (!daySchedule) return null;

  const rawStart = cell.start - grabOffsetMinutes;
  const snapped = Math.round(rawStart / SNAP_MINUTES) * SNAP_MINUTES;
  const clamped = Math.max(daySchedule.startMinutes, Math.min(snapped, daySchedule.endMinutes - durationMinutes));
  return { date: cell.date, startMinutes: clamped };
}

// ─── outlook insertion point ─────────────────────────────────────────────────

// Decide where a dragged card should insert within an outlook day.
//
//   target    — { dateStr, hoveredId, pos } from the hit-test layer, where
//               `hoveredId`/`pos` describe the card under the pointer (pos is
//               'before' | 'after' its midpoint), or hoveredId === null for the
//               empty area of the day (append at end). `overGhost` is true
//               when the pointer is on the insertion ghost.
//   idsInDay  — task IDs currently rendered in that day, in order.
//   current   — the last committed drop { dateStr, insertBeforeTaskId } | null,
//               kept while the pointer is on the ghost.
//   source    — { dateStr, taskId } describing the dragged card's own day, so
//               same-day no-op reorders can be suppressed. Pass null when the
//               drag has no home day (task chip / timeline block).
//
// Returns one of:
//   { action: 'keep' }               — pointer on the ghost; no change
//   { action: 'clear' }              — no meaningful insertion (same-day no-op)
//   { action: 'set', insertBeforeTaskId }
export function computeOutlookInsertion(target, idsInDay, current, source = null) {
  const { dateStr, hoveredId, pos, overGhost } = target;

  // On the ghost itself: keep the insertion it stands for. The ghost is drawn
  // where the pointer is, so without this the pointer landing on it read as
  // the empty area of the day and flipped the preview to "append".
  if (overGhost && current?.dateStr === dateStr) return { action: 'keep' };

  // Empty day area — append at end (or no-op if already alone on our own day).
  if (hoveredId === null) {
    if (source && dateStr === source.dateStr) return { action: 'clear' };
    return { action: 'set', insertBeforeTaskId: null };
  }

  // No neighbour hysteresis. Inserting the ghost shifts the cards beside it,
  // which used to flip the pointer across a card's midpoint and back; the
  // overGhost check above is what breaks that loop now, because once the ghost
  // moves under the pointer the pointer is on the ghost and the decision holds.
  // The old rule held the decision while hovering either neighbour card, on
  // either half, which made "before the first card" unreachable on any day the
  // pointer entered through its header.

  const targetIdx = idsInDay.indexOf(hoveredId);
  const insertBeforeTaskId = pos === 'before'
    ? (idsInDay[targetIdx] ?? null)
    : (idsInDay[targetIdx + 1] ?? null);

  // Suppress no-op for same-day reorders (dropping back into own slot).
  if (source && dateStr === source.dateStr) {
    const myIdx   = idsInDay.indexOf(source.taskId);
    const afterMe = idsInDay[myIdx + 1] ?? null;
    if (insertBeforeTaskId === source.taskId || insertBeforeTaskId === afterMe) {
      return { action: 'clear' };
    }
  }

  return { action: 'set', insertBeforeTaskId };
}
