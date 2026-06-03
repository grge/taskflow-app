/**
 * Scheduler benchmark — compares the greedy+local-search heuristic against
 * the exact DP solver for small task instances.
 *
 * Usage:
 *   node scripts/benchmark.js                  # random synthetic tasks
 *   node scripts/benchmark.js export.json      # your real tasks (exported via the app)
 *
 * Export format: the raw localStorage value for 'taskflow_v1', saved as JSON.
 * In the browser console: copy(localStorage.getItem('taskflow_v1')) then paste to a file.
 */

import { readFileSync } from 'fs';
import { accumulatedProblemness } from '../src/lib/envelope.js';
import { advanceWork } from '../src/lib/calendar.js';
import { packSequence, totalCost } from '../src/lib/scheduler.js';
import { autoSchedule } from '../src/lib/scheduler.js';

// ─── default work schedule (Mon–Fri 9–17) ────────────────────────────────────

const DEFAULT_SCHEDULE = {
  bufferMinutes: 0, // no buffer for benchmarking — cleaner comparisons
  days: [
    { dayOfWeek: 1, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 2, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 3, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 4, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 5, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 0, enabled: false, startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 6, enabled: false, startMinutes: 540, endMinutes: 1020 },
  ]
};

// ─── exact DP solver ──────────────────────────────────────────────────────────

function lowestSetBit(mask) {
  return Math.log2(mask & -mask) | 0;
}

function exactDP(tasks, schedule) {
  const n = tasks.length;

  const now = new Date();

  // Precompute endTime[mask]: calendar time after completing all tasks in mask,
  // packed sequentially in index order from now. Order doesn't affect end time
  // (same total work minutes), so index order is fine for precomputation.
  const endTime = new Array(1 << n);
  endTime[0] = now;
  for (let mask = 1; mask < (1 << n); mask++) {
    const i = lowestSetBit(mask);
    const prevMask = mask ^ (1 << i);
    endTime[mask] = advanceWork(endTime[prevMask], tasks[i].estimatedMinutes, schedule);
  }

  const memo = new Float64Array(1 << n).fill(-1);

  function solve(mask) {
    if (mask === (1 << n) - 1) return 0;
    if (memo[mask] !== -1) return memo[mask];

    let minCost = Infinity;

    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) continue;
      const newMask = mask | (1 << i);
      const taskCost = accumulatedProblemness(tasks[i], endTime[newMask]);
      const rest = solve(newMask);
      const total = taskCost + rest;
      if (total < minCost) minCost = total;
    }

    memo[mask] = minCost;
    return minCost;
  }

  return solve(0);
}

// ─── synthetic task generator ─────────────────────────────────────────────────

const PROFILES = ['next-couple-hours', 'cob-today', 'cob-tomorrow', 'few-days', 'end-of-week', 'whenever'];
const IMPORTANCES = ['low', 'medium', 'high'];

function randomTask(i, now) {
  const profile = PROFILES[Math.floor(Math.random() * PROFILES.length)];
  const importance = IMPORTANCES[Math.floor(Math.random() * IMPORTANCES.length)];
  // Durations: 15, 30, 45, 60, 90, 120 minutes
  const durations = [15, 30, 45, 60, 90, 120];
  const estimatedMinutes = durations[Math.floor(Math.random() * durations.length)];
  // Created uniformly within the last 24 hours
  const createdAt = new Date(now.getTime() - Math.random() * 24 * 60 * 60 * 1000);

  return {
    id: `task-${i}`,
    description: `Task ${i} (${profile}, ${importance}, ${estimatedMinutes}m)`,
    estimatedMinutes,
    urgencyProfile: profile,
    importance,
    createdAt,
    lastModifiedAt: createdAt,
    scheduledBlocks: [],
    elapsedSeconds: 0,
    isCompleted: false,
    isDeleted: false,
    customEnvelope: null,
  };
}

// ─── load tasks ───────────────────────────────────────────────────────────────

function loadFromFile(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return (parsed.tasks ?? [])
    .filter(t => !t.isCompleted && !t.isDeleted && t.scheduledBlocks.length === 0)
    .map(t => ({ ...t, createdAt: new Date(t.createdAt), lastModifiedAt: new Date(t.lastModifiedAt) }));
}

// ─── run a single benchmark trial ────────────────────────────────────────────

// Suppress the autoSchedule console.log output during benchmarking
const _log = console.log;
function withSilentScheduler(fn) {
  console.log = () => {};
  try { return fn(); } finally { console.log = _log; }
}

