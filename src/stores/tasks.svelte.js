import { loadState, saveState } from '../lib/persistence.js';
import { createTask, updateTask } from '../lib/tasks.js';
import { placeBlockOnTask, removeBlocksForTask } from '../lib/scheduling.js';
import { autoSchedule } from '../lib/scheduler.js';
import { workSchedule } from './schedule.svelte.js';

let _tasks = $state(loadState().tasks);

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
    saveState(_tasks, workSchedule.value);
  });
}

export function addTask(description, urgencyProfile, importance, estimatedMinutes) {
  const task = createTask(description, urgencyProfile, importance, estimatedMinutes);
  _tasks = [..._tasks, task];
  return task;
}

export function editTask(taskId, patch) {
  _tasks = _tasks.map(t => t.id === taskId ? updateTask(t, patch) : t);
}

export function deleteTask(taskId) {
  _tasks = _tasks.map(t => t.id === taskId ? { ...t, isDeleted: true } : t);
}

export function completeTask(taskId) {
  _tasks = _tasks.map(t =>
    t.id === taskId ? { ...t, isCompleted: true, completedAt: new Date(), scheduledBlocks: [] } : t
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

export function autoScheduleAll() {
  const blocks = autoSchedule(_tasks, workSchedule.value);
  if (!blocks.length) return;
  // Group blocks by taskId and apply to each task.
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

export function unscheduleTasksOnDisabledDays(schedule) {
  const enabledDays = new Set(
    schedule.days.filter(d => d.enabled).map(d => d.dayOfWeek)
  );
  _tasks = _tasks.map(t => {
    if (!t.scheduledBlocks.length) return t;
    // Unschedule if any block falls on a now-disabled day.
    const hasDisabledBlock = t.scheduledBlocks.some(b => {
      const dow = new Date(b.date + 'T00:00:00').getDay();
      return !enabledDays.has(dow);
    });
    return hasDisabledBlock ? removeBlocksForTask(t) : t;
  });
}
