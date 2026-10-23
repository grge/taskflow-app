/**
 * Scheduler benchmark — compares the greedy+local-search heuristic against
 * the exact DP solver for small task instances.
 *
 * Usage:
 *   node scripts/benchmark.js                  # random synthetic tasks
 *   node scripts/benchmark.js export.json      # your real tasks (exported via the app)
 *
 * Export format: the raw localStorage value for 'taskflow_v2', saved as JSON.
 * In the browser console: copy(localStorage.getItem('taskflow_v2')) then paste to a file.
 *
 * The DP is a validation oracle, not a production component: it is exact but
 * O(n·2^n) time and O(2^n) space, so it is only usable up to n≈22.
 */

import { readFileSync } from 'fs';
import { accumulatedPressure } from '../src/lib/envelope.js';
import { advanceWork } from '../src/lib/calendar.js';
import { autoSchedule, totalCost } from '../src/lib/scheduler.js';
import { schedulableMinutes } from '../src/lib/tasks.js';

// ─── default work schedule (Mon–Fri 9–17) ────────────────────────────────────

const DEFAULT_SCHEDULE = {
  bufferMinutes: 0, // no buffer for benchmarking — cleaner comparisons
  days: [
    { dayOfWeek: 0, enabled: false, startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 1, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 2, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 3, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 4, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 5, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 6, enabled: false, startMinutes: 540, endMinutes: 1020 },
  ]
};

// ─── exact DP solver ──────────────────────────────────────────────────────────

// Relies on two properties of the cost model, both verified in
// SCHEDULER-DIRECTIONS.md §1:
//   1. accumulatedPressure(task, C) depends only on that task's own completion
//      time — the objective is separable.
//   2. The end time of a *set* of tasks is independent of their order (same
//      total work minutes consumed), so n! orderings collapse to 2^n subsets.
// Together these give O(n·2^n) rather than O(n!).

function lowestSetBit(mask) {
  return 31 - Math.clz32(mask & -mask);
}

function exactDP(tasks, schedule) {
  const n = tasks.length;
  const now = new Date();

  // Pack durations against the same figure the scheduler uses, so the DP and
  // the heuristic are measuring the same problem.
  const durations = tasks.map(t => schedulableMinutes(t));

  // endTime[mask]: calendar time after completing all tasks in mask, packed
  // sequentially from now. Order-independent (see note above).
  const endTime = new Array(1 << n);
  endTime[0] = now;
  for (let mask = 1; mask < (1 << n); mask++) {
    const i = lowestSetBit(mask);
    const prevMask = mask ^ (1 << i);
    endTime[mask] = advanceWork(endTime[prevMask], durations[i], schedule);
  }

  const memo = new Float64Array(1 << n).fill(-1);

  function solve(mask) {
    if (mask === (1 << n) - 1) return 0;
    if (memo[mask] !== -1) return memo[mask];

    let minCost = Infinity;

    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) continue;
      const newMask = mask | (1 << i);
      const taskCost = accumulatedPressure(tasks[i], endTime[newMask]);
      const total = taskCost + solve(newMask);
      if (total < minCost) minCost = total;
    }

    memo[mask] = minCost;
    return minCost;
  }

  return solve(0);
}

// ─── synthetic task generator ─────────────────────────────────────────────────

// Mirrors the app's own task model: an onset/peak pressure envelope rather than
// the old urgencyProfile/importance pair.
function randomTask(i, now) {
  const DAY = 24 * 60 * 60 * 1000;
  const durations = [15, 30, 45, 60, 90, 120];
  const estimatedMinutes = durations[Math.floor(Math.random() * durations.length)];

  // Onset from a day ago to two days out; peak 0.5–6 days after onset.
  const onsetMs = now.getTime() + (Math.random() * 3 - 1) * DAY;
  const peakMs  = onsetMs + (0.5 + Math.random() * 5.5) * DAY;
  // Created uniformly within the last 24 hours.
  const createdAt = new Date(now.getTime() - Math.random() * DAY);

  return {
    id: `task-${i}`,
    description: `Task ${i} (${estimatedMinutes}m)`,
    estimatedMinutes,
    onset: new Date(onsetMs),
    peak: new Date(peakMs),
    peakPressure: 0.3 + Math.random() * 0.7,
    createdAt,
    lastModifiedAt: createdAt,
    completedAt: null,
    scheduledBlocks: [],
    elapsedSeconds: 0,
    remainingOverride: null,
    isCompleted: false,
    isDeleted: false,
    isLocked: false,
  };
}

// ─── load tasks ───────────────────────────────────────────────────────────────

function loadFromFile(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return (parsed.tasks ?? [])
    .filter(t => !t.isCompleted && !t.isDeleted && (t.scheduledBlocks?.length ?? 0) === 0)
    .map(t => ({
      ...t,
      onset:          new Date(t.onset),
      peak:           new Date(t.peak),
      createdAt:      new Date(t.createdAt),
      lastModifiedAt: new Date(t.lastModifiedAt ?? t.createdAt),
    }));
}

// ─── trial helpers ────────────────────────────────────────────────────────────

// autoSchedule logs progress; silence it so benchmark output stays readable.
const _log = console.log;
function withSilentScheduler(fn) {
  console.log = () => {};
  try { return fn(); } finally { console.log = _log; }
}

