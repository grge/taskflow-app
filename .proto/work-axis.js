// PROTOTYPE — work-time axis scheduler. Not wired into the app.
//
// Premise: pressure stays defined on the calendar axis (users author it there),
// but scheduling reasons on a work-minute axis. The bridge is a small lookup
// table built once per schedule: work-minutes-elapsed -> calendar instant.
//
// The point is that BOTH the search and the objective use that same bridge, so
// they cannot disagree. The previous attempt put the search on a flat
// work-minute model while totalCost integrated calendar time, and the two
// diverged hardest exactly where non-work gaps are largest (weekends).

import { accumulatedPressure } from '../src/lib/envelope.js';
import { getVisibleWorkDays, toISODate } from '../src/lib/calendar.js';
import { schedulableMinutes } from '../src/lib/tasks.js';

// ─── the axis ────────────────────────────────────────────────────────────────

// One entry per work day: where that day starts on the work axis, and the
// calendar coordinates it maps back to. 21 entries over the default horizon.
export function buildWorkAxis(schedule, horizonDays) {
  const days = getVisibleWorkDays(schedule, horizonDays);
  const grid = [];
  let acc = 0;
  for (const { date, daySchedule } of days) {
    const length = daySchedule.endMinutes - daySchedule.startMinutes;
    grid.push({
      fromWork: acc,
      toWork: acc + length,
      dateStr: toISODate(date),
      dayStartMinutes: daySchedule.startMinutes,
    });
    acc += length;
  }
  return { grid, totalWorkMinutes: acc, days };
}

// work-minutes -> { dateStr, startMinutes }. Binary search over the grid.
// Clamped at the horizon: callers check `totalWorkMinutes` before relying on it.
export function workToCalendarParts(axis, workMinutes) {
  const { grid } = axis;
  if (!grid.length) return null;

  // A completion exactly on a day boundary belongs to the day that just ended,
  // not the next one — otherwise a task finishing at 5pm reads as 9am tomorrow
  // and its cost jumps by a full overnight.
  let lo = 0, hi = grid.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (grid[mid].fromWork < workMinutes) lo = mid; else hi = mid - 1;
  }
  const g = grid[lo];
  return {
    dateStr: g.dateStr,
    startMinutes: g.dayStartMinutes + (workMinutes - g.fromWork),
  };
}

export function workToDate(axis, workMinutes) {
  const parts = workToCalendarParts(axis, workMinutes);
  if (!parts) return null;
  const d = new Date(parts.dateStr + 'T00:00:00');
  d.setMinutes(parts.startMinutes);
  return d;
}

// ─── cost on the work axis ───────────────────────────────────────────────────

// Cost of finishing `task` after `workMinutes` of work have elapsed. Pressure
// itself is untouched — this only decides which calendar instant to ask about.
export function costAtWorkMinutes(axis, task, workMinutes, cache) {
  let instant = cache.get(workMinutes);
  if (instant === undefined) {
    instant = workToDate(axis, workMinutes);
    cache.set(workMinutes, instant);
  }
  return accumulatedPressure(task, instant);
}

// ─── sequencing ──────────────────────────────────────────────────────────────

// Cost of an ordering, expressed as work-minute completion times. Buffers sit
// between consecutive tasks, matching how packing lays them out.
export function sequenceCostWork(order, tasks, durations, buffer, axis, cache) {
  let cost = 0;
  let elapsed = 0;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    elapsed += (k > 0 ? buffer : 0) + durations[i];
    cost += costAtWorkMinutes(axis, tasks[i], elapsed, cache);
  }
  return cost;
}

