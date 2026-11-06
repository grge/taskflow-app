import { accumulatedPressure } from './envelope.js';
import { advanceWork, getVisibleWorkDays, parseLocalDate, toISODate } from './calendar.js';
import { splitTaskAcrossDays, computeFreeIntervals } from './scheduling.js';
import { schedulableMinutes } from './tasks.js';
import { SCHEDULING_HORIZON_DAYS } from './constants.js';

// ─── packSequence ────────────────────────────────────────────────────────────

// Place tasks in sequence into the schedule. Manual blocks carve the work
// window into free intervals; each task must fit entirely within a single
// contiguous run of free intervals starting from the current cursor position.
// Intervals too small to fit the task are skipped entirely — never partially
// filled.
//
// Returns an array of ScheduledBlock objects, or null if any task in the
// sequence doesn't fit in the remaining window. `now` is where packing starts:
// passed in rather than read from the clock, so a device and a backend applying
// the same operation place it identically.
export function packSequence(sequence, schedule, manualBlocks, fixedBlocks, now) {
  return makePacker(schedule, manualBlocks, fixedBlocks, now).pack(sequence);
}

// packSequence for many sequences over the same blocking blocks, as the local
// search packs thousands. The blocking blocks don't change while a sequence is
// packed (placed tasks advance the cursor rather than carving the window), so
// the free intervals are computed once, from `now`, and each task takes the
// ones at or after the cursor. That gives the same intervals as computing them
// afresh from the cursor: on the cursor's day they are clipped to start there.
// Local times are memoised by day and minute, as the same few recur in every
// packing; `cost` is totalCost using them.
function makePacker(schedule, manualBlocks, fixedBlocks, now) {
  const bufferMinutes = schedule.bufferMinutes ?? 0;
  const visibleDays = getVisibleWorkDays(schedule, SCHEDULING_HORIZON_DAYS, now);
  if (!visibleDays.length) return { pack: () => [], cost: totalCost, empty: true };
  const allIntervals = computeFreeIntervals(visibleDays, [...manualBlocks, ...fixedBlocks], new Date(now), bufferMinutes);
  const byDate = new Map();
  for (const iv of allIntervals) {
    if (!byDate.has(iv.date)) byDate.set(iv.date, []);
    byDate.get(iv.date).push(iv);
  }
  // The visible days from each one on, so splitTaskAcrossDays finds its start
  // day first.
  const daysFrom = new Map(visibleDays.map((d, i) => [toISODate(d.date), visibleDays.slice(i)]));
  // A block can't lie in an interval that clipping drops: it would end at or
  // before the cursor, and every block starts at or after it.
  const fitsFree = b => (byDate.get(b.date) ?? []).some(iv =>
    iv.startMinutes <= b.startMinutes && iv.endMinutes >= b.startMinutes + b.durationMinutes
  );

  const times = new Map();
  const localTime = (date, minutes) => {
    const key = `${date}+${minutes}`;
    let t = times.get(key);
    if (!t) {
      const d = parseLocalDate(date);
      d.setMinutes(minutes);
      t = { ms: d.getTime(), date: toISODate(d), minutes: d.getHours() * 60 + d.getMinutes() };
      times.set(key, t);
    }
    return t;
  };

  // Place one task at the cursor (`from`, with `k` the first interval not on a
  // day before it): its blocks and the cursor after them, or null if it fits
  // nowhere, in which case the whole sequence doesn't fit.
  const place = (task, from, k, isLast) => {
    while (k < allIntervals.length && allIntervals[k].date < from.date) k++;

    // We try each interval's start in order. splitTaskAcrossDays handles
    // multi-day splits at end-of-day; we additionally check that all blocks
    // fit within free intervals (i.e. don't cross manual block exclusion zones).
    for (let i = k; i < allIntervals.length; i++) {
      const iv = allIntervals[i];
      const startMinutes = iv.date === from.date ? Math.max(iv.startMinutes, from.minutes) : iv.startMinutes;
      if (startMinutes >= iv.endMinutes) continue;

      const blocks = splitTaskAcrossDays(
        task.id, iv.date, startMinutes, schedulableMinutes(task), daysFrom.get(iv.date)
      );
      if (blocks === null) return null; // doesn't fit in window at all

      if (blocks.every(fitsFree)) {
        // Advance cursor to end of last placed block, plus inter-task buffer
        // (skip buffer after the last task).
        const last = blocks[blocks.length - 1];
        return { blocks, from: localTime(last.date, last.startMinutes + last.durationMinutes + (isLast ? 0 : bufferMinutes)), k };
      }
    }
    return null; // no gap large enough for this task
  };

  const start = { from: localTime(toISODate(now), now.getHours() * 60 + now.getMinutes()), k: 0 };

  const pack = sequence => {
    const result = [];
    let at = start;
    for (let i = 0; i < sequence.length; i++) {
      at = place(sequence[i], at.from, at.k, i === sequence.length - 1);
      if (!at) return null;
      result.push(...at.blocks);
    }
    return result;
  };

  const completion = b => localTime(b.date, b.startMinutes + b.durationMinutes).ms;
  const cost = (blocks, tasks) => totalCost(blocks, tasks, completion);
  return { pack, cost, place, start, completion };
}

