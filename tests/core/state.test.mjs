// The stored and exported form of the state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/core/apply.js';
import { emptyState, reviveState, serializeState } from '../../src/core/state.js';
import { DEFAULT_WORK_SCHEDULE } from '../../src/lib/constants.js';

const NOW = new Date(2026, 9, 28, 10);
const run = (s, type, args) => apply(s, { type, args }, { now: NOW }).state;

function sampleState() {
  let s = emptyState();
  s = run(s, 'task.add', { id: 'a', description: 'Write report', onset: new Date(2026, 9, 27), peak: new Date(2026, 9, 30, 17), peakPressure: 0.7, estimatedMinutes: 90 });
  s = run(s, 'task.add', { id: 'b', description: 'Ünïcödé "quotes"', onset: new Date(2026, 9, 28), peak: new Date(2026, 10, 2), peakPressure: 0.4, estimatedMinutes: 30 });
  s = run(s, 'schedule.auto', {});
  s = run(s, 'task.setLock', { id: 'b', locked: true });
  s = run(s, 'block.add', { block: { id: 'f', date: '2026-10-29', startMinutes: 720, durationMinutes: 60, label: 'Lunch' } });
  s = run(s, 'timer.start', { id: 'a' });
  return s;
}

test('export → import → export is byte-identical', () => {
  const exported = serializeState(sampleState(), 2);
  const imported = run(sampleState(), 'data.import', { data: JSON.parse(exported) });
  assert.equal(serializeState(imported, 2), exported);
});

test('a fresh install round-trips too, default work hours included', () => {
  const exported = serializeState(emptyState(), 2);
  assert.equal(serializeState(run(emptyState(), 'data.import', { data: JSON.parse(exported) }), 2), exported);
});

test('reviving restores Dates and equals the original state', () => {
  const s = sampleState();
  const revived = reviveState(JSON.parse(serializeState(s)));
  assert.deepEqual(revived, s);
  assert.ok(revived.activeTimer.startedAt instanceof Date);
});

test('reviving fills what older saves lack, without reordering what they have', () => {
  const old = { tasks: [{ id: 'x', description: 'x', onset: NOW.toISOString(), peak: NOW.toISOString() }], workSchedule: { days: DEFAULT_WORK_SCHEDULE.days } };
  const s = reviveState(old);
  assert.equal(s.tasks[0].elapsedSeconds, 0);
  assert.deepEqual(s.tasks[0].scheduledBlocks, []);
  assert.equal(s.workSchedule.bufferMinutes, 15);
  assert.deepEqual(s.fixedBlocks, []);
  assert.equal(s.activeTimer, null);
  assert.deepEqual(Object.keys(reviveState({ tasks: [], workSchedule: { days: [], bufferMinutes: 5 } }).workSchedule), ['days', 'bufferMinutes']);
});
