// The one place TaskFlow's data lives. Every change is an operation applied by
// the domain core (src/core/apply.js) through this device's replica
// (src/sync/replica.js): the last acknowledged state plus the operations not yet
// acknowledged. This module owns the replica, stamps each operation, and
// persists the result. tasks.svelte.js and schedule.svelte.js are thin wrappers
// over dispatch() that keep the app's existing store API.
//
// Local-only is the same path minus the network: with no backend to wait for,
// each operation is acknowledged as soon as it is applied (commitLocal), so the
// pending queue is empty between operations. With a backend connected, a sync
// client (src/sync/client.js) holds the replica instead: operations wait in the
// pending queue until the backend applies them, and other devices' operations
// arrive over its stream.
//
// State is held as four raw slices rather than one object so readers are only
// notified about the slice that changed, as they were when each store held its
// own. apply() never mutates and reuses untouched slices, so identity tells us
// what changed. No caller mutates store data in place, which is what makes
// $state.raw safe here.

import { loadState, saveState, loadSync, saveSync, loadBackend, saveBackend } from '../lib/persistence.js';
import { serializeState, checkStateData } from '../core/state.js';
import { createReplica, currentState, applyLocal, commitLocal, toStored } from '../sync/replica.js';
import { createSyncClient } from '../sync/client.js';
import { firstConnectPlan, mergeStates } from '../sync/connect.js';

/* global __TASKFLOW_CORE_VERSION__ */
const CORE_VERSION = typeof __TASKFLOW_CORE_VERSION__ === 'string' ? __TASKFLOW_CORE_VERSION__ : null;

// A device that closed with operations still pending reopens on base plus
// those operations, replayed; taskflow_v2 may be one save behind them.
function initialReplica() {
  const sync = loadSync();
  if (!sync?.pending.length) return createReplica({ base: loadState(), version: sync?.version ?? null }).replica;
  const { replica, dropped } = createReplica({ base: sync.base ?? loadState(), version: sync.version, pending: sync.pending });
  for (const { op, error } of dropped) console.warn(`TaskFlow dropped a saved operation it could not apply (${op.type}):`, error);
  return replica;
}

let backend = loadBackend();
// Local-only: no backend, so whatever was pending is final (see above).
// Connected: it waits for the backend, which the client sends it to.
let replica = backend ? initialReplica() : commitLocal(initialReplica());
let client = null;
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

export const TIME_ZONE = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
})();

function publish(next) {
  if (next.tasks        !== _tasks)        _tasks        = next.tasks;
  if (next.workSchedule !== _workSchedule) _workSchedule = next.workSchedule;
  if (next.fixedBlocks  !== _fixedBlocks)  _fixedBlocks  = next.fixedBlocks;
  if (next.activeTimer  !== _activeTimer)  _activeTimer  = next.activeTimer;
}

const current = () => (client ? client.state : currentState(replica));

// The only place the app's data path reads the clock: the operation is stamped
// here and the core takes `now` from that stamp. Args go through JSON so the
// operation applied here is exactly the one that would be stored, replayed or
// sent (Dates become ISO strings, which the core accepts).
function stamp(type, args) {
  return {
    id: crypto.randomUUID(),
    type,
    args: JSON.parse(JSON.stringify(args)),
    at: new Date().toISOString(),
    tz: TIME_ZONE,
    actor: 'app'
  };
}

export function dispatch(type, args = {}) {
  const op = stamp(type, args);
  if (client) return client.submit(op); // publishes through onChange
  const applied = applyLocal(replica, op);
  replica = commitLocal(applied.replica);
  publish(currentState(replica));
  return applied.result;
}

// ─── the backend ─────────────────────────────────────────────────────────────

let _backendUrl = $state(backend?.url ?? null);
let _status     = $state.raw({ state: 'offline', detail: null }); // client.js's status
let _info       = $state.raw(null);                               // the backend's /v1/info
let _pending    = $state(replica.pending.length);
let _notices    = $state.raw([]);                                 // [{ id, message }]
let noticeSeq = 0;

