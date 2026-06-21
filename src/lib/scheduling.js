import { toISODate, getDaySchedule } from './calendar.js';
import { SNAP_MINUTES } from './constants.js';

export function createScheduledBlock(taskId, date, startMinutes, durationMinutes, opts = {}) {
  return {
    id: crypto.randomUUID(),
    taskId,
    date: typeof date === 'string' ? date : toISODate(date),
    startMinutes,
    durationMinutes,
    ...opts
  };
}

/**
 * Split a task across consecutive work days starting at dropDate/startMinutes.
 * visibleDays is the array from getVisibleWorkDays (ordered, no gaps).
 *
 * Returns null if:
 *   - the drop date isn't in visibleDays
 *   - the total available work minutes from drop point to end of window < task duration
 * In the null case the caller should find the latest valid start and retry, or give up.
 *
 * Returns an array of 1..N ScheduledBlock objects otherwise.
 */
export function splitTaskAcrossDays(taskId, dropDate, startMinutes, durationMinutes, visibleDays) {
  // Find the index of the drop day in the visible window.
  const dropIdx = visibleDays.findIndex(d => toISODate(d.date) === dropDate);
  if (dropIdx === -1) return null;

  const blocks = [];
  let remaining = durationMinutes;
  let dayIdx = dropIdx;
  let currentStart = startMinutes;

  while (remaining > 0) {
    if (dayIdx >= visibleDays.length) return null; // ran out of visible days

    const { date, daySchedule } = visibleDays[dayIdx];
    const availableToday = daySchedule.endMinutes - currentStart;

    if (availableToday <= 0) {
      // Drop point is at or past end of this day — shouldn't happen on first iteration
      // if the cell grid is correct, but guard anyway.
      return null;
    }

    const consume = Math.min(remaining, availableToday);
    blocks.push(createScheduledBlock(taskId, toISODate(date), currentStart, consume));

    remaining -= consume;
    dayIdx++;
    // Next day starts at that day's work start
    if (dayIdx < visibleDays.length) {
      currentStart = visibleDays[dayIdx].daySchedule.startMinutes;
    }
  }

  // Annotate partIndex/totalParts only when split across multiple days.
  if (blocks.length > 1) {
    blocks.forEach((b, i) => {
      b.partIndex = i + 1;
      b.totalParts = blocks.length;
    });
  }

  return blocks;
}

/**
 * Find the latest drop position (dropDate, startMinutes) within visibleDays such that
 * the task fits. Returns { date, startMinutes } or null if it can't fit anywhere.
 */
export function latestValidDropPosition(durationMinutes, visibleDays) {
  // Walk backwards from the last day to find the latest start that still fits.
  for (let i = visibleDays.length - 1; i >= 0; i--) {
    // Try each 15-min slot from end-of-day backwards on day i.
    const { date, daySchedule } = visibleDays[i];
    const dateStr = toISODate(date);
    for (let start = daySchedule.endMinutes - SNAP_MINUTES; start >= daySchedule.startMinutes; start -= SNAP_MINUTES) {
      const blocks = splitTaskAcrossDays(null, dateStr, start, durationMinutes, visibleDays);
      if (blocks !== null) return { date: dateStr, startMinutes: start };
    }
  }
  return null; // task doesn't fit anywhere in the window
}

export function placeBlockOnTask(task, blocks) {
  const arr = Array.isArray(blocks) ? blocks : [blocks];
  return { ...task, scheduledBlocks: arr, lastModifiedAt: new Date() };
}

export function removeBlocksForTask(task) {
  return { ...task, scheduledBlocks: [], lastModifiedAt: new Date() };
}

export function findOverlapsOnDay(blocks, dateStr) {
  const dayBlocks = blocks.filter(b => b.date === dateStr);
  // Sort by start time
  const sorted = [...dayBlocks].sort((a, b) => a.startMinutes - b.startMinutes);

  // Assign zIndex/offset by detecting overlaps
  const result = sorted.map(b => ({ ...b, zIndex: 0, overlapOffset: 0 }));

  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i];
      const bk = result[j];
      const overlaps =
        a.startMinutes < bk.startMinutes + bk.durationMinutes &&
        bk.startMinutes < a.startMinutes + a.durationMinutes;
      if (overlaps) {
        result[j].zIndex = result[i].zIndex + 1;
        result[j].overlapOffset = result[j].zIndex * 10;
      }
    }
  }

  return result;
}

export function blockCoversTime(block, time) {
  const blockDate = toISODate(time);
  if (block.date !== blockDate) return false;
  const timeMinutes = time.getHours() * 60 + time.getMinutes();
  return timeMinutes >= block.startMinutes && timeMinutes < block.startMinutes + block.durationMinutes;
}
