// The state's plain-data form. State holds Dates (a task's onset, peak and
// timestamps; the timer's startedAt); stored, exported and sent over the wire
// they are ISO strings. JSON.stringify writes them, reviveState reads them
// back. One shape everywhere: localStorage (taskflow_v2), the export file, the
// data.import operation and, later, the backend's snapshots.

import { DEFAULT_WORK_SCHEDULE } from '../lib/constants.js';

const TASK_DATE_FIELDS = ['createdAt', 'lastModifiedAt', 'completedAt', 'onset', 'peak'];

export function emptyState() {
  return { tasks: [], workSchedule: DEFAULT_WORK_SCHEDULE, fixedBlocks: [], activeTimer: null };
}

function reviveTask(raw) {
  const task = { ...raw };
  for (const field of TASK_DATE_FIELDS) {
    if (task[field]) task[field] = new Date(task[field]);
  }
  if (task.elapsedSeconds === undefined) task.elapsedSeconds = 0;
  if (!Array.isArray(task.scheduledBlocks)) task.scheduledBlocks = [];
  return task;
}

function reviveTimer(raw) {
  if (!raw) return null;
  return {
    taskId:      raw.taskId,
    startedAt:   raw.startedAt ? new Date(raw.startedAt) : null,
    baseSeconds: raw.baseSeconds ?? 0
  };
}

// Plain data (parsed JSON) → state, filling what older saves lack.
export function reviveState(raw) {
  return {
    tasks:        (raw?.tasks || []).map(reviveTask),
    // Spread first, default after: a key that exists keeps its position, so
    // reviving doesn't reorder keys and an export re-imports byte-identically.
    workSchedule: raw?.workSchedule ? { ...raw.workSchedule, bufferMinutes: raw.workSchedule.bufferMinutes ?? 15 } : DEFAULT_WORK_SCHEDULE,
    fixedBlocks:  raw?.fixedBlocks || [],
    activeTimer:  reviveTimer(raw?.activeTimer ?? null)
  };
}

// The four slices in their stored key order, so an export, a save and an
// export of the re-imported file are byte-identical.
export function serializeState(state, space) {
  const { tasks, workSchedule, activeTimer, fixedBlocks } = state;
  return JSON.stringify({ tasks, workSchedule, activeTimer, fixedBlocks }, null, space);
}

// A fingerprint of the state, for checking that two copies agree without
// shipping either. The backend sends it with every batch of operations; a
// device that replays the batch to a different hash has a different core and
// reloads the backend's state instead. cyrb53: fast, synchronous, the same in
// every JavaScript engine. Not cryptographic, and doesn't need to be.
export function stateHash(state) {
  const str = serializeState(state);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

// Checks that parsed JSON looks like TaskFlow data before it replaces
// anything. Returns an error message, or null when it is acceptable. Deliberately
// shallow: it guards against importing the wrong file, not against crafted ones.
export function checkStateData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'The file is not a TaskFlow export.';
  if (!Array.isArray(raw.tasks)) return 'The file has no task list, so it is not a TaskFlow export.';
  for (const t of raw.tasks) {
    if (!t || typeof t.id !== 'string' || typeof t.description !== 'string') return 'A task in the file is missing its id or description.';
    for (const f of ['onset', 'peak']) {
      if (Number.isNaN(+new Date(t[f]))) return `The task "${t.description}" has an unreadable ${f} date.`;
    }
  }
  if (raw.workSchedule != null && !Array.isArray(raw.workSchedule.days)) return 'The file\'s work hours are not in a form TaskFlow can read.';
  if (raw.fixedBlocks != null && !Array.isArray(raw.fixedBlocks)) return 'The file\'s fixed blocks are not in a form TaskFlow can read.';
  return null;
}
