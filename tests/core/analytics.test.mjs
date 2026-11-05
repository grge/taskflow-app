// The Insights tab's numbers. Like the core tests, every time is a local
// wall-clock time and tests/run-core.mjs runs this under several timezones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyFromOps, eventsFromTasks, flowSeries, backlogBridge, runway, letAloneCandidates } from '../../src/lib/analytics.js';
import { apply } from '../../src/core/apply.js';
import { emptyState } from '../../src/core/state.js';
import { remainingMinutes } from '../../src/lib/tasks.js';

const local = (month, day, h = 10, m = 0) => new Date(2026, month - 1, day, h, m);
let seq = 0;
const op = (type, args, at) => ({ id: `op${++seq}`, type, args, at: at.toISOString(), tz: 'UTC', actor: 'test' });
const add = (id, at, estimatedMinutes = 60) => op('task.add', {
  id, description: id, estimatedMinutes, peakPressure: 0.5,
  onset: new Date(+at + 86_400_000).toISOString(), peak: new Date(+at + 5 * 86_400_000).toISOString()
}, at);
const sum = events => events.reduce((s, e) => s + e.minutes, 0);
const types = events => events.map(e => e.type);

// Replays must land on what the core really computed.
function liveBacklog(ops) {
  let state = emptyState();
  for (const o of ops) state = apply(state, o, { now: new Date(o.at) }).state;
  return state.tasks.filter(t => !t.isCompleted && !t.isDeleted).reduce((s, t) => s + remainingMinutes(t), 0);
}

test('events sum to the backlog through every kind of change', () => {
  const ops = [
    add('a', local(10, 1)), add('b', local(10, 1)), add('c', local(10, 2), 120), add('d', local(10, 2), 30),
    op('task.setRemaining', { id: 'a', minutes: 90 }, local(10, 3)),
    op('task.edit', { id: 'b', patch: { estimatedMinutes: 45 } }, local(10, 3)),
    op('timer.start', { id: 'c' }, local(10, 4, 9)),
    op('timer.start', { id: 'd' }, local(10, 4, 10)), // flushes c's hour
    op('timer.finish', { id: 'd' }, local(10, 4, 10, 15)),
    op('task.setElapsed', { id: 'c', seconds: 1800 }, local(10, 5)),
    op('task.complete', { id: 'a' }, local(10, 6)),
    op('task.delete', { id: 'd' }, local(10, 7))
  ];
  const { events } = historyFromOps(ops);
  assert.equal(sum(events), liveBacklog(ops));
  assert.deepEqual(types(events), ['added', 'added', 'added', 'added', 'reestimated', 'reestimated', 'worked', 'worked', 'worked', 'done', 'dropped']);
});

test('scheduling operations are skipped, so they cannot move history', () => {
  const ops = [add('a', local(10, 1)), op('schedule.auto', {}, local(10, 2)), op('schedule.clear', {}, local(10, 2)), op('hours.update', { schedule: { days: [] } }, local(10, 3))];
  assert.deepEqual(types(historyFromOps(ops).events), ['added']);
});

test('an unknown operation is passed over', () => {
  assert.deepEqual(types(historyFromOps([add('a', local(10, 1)), op('task.fromTheFuture', {}, local(10, 2))]).events), ['added']);
});

test('a corrected creation time is when the task arrived', () => {
  const { events } = historyFromOps([add('a', local(10, 5)), op('task.edit', { id: 'a', patch: { createdAt: local(10, 1).toISOString() } }, local(10, 5))]);
  assert.equal(+events[0].at, +local(10, 1));
});

test('backdated operations land when they say, whatever order they arrived in', () => {
  const { events } = historyFromOps([add('a', local(10, 1)), add('b', local(10, 2)), op('task.complete', { id: 'b' }, local(10, 3)), op('task.complete', { id: 'a' }, local(10, 1, 12))]);
  assert.deepEqual(events.map(e => e.at.getDate()), [1, 1, 2, 3]);
});

