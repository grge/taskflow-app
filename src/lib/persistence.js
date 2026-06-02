import { DEFAULT_WORK_SCHEDULE } from './constants.js';

const STORAGE_KEY = 'taskflow_v1';

const DATE_FIELDS = ['createdAt', 'lastModifiedAt', 'completedAt'];
const SESSION_DATE_FIELDS = ['startedAt', 'pausedAt', 'finishedAt'];

function reviveTask(raw) {
  const task = { ...raw };
  for (const field of DATE_FIELDS) {
    if (task[field]) task[field] = new Date(task[field]);
  }
  if (task.timeSessions) {
    task.timeSessions = task.timeSessions.map(s => {
      const session = { ...s };
      for (const f of SESSION_DATE_FIELDS) {
        if (session[f]) session[f] = new Date(session[f]);
      }
      return session;
    });
  }
  return task;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tasks: [], workSchedule: DEFAULT_WORK_SCHEDULE };
    const parsed = JSON.parse(raw);
    return {
      tasks: (parsed.tasks || []).map(reviveTask),
      workSchedule: parsed.workSchedule || DEFAULT_WORK_SCHEDULE
    };
  } catch {
    return { tasks: [], workSchedule: DEFAULT_WORK_SCHEDULE };
  }
}

export function saveState(tasks, workSchedule) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, workSchedule }));
  } catch {
    // Storage full or unavailable — silently skip
  }
}
