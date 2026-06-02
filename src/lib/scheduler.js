import { accumulatedProblemness } from './envelope.js';
import { advanceWork, getVisibleWorkDays, toISODate } from './calendar.js';
import { splitTaskAcrossDays } from './scheduling.js';

// ─── free interval computation ───────────────────────────────────────────────

// A free interval is a contiguous stretch of work time unoccupied by manual
// blocks. Represented as { date, startMinutes, endMinutes } — always within a
// single work day (intervals do not span day boundaries).
function computeFreeIntervals(visibleDays, manualBlocks, fromDate) {
  const fromStr = toISODate(fromDate);
  const fromMinutes = fromDate.getHours() * 60 + fromDate.getMinutes();
  const intervals = [];

  for (const { date, daySchedule } of visibleDays) {
    const dateStr = toISODate(date);

    // Skip days entirely before `from`.
    if (dateStr < fromStr) continue;

    // Manual blocks on this day, sorted by start time.
    const dayBlocks = manualBlocks
      .filter(b => b.date === dateStr)
      .sort((a, b) => a.startMinutes - b.startMinutes);

    // Work period start, clamped to `from` if this is the first day.
    let cursor = dateStr === fromStr
      ? Math.max(daySchedule.startMinutes, fromMinutes)
      : daySchedule.startMinutes;

    for (const block of dayBlocks) {
      if (block.startMinutes > cursor) {
        intervals.push({ date: dateStr, startMinutes: cursor, endMinutes: block.startMinutes });
      }
      cursor = Math.max(cursor, block.startMinutes + block.durationMinutes);
    }

    if (cursor < daySchedule.endMinutes) {
      intervals.push({ date: dateStr, startMinutes: cursor, endMinutes: daySchedule.endMinutes });
    }
  }

  return intervals;
}

// ─── packSequence ────────────────────────────────────────────────────────────

// Place tasks in sequence into the schedule. Manual blocks carve the work
// window into free intervals; each task must fit entirely within a single
// contiguous run of free intervals starting from the current cursor position.
// Intervals too small to fit the task are skipped entirely — never partially
// filled.
//
// Returns an array of ScheduledBlock objects, or null if any task in the
// sequence doesn't fit in the remaining window.
export function packSequence(sequence, schedule, manualBlocks = []) {
  const visibleDays = getVisibleWorkDays(schedule, 7);
  if (!visibleDays.length) return [];

  const result = [];
  let cursorDate = new Date();

  for (const task of sequence) {
    const intervals = computeFreeIntervals(visibleDays, manualBlocks, cursorDate);

    // Find the first interval (or run of consecutive intervals across day
    // boundaries) where the task fits. Because we don't split across manual
    // blocks, we walk intervals looking for a starting point from which
    // splitTaskAcrossDays succeeds — meaning there are enough consecutive
    // free work-minutes from that point to the end of the window without
    // hitting a manual block boundary.
    //
    // We try each interval's start in order. splitTaskAcrossDays already
    // handles multi-day splits at end-of-day; the only new constraint is that
    // we must not cross a manual block. We enforce this by checking that all
    // the blocks produced by splitTaskAcrossDays land within free intervals.
    let placed = false;

    for (let i = 0; i < intervals.length; i++) {
      const iv = intervals[i];
      const blocks = splitTaskAcrossDays(
        task.id, iv.date, iv.startMinutes, task.estimatedMinutes, visibleDays
      );
      if (blocks === null) return null; // doesn't fit in window at all

      // Check every block falls within a free interval (not inside a manual block).
      const fits = blocks.every(b =>
        intervals.some(fiv =>
          fiv.date === b.date &&
          fiv.startMinutes <= b.startMinutes &&
          fiv.endMinutes >= b.startMinutes + b.durationMinutes
        )
      );

      if (fits) {
        result.push(...blocks);
        // Advance cursor to end of last placed block.
        const last = blocks[blocks.length - 1];
        cursorDate = new Date(last.date + 'T00:00:00');
        cursorDate.setMinutes(last.startMinutes + last.durationMinutes);
        placed = true;
        break;
      }
    }

    if (!placed) return null; // no gap large enough for this task
  }

  return result;
}

function blockCoversTime(block, time) {
  const blockDate = toISODate(time);
  if (block.date !== blockDate) return false;
  const timeMinutes = time.getHours() * 60 + time.getMinutes();
  return timeMinutes >= block.startMinutes && timeMinutes < block.startMinutes + block.durationMinutes;
}

// ─── totalCost ───────────────────────────────────────────────────────────────