export const sync = {
  get connected() { return _backendUrl !== null; },
  get url()       { return _backendUrl; },
  get status()    { return _status; },
  get info()      { return _info; },
  get pending()   { return _pending; },
  get notices()   { return _notices; }
};

// The client says some things on every reconnect (a core version mismatch);
// one copy on screen is enough.
function notify(message) {
  if (_notices.some(n => n.message === message)) return;
  _notices = [..._notices.slice(-3), { id: ++noticeSeq, message }];
}

export function dismissNotice(id) {
  _notices = _notices.filter(n => n.id !== id);
}

// Saved as it changes rather than by the $effect below, so a page closed right
// after a batch arrives can't leave taskflow_sync's version ahead of
// taskflow_v2's state.
function persist(stored) {
  saveSync(stored);
  saveState(current());
  _pending = stored.pending.length;
}

// Said once a session: the backend schedules in its home timezone, so a
// device elsewhere sees its scheduling recomputed when it syncs.
let timeZoneNoted = false;
function checkTimeZone(info) {
  if (timeZoneNoted || !info?.homeTimeZone || !TIME_ZONE || info.homeTimeZone === TIME_ZONE) return;
  timeZoneNoted = true;
  notify(`This device is on ${TIME_ZONE} time and the backend on ${info.homeTimeZone}. The backend schedules in its own timezone, so blocks may move when they sync.`);
}

function startClient() {
  client = createSyncClient({
    url: backend.url,
    token: backend.token,
    replica,
    coreVersion: CORE_VERSION,
    onChange: publish,
    onPersist: persist,
    onStatus: s => { _status = s; _info = client?.info ?? _info; checkTimeZone(_info); },
    onNotice: notify
  });
  client.start();
}

if (backend) startClient();

// Connect this device to a backend that probeBackend (src/sync/connect.js)
// checked. `choice` settles a 'ask' plan: 'merge', 'backend' or 'device'.
// The backend's state becomes the base; whatever this device sends goes as one
// data.import, queued like any other operation, so it survives going offline.
export function connect(probe, { token, choice = null }) {
  if (client) disconnect();
  const device = current();
  const plan = firstConnectPlan(device, probe.state);
  const mode = plan === 'ask' ? choice : plan;
  if (!['download', 'upload', 'merge', 'backend', 'device'].includes(mode)) throw new Error(`connect: no choice made for plan ${plan}`);

  let next = createReplica({ base: probe.state, version: probe.version }).replica;
  const send = mode === 'upload' || mode === 'device' ? device : mode === 'merge' ? mergeStates(device, probe.state) : null;
  if (send) next = applyLocal(next, stamp('data.import', { data: JSON.parse(serializeState(send)) })).replica;

  replica = next;
  backend = { url: probe.url, token: token.trim() };
  saveBackend(backend);
  _backendUrl = backend.url;
  _notices = [];
  _info = probe.info;
  checkTimeZone(probe.info);
  publish(currentState(replica));
  persist(toStored(replica));
  startClient();
}

// Back to local-only, keeping everything this device has, including changes
// the backend hasn't acknowledged yet. Returns how many of those there were.
export function disconnect() {
  if (!client) return 0;
  const c = client;
  client = null;
  c.stop();
  const unsent = c.replica.pending.length;
  replica = { ...commitLocal(c.replica), version: null };
  backend = null;
  saveBackend(null);
  _backendUrl = null;
  _status = { state: 'offline', detail: null };
  _info = null;
  _notices = [];
  persist(toStored(replica));
  return unsent;
}

// ─── export and import ───────────────────────────────────────────────────────

// The current data as an export file: the taskflow_v2 shape, indented.
export function exportData() {
  return serializeState(current(), 2);
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

// Replace all data with what readImport returned. Same result shape. With a
// backend connected this replaces the data on every device.
export function importData(data) {
  return dispatch('data.import', { data });
}

// Must run inside a component: $effect needs an owner. Called from App.svelte.
export function initPersistence() {
  $effect(() => {
    saveState({ tasks: _tasks, workSchedule: _workSchedule, fixedBlocks: _fixedBlocks, activeTimer: _activeTimer });
  });
}
