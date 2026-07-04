import { accumulatedPressure } from './envelope.js';
import { advanceWork, getVisibleWorkDays, parseLocalDate } from './calendar.js';
import { splitTaskAcrossDays, computeFreeIntervals } from './scheduling.js';
import { schedulableMinutes } from './tasks.js';

// ─── packSequence ────────────────────────────────────────────────────────────

// Place tasks in sequence into the schedule. Manual blocks carve the work
// window into free intervals; each task must fit entirely within a single
// contiguous run of free intervals starting from the current cursor position.
// Intervals too small to fit the task are skipped entirely — never partially
// filled.
//
// Returns an array of ScheduledBlock objects, or null if any task in the
// sequence doesn't fit in the remaining window.
export function packSequence(sequence, schedule, manualBlocks = [], fixedBlocks = []) {
  const allBlocking = [...manualBlocks, ...fixedBlocks];
  const bufferMinutes = schedule.bufferMinutes ?? 0;
  const visibleDays = getVisibleWorkDays(schedule, 7);
  if (!visibleDays.length) return [];

  const result = [];
  let cursorDate = new Date();

  for (let taskIndex = 0; taskIndex < sequence.length; taskIndex++) {
    const task = sequence[taskIndex];
    const isLast = taskIndex === sequence.length - 1;
    const intervals = computeFreeIntervals(visibleDays, allBlocking, cursorDate, bufferMinutes);

    // We try each interval's start in order. splitTaskAcrossDays handles
    // multi-day splits at end-of-day; we additionally check that all blocks
    // fit within free intervals (i.e. don't cross manual block exclusion zones).
    let placed = false;

    for (let i = 0; i < intervals.length; i++) {
      const iv = intervals[i];
      const blocks = splitTaskAcrossDays(
        task.id, iv.date, iv.startMinutes, schedulableMinutes(task), visibleDays
      );
      if (blocks === null) return null; // doesn't fit in window at all

      // Check every block falls within a free interval.
      const fits = blocks.every(b =>
        intervals.some(fiv =>
          fiv.date === b.date &&
          fiv.startMinutes <= b.startMinutes &&
          fiv.endMinutes >= b.startMinutes + b.durationMinutes
        )
      );

      if (fits) {
        result.push(...blocks);
        // Advance cursor to end of last placed block, plus inter-task buffer
        // (skip buffer after the last task).
        const last = blocks[blocks.length - 1];
        cursorDate = parseLocalDate(last.date);
        cursorDate.setMinutes(last.startMinutes + last.durationMinutes + (isLast ? 0 : bufferMinutes));
        placed = true;
        break;
      }
    }

    if (!placed) return null; // no gap large enough for this task
  }

  return result;
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
    const completionTime = parseLocalDate(last.date);
    completionTime.setMinutes(last.startMinutes + last.durationMinutes);
    cost += accumulatedPressure(task, completionTime);
  }
  return cost;
}

// ─── greedyScore ─────────────────────────────────────────────────────────────

function greedyScore(task, currentWorkTime, schedule) {
  const rem = schedulableMinutes(task);
  const completionTime = advanceWork(currentWorkTime, rem, schedule);
  const nowCost = accumulatedPressure(task, currentWorkTime);
  const completeCost = accumulatedPressure(task, completionTime);
  return (completeCost - nowCost) / (rem / 60);
}

// ─── autoSchedule ────────────────────────────────────────────────────────────

export function autoSchedule(allTasks, schedule, fixedBlocks = []) {
  const manualBlocks = allTasks
    .filter(t => t.scheduledBlocks.length > 0)
    .flatMap(t => t.scheduledBlocks);

  const unscheduled = allTasks
    .filter(t => !t.isCompleted && !t.isDeleted && !t.isLocked && t.scheduledBlocks.length === 0);

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
    currentTime = advanceWork(currentTime, schedulableMinutes(bestTask), schedule);
  }

  // ── Phase 2: pack and check window capacity ──────────────────────────────────
  let blocks = packSequence(sequence, schedule, manualBlocks, fixedBlocks);

  if (blocks === null) {
    // Some tasks don't fit. Binary-search for the longest prefix that does fit,
    // leaving the rest unscheduled.
    let lo = 0, hi = sequence.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (packSequence(sequence.slice(0, mid), schedule, manualBlocks, fixedBlocks) !== null) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    blocks = lo > 0 ? packSequence(sequence.slice(0, lo), schedule, manualBlocks, fixedBlocks) : [];
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
      const newBlocks = packSequence(schedulable, schedule, manualBlocks, fixedBlocks);
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
        const newBlocks = packSequence(schedulable, schedule, manualBlocks, fixedBlocks);
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
        blocks = packSequence(schedulable, schedule, manualBlocks, fixedBlocks);
        cost = bestCost;
        improved = true;
        break;
      }
    }
  }

  console.log(`[autoSchedule] final cost: ${cost.toFixed(4)}`);
  return blocks;
}