function runHeuristic(tasks, schedule) {
  const t0 = performance.now();
  const blocks = withSilentScheduler(() => autoSchedule(tasks, schedule));
  const ms = performance.now() - t0;
  const scheduled = blocks.length ? new Set(blocks.map(b => b.taskId)).size : 0;
  const cost = blocks.length ? totalCost(blocks, tasks) : Infinity;
  console.log(`  n=${String(tasks.length).padStart(3)}  scheduled=${scheduled}/${tasks.length}  cost=${cost.toFixed(3)}  time=${ms.toFixed(0)}ms`);
}

function runTrial(tasks, schedule, label) {
  if (tasks.length === 0) {
    console.log(`${label}: no tasks`);
    return;
  }

  const n = tasks.length;
  const estimatedMB = (8 * (1 << Math.min(n, 30))) / (1024 * 1024);

  const t0 = performance.now();
  const heuristicBlocks = withSilentScheduler(() => autoSchedule(tasks, schedule));
  const heuristicTime = performance.now() - t0;
  const heuristicCost = heuristicBlocks.length ? totalCost(heuristicBlocks, tasks) : Infinity;
  const scheduled = heuristicBlocks.length ? new Set(heuristicBlocks.map(b => b.taskId)).size : 0;

  console.log(`\n── ${label} (n=${n}) ──`);
  console.log(`  Scheduled:      ${scheduled}/${n}`);
  console.log(`  Heuristic cost: ${heuristicCost.toFixed(4)}  (${heuristicTime.toFixed(0)}ms)`);

  if (estimatedMB > 512) {
    console.log(`  DP:             skipped (would need ~${Math.round(estimatedMB)}MB)`);
    return;
  }

  // The DP assumes every task is placed. If the window couldn't fit them all,
  // the two numbers describe different problems and the gap is meaningless.
  if (scheduled < n) {
    console.log(`  DP:             skipped (only ${scheduled}/${n} fit the window)`);
    return;
  }

  const t1 = performance.now();
  const optimalCost = exactDP(tasks, schedule);
  const dpTime = performance.now() - t1;
  const gap = optimalCost > 0 ? ((heuristicCost - optimalCost) / optimalCost * 100) : 0;

  console.log(`  Optimal cost:   ${optimalCost.toFixed(4)}  (${dpTime.toFixed(0)}ms, ~${estimatedMB < 1 ? '<1' : Math.round(estimatedMB)}MB)`);
  console.log(`  Optimality gap: ${gap.toFixed(3)}%`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

const exportFile = process.argv[2];
const now = new Date();

if (exportFile) {
  const tasks = loadFromFile(exportFile);
  console.log(`Loaded ${tasks.length} unscheduled tasks from ${exportFile}`);
  runTrial(tasks, DEFAULT_SCHEDULE, 'Real data');
} else {
  console.log('No export file provided — running synthetic trials.\n');
  console.log('To benchmark against real tasks:');
  console.log('  1. In the browser console: copy(localStorage.getItem(\'taskflow_v2\'))');
  console.log('  2. Paste into a file: pbpaste > export.json');
  console.log('  3. node scripts/benchmark.js export.json\n');

  // ── Section 1: heuristic vs exact DP ────────────────────────────────────────
  // DP complexity: O(n·2^n) time, 8·2^n bytes.
  // n=20 → ~8MB, ~5s.  n=22 → ~32MB, ~25s.  n=25 → ~256MB, ~4min.
  console.log('── Heuristic vs exact DP ──────────────────────────────────────────');
  for (const n of [5, 8, 10, 12, 15, 18]) {
    const tasks = Array.from({ length: n }, (_, i) => randomTask(i, now));
    runTrial(tasks, DEFAULT_SCHEDULE, `n=${n}`);
  }

  // ── Section 2: gap distribution at n=15 ─────────────────────────────────────
  // This is the number to watch when changing the scheduler: it is the
  // regression signal that a speedup did not cost solution quality.
  console.log('\n── Gap distribution: n=15, 50 trials ──────────────────────────────');
  const gaps = [];
  let skipped = 0;
  for (let trial = 0; trial < 50; trial++) {
    const tasks = Array.from({ length: 15 }, (_, i) => randomTask(i, now));
    const blocks = withSilentScheduler(() => autoSchedule(tasks, DEFAULT_SCHEDULE));
    if (!blocks.length || new Set(blocks.map(b => b.taskId)).size < tasks.length) { skipped++; continue; }
    const hCost = totalCost(blocks, tasks);
    const oCost = exactDP(tasks, DEFAULT_SCHEDULE);
    if (oCost > 0) gaps.push((hCost - oCost) / oCost * 100);
  }
  if (gaps.length) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const max = Math.max(...gaps);
    const nonZero = gaps.filter(g => g > 0.001).length;
    console.log(`  Mean gap: ${mean.toFixed(3)}%  Max gap: ${max.toFixed(3)}%`);
    console.log(`  Non-zero gaps: ${nonZero}/${gaps.length} trials  (${skipped} skipped: didn't fit window)`);
  } else {
    console.log(`  No comparable trials (${skipped} skipped).`);
  }

  // ── Section 3: heuristic scaling ────────────────────────────────────────────
  console.log('\n── Heuristic scaling (no DP) ───────────────────────────────────────');
  for (const n of [20, 30, 40, 50]) {
    const tasks = Array.from({ length: n }, (_, i) => randomTask(i, now));
    runHeuristic(tasks, DEFAULT_SCHEDULE);
  }
}
