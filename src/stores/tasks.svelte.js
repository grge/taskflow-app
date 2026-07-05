import { loadState, saveState } from '../lib/persistence.js';
import { createTask, updateTask, remainingMinutes as remainingOf } from '../lib/tasks.js';
import { placeBlockOnTask, removeBlocksForTask } from '../lib/scheduling.js';
import { autoSchedule } from '../lib/scheduler.js';
import { reorderAndBumpForward } from '../lib/outlook-scheduler.js';
import { workSchedule, fixedBlocks } from './schedule.svelte.js';
import { activeTimer, setActiveTimer } from './ui.svelte.js';
import { getDaySchedule, parseLocalDate } from '../lib/calendar.js';
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

// Rescale a task's scheduled blocks so their durations sum to newTotal,
// preserving each block's share of oldTotal. Last block absorbs rounding drift.
function rescaleBlocks(blocks, oldTotal, newTotal) {
  return blocks.map((b, i, arr) => {
    const share = i < arr.length - 1
      ? Math.round(newTotal * (b.durationMinutes / oldTotal) / SNAP_MINUTES) * SNAP_MINUTES
      : newTotal - arr.slice(0, i).reduce((s, prev) => s + Math.round(newTotal * (prev.durationMinutes / oldTotal) / SNAP_MINUTES) * SNAP_MINUTES, 0);
    return { ...b, durationMinutes: Math.max(SNAP_MINUTES, share) };
  });
}

