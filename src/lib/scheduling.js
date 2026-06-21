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

// Assigns each item a lane (0-indexed horizontal slot) and laneCount (how many
// lanes wide its overlap cluster is), so overlapping items render side-by-side
// at width 1/laneCount instead of one fully occluding another. Works on any
// mixed-type array of {startMinutes, durationMinutes} items.
export function layoutOverlapsOnDay(items, dateStr) {
  const dayItems = items.filter(b => b.date === dateStr);
  const sorted = [...dayItems].sort((a, b) => a.startMinutes - b.startMinutes);
  const result = sorted.map(b => ({ ...b, lane: 0, laneCount: 1 }));

  const laneEnds = []; // end time of the last item placed in each lane, for the active cluster
  let clusterMembers = [];

  function closeCluster() {
    const laneCount = laneEnds.length;
    if (laneCount > 1) {
      for (const item of clusterMembers) item.laneCount = laneCount;
    }
    laneEnds.length = 0;
    clusterMembers = [];
  }

  let clusterEnd = -1; // max end time among items placed so far in the active cluster
  for (const item of result) {
    if (clusterMembers.length && item.startMinutes >= clusterEnd) closeCluster();

    let lane = laneEnds.findIndex(endTime => item.startMinutes >= endTime);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = item.startMinutes + item.durationMinutes;
    item.lane = lane;
    clusterMembers.push(item);
    clusterEnd = Math.max(clusterEnd, item.startMinutes + item.durationMinutes);
  }
  closeCluster();

  return result;
}

export function blockCoversTime(block, time) {
  const blockDate = toISODate(time);
  if (block.date !== blockDate) return false;
  const timeMinutes = time.getHours() * 60 + time.getMinutes();
  return timeMinutes >= block.startMinutes && timeMinutes < block.startMinutes + block.durationMinutes;
}
