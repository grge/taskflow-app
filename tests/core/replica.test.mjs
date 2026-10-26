// The replica: base + pending, and how it converges with a backend. The
// backend here is a few lines standing in for the real one (phase 3): it
// applies operations in arrival order with the same core and hands each device
// the batch it applied.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/core/apply.js';
import { emptyState, reviveState, serializeState } from '../../src/core/state.js';
import {
  createReplica, currentState, pendingOps, applyLocal, commitLocal, receive, rebase, reject, toStored
} from '../../src/sync/replica.js';

const minute = n => new Date(2026, 9, 28, 10, n).toISOString();
let seq = 0;
function op(type, args, at = minute(seq)) {
  seq += 1;
  return JSON.parse(JSON.stringify({ id: `op${seq}`, type, args, at, tz: 'test', actor: 'app' }));
}
const addTask = (id, description, extra = {}) => op('task.add', {
  id, description, onset: new Date(2026, 9, 26), peak: new Date(2026, 10, 1), peakPressure: 0.5, estimatedMinutes: 60, ...extra
});

function backend(state = emptyState()) {
  const server = { state, version: 0, log: [] };
  server.post = ops => {
    for (const o of ops) {
      server.state = apply(server.state, o, { now: new Date(o.at) }).state;
      server.version += 1;
      server.log.push(o);
    }
    return { version: server.version, ops };
  };
  server.since = v => ({ version: server.version, ops: server.log.slice(v) });
  return server;
}

const local = (r, o) => applyLocal(r, o).replica;
const titles = r => currentState(r).tasks.map(t => t.description);

test('local operations apply at once and wait in pending; commitLocal makes them final', () => {
  let r = createReplica({ base: emptyState() }).replica;
  r = local(r, addTask('a', 'A'));
  r = local(r, op('schedule.next', { id: 'a' }));
  assert.deepEqual(titles(r), ['A']);
  assert.equal(currentState(r).tasks[0].scheduledBlocks.length, 1);
  assert.equal(pendingOps(r).length, 2);
  assert.equal(r.base.tasks.length, 0, 'base is the acknowledged state');

  const committed = commitLocal(r);
  assert.equal(pendingOps(committed).length, 0);
  assert.equal(committed.base, currentState(r));
});

test('an acknowledgement in the expected order reuses the cached state', () => {
  const server = backend();
  let r = createReplica({ base: emptyState(), version: 0 }).replica;
  const ops = [addTask('a', 'A'), op('schedule.next', { id: 'a' }), addTask('b', 'B')];
  for (const o of ops) r = local(r, o);
  const afterTwo = r.pending[1].after;

  const ack = receive(r, server.post(ops.slice(0, 2)));
  assert.equal(ack.replica.base, afterTwo, 'no recomputation');
  assert.equal(ack.replica.version, 2);
  assert.deepEqual(pendingOps(ack.replica).map(o => o.id), [ops[2].id]);
  assert.deepEqual(titles(ack.replica), ['A', 'B']);
});

// The design's headline case: two devices edit at once, the backend's order
// wins, and both end up with its state without losing either edit.
test('two devices converge on the backend\'s state, keeping both edits', () => {
  const server = backend();
  let phone = createReplica({ base: emptyState(), version: 0 }).replica;
  let laptop = createReplica({ base: emptyState(), version: 0 }).replica;

  const phoneOps = [addTask('p', 'From phone'), op('schedule.next', { id: 'p' })];
  const laptopOps = [addTask('l', 'From laptop', { peakPressure: 0.9 }), op('schedule.next', { id: 'l' })];
  for (const o of phoneOps) phone = local(phone, o);
  for (const o of laptopOps) laptop = local(laptop, o);
  // Each device scheduled its task in the morning's first free slot.
  assert.ok(currentState(phone).tasks[0].scheduledBlocks[0].startMinutes < 660);
  assert.ok(currentState(laptop).tasks[0].scheduledBlocks[0].startMinutes < 660);

  // The laptop's operations reach the backend first.
  const first = server.post(laptopOps);
  const second = server.post(phoneOps);
  for (const batch of [first, second]) {
    phone = receive(phone, batch).replica;
    laptop = receive(laptop, batch).replica;
  }

  assert.deepEqual(currentState(phone), server.state);
  assert.deepEqual(currentState(laptop), server.state);
  assert.equal(pendingOps(phone).length + pendingOps(laptop).length, 0);
  const [l, p] = server.state.tasks;
  assert.deepEqual([l.description, p.description], ['From laptop', 'From phone']);
  assert.ok(p.scheduledBlocks[0].startMinutes > l.scheduledBlocks[0].startMinutes,
    'the phone\'s "next free slot", replayed after the laptop\'s, found the slot that was free then');
});