// Run heuristic only — no DP limit
function runHeuristic(tasks, schedule, label) {
  const t0 = Date.now();
  const blocks = withSilentScheduler(() => autoSchedule(tasks, schedule));
  const ms = Date.now() - t0;
  const scheduled = blocks.length ? new Set(blocks.map(b => b.taskId)).size : 0;
  const cost = blocks.length ? totalCost(blocks, tasks) : Infinity;
  console.log(`  n=${String(tasks.length).padStart(3)}  scheduled=${scheduled}/${tasks.length}  cost=${cost.toFixed(3)}  time=${ms}ms`);
}

// Run heuristic vs DP — aborts DP if estimated memory > 512MB
function runTrial(tasks, schedule, label) {
  if (tasks.length === 0) {
    console.log(`${label}: no tasks`);
    return;
  }

  const n = tasks.length;
  const estimatedMB = (8 * (1 << Math.min(n, 30))) / (1024 * 1024);

  const t0 = Date.now();
  const heuristicBlocks = withSilentScheduler(() => autoSchedule(tasks, schedule));
  const heuristicTime = Date.now() - t0;
  const heuristicCost = heuristicBlocks.length
    ? totalCost(heuristicBlocks, tasks)
    : Infinity;
  const scheduled = heuristicBlocks.length
    ? new Set(heuristicBlocks.map(b => b.taskId)).size
    : 0;

  console.log(`\n── ${label} (n=${n}) ──`);
  console.log(`  Scheduled:      ${scheduled}/${n}`);
  console.log(`  Heuristic cost: ${heuristicCost.toFixed(4)}  (${heuristicTime}ms)`);

  if (estimatedMB > 512) {
    console.log(`  DP:             skipped (would need ~${Math.round(estimatedMB)}MB)`);
    return;
  }

  const t1 = Date.now();
  const optimalCost = exactDP(tasks, schedule);
  const dpTime = Date.now() - t1;
  const gap = optimalCost > 0
    ? ((heuristicCost - optimalCost) / optimalCost * 100).toFixed(3)
    : '0.000';

  console.log(`  Optimal cost:   ${optimalCost.toFixed(4)}  (${dpTime}ms, ~${Math.round(estimatedMB)}MB)`);
  console.log(`  Optimality gap: ${gap}%`);
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
  console.log('  1. In the browser console: copy(localStorage.getItem(\'taskflow_v1\'))');
  console.log('  2. Paste into a file: pbpaste > export.json');
  console.log('  3. node scripts/benchmark.js export.json\n');

  // ── Section 1: heuristic vs DP (goes until DP becomes impractical) ──────────
  // DP complexity: O(n·2^n). Memory: 8·2^n bytes.
  // n=20 → ~8MB, ~5s.  n=22 → ~32MB, ~25s.  n=25 → ~256MB, ~4min.  n=28+ → impractical.
  console.log('── Heuristic vs exact DP ──────────────────────────────────────────');
  for (const n of [5, 8, 10, 12, 15, 18, 20, 22]) {
    const tasks = Array.from({ length: n }, (_, i) => randomTask(i, now));
    runTrial(tasks, DEFAULT_SCHEDULE, `n=${n}`);
  }

  // ── Section 2: multi-trial gap distribution at n=15 (fast) ──────────────────
  console.log('\n── Gap distribution: n=15, 50 trials ──────────────────────────────');
  const gaps = [];
  for (let trial = 0; trial < 50; trial++) {
    const tasks = Array.from({ length: 15 }, (_, i) => randomTask(i, now));
    const blocks = withSilentScheduler(() => autoSchedule(tasks, DEFAULT_SCHEDULE));
    if (!blocks.length) continue;
    const hCost = totalCost(blocks, tasks);
    const oCost = exactDP(tasks, DEFAULT_SCHEDULE);
    if (oCost > 0) gaps.push((hCost - oCost) / oCost * 100);
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const max = Math.max(...gaps);
  const nonZero = gaps.filter(g => g > 0.001).length;
  console.log(`  Mean gap: ${mean.toFixed(3)}%  Max gap: ${max.toFixed(3)}%`);
  console.log(`  Non-zero gaps: ${nonZero}/${gaps.length} trials`);

  // ── Section 3: heuristic scaling — how fast is it at large n? ───────────────
  console.log('\n── Heuristic scaling (no DP) ───────────────────────────────────────');
  for (const n of [20, 30, 50, 75, 100]) {
    const tasks = Array.from({ length: n }, (_, i) => randomTask(i, now));
    runHeuristic(tasks, DEFAULT_SCHEDULE, `n=${n}`);
  }
}
