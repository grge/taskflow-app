// Pure placement math for drag-and-drop. No DOM access and no store mutation:
// callers pass descriptors read from the hit-test layer plus current schedule /
// tasks, and get back the blocks or insertion point that a drop would produce.
// This is the domain logic that used to live inline in the drag actions.

import { splitTaskAcrossDays } from './scheduling.js';
import { schedulableMinutes } from './tasks.js';
import { getVisibleWorkDays, retreatWork, toISODate, getDaySchedule, parseLocalDate } from './calendar.js';
import { SNAP_MINUTES } from './constants.js';

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
  const visibleDays = getVisibleWorkDays(schedule, 7);

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

// ─── outlook insertion point + hysteresis ────────────────────────────────────

// The gap that a given insertBeforeTaskId occupies is bounded by the card just
// before it and the card itself; the pointer is "still in that gap" when the
// hovered card is either neighbour. Shared by the hysteresis check below.
function occupiesSameGap(idsInDay, insertBeforeTaskId, hoveredId) {
  const insertIdx = insertBeforeTaskId === null
    ? idsInDay.length
    : idsInDay.indexOf(insertBeforeTaskId);
  const gapBefore = idsInDay[insertIdx - 1] ?? null;
  const gapAfter  = idsInDay[insertIdx]     ?? null;
  return hoveredId === gapBefore || hoveredId === gapAfter;
}

// Decide where a dragged card should insert within an outlook day.
//
//   target    — { dateStr, hoveredId, pos } from the hit-test layer, where
//               `hoveredId`/`pos` describe the card under the pointer (pos is
//               'before' | 'after' its midpoint), or hoveredId === null for the
//               empty area of the day (append at end).
//   idsInDay  — task IDs currently rendered in that day, in order.
//   current   — the last committed drop { dateStr, insertBeforeTaskId } | null,
//               for hysteresis.
//   source    — { dateStr, taskId } describing the dragged card's own day, so
//               same-day no-op reorders can be suppressed. Pass null when the
//               drag has no home day (task chip / timeline block).
//
// Returns one of:
//   { action: 'keep' }               — pointer still in the same gap; no change
//   { action: 'clear' }              — no meaningful insertion (same-day no-op)
//   { action: 'set', insertBeforeTaskId }
export function computeOutlookInsertion(target, idsInDay, current, source = null) {
  const { dateStr, hoveredId, pos } = target;

  // Empty day area — append at end (or no-op if already alone on our own day).
  if (hoveredId === null) {
    if (source && dateStr === source.dateStr) return { action: 'clear' };
    return { action: 'set', insertBeforeTaskId: null };
  }

  // Hysteresis: if we already have a drop on this same day and the pointer is
  // still within the gap the ghost occupies, don't update — this breaks the
  // ghost-shifts-midpoints-flips-pos feedback loop.
  if (current?.dateStr === dateStr && occupiesSameGap(idsInDay, current.insertBeforeTaskId, hoveredId)) {
    return { action: 'keep' };
  }

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