// ─── totalCost ───────────────────────────────────────────────────────────────

const endOf = b => {
  const t = parseLocalDate(b.date);
  t.setMinutes(b.startMinutes + b.durationMinutes);
  return t;
};

export function totalCost(blocks, tasks, completionOf = endOf) {
  // Each task's last part: the highest partIndex, the first such on a tie.
  const last = new Map();
  for (const b of blocks) {
    const seen = last.get(b.taskId);
    if (!seen || (b.partIndex ?? 1) > (seen.partIndex ?? 1)) last.set(b.taskId, b);
  }
  let cost = 0;
  for (const task of tasks) {
    const b = last.get(task.id);
    if (b) cost += accumulatedPressure(task, completionOf(b));
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

export function autoSchedule(allTasks, schedule, fixedBlocks, now) {
  const manualBlocks = allTasks
    .filter(t => t.scheduledBlocks.length > 0)
    .flatMap(t => t.scheduledBlocks);

  const unscheduled = allTasks
    .filter(t => !t.isCompleted && !t.isDeleted && !t.isLocked && t.scheduledBlocks.length === 0);

  if (!unscheduled.length) return [];
  const packer = makePacker(schedule, manualBlocks, fixedBlocks, now);
  const { pack, cost: costOf } = packer;

  // ── Phase 1: greedy initial ordering ────────────────────────────────────────
  const sequence = [];
  const remaining = [...unscheduled];
  let currentTime = new Date(now);

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
  let blocks = pack(sequence);

  if (blocks === null) {
    // Some tasks don't fit. Binary-search for the longest prefix that does fit,
    // leaving the rest unscheduled.
    let lo = 0, hi = sequence.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (pack(sequence.slice(0, mid)) !== null) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    blocks = lo > 0 ? pack(sequence.slice(0, lo)) : [];
  }

  let cost = costOf(blocks, sequence);

  // ── Phase 3: local search ────────────────────────────────────────────────────
  // Operate only on the schedulable prefix.
  const schedulable = sequence.slice(0, blocks.length > 0
    ? new Set(blocks.map(b => b.taskId)).size
    : 0);
  if (packer.empty || !schedulable.length) return blocks;

  // The current order's packing, position by position: the cursor before each
  // task, its blocks, and its cost. A move changes only a stretch of the order;
  // packing a trial starts at the stretch, and once the cursor after it meets
  // the current one, the rest packs as it does now, so its blocks and costs are
  // reused. Costs are still added in order, so totals match a full repack.
  const layout = seq => {
    const L = { at: [], blocks: [], cost: [] };
    let at = packer.start;
    for (let p = 0; p < seq.length; p++) {
      L.at.push(at);
      at = packer.place(seq[p], at.from, at.k, p === seq.length - 1);
      L.blocks.push(at.blocks);
      L.cost.push(accumulatedPressure(seq[p], packer.completion(at.blocks[at.blocks.length - 1])));
    }
    return L;
  };
  // The cost of `seq`, which differs from the laid-out order only in positions
  // from..to-1; null if it doesn't fit.
  const trial = (seq, L, from, to) => {
    let cost = 0;
    for (let p = 0; p < from; p++) cost += L.cost[p];
    let at = L.at[from];
    for (let p = from; p < seq.length; p++) {
      if (p >= to && at.from === L.at[p].from) {
        for (let q = p; q < seq.length; q++) cost += L.cost[q];
        return cost;
      }
      at = packer.place(seq[p], at.from, at.k, p === seq.length - 1);
      if (!at) return null;
      cost += accumulatedPressure(seq[p], packer.completion(at.blocks[at.blocks.length - 1]));
    }
    return cost;
  };

  let L = layout(schedulable);
  const accept = () => {
    L = layout(schedulable);
    blocks = L.blocks.flat();
  };

  let improved = true;
  while (improved) {
    improved = false;

    // Phase A: adjacent swaps
    for (let i = 0; i < schedulable.length - 1; i++) {
      [schedulable[i], schedulable[i + 1]] = [schedulable[i + 1], schedulable[i]];
      const newCost = trial(schedulable, L, i, i + 2);
      if (newCost !== null && newCost < cost) {
        accept();
        cost = newCost;
        improved = true;
        break;
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
        const newCost = trial(schedulable, L, Math.min(i, j), Math.max(i, j) + 1);
        if (newCost !== null && newCost < bestCost) {
          bestPos = j;
          bestCost = newCost;
        }
        schedulable.splice(j, 1);
      }

      schedulable.splice(bestPos, 0, task);
      if (bestCost < cost) {
        accept();
        cost = bestCost;
        improved = true;
        break;
      }
    }
  }

  return blocks;
}
