import { completedTasks } from './tasks.svelte.js';

// Median actual/estimated ratio across all completed timed tasks.
// Falls back to 1.2 (a modest underestimation prior) when fewer than 5 observations.
export const estimationMultiplier = {
  get value() {
    const ratios = completedTasks.value
      .filter(t => t.elapsedSeconds > 0 && t.estimatedMinutes > 0)
      .map(t => (t.elapsedSeconds / 60) / t.estimatedMinutes);

    if (ratios.length < 5) return 1.2;

    const sorted = [...ratios].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }
};
