// Unit tests for the domain core. Plain node:test, no dependencies.
//
// Every time here is a local wall-clock time (new Date(y, m, d, h, min)), and
// every expectation is in local minutes and local dates, because the core's
// contract is host-local time. tests/run-core.mjs runs this file under several
// timezones, including a half-hour offset and a DST change, so a hidden UTC
// assumption fails somewhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, OP_TYPES } from '../../src/core/apply.js';
import { DEFAULT_WORK_SCHEDULE } from '../../src/lib/constants.js';

// ─── fixtures ────────────────────────────────────────────────────────────────

const local = (day, h, m = 0, month = 9) => new Date(2026, month, day, h, m);
const NOW = local(28, 10);          // Wednesday 28 Oct 2026, 10:00
const TODAY = '2026-10-28';
const TOMORROW = '2026-10-29';      // Thursday
const FRIDAY = '2026-10-30';
const MONDAY = '2026-11-02';        // after the US DST change on Sun 1 Nov
const DAY = 86_400_000;

let seq = 0;
function task(description, o = {}) {
  seq += 1;
  return {
    id: `t${seq}`,
    description,
    estimatedMinutes: 60,
    onset: new Date(+NOW - 2 * DAY),
    peak: new Date(+NOW + 4 * DAY),
    peakPressure: 0.6,
    createdAt: new Date(+NOW - 3 * DAY),
    lastModifiedAt: new Date(+NOW - 3 * DAY),
    completedAt: null,
    scheduledBlocks: [],
    elapsedSeconds: 0,
    remainingOverride: null,
    isCompleted: false,
    isDeleted: false,
    isLocked: false,
    ...o
  };
}

const blk = (t, date, start, dur = t.estimatedMinutes, extra = {}) =>
  ({ id: `b-${t.id}-${date}`, taskId: t.id, date, startMinutes: start, durationMinutes: dur, ...extra });

const state = (o = {}) => ({
  tasks: [], workSchedule: DEFAULT_WORK_SCHEDULE, fixedBlocks: [], activeTimer: null, ...o
});

const run = (s, type, args = {}, now = NOW) => apply(s, { type, args }, { now });
const byId = (s, id) => s.tasks.find(t => t.id === id);
const placed = t => t.scheduledBlocks.map(b => [b.date, b.startMinutes, b.durationMinutes]);

// ─── contract ────────────────────────────────────────────────────────────────

test('rejects an unknown operation and a missing clock', () => {
  assert.throws(() => run(state(), 'task.nope'), /Unknown operation/);
  assert.throws(() => apply(state(), { type: 'schedule.clear' }, {}), /context\.now/);
});

test('the catalogue matches the design doc', () => {
  assert.deepEqual([...OP_TYPES].sort(), [
    'block.add', 'block.edit', 'block.remove',
    'data.import',
    'hours.update',
    'schedule.auto', 'schedule.clear', 'schedule.next', 'schedule.outlookMove', 'schedule.place', 'schedule.unschedule',
    'task.add', 'task.complete', 'task.delete', 'task.edit', 'task.restore', 'task.setElapsed', 'task.setLock', 'task.setRemaining',
    'timer.finish', 'timer.pause', 'timer.resume', 'timer.start'
  ]);
});

// The core must never read the clock: `now` comes from the operation, which is
// what lets a device and a backend agree. Make reading it throw, then exercise
// every operation that involves time.
test('never reads the clock', () => {
  const RealDate = globalThis.Date;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      if (args.length === 0) throw new Error('the core read the clock: new Date()');
      return Reflect.construct(target, args, newTarget);
    },
    get(target, prop, receiver) {
      if (prop === 'now') return () => { throw new Error('the core read the clock: Date.now()'); };
      return Reflect.get(target, prop, receiver);
    }
  });
  try {
    let s = state({ tasks: [task('A'), task('B', { peakPressure: 0.9 })] });
    s = run(s, 'task.add', { id: 'n', description: 'New', onset: NOW, peak: new RealDate(+NOW + DAY), peakPressure: 0.5, estimatedMinutes: 30 }).state;
    s = run(s, 'schedule.next', { id: 'n' }).state;
    s = run(s, 'schedule.auto').state;
    s = run(s, 'timer.start', { id: 't1' }).state;
    s = run(s, 'task.setRemaining', { id: 't1', minutes: 45 }).state;
    s = run(s, 'timer.pause', { id: 't1' }).state;
    s = run(s, 'timer.resume', { id: 't1' }).state;
    s = run(s, 'timer.finish', { id: 't1' }).state;
    s = run(s, 'schedule.outlookMove', { id: 'n', sourceDate: TODAY, targetDate: TOMORROW, insertBeforeId: null }).state;
    s = run(s, 'hours.update', { schedule: DEFAULT_WORK_SCHEDULE }).state;
    s = run(s, 'task.complete', { id: 't2' }).state;
    run(s, 'schedule.clear');
  } finally {
    globalThis.Date = RealDate;
  }
});