test('pending operations the backend hasn\'t seen replay on top of what it sent', () => {
  const server = backend();
  let r = createReplica({ base: emptyState(), version: 0 }).replica;
  r = local(r, addTask('mine', 'Mine'));
  const theirs = server.post([addTask('theirs', 'Theirs')]);
  const res = receive(r, theirs);
  assert.deepEqual(titles(res.replica), ['Theirs', 'Mine']);
  assert.equal(pendingOps(res.replica).length, 1);
  assert.equal(res.replica.base.tasks.length, 1);
});

test('a batch that skips versions is reported as a gap and changes nothing', () => {
  const server = backend();
  let r = createReplica({ base: emptyState(), version: 0 }).replica;
  server.post([addTask('a', 'A')]);
  const later = server.post([addTask('b', 'B')]);
  const res = receive(r, later);
  assert.equal(res.gap, true);
  assert.equal(res.replica, r);
  const caughtUp = receive(r, server.since(r.version));
  assert.equal(caughtUp.gap, false);
  assert.deepEqual(titles(caughtUp.replica), ['A', 'B']);
});

test('an operation this core can\'t apply marks the replica diverged and changes nothing', () => {
  const r = createReplica({ base: emptyState(), version: 0 }).replica;
  const res = receive(r, { version: 1, ops: [op('task.fromTheFuture', {})] });
  assert.equal(res.diverged, true);
  assert.equal(res.replica, r);
});

test('rebase swaps in a full state and keeps what is pending', () => {
  const server = backend();
  server.post([addTask('a', 'A'), addTask('b', 'B')]);
  let r = createReplica({ base: emptyState(), version: null }).replica;
  r = local(r, addTask('c', 'C'));
  const res = rebase(r, { state: server.state, version: server.version });
  assert.equal(res.replica.version, 2);
  assert.deepEqual(titles(res.replica), ['A', 'B', 'C']);
});

test('reject drops one pending operation and replays the rest', () => {
  let r = createReplica({ base: emptyState(), version: 0 }).replica;
  const bad = addTask('x', 'Rejected');
  r = local(r, bad);
  r = local(r, addTask('y', 'Kept'));
  assert.deepEqual(titles(reject(r, bad.id).replica), ['Kept']);
});

// What a reload does: the stored form goes through JSON and back.
test('the pending queue survives storage and replays to the same state', () => {
  let r = createReplica({ base: emptyState(), version: 3 }).replica;
  r = local(r, addTask('a', 'A'));
  r = local(r, op('schedule.next', { id: 'a' }));
  r = local(r, op('timer.start', { id: 'a' }));

  const stored = JSON.parse(JSON.stringify({ ...toStored(r), base: JSON.parse(serializeState(r.base)) }));
  const { replica: reloaded, dropped } = createReplica({ base: reviveState(stored.base), version: stored.version, pending: stored.pending });
  assert.deepEqual(dropped, []);
  assert.equal(reloaded.version, 3);
  assert.deepEqual(pendingOps(reloaded), pendingOps(r));
  assert.deepEqual(currentState(reloaded), currentState(r));
});

test('a stored operation the core no longer knows is dropped on load, not fatal', () => {
  const { replica, dropped } = createReplica({ base: emptyState(), pending: [addTask('a', 'A'), op('task.retired', {}), addTask('b', 'B')] });
  assert.deepEqual(titles(replica), ['A', 'B']);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].op.type, 'task.retired');
});
