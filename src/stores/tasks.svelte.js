// Task and scheduling operations. Each mutation dispatches one operation to the
// domain core through data.svelte.js; the exports and their signatures are the
// app's long-standing store API, so components did not need to change.

import { data, dispatch, initPersistence } from './data.svelte.js';
import {
  liveSeconds as liveSecondsAt,
  liveElapsedFor as liveElapsedAt,
  withLiveElapsed as withLiveElapsedAt
} from '../core/live.js';

export { initPersistence };

export const tasks = {
  get value() { return data.tasks; }
};

export const activeTasks = {
  get value() { return data.tasks.filter(t => !t.isCompleted && !t.isDeleted); }
};

export const completedTasks = {
  get value() { return data.tasks.filter(t => t.isCompleted && !t.isDeleted); }
};

// ─── tasks ───────────────────────────────────────────────────────────────────

export function addTask(description, onset, peak, peakPressure, estimatedMinutes) {
  return dispatch('task.add', { id: crypto.randomUUID(), description, onset, peak, peakPressure, estimatedMinutes });
}

export function editTask(taskId, patch) {
  dispatch('task.edit', { id: taskId, patch });
}

export function deleteTask(taskId) {
  dispatch('task.delete', { id: taskId });
}

export function completeTask(taskId) {
  dispatch('task.complete', { id: taskId });
}

export function restoreTask(taskId) {
  dispatch('task.restore', { id: taskId });
}

// The UI toggles; the operation records the value it toggled to, so replaying
// it can't flip the lock the wrong way.
export function toggleLock(taskId) {
  const t = data.tasks.find(x => x.id === taskId);
  if (t) dispatch('task.setLock', { id: taskId, locked: !t.isLocked });
}

// Manually set minutes of work left; null clears the override.
export function setRemaining(taskId, minutes) {
  dispatch('task.setRemaining', { id: taskId, minutes });
}

// Manually correct logged elapsed time; a live timer for the task is rebased.
export function setElapsed(taskId, seconds) {
  dispatch('task.setElapsed', { id: taskId, seconds });
}

// ─── scheduling ──────────────────────────────────────────────────────────────

export function scheduleTask(taskId, blocks) {
  dispatch('schedule.place', { id: taskId, blocks });
}

export function unscheduleTask(taskId) {
  dispatch('schedule.unschedule', { id: taskId });
}

// Place one task at the earliest free work time. Returns { ok: false, reason }
// or { ok: true, blocks, previousBlocks }; previousBlocks feeds restoreBlocks.
export function scheduleTaskNext(taskId) {
  return dispatch('schedule.next', { id: taskId });
}

// Undo for scheduleTaskNext: put back exactly what the task had, including
// having had nothing.
export function restoreBlocks(taskId, blocks) {
  dispatch('schedule.place', { id: taskId, blocks });
}

export function autoScheduleAll() {
  dispatch('schedule.auto');
}

export function clearSchedule() {
  dispatch('schedule.clear');
}

// Commit an Upcoming drop: place `movedTaskId` before `insertBeforeTaskId`
// (null = at the end) within `targetDateStr`, repack the day, spill forward.
// `sourceDateStr` is the card's own day, or null from outside the backlog.
export function commitOutlookDrop(movedTaskId, sourceDateStr, targetDateStr, insertBeforeTaskId) {
  dispatch('schedule.outlookMove', {
    id: movedTaskId,
    sourceDate: sourceDateStr,
    targetDate: targetDateStr,
    insertBeforeId: insertBeforeTaskId
  });
}

// ─── timer ───────────────────────────────────────────────────────────────────

export function startTimer(taskId)  { dispatch('timer.start',  { id: taskId }); }
export function pauseTimer(taskId)  { dispatch('timer.pause',  { id: taskId }); }
export function resumeTimer(taskId) { dispatch('timer.resume', { id: taskId }); }
export function finishTimer(taskId) { dispatch('timer.finish', { id: taskId }); }

// Live readings for the UI, at the current moment. Inside the core the same
// functions take the operation's time instead.
export function liveSeconds(t) {
  return liveSecondsAt(t, Date.now());
}

export function liveElapsedFor(task) {
  return liveElapsedAt(data, task, Date.now());
}

export function withLiveElapsed(task) {
  return withLiveElapsedAt(data, task, Date.now());
}