test('a restore takes the completion back', () => {
  const ops = [add('a', local(10, 1)), op('task.complete', { id: 'a' }, local(10, 2)), op('task.restore', { id: 'a' }, local(10, 3))];
  const { events } = historyFromOps(ops);
  assert.deepEqual(types(events), ['added']);
  assert.equal(sum(events), liveBacklog(ops));
});

test('completing an already completed task counts once', () => {
  const { events } = historyFromOps([add('a', local(10, 1)), op('task.complete', { id: 'a' }, local(10, 2)), op('task.complete', { id: 'a' }, local(10, 2, 11))]);
  assert.deepEqual(types(events), ['added', 'done']);
});

test('a timer left running on a completed task stops counting at completion', () => {
  const { tasks } = historyFromOps([
    add('a', local(10, 1)), op('timer.start', { id: 'a' }, local(10, 2, 9)),
    op('task.complete', { id: 'a' }, local(10, 2, 10)), op('timer.finish', { id: 'a' }, local(10, 3, 10))
  ]);
  assert.equal(tasks[0].elapsedSeconds, 3600);
});

test('an import restarts history from the dates it carries', () => {
  const task = { id: 'x', description: 'x', estimatedMinutes: 60, onset: local(9, 2), peak: local(9, 5), peakPressure: 0.5, createdAt: local(9, 1), lastModifiedAt: local(9, 3), completedAt: local(9, 3), isCompleted: true, isDeleted: false, scheduledBlocks: [], elapsedSeconds: 0 };
  const { events } = historyFromOps([add('old', local(10, 1)), op('data.import', { data: { tasks: [JSON.parse(JSON.stringify(task))] } }, local(10, 2)), add('new', local(10, 3))]);
  assert.deepEqual(events.map(e => [e.taskId, e.type]), [['x', 'added'], ['x', 'done'], ['new', 'added']]);
});

test('task dates alone give the counts, and a deletion falls back to lastModifiedAt', () => {
  const base = { estimatedMinutes: 60, elapsedSeconds: 0, scheduledBlocks: [], isCompleted: false, isDeleted: false, createdAt: local(10, 1), lastModifiedAt: local(10, 2) };
  const events = eventsFromTasks([
    { ...base, id: 'open' },
    { ...base, id: 'done', isCompleted: true, completedAt: local(10, 3) },
    { ...base, id: 'gone', isDeleted: true, deletedAt: local(10, 4) },
    { ...base, id: 'old', isDeleted: true }
  ]);
  assert.equal(sum(events), 60);
  assert.equal(+events.find(e => e.taskId === 'gone' && e.type === 'dropped').at, +local(10, 4));
  assert.equal(+events.find(e => e.taskId === 'old' && e.type === 'dropped').at, +local(10, 2));
});

// ─── periods ─────────────────────────────────────────────────────────────────

const history = () => historyFromOps([
  add('a', local(10, 5)), add('b', local(10, 5, 23, 30)), add('c', local(10, 7), 120),
  op('task.complete', { id: 'a' }, local(10, 6, 0, 30)), op('task.delete', { id: 'b' }, local(10, 12))
]).events;

test('days keep quiet periods and split at local midnight', () => {
  const series = flowSeries(history(), 'day', local(10, 13));
  assert.equal(series.length, 9);
  assert.deepEqual(series.slice(0, 3).map(r => [r.added, r.done, r.backlog, r.open]), [[2, 0, 120, 2], [0, 1, 60, 1], [1, 0, 180, 2]]);
  assert.equal(series[7].dropped, 1);
  assert.equal(series[8].backlog, 120);
});