test('never mutates its input, Dates included', () => {
  const a = task('A');
  a.scheduledBlocks = [blk(a, TODAY, 600)];
  const s = state({ tasks: [a, task('B')], fixedBlocks: [{ id: 'f', date: TODAY, startMinutes: 720, durationMinutes: 30 }] });
  const frozen = JSON.stringify(s);
  const times = s.tasks.map(t => [+t.onset, +t.peak, +t.createdAt, +t.lastModifiedAt]);
  for (const [type, args] of [
    ['task.edit', { id: a.id, patch: { estimatedMinutes: 90, peak: new Date(+NOW + DAY) } }],
    ['schedule.next', { id: 't2' }], ['schedule.auto', {}], ['schedule.clear', {}],
    ['task.complete', { id: a.id }], ['hours.update', { schedule: { ...DEFAULT_WORK_SCHEDULE, bufferMinutes: 0 } }],
    ['schedule.outlookMove', { id: a.id, sourceDate: TODAY, targetDate: FRIDAY, insertBeforeId: null }]
  ]) {
    run(s, type, args);
    assert.equal(JSON.stringify(s), frozen, `${type} changed its input`);
    assert.deepEqual(s.tasks.map(t => [+t.onset, +t.peak, +t.createdAt, +t.lastModifiedAt]), times, `${type} mutated a Date`);
  }
});

// Replaying an operation on another device or on the backend must give the same
// state, ids included, or the copies drift apart one block id at a time.
test('is deterministic: the same operation on the same state gives the same state', () => {
  const a = task('A'), b = task('B', { peakPressure: 0.9 }), c = task('C', { estimatedMinutes: 600 });
  a.scheduledBlocks = [blk(a, TOMORROW, 540)];
  const s = state({ tasks: [a, b, c] });
  for (const [type, args] of [
    ['schedule.next', { id: c.id }], ['schedule.auto', {}],
    ['schedule.outlookMove', { id: b.id, sourceDate: null, targetDate: TOMORROW, insertBeforeId: a.id }]
  ]) {
    const first = run(s, type, args).state;
    const second = run(s, type, args).state;
    assert.deepEqual(second, first, type);
    assert.notEqual(first.tasks, s.tasks, `${type} placed something`);
  }
});

test('untouched slices keep their identity; no-ops return the same state', () => {
  const s = state({ tasks: [task('A')] });
  const added = run(s, 'block.add', { block: { id: 'f', date: TODAY, startMinutes: 600, durationMinutes: 30 } }).state;
  assert.equal(added.tasks, s.tasks, 'tasks untouched by block.add');
  assert.equal(added.workSchedule, s.workSchedule);
  assert.equal(run(s, 'timer.pause', { id: 't-none' }).state, s, 'pausing with no timer is a no-op');
});

// ─── tasks ───────────────────────────────────────────────────────────────────

test('task.add stamps from the operation and copies the dates it is given', () => {
  const onset = local(29, 10), peak = local(31, 10);
  const { state: s, result } = run(state(), 'task.add',
    { id: 'n1', description: 'Write report', onset, peak, peakPressure: 0.7, estimatedMinutes: 90 });
  assert.equal(result.id, 'n1');
  assert.equal(+result.createdAt, +NOW);
  assert.equal(+result.peak, +peak);
  assert.notEqual(result.peak, peak, 'stored peak must not alias the caller\'s Date');
  assert.equal(s.tasks.length, 1);
});

test('task.add accepts ISO strings, as operations arriving over the wire will carry', () => {
  const { result } = run(state(), 'task.add',
    { id: 'n', description: 'x', onset: local(29, 10).toISOString(), peak: local(31, 10).toISOString(), peakPressure: 0.5, estimatedMinutes: 30 });
  assert.ok(result.peak instanceof Date);
  assert.equal(+result.peak, +local(31, 10));
});

