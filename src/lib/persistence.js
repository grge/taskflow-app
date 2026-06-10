import { DEFAULT_WORK_SCHEDULE } from './constants.js';

const STORAGE_KEY = 'taskflow_v1';


const DATE_FIELDS = ['createdAt', 'lastModifiedAt', 'completedAt'];

function reviveTask(raw) {
  const task = { ...raw };
  for (const field of DATE_FIELDS) {
    if (task[field]) task[field] = new Date(task[field]);
  }
  // Migrate old timeSessions format to elapsedSeconds
  if (task.timeSessions !== undefined && task.elapsedSeconds === undefined) {
    task.elapsedSeconds = (task.timeSessions ?? [])
      .reduce((sum, s) => sum + (s.durationMinutes ?? 0) * 60, 0);
    delete task.timeSessions;
  }
  if (task.elapsedSeconds === undefined) task.elapsedSeconds = 0;
  return task;
}

function reviveTimer(raw) {
  if (!raw) return null;
  return {
    taskId: raw.taskId,
    startedAt: raw.startedAt ? new Date(raw.startedAt) : null,
    baseSeconds: raw.baseSeconds ?? raw.accumulatedSeconds ?? 0,
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tasks: [], workSchedule: DEFAULT_WORK_SCHEDULE, activeTimer: null };
    const parsed = JSON.parse(raw);
    return {
      tasks: (parsed.tasks || []).map(reviveTask),
      workSchedule: parsed.workSchedule
        ? { bufferMinutes: 15, envelopeWindowHours: 48, ...parsed.workSchedule }
        : DEFAULT_WORK_SCHEDULE,
      activeTimer: reviveTimer(parsed.activeTimer ?? null),
    };
  } catch {
    return { tasks: [], workSchedule: DEFAULT_WORK_SCHEDULE, activeTimer: null };
  }
}

export function saveState(tasks, workSchedule, activeTimer) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, workSchedule, activeTimer }));
  } catch {
    // Storage full or unavailable — silently skip
  }
}