export function editTask(taskId, patch) {
  _tasks = _tasks.map(t => {
    if (t.id !== taskId) return t;
    const updated = updateTask(t, patch);
    // Keep scheduled block durations in sync when estimatedMinutes changes —
    // but only when remaining is still driven by the estimate (no override).
    // With an override active, remaining is decoupled from the estimate, so
    // editing the estimate shouldn't move the scheduled block.
    if ('estimatedMinutes' in patch && updated.scheduledBlocks.length > 0 && t.remainingOverride == null && !t.elapsedSeconds) {
      updated.scheduledBlocks = rescaleBlocks(updated.scheduledBlocks, t.estimatedMinutes, patch.estimatedMinutes);
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

export function toggleLock(taskId) {
  _tasks = _tasks.map(t => t.id === taskId ? { ...t, isLocked: !t.isLocked } : t);
}

// Manually set minutes of work left. Plants an anchor at the task's current
// live elapsed reading, so subsequent timer time counts down from `minutes`.
// Pass null to clear the override and revert to estimate − elapsed.
export function setRemaining(taskId, minutes) {
  _tasks = _tasks.map(t => {
    if (t.id !== taskId) return t;
    const oldRemaining = remainingOf(t);
    const timer = activeTimer.value;
    const elapsed = timer?.taskId === taskId ? liveSeconds(timer) : (t.elapsedSeconds ?? 0);
    const override = minutes == null
      ? null
      : { atElapsedSeconds: elapsed, remainingMinutes: minutes };
    const updated = updateTask(t, { remainingOverride: override });
    // Resize any already-scheduled blocks to match the new remaining, so the
    // timeline and the "X left" label stay in agreement without a reschedule.
    if (updated.scheduledBlocks.length > 0) {
      const newRemaining = remainingOf(updated);
      updated.scheduledBlocks = rescaleBlocks(updated.scheduledBlocks, oldRemaining, newRemaining);
    }
    return updated;
  });
}

// Manually correct logged elapsed time. Writes the task's elapsedSeconds and,
// if a timer is live for it, rebases the timer so its running clock continues
// from the edited value (mirrors pauseTimer's flush). The remainingOverride is
// left untouched: with no override, remaining = estimate − elapsed recomputes
// naturally, so bumping elapsed lowers "Left"; with one, its anchor holds.
export function setElapsed(taskId, seconds) {
  const total = Math.max(0, Math.round(seconds));
  _tasks = _tasks.map(t => t.id === taskId ? { ...t, elapsedSeconds: total } : t);
  const timer = activeTimer.value;
  if (timer?.taskId === taskId) {
    setActiveTimer({
      taskId,
      startedAt: timer.startedAt ? new Date() : null,
      baseSeconds: total
    });
  }
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

// Commit an outlook-backlog drop: place `movedTaskId` at `insertBeforeTaskId`
// within `targetDateStr`, then repack that day (respecting the resulting order)
// and spill any overflow forward. `sourceDateStr` is the moved card's origin
// day, or null when it came from outside the outlook (task list / Today).
export function commitOutlookDrop(movedTaskId, sourceDateStr, targetDateStr, insertBeforeTaskId) {
  // Snapshot the target day's entries before any mutation.
  const dayEntries = _tasks
    .filter(t => !t.isCompleted && !t.isDeleted)
    .flatMap(t => t.scheduledBlocks
      .filter(b => b.date === targetDateStr)
      .map(b => ({ task: t, block: b })))
    .sort((a, b) => a.block.startMinutes - b.block.startMinutes);

  // Moving between days (or in from outside) frees the source placement first.
  if (sourceDateStr !== targetDateStr) {
    unscheduleTask(movedTaskId);
  }

  // Build the ordered task list for the target day, including the moved task.
  // Settle live timer time so a running task packs at its true remaining.
  const orderedTasks = dayEntries.map(e => withLiveElapsed(e.task)).filter(t => t.id !== movedTaskId);
  const rawMoved = _tasks.find(t => t.id === movedTaskId);
  if (!rawMoved) return;
  const movedTask = withLiveElapsed(rawMoved);

  let insertAt;
  if (insertBeforeTaskId === null) {
    insertAt = orderedTasks.length;
  } else {
    insertAt = orderedTasks.findIndex(t => t.id === insertBeforeTaskId);
    if (insertAt === -1) insertAt = orderedTasks.length;
  }
  orderedTasks.splice(insertAt, 0, movedTask);

  // Obstacles for packing/spill: fixed blocks, plus scheduled blocks of tasks
  // NOT being repacked here (repacked tasks' own blocks are about to be
  // rewritten, so they must not block themselves).
  const repackedIds = new Set(orderedTasks.map(t => t.id));
  const otherScheduledBlocks = _tasks
    .filter(t => !t.isCompleted && !t.isDeleted && !repackedIds.has(t.id))
    .flatMap(t => t.scheduledBlocks);
  const occupiedBlocks = [...fixedBlocks.value, ...otherScheduledBlocks];

  const { blocks } = reorderAndBumpForward(
    orderedTasks, movedTaskId, insertAt,
    workSchedule.value, occupiedBlocks, targetDateStr
  );

  for (const [taskId, block] of blocks) {
    scheduleTask(taskId, [block]);
  }
}

// ─── timer mutations ─────────────────────────────────────────────────────────

export function liveSeconds(t) {
  if (!t) return 0;
  if (!t.startedAt) return t.baseSeconds;
  return t.baseSeconds + Math.max(0, Math.floor((Date.now() - new Date(t.startedAt)) / 1000));
}

// Elapsed seconds for a task including any in-flight (unflushed) timer time.
// The scheduler must use this so the block it packs matches the "X left" the UI
// shows — the stored elapsedSeconds lags behind while a timer is running.
export function liveElapsedFor(task) {
  const timer = activeTimer.value;
  return timer?.taskId === task.id ? liveSeconds(timer) : (task.elapsedSeconds ?? 0);
}

// Return a task with its live timer time folded into elapsedSeconds, so pure
// scheduling code reading task.elapsedSeconds sees the same value as the UI.
export function withLiveElapsed(task) {
  const live = liveElapsedFor(task);
  return live === task.elapsedSeconds ? task : { ...task, elapsedSeconds: live };
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
  const blocks = autoSchedule(_tasks.map(withLiveElapsed), workSchedule.value, fixedBlocks.value);
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
    t.scheduledBlocks.length && !t.isLocked ? removeBlocksForTask(t) : t
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
    const day = getDaySchedule(parseLocalDate(b.date), schedule);
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