test('task.edit rescales blocks with the estimate, unless remaining is decoupled', () => {
  const a = task('A', { estimatedMinutes: 60 });
  a.scheduledBlocks = [blk(a, TODAY, 600, 60)];
  const s = run(state({ tasks: [a] }), 'task.edit', { id: a.id, patch: { estimatedMinutes: 90 } }).state;
  assert.deepEqual(placed(byId(s, a.id)), [[TODAY, 600, 90]]);

  const b = task('B', { remainingOverride: { atElapsedSeconds: 0, remainingMinutes: 45 } });
  b.scheduledBlocks = [blk(b, TODAY, 600, 45)];
  const s2 = run(state({ tasks: [b] }), 'task.edit', { id: b.id, patch: { estimatedMinutes: 120 } }).state;
  assert.deepEqual(placed(byId(s2, b.id)), [[TODAY, 600, 45]], 'override keeps the block');
});

test('task.setLock is absolute, so replaying it is harmless', () => {
  const a = task('A');
  const once = run(state({ tasks: [a] }), 'task.setLock', { id: a.id, locked: true }).state;
  const twice = run(once, 'task.setLock', { id: a.id, locked: true }).state;
  assert.equal(byId(twice, a.id).isLocked, true);
});

test('task.complete clears blocks and stamps completedAt from the operation', () => {
  const a = task('A');
  a.scheduledBlocks = [blk(a, TODAY, 600)];
  const done = byId(run(state({ tasks: [a] }), 'task.complete', { id: a.id }).state, a.id);
  assert.equal(done.isCompleted, true);
  assert.equal(+done.completedAt, +NOW);
  assert.deepEqual(done.scheduledBlocks, []);
});

test('task.delete is soft', () => {
  const a = task('A');
  assert.equal(byId(run(state({ tasks: [a] }), 'task.delete', { id: a.id }).state, a.id).isDeleted, true);
});

// ─── schedule.next ───────────────────────────────────────────────────────────

test('schedule.next places at the next free minute, after others plus the buffer', () => {
  const a = task('A'), b = task('B');
  let s = state({ tasks: [a, b] });
  const r1 = run(s, 'schedule.next', { id: a.id });
  assert.equal(r1.result.ok, true);
  s = r1.state;
  s = run(s, 'schedule.next', { id: b.id }).state;
  assert.deepEqual(placed(byId(s, a.id)), [[TODAY, 600, 60]]);
  assert.deepEqual(placed(byId(s, b.id)), [[TODAY, 675, 60]], '60 min + 15 min buffer');
});

test('schedule.next is deterministic in `now`', () => {
  const a = task('A');
  const s = state({ tasks: [a] });
  const first = placed(byId(run(s, 'schedule.next', { id: a.id }).state, a.id));
  const again = placed(byId(run(s, 'schedule.next', { id: a.id }).state, a.id));
  const later = placed(byId(run(s, 'schedule.next', { id: a.id }, local(28, 11, 30)).state, a.id));
  assert.deepEqual(first, again);
  assert.deepEqual(later, [[TODAY, 690, 60]], 'a later operation time packs from later');
});

test('schedule.next re-places a scheduled task over its own slot', () => {
  const a = task('A');
  a.scheduledBlocks = [blk(a, TODAY, 600)];
  assert.deepEqual(placed(byId(run(state({ tasks: [a] }), 'schedule.next', { id: a.id }).state, a.id)), [[TODAY, 600, 60]]);
});

test('schedule.next ignores soft-deleted tasks as obstacles', () => {
  const gone = task('Gone', { isDeleted: true });
  gone.scheduledBlocks = [blk(gone, TODAY, 600)];
  const a = task('A');
  assert.deepEqual(placed(byId(run(state({ tasks: [gone, a] }), 'schedule.next', { id: a.id }).state, a.id)), [[TODAY, 600, 60]]);
});

test('schedule.next reports why it could not place', () => {
  const huge = task('Huge', { estimatedMinutes: 600 * 60 });
  assert.deepEqual(run(state({ tasks: [huge] }), 'schedule.next', { id: huge.id }).result, { ok: false, reason: 'no-room' });

  const noDays = { ...DEFAULT_WORK_SCHEDULE, days: DEFAULT_WORK_SCHEDULE.days.map(d => ({ ...d, enabled: false })) };
  const a = task('A');
  assert.equal(run(state({ tasks: [a], workSchedule: noDays }), 'schedule.next', { id: a.id }).result.reason, 'no-work-days');
  assert.equal(run(state(), 'schedule.next', { id: 'missing' }).result.reason, 'unavailable');
});

test('schedule.next splits across days in local time, over a weekend and a DST change', () => {
  const a = task('Long', { estimatedMinutes: 360 });
  const s = run(state({ tasks: [a] }), 'schedule.next', { id: a.id }, local(30, 13)).state;
  assert.deepEqual(placed(byId(s, a.id)), [[FRIDAY, 780, 240], [MONDAY, 540, 120]]);
});

// ─── schedule.auto / clear ───────────────────────────────────────────────────