export function totalCost(blocks, tasks) {
  let cost = 0;
  for (const task of tasks) {
    const taskBlocks = blocks.filter(b => b.taskId === task.id);
    if (!taskBlocks.length) continue;
    const last = taskBlocks.reduce((a, b) =>
      (b.partIndex ?? 1) > (a.partIndex ?? 1) ? b : a
    );
    const completionTime = new Date(last.date + 'T00:00:00');
    completionTime.setMinutes(last.startMinutes + last.durationMinutes);
    cost += accumulatedProblemness(task, completionTime);
  }
  return cost;
}

// ─── greedyScore ─────────────────────────────────────────────────────────────

function greedyScore(task, currentWorkTime, schedule) {
  const completionTime = advanceWork(currentWorkTime, task.estimatedMinutes, schedule);
  const nowCost = accumulatedProblemness(task, currentWorkTime);
  const completeCost = accumulatedProblemness(task, completionTime);
  return (completeCost - nowCost) / (task.estimatedMinutes / 60);
}

// ─── autoSchedule ────────────────────────────────────────────────────────────

export function autoSchedule(allTasks, schedule) {
  const manualBlocks = allTasks
    .filter(t => t.scheduledBlocks.length > 0)
    .flatMap(t => t.scheduledBlocks);

  const unscheduled = allTasks.filter(
    t => !t.isCompleted && !t.isDeleted && t.scheduledBlocks.length === 0
  );

  if (!unscheduled.length) {
    console.log('[autoSchedule] nothing to schedule');
    return [];
  }

  // ── Phase 1: greedy initial ordering ────────────────────────────────────────
  const sequence = [];
  const remaining = [...unscheduled];
  let currentTime = new Date();

  while (remaining.length > 0) {
    let bestTask = null;
    let bestScore = -Infinity;

    for (const task of remaining) {
      const score = greedyScore(task, currentTime, schedule);
      if (score > bestScore) {
        bestScore = score;
        bestTask = task;
      }
    }

    sequence.push(bestTask);
    remaining.splice(remaining.indexOf(bestTask), 1);
    currentTime = advanceWork(currentTime, bestTask.estimatedMinutes, schedule);
  }

  // ── Phase 2: pack and check window capacity ──────────────────────────────────
  let blocks = packSequence(sequence, schedule, manualBlocks);

  if (blocks === null) {
    // Some tasks don't fit. Binary-search for the longest prefix that does fit,
    // leaving the rest unscheduled.
    let lo = 0, hi = sequence.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (packSequence(sequence.slice(0, mid), schedule, manualBlocks) !== null) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    blocks = lo > 0 ? packSequence(sequence.slice(0, lo), schedule, manualBlocks) : [];
    console.log(`[autoSchedule] window full: scheduled ${lo}/${sequence.length} tasks`);
  }

  let cost = totalCost(blocks, sequence);
  console.log(`[autoSchedule] greedy cost: ${cost.toFixed(4)}`);

  // ── Phase 3: local search ────────────────────────────────────────────────────
  // Operate only on the schedulable prefix.
  const schedulable = sequence.slice(0, blocks.length > 0
    ? new Set(blocks.map(b => b.taskId)).size
    : 0);

  let improved = true;
  while (improved) {
    improved = false;

    // Phase A: adjacent swaps
    for (let i = 0; i < schedulable.length - 1; i++) {
      [schedulable[i], schedulable[i + 1]] = [schedulable[i + 1], schedulable[i]];
      const newBlocks = packSequence(schedulable, schedule, manualBlocks);
      if (newBlocks !== null) {
        const newCost = totalCost(newBlocks, schedulable);
        if (newCost < cost) {
          blocks = newBlocks;
          cost = newCost;
          improved = true;
          break;
        }
      }
      [schedulable[i], schedulable[i + 1]] = [schedulable[i + 1], schedulable[i]]; // revert
    }

    if (improved) continue;

    // Phase B: insertion moves
    for (let i = 0; i < schedulable.length; i++) {
      const task = schedulable.splice(i, 1)[0];
      let bestPos = i;
      let bestCost = cost;

      for (let j = 0; j <= schedulable.length; j++) {
        schedulable.splice(j, 0, task);
        const newBlocks = packSequence(schedulable, schedule, manualBlocks);
        if (newBlocks !== null) {
          const newCost = totalCost(newBlocks, schedulable);
          if (newCost < bestCost) {
            bestPos = j;
            bestCost = newCost;
          }
        }
        schedulable.splice(j, 1);
      }

      schedulable.splice(bestPos, 0, task);
      if (bestCost < cost) {
        blocks = packSequence(schedulable, schedule, manualBlocks);
        cost = bestCost;
        improved = true;
        break;
      }
    }
  }

  console.log(`[autoSchedule] final cost: ${cost.toFixed(4)}`);
  return blocks;
}