// Best-improvement insertion search, scored entirely on the work axis.
export function optimizeOrderWork(tasks, schedule, axis, maxPasses = 30) {
  const buffer = schedule.bufferMinutes ?? 0;
  const durations = tasks.map(t => schedulableMinutes(t));
  const cache = new Map();

  // Seed with a pairwise-exchange sort: for two tasks, does ab beat ba? This is
  // a far better starting point than input order, and on the work axis the
  // comparison is exact rather than approximate. The search still has to fix
  // what a pairwise rule cannot see, but it starts much closer.
  let order = tasks.map((_, i) => i).sort((x, y) => {
    const dx = durations[x], dy = durations[y];
    const ab = costAtWorkMinutes(axis, tasks[x], dx, cache)
             + costAtWorkMinutes(axis, tasks[y], dx + buffer + dy, cache);
    const ba = costAtWorkMinutes(axis, tasks[y], dy, cache)
             + costAtWorkMinutes(axis, tasks[x], dy + buffer + dx, cache);
    return ab - ba;
  });
  if (order.length < 2) return order;

  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;

    for (let i = 0; i < order.length; i++) {
      const picked = order[i];
      const rest = order.slice(0, i).concat(order.slice(i + 1));

      // Prefix scaffolding over `rest`: elapsed work-minutes and accumulated
      // cost before each insertion slot.
      const prefixElapsed = new Array(rest.length + 1);
      const prefixCost = new Array(rest.length + 1);
      prefixElapsed[0] = 0;
      prefixCost[0] = 0;
      for (let k = 0; k < rest.length; k++) {
        const e = prefixElapsed[k] + (k > 0 ? buffer : 0) + durations[rest[k]];
        prefixElapsed[k + 1] = e;
        prefixCost[k + 1] = prefixCost[k] + costAtWorkMinutes(axis, tasks[rest[k]], e, cache);
      }

      let bestPos = i;
      let bestCost = Infinity;
      for (let j = 0; j <= rest.length; j++) {
        const own = prefixElapsed[j] + (j > 0 ? buffer : 0) + durations[picked];
        let total = prefixCost[j] + costAtWorkMinutes(axis, tasks[picked], own, cache);

        // Suffix: everything after the insertion point shifts by the inserted
        // task's span.
        let elapsed = own;
        for (let k = j; k < rest.length; k++) {
          elapsed += buffer + durations[rest[k]];
          total += costAtWorkMinutes(axis, tasks[rest[k]], elapsed, cache);
        }

        if (total < bestCost - 1e-12) { bestCost = total; bestPos = j; }
      }

      if (bestPos !== i) {
        rest.splice(bestPos, 0, picked);
        order = rest;
        moved = true;
      }
    }

    if (!moved) break;
  }

  return order;
}

// ─── naive placement on the axis ─────────────────────────────────────────────

// Lay an ordering out contiguously on the work axis, then convert to calendar
// blocks, splitting only where a task crosses a day boundary. This is the
// "pretend day boundaries don't exist, repair afterwards" approach: placement
// is trivial, and day structure is applied as a rendering concern.
//
// Ignores manual/fixed blocks — this prototype measures the ordering model, not
// the full placement problem.
export function layoutOnAxis(order, tasks, schedule, axis) {
  const buffer = schedule.bufferMinutes ?? 0;
  const durations = tasks.map(t => schedulableMinutes(t));
  const blocks = [];
  let elapsed = 0;

  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    if (k > 0) elapsed += buffer;
    let remaining = durations[i];
    if (elapsed + remaining > axis.totalWorkMinutes) return null; // past horizon

    const parts = [];
    while (remaining > 0) {
      const at = workToCalendarParts(axis, elapsed + 1); // +1: which day are we in
      const g = axis.grid.find(x => x.dateStr === at.dateStr);
      const roomToday = g.toWork - elapsed;
      const take = Math.min(remaining, roomToday);
      const start = workToCalendarParts(axis, elapsed + 1);
      parts.push({
        taskId: tasks[i].id,
        date: start.dateStr,
        startMinutes: g.dayStartMinutes + (elapsed - g.fromWork),
        durationMinutes: take,
      });
      elapsed += take;
      remaining -= take;
    }
    if (parts.length > 1) {
      parts.forEach((p, idx) => { p.partIndex = idx + 1; p.totalParts = parts.length; });
    }
    blocks.push(...parts);
  }

  return blocks;
}

// True cost of a laid-out schedule, read off the blocks the same way the app's
// totalCost does — completion is the end of a task's LAST part.
export function totalCostFromBlocks(blocks, tasks) {
  let cost = 0;
  for (const task of tasks) {
    const own = blocks.filter(b => b.taskId === task.id);
    if (!own.length) continue;
    const last = own.reduce((a, b) => (b.partIndex ?? 1) > (a.partIndex ?? 1) ? b : a);
    const completion = new Date(last.date + 'T00:00:00');
    completion.setMinutes(last.startMinutes + last.durationMinutes);
    cost += accumulatedPressure(task, completion);
  }
  return cost;
}
