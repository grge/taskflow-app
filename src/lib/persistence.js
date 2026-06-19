import { DEFAULT_WORK_SCHEDULE, STORAGE_KEY } from './constants.js';

const DATE_FIELDS = ['createdAt', 'lastModifiedAt', 'completedAt', 'onset', 'peak'];

function reviveTask(raw) {
  const task = { ...raw };
  for (const field of DATE_FIELDS) {
    if (task[field]) task[field] = new Date(task[field]);
  }
  if (task.elapsedSeconds === undefined) task.elapsedSeconds = 0;
  return task;
}

function reviveTimer(raw) {
  if (!raw) return null;
  return {
    taskId:       raw.taskId,
    startedAt:    raw.startedAt ? new Date(raw.startedAt) : null,
    baseSeconds:  raw.baseSeconds ?? 0,
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tasks: [], workSchedule: DEFAULT_WORK_SCHEDULE, activeTimer: null, fixedBlocks: [] };
    const parsed = JSON.parse(raw);
    return {
      tasks:        (parsed.tasks || []).map(reviveTask),
      workSchedule: parsed.workSchedule
        ? { bufferMinutes: 15, ...parsed.workSchedule }
        : DEFAULT_WORK_SCHEDULE,
      activeTimer:  reviveTimer(parsed.activeTimer ?? null),
      fixedBlocks:  parsed.fixedBlocks || [],
    };
  } catch {
    return { tasks: [], workSchedule: DEFAULT_WORK_SCHEDULE, activeTimer: null, fixedBlocks: [] };
  }
}

export function saveState(tasks, workSchedule, activeTimer, fixedBlocks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, workSchedule, activeTimer, fixedBlocks }));
  } catch {
    // Storage full or unavailable — silently skip
  }
}