test('schedule.auto orders by pressure and skips locked tasks', () => {
  const hot = task('Hot', { peakPressure: 0.9 });
  const locked = task('Locked', { isLocked: true });
  const mild = task('Mild', { peakPressure: 0.3, estimatedMinutes: 30 });
  const s = run(state({ tasks: [hot, locked, mild] }), 'schedule.auto').state;
  assert.deepEqual(placed(byId(s, hot.id)), [[TODAY, 600, 60]]);
  assert.deepEqual(placed(byId(s, locked.id)), []);
  assert.deepEqual(placed(byId(s, mild.id)), [[TODAY, 675, 30]]);
});

test('schedule.auto counts a running timer\'s unflushed time', () => {
  const a = task('A', { estimatedMinutes: 60 });
  const timer = { taskId: a.id, startedAt: local(28, 9, 30), baseSeconds: 0 };
  const s = run(state({ tasks: [a], activeTimer: timer }), 'schedule.auto').state;
  assert.deepEqual(placed(byId(s, a.id)), [[TODAY, 600, 30]], '30 of 60 min already worked');
});

test('schedule.clear keeps locked tasks', () => {
  const a = task('A'), b = task('B', { isLocked: true });
  a.scheduledBlocks = [blk(a, TODAY, 600)];
  b.scheduledBlocks = [blk(b, TODAY, 720)];
  const s = run(state({ tasks: [a, b] }), 'schedule.clear').state;
  assert.deepEqual(placed(byId(s, a.id)), []);
  assert.deepEqual(placed(byId(s, b.id)), [[TODAY, 720, 60]]);
});

// ─── schedule.outlookMove ────────────────────────────────────────────────────

test('outlookMove reorders within a day', () => {
  const a = task('A'), b = task('B');
  a.scheduledBlocks = [blk(a, TOMORROW, 540)];
  b.scheduledBlocks = [blk(b, TOMORROW, 660)];
  const s = run(state({ tasks: [a, b] }), 'schedule.outlookMove',
    { id: b.id, sourceDate: TOMORROW, targetDate: TOMORROW, insertBeforeId: a.id }).state;
  assert.deepEqual(placed(byId(s, b.id)), [[TOMORROW, 540, 60]]);
  assert.deepEqual(placed(byId(s, a.id)), [[TOMORROW, 615, 60]]);
});

test('outlookMove moves to another day, inserting before a card there', () => {
  const a = task('A'), b = task('B');
  a.scheduledBlocks = [blk(a, TOMORROW, 540)];
  b.scheduledBlocks = [blk(b, FRIDAY, 540)];
  const s = run(state({ tasks: [a, b] }), 'schedule.outlookMove',
    { id: a.id, sourceDate: TOMORROW, targetDate: FRIDAY, insertBeforeId: b.id }).state;
  assert.deepEqual(placed(byId(s, a.id)), [[FRIDAY, 540, 60]]);
  assert.deepEqual(placed(byId(s, b.id)), [[FRIDAY, 615, 60]]);
});

// The deliberate difference from the old store function: its rollback snapshot
// was taken after the cross-day move had already cleared the moved task, so a
// task too long for one day ended up unscheduled instead of put back.
test('outlookMove puts back a task too long for one day', () => {
  const long = task('Long', { estimatedMinutes: 540 });
  long.scheduledBlocks = [
    blk(long, TOMORROW, 540, 480, { partIndex: 1, totalParts: 2 }),
    { ...blk(long, FRIDAY, 540, 60, { partIndex: 2, totalParts: 2 }), id: 'b-long-fri' }
  ];
  const s = run(state({ tasks: [long] }), 'schedule.outlookMove',
    { id: long.id, sourceDate: TOMORROW, targetDate: MONDAY, insertBeforeId: null }).state;
  assert.deepEqual(placed(byId(s, long.id)), [[TOMORROW, 540, 480], [FRIDAY, 540, 60]]);
});

// ─── hours.update ────────────────────────────────────────────────────────────

