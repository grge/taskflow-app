import { MIN_BLOCK_MINUTES } from './constants.js';

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
    // { atElapsedSeconds, remainingMinutes } | null. When set, remaining is
    // measured down from this anchor instead of from (0, estimatedMinutes).
    remainingOverride: null,
    isCompleted:     false,
    isDeleted:       false,
    isLocked:        false
  };
}

export function updateTask(task, patch) {
  return { ...task, ...patch, lastModifiedAt: new Date() };
}

/**
 * Minutes of work left on a task — the single source of truth the scheduler
 * packs against and the UI displays.
 *
 * Anchored subtraction: remaining counts down from an anchor by real elapsed
 * time since that anchor. With no override the anchor is (elapsed 0, estimate),
 * so remaining = estimate − elapsed. A manual override replants the anchor at
 * the elapsed reading of the moment it was set, so remaining = override value −
 * (elapsed now − elapsed then). Floored at 0 — the user sees an honest "0m
 * left" once the time is spent, never a value stuck above zero. Scheduling
 * callers wrap this in MIN_BLOCK_MINUTES to avoid placing degenerate blocks.
 * estimatedMinutes is never consulted once an override exists.
 *
 * `elapsedSeconds` defaults to the task's stored value but callers with a live
 * timer should pass the ticking value so the figure updates in real time.
 */
export function remainingMinutes(task, elapsedSeconds = task.elapsedSeconds ?? 0) {
  const elapsedMin = elapsedSeconds / 60;
  const ov = task.remainingOverride;
  const raw = ov
    ? ov.remainingMinutes - (elapsedMin - ov.atElapsedSeconds / 60)
    : task.estimatedMinutes - elapsedMin;
  return Math.max(0, Math.round(raw));
}

// Block size the scheduler should reserve for a task: its remaining time, but
// never smaller than MIN_BLOCK_MINUTES so placement math stays well-defined.
export function schedulableMinutes(task, elapsedSeconds) {
  return Math.max(MIN_BLOCK_MINUTES, remainingMinutes(task, elapsedSeconds));
}

// Minutes to show on a scheduled/ghost card for a block. A single-part block
// reflects the task's true remaining (honest "0m" even though the scheduler
// floored the actual block to MIN_BLOCK_MINUTES). Multi-day split parts keep
// their own slice — remaining is the whole-task figure, not this part's.
export function blockDisplayMinutes(task, block, elapsedSeconds) {
  return block?.totalParts > 1 ? block.durationMinutes : remainingMinutes(task, elapsedSeconds);
}
