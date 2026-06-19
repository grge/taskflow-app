import { pAt } from './envelope.js';

export function createTask(description, onset, peak, peakPressure, estimatedMinutes) {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    description,
    estimatedMinutes,
    onset:           onset instanceof Date ? onset : new Date(onset),
    peak:            peak  instanceof Date ? peak  : new Date(peak),
    peakPressure,
    createdAt:       now,
    lastModifiedAt:  now,
    completedAt:     null,
    scheduledBlocks: [],
    elapsedSeconds:  0,
    isCompleted:     false,
    isDeleted:       false
  };
}

export function updateTask(task, patch) {
  return { ...task, ...patch, lastModifiedAt: new Date() };
}

export function sortTasksByPressure(tasks, now) {
  return [...tasks].sort((a, b) => pAt(b, now) - pAt(a, now));
}
