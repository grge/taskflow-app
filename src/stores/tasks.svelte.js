import { loadState, saveState } from '../lib/persistence.js';
import { createTask, updateTask } from '../lib/tasks.js';
import { placeBlockOnTask, removeBlocksForTask } from '../lib/scheduling.js';
import { autoSchedule } from '../lib/scheduler.js';
import { workSchedule, fixedBlocks } from './schedule.svelte.js';
import { activeTimer, setActiveTimer } from './ui.svelte.js';
import { toISODate, getDaySchedule } from '../lib/calendar.js';
import { SNAP_MINUTES } from '../lib/constants.js';

const _initialState = loadState();
let _tasks = $state(_initialState.tasks);

if (_initialState.activeTimer) {
  setActiveTimer(_initialState.activeTimer);
}

export const tasks = {
  get value() { return _tasks; }
};

export const activeTasks = {
  get value() {
    return _tasks.filter(t => !t.isCompleted && !t.isDeleted);
  }
};

export const completedTasks = {
  get value() {
    return _tasks.filter(t => t.isCompleted && !t.isDeleted);
  }
};

// Tasks that have scheduled blocks dated before today — shown with a visual flag.
export const pastScheduledTasks = {
  get value() {
    const todayStr = toISODate(new Date());
    return _tasks.filter(t =>
      !t.isCompleted && !t.isDeleted &&
      t.scheduledBlocks.some(b => b.date < todayStr)
    );
  }
};

export function initPersistence() {
  $effect(() => {
    saveState(_tasks, workSchedule.value, activeTimer.value, fixedBlocks.value);
  });
}

export function addTask(description, onset, peak, peakPressure, estimatedMinutes) {
  const task = createTask(description, onset, peak, peakPressure, estimatedMinutes);
  _tasks = [..._tasks, task];
  return task;
}

export function editTask(taskId, patch) {
  _tasks = _tasks.map(t => {
    if (t.id !== taskId) return t;
    const updated = updateTask(t, patch);
    // Keep scheduled block durations in sync when estimatedMinutes changes
    if ('estimatedMinutes' in patch && updated.scheduledBlocks.length > 0) {
      const newTotal = patch.estimatedMinutes;
      updated.scheduledBlocks = updated.scheduledBlocks.map((b, i, arr) => {
        // Last block gets remainder to avoid rounding drift
        const share = i < arr.length - 1
          ? Math.round(newTotal * (b.durationMinutes / t.estimatedMinutes) / SNAP_MINUTES) * SNAP_MINUTES
          : newTotal - arr.slice(0, i).reduce((s, prev) => s + Math.round(newTotal * (prev.durationMinutes / t.estimatedMinutes) / SNAP_MINUTES) * SNAP_MINUTES, 0);
        return { ...b, durationMinutes: Math.max(SNAP_MINUTES, share) };
      });
    }
    return updated;
  });
}

export function deleteTask(taskId) {
  _tasks = _tasks.map(t => t.id === taskId ? { ...t, isDeleted: true } : t);
}

export function completeTask(taskId) {
  const now = new Date();
  _tasks = _tasks.map(t =>
    t.id === taskId ? { ...t, isCompleted: true, completedAt: now, scheduledBlocks: [] } : t
  );
}

export function restoreTask(taskId) {
  _tasks = _tasks.map(t =>
    t.id === taskId ? { ...t, isCompleted: false, completedAt: null } : t
  );
}

export function scheduleTask(taskId, blocks) {
  _tasks = _tasks.map(t =>
    t.id === taskId ? placeBlockOnTask(t, blocks) : t
  );
}

export function unscheduleTask(taskId) {
  _tasks = _tasks.map(t =>
    t.id === taskId ? removeBlocksForTask(t) : t
  );
}

// ─── timer mutations ─────────────────────────────────────────────────────────

export function liveSeconds(t) {
  if (!t) return 0;
  if (!t.startedAt) return t.baseSeconds;
  return t.baseSeconds + Math.max(0, Math.floor((Date.now() - new Date(t.startedAt)) / 1000));
}

export function startTimer(taskId) {
  const current = activeTimer.value;
  if (current && current.taskId !== taskId) {
    finishTimer(current.taskId);
  }
  const task = _tasks.find(t => t.id === taskId);
  const base = task?.elapsedSeconds ?? 0;
  setActiveTimer({ taskId, startedAt: new Date(), baseSeconds: base });
}

export function pauseTimer(taskId) {
  const t = activeTimer.value;
  if (!t || t.taskId !== taskId || !t.startedAt) return;
  const total = liveSeconds(t);
  _tasks = _tasks.map(t2 => t2.id === taskId ? { ...t2, elapsedSeconds: total } : t2);
  setActiveTimer({ taskId, startedAt: null, baseSeconds: total });
}

export function resumeTimer(taskId) {
  const t = activeTimer.value;
  if (!t || t.taskId !== taskId || t.startedAt) return;
  setActiveTimer({ taskId, startedAt: new Date(), baseSeconds: t.baseSeconds });
}

export function finishTimer(taskId) {
  const t = activeTimer.value;
  const total = t && t.taskId === taskId ? liveSeconds(t) : null;
  setActiveTimer(null);
  if (total === null) return;
  _tasks = _tasks.map(t2 =>
    t2.id === taskId ? { ...t2, elapsedSeconds: total } : t2
  );
}

// ─── schedule mutations ───────────────────────────────────────────────────────

export function autoScheduleAll() {
  const blocks = autoSchedule(_tasks, workSchedule.value, fixedBlocks.value);
  if (!blocks.length) return;
  const blocksByTask = new Map();
  for (const block of blocks) {
    if (!blocksByTask.has(block.taskId)) blocksByTask.set(block.taskId, []);
    blocksByTask.get(block.taskId).push(block);
  }
  _tasks = _tasks.map(t => {
    const tb = blocksByTask.get(t.id);
    return tb ? placeBlockOnTask(t, tb) : t;
  });
}

export function clearSchedule() {
  _tasks = _tasks.map(t =>
    t.scheduledBlocks.length ? removeBlocksForTask(t) : t
  );
}

// Called when work hours change. Finds the earliest scheduled block that no
// longer fits its day (day disabled, or block starts/ends outside the new
// startMinutes/endMinutes), then unschedules that task and every task with a
// block at or after that point in time — since the auto-scheduler packs
// sequentially, anything after is presumptively built on top of a now-invalid
// placement. Predictable over clever: no partial trims, no re-packing.
export function revalidateScheduleAfterHoursChange(schedule) {
  const blockFits = (b) => {
    const day = getDaySchedule(new Date(b.date + 'T00:00:00'), schedule);
    return !!day && b.startMinutes >= day.startMinutes && b.startMinutes + b.durationMinutes <= day.endMinutes;
  };

  let cutoff = null; // { date, startMinutes } — earliest invalid block
  for (const t of _tasks) {
    for (const b of t.scheduledBlocks) {
      if (blockFits(b)) continue;
      if (!cutoff || b.date < cutoff.date || (b.date === cutoff.date && b.startMinutes < cutoff.startMinutes)) {
        cutoff = { date: b.date, startMinutes: b.startMinutes };
      }
    }
  }
  if (!cutoff) return;

  const isAtOrAfterCutoff = (b) =>
    b.date > cutoff.date || (b.date === cutoff.date && b.startMinutes >= cutoff.startMinutes);

  _tasks = _tasks.map(t => {
    if (!t.scheduledBlocks.length) return t;
    const affected = t.scheduledBlocks.some(isAtOrAfterCutoff);
    return affected ? removeBlocksForTask(t) : t;
  });
}
