// Live timer readings. The running timer's time isn't written to the task until
// it pauses or stops, so anything that needs a task's true elapsed time folds
// the in-flight seconds in. `now` is always passed in: inside the core it is
// the operation's time, in the UI it is the clock.

export function liveSeconds(timer, now) {
  if (!timer) return 0;
  if (!timer.startedAt) return timer.baseSeconds;
  return timer.baseSeconds + Math.max(0, Math.floor((+now - +new Date(timer.startedAt)) / 1000));
}

// Elapsed seconds for a task including any unflushed timer time. The scheduler
// must use this so the block it packs matches the "X left" the UI shows.
export function liveElapsedFor(state, task, now) {
  const timer = state.activeTimer;
  return timer?.taskId === task.id ? liveSeconds(timer, now) : (task.elapsedSeconds ?? 0);
}

// The task with its live timer time folded into elapsedSeconds, so pure
// scheduling code reading task.elapsedSeconds sees what the UI shows.
export function withLiveElapsed(state, task, now) {
  const live = liveElapsedFor(state, task, now);
  return live === task.elapsedSeconds ? task : { ...task, elapsedSeconds: live };
}