test('weeks start on Monday, and months on the first', () => {
  const weeks = flowSeries(history(), 'week', local(10, 13));
  assert.deepEqual(weeks.map(r => r.start.getDate()), [5, 12]); // Mon 5 and Mon 12 October
  const months = flowSeries(history(), 'month', local(11, 2));
  assert.deepEqual(months.map(r => r.start.getMonth()), [9, 10]);
  assert.equal(months[1].added, 0);
  assert.equal(months[1].opening, 120);
});

test('a long history is cut to the limit, carrying the backlog in', () => {
  const series = flowSeries(history(), 'day', local(12, 31));
  assert.equal(series.length, 30);
  assert.equal(series[0].opening, 120);
  assert.equal(series[0].open, 1);
});

test('no events, no periods', () => {
  assert.deepEqual(flowSeries([], 'day', local(10, 1)), []);
  assert.equal(backlogBridge([]), null);
});

test('the bridge adds up to where the backlog ended', () => {
  const events = historyFromOps([
    add('a', local(10, 5)), add('b', local(10, 5)), op('task.setRemaining', { id: 'a', minutes: 150 }, local(10, 6)),
    op('task.setElapsed', { id: 'a', seconds: 1800 }, local(10, 7)), op('task.complete', { id: 'a' }, local(10, 8)), op('task.delete', { id: 'b' }, local(10, 9)), add('c', local(10, 9))
  ]).events;
  const b = backlogBridge(flowSeries(events, 'day', local(10, 10)));
  assert.equal(b.opening + b.added + b.reestimated + b.workedOff + b.dropped, b.closing);
  assert.deepEqual([b.added, b.reestimated, b.workedOff, b.dropped, b.closing], [180, 90, -150, -60, 60]);
});

// ─── runway and let-alone ────────────────────────────────────────────────────

test('runway divides the backlog by the recent pace', () => {
  const now = local(10, 29);
  const events = historyFromOps([
    add('a', local(10, 1), 240), add('b', local(10, 1), 1000),
    op('task.complete', { id: 'a' }, local(10, 8))
  ]).events;
  const r = runway(events, now);
  assert.equal(r.days, 28);
  assert.equal(r.outPerWeek, 60);
  assert.equal(r.weeks, 1000 / 60);
});

test('runway has no answer until something has been worked off', () => {
  assert.equal(runway(historyFromOps([add('a', local(10, 1))]).events, local(10, 2)).weeks, null);
  assert.equal(runway([], local(10, 2)).weeks, null);
});

test('one busy first day does not set the pace', () => {
  const now = local(10, 1, 18);
  const events = historyFromOps([add('a', local(10, 1, 9), 420), add('b', local(10, 1, 9), 60), op('task.complete', { id: 'a' }, local(10, 1, 17))]).events;
  assert.equal(runway(events, now).days, 7);
  assert.equal(runway(events, now).outPerWeek, 420);
});

test('the backlog being entered on the first day is not new work arriving', () => {
  const events = historyFromOps([add('a', local(10, 1), 600), add('b', local(10, 1, 15), 600), add('c', local(10, 8, 12), 70)]).events;
  assert.equal(runway(events, local(10, 15)).inPerWeek, 70 / 14 * 7);
});

test('let-alone candidates are old, unplanned and not pressing', () => {
  const now = local(11, 1);
  const task = (id, o = {}) => ({
    id, createdAt: local(10, 1), onset: local(12, 1), peak: local(12, 5), peakPressure: 0.5,
    scheduledBlocks: [], isCompleted: false, isDeleted: false, ...o
  });
  const found = letAloneCandidates([
    task('newer', { createdAt: local(10, 10) }),
    task('oldest', { createdAt: local(9, 1) }),
    task('young', { createdAt: local(10, 25) }),
    task('planned', { scheduledBlocks: [{}] }),
    task('pressing', { onset: local(10, 2), peak: local(10, 20) }),
    task('finished', { isCompleted: true }),
    task('gone', { isDeleted: true })
  ], now);
  assert.deepEqual(found.map(t => t.id), ['oldest', 'newer']);
});