test('hours.update unschedules from the first invalid block on, and drops invalid fixed blocks', () => {
  const a = task('A'), b = task('B'), c = task('C');
  a.scheduledBlocks = [blk(a, '2026-10-27', 600)];   // Tuesday, unaffected and earlier
  b.scheduledBlocks = [blk(b, TODAY, 600)];          // Wednesday, about to be disabled
  c.scheduledBlocks = [blk(c, MONDAY, 600)];         // later, built on top of it
  const fixed = [{ id: 'f1', date: TODAY, startMinutes: 660, durationMinutes: 30 },
                 { id: 'f2', date: MONDAY, startMinutes: 660, durationMinutes: 30 }];
  const noWednesday = { ...DEFAULT_WORK_SCHEDULE, days: DEFAULT_WORK_SCHEDULE.days.map(d => (d.dayOfWeek === 3 ? { ...d, enabled: false } : d)) };
  const s = run(state({ tasks: [a, b, c], fixedBlocks: fixed }), 'hours.update', { schedule: noWednesday }).state;
  assert.deepEqual(placed(byId(s, a.id)), [[ '2026-10-27', 600, 60 ]]);
  assert.deepEqual(placed(byId(s, b.id)), []);
  assert.deepEqual(placed(byId(s, c.id)), []);
  assert.deepEqual(s.fixedBlocks.map(f => f.id), ['f2']);
  assert.equal(s.workSchedule, noWednesday);
});

// ─── timer ───────────────────────────────────────────────────────────────────

test('timer: pause flushes, paused time does not count, finish clears', () => {
  const a = task('A');
  let s = state({ tasks: [a] });
  s = run(s, 'timer.start', { id: a.id }, local(28, 10, 0)).state;
  s = run(s, 'timer.pause', { id: a.id }, local(28, 10, 2)).state;
  assert.equal(byId(s, a.id).elapsedSeconds, 120);
  s = run(s, 'timer.resume', { id: a.id }, local(28, 10, 5)).state;
  s = run(s, 'timer.finish', { id: a.id }, local(28, 10, 6)).state;
  assert.equal(byId(s, a.id).elapsedSeconds, 180);
  assert.equal(s.activeTimer, null);
});

test('timer.start on another task flushes the running one first', () => {
  const a = task('A'), b = task('B');
  let s = run(state({ tasks: [a, b] }), 'timer.start', { id: a.id }, local(28, 10)).state;
  s = run(s, 'timer.start', { id: b.id }, local(28, 10, 10)).state;
  assert.equal(byId(s, a.id).elapsedSeconds, 600);
  assert.equal(s.activeTimer.taskId, b.id);
});

test('task.setRemaining anchors at the live elapsed reading', () => {
  const a = task('A', { estimatedMinutes: 60 });
  let s = run(state({ tasks: [a] }), 'timer.start', { id: a.id }, local(28, 10)).state;
  s = run(s, 'task.setRemaining', { id: a.id, minutes: 45 }, local(28, 10, 20)).state;
  assert.deepEqual(byId(s, a.id).remainingOverride, { atElapsedSeconds: 1200, remainingMinutes: 45 });
});

test('task.setElapsed rebases a live timer at the operation time', () => {
  const a = task('A');
  let s = run(state({ tasks: [a] }), 'timer.start', { id: a.id }, local(28, 10)).state;
  s = run(s, 'task.setElapsed', { id: a.id, seconds: 900 }, local(28, 10, 30)).state;
  assert.deepEqual(s.activeTimer, { taskId: a.id, startedAt: local(28, 10, 30), baseSeconds: 900 });
});

// ─── data.import ─────────────────────────────────────────────────────────────

test('data.import replaces everything with the file, unrestamped', () => {
  const kept = task('Imported', { isLocked: true });
  kept.scheduledBlocks = [blk(kept, FRIDAY, 600)];
  const file = JSON.parse(JSON.stringify({
    tasks: [kept], workSchedule: { ...DEFAULT_WORK_SCHEDULE, bufferMinutes: 5 }, activeTimer: null,
    fixedBlocks: [{ id: 'f', date: FRIDAY, startMinutes: 720, durationMinutes: 30 }]
  }));
  const { state: s, result } = run(state({ tasks: [task('Old')] }), 'data.import', { data: file });
  assert.deepEqual(result, { ok: true, tasks: 1 });
  assert.deepEqual(s.tasks.map(t => t.description), ['Imported']);
  assert.ok(s.tasks[0].peak instanceof Date);
  assert.equal(+s.tasks[0].lastModifiedAt, +kept.lastModifiedAt, 'not restamped');
  assert.equal(s.workSchedule.bufferMinutes, 5);
  assert.deepEqual(s.fixedBlocks.map(f => f.id), ['f']);
});

test('data.import refuses something that is not an export, changing nothing', () => {
  const s = state({ tasks: [task('Keep me')] });
  for (const bad of [null, [], { notes: [] }, { tasks: [{ description: 'no id' }] }, { tasks: [{ id: 'x', description: 'x', onset: 'soon', peak: 'later' }] }]) {
    const r = run(s, 'data.import', { data: bad });
    assert.equal(r.result.ok, false, JSON.stringify(bad));
    assert.equal(typeof r.result.reason, 'string');
    assert.equal(r.state, s);
  }
});
