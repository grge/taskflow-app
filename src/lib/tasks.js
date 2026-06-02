import { buildEnvelopeParams } from './envelope.js';
import { calculateProblemness } from './envelope.js';

export function createTask(description, urgencyProfile, importance, estimatedMinutes) {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    description,
    estimatedMinutes,
    urgencyProfile,
    importance,
    customEnvelope: null,
    createdAt: now,
    lastModifiedAt: now,
    completedAt: null,
    scheduledBlocks: [],
    timeSessions: [],
    isCompleted: false,
    isDeleted: false
  };
}

export function updateTask(task, patch) {
  const updated = { ...task, ...patch, lastModifiedAt: new Date() };
  // Rebuild customEnvelope if envelope-affecting fields changed
  if ('urgencyProfile' in patch || 'importance' in patch) {
    updated.customEnvelope = null; // clear custom, let it derive from profile+importance
  }
  return updated;
}

export function sortTasksByProblemness(tasks, now) {
  return [...tasks].sort((a, b) =>
    calculateProblemness(b, now) - calculateProblemness(a, now)
  );
}
