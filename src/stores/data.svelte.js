// The one place TaskFlow's data lives. Every change is an operation applied by
// the domain core (src/core/apply.js); this module owns the state, stamps each
// operation, and persists the result. tasks.svelte.js and schedule.svelte.js
// are thin wrappers over dispatch() that keep the app's existing store API.
//
// State is held as four raw slices rather than one object so readers are only
// notified about the slice that changed, as they were when each store held its
// own. apply() never mutates and reuses untouched slices, so identity tells us
// what changed. No caller mutates store data in place, which is what makes
// $state.raw safe here.

import { loadState, saveState } from '../lib/persistence.js';
import { apply } from '../core/apply.js';

const initial = loadState();

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

// The only place the app's data path reads the clock: the operation is stamped
// here and the core takes `now` from that stamp.
export function dispatch(type, args = {}) {
  const op = { id: crypto.randomUUID(), type, args, at: new Date().toISOString(), tz: TIME_ZONE, actor: 'app' };
  const prev = { tasks: _tasks, workSchedule: _workSchedule, fixedBlocks: _fixedBlocks, activeTimer: _activeTimer };
  const { state: next, result } = apply(prev, op, { now: new Date(op.at) });
  if (next.tasks        !== prev.tasks)        _tasks        = next.tasks;
  if (next.workSchedule !== prev.workSchedule) _workSchedule = next.workSchedule;
  if (next.fixedBlocks  !== prev.fixedBlocks)  _fixedBlocks  = next.fixedBlocks;
  if (next.activeTimer  !== prev.activeTimer)  _activeTimer  = next.activeTimer;
  return result;
}

// Must run inside a component: $effect needs an owner. Called from App.svelte.
export function initPersistence() {
  $effect(() => {
    saveState(_tasks, _workSchedule, _activeTimer, _fixedBlocks);
  });
}
