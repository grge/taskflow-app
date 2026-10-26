// The one place TaskFlow's data lives. Every change is an operation applied by
// the domain core (src/core/apply.js) through this device's replica
// (src/sync/replica.js): the last acknowledged state plus the operations not yet
// acknowledged. This module owns the replica, stamps each operation, and
// persists the result. tasks.svelte.js and schedule.svelte.js are thin wrappers
// over dispatch() that keep the app's existing store API.
//
// Local-only is the same path minus the network: with no backend to wait for,
// each operation is acknowledged as soon as it is applied (commitLocal), so the
// pending queue is empty between operations. Connecting a backend (phase 4 of
// SYNC-AND-API-DESIGN.md) replaces that with sending and receiving.
//
// State is held as four raw slices rather than one object so readers are only
// notified about the slice that changed, as they were when each store held its
// own. apply() never mutates and reuses untouched slices, so identity tells us
// what changed. No caller mutates store data in place, which is what makes
// $state.raw safe here.

import { loadState, saveState, loadSync, saveSync } from '../lib/persistence.js';
import { serializeState, checkStateData } from '../core/state.js';
import { createReplica, currentState, applyLocal, commitLocal, toStored } from '../sync/replica.js';

// A device that closed with operations still pending reopens on base plus
// those operations, replayed; taskflow_v2 may be one save behind them.
function initialReplica() {
  const sync = loadSync();
  if (!sync?.pending.length) return createReplica({ base: loadState(), version: sync?.version ?? null }).replica;
  const { replica, dropped } = createReplica({ base: sync.base ?? loadState(), version: sync.version, pending: sync.pending });
  for (const { op, error } of dropped) console.warn(`TaskFlow dropped a saved operation it could not apply (${op.type}):`, error);
  return replica;
}

// No backend yet, so whatever was pending is final (see above).
let replica = commitLocal(initialReplica());
saveSync(toStored(replica));

const initial = currentState(replica);
let _tasks        = $state.raw(initial.tasks);
let _workSchedule = $state.raw(initial.workSchedule);
let _fixedBlocks  = $state.raw(initial.fixedBlocks);
let _activeTimer  = $state.raw(initial.activeTimer);

export const data = {
  get tasks()        { return _tasks; },
  get workSchedule() { return _workSchedule; },
  get fixedBlocks()  { return _fixedBlocks; },
  get activeTimer()  { return _activeTimer; }
};

const TIME_ZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
})();

function publish(next) {
  if (next.tasks        !== _tasks)        _tasks        = next.tasks;
  if (next.workSchedule !== _workSchedule) _workSchedule = next.workSchedule;
  if (next.fixedBlocks  !== _fixedBlocks)  _fixedBlocks  = next.fixedBlocks;
  if (next.activeTimer  !== _activeTimer)  _activeTimer  = next.activeTimer;
}

// The only place the app's data path reads the clock: the operation is stamped
// here and the core takes `now` from that stamp. Args go through JSON so the
// operation applied here is exactly the one that would be stored, replayed or
// sent (Dates become ISO strings, which the core accepts).
export function dispatch(type, args = {}) {
  const op = {
    id: crypto.randomUUID(),
    type,
    args: JSON.parse(JSON.stringify(args)),
    at: new Date().toISOString(),
    tz: TIME_ZONE,
    actor: 'app'
  };
  const applied = applyLocal(replica, op);
  replica = commitLocal(applied.replica);
  publish(currentState(replica));
  return applied.result;
}

// ─── export and import ───────────────────────────────────────────────────────

// The current data as an export file: the taskflow_v2 shape, indented.
export function exportData() {
  return serializeState(currentState(replica), 2);
}

// Read an export file's text without changing anything, so the UI can refuse
// the wrong file before asking to replace everything. Returns
// { ok: true, data, tasks } or { ok: false, reason } with a message fit to show.
export function readImport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'The file is not valid JSON, so it is not a TaskFlow export.' };
  }
  const problem = checkStateData(parsed);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, data: parsed, tasks: parsed.tasks.filter(t => !t.isDeleted).length };
}

// Replace all data with what readImport returned. Same result shape.
export function importData(data) {
  return dispatch('data.import', { data });
}

// Must run inside a component: $effect needs an owner. Called from App.svelte.
export function initPersistence() {
  $effect(() => {
    saveState({ tasks: _tasks, workSchedule: _workSchedule, fixedBlocks: _fixedBlocks, activeTimer: _activeTimer });
  });
}
