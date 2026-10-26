// The domain core: every change to TaskFlow's data is an operation applied by
// one pure function.
//
//   apply(state, op, context) → { state, result }
//
//   state   — { tasks, workSchedule, fixedBlocks, activeTimer }, the same shape
//             persistence stores. Never mutated: a handler returns a new state,
//             reusing every slice it didn't touch so unchanged parts keep their
//             identity (the stores only notify readers of slices that changed).
//   op      — { id, type, args, at, tz, actor }. Only `type` and `args` are read
//             here; `at` arrives as context.now.
//   context — { now }, a Date. Nothing in the core reads the clock, so a device
//             and a backend applying the same operation get the same result.
//             Day boundaries and work hours use the host's local time by
//             contract: the browser's on a device, TZ on a backend.
//   result  — what the operation reports back, where it has something to say
//             (the created task, schedule.next's placement); otherwise undefined.
//
// Operations are absolute where they can be. Locking is task.setLock with the
// value, never a toggle, because a toggle replayed on newer state can flip the
// wrong way. task.add and block.add carry their client-generated ids, so later
// operations naming a new record still resolve after a replay.
//
// Each handler is a direct port of the store function named beside it, so the
// refactor moves behaviour rather than redesigning it. The one deliberate
// difference is noted at schedule.outlookMove.

import { createTask, updateTask, remainingMinutes as remainingOf } from '../lib/tasks.js';
import { placeBlockOnTask, removeBlocksForTask } from '../lib/scheduling.js';
import { autoSchedule, packSequence } from '../lib/scheduler.js';
import { reorderAndBumpForward } from '../lib/outlook-scheduler.js';
import { getDaySchedule, parseLocalDate } from '../lib/calendar.js';
import { SNAP_MINUTES } from '../lib/constants.js';
import { liveSeconds, withLiveElapsed } from './live.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

const unchanged = state => ({ state, result: undefined });

function withTasks(state, tasks, result) {
  return { state: { ...state, tasks }, result };
}

function mapTask(state, id, fn) {
  return withTasks(state, state.tasks.map(t => (t.id === id ? fn(t) : t)));
}

const isActive = t => !t.isCompleted && !t.isDeleted;

// Patches can arrive with dates as strings (operations are JSON-safe) or as
// Dates; either way the stored value is a fresh Date, never the caller's.
const DATE_FIELDS = ['onset', 'peak', 'createdAt', 'lastModifiedAt', 'completedAt'];

function normalizePatch(patch) {
  const out = { ...patch };
  for (const f of DATE_FIELDS) {
    if (f in out && out[f] != null) out[f] = new Date(out[f]);
  }
  return out;
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

// ─── tasks ───────────────────────────────────────────────────────────────────

const handlers = {

  // addTask
  'task.add'(state, args, { now }) {
    const task = createTask(args, now);
    return withTasks(state, [...state.tasks, task], task);
  },

  // editTask. Keeps scheduled block durations in sync when the estimate
  // changes, but only while remaining is still driven by it: with an override
  // or logged time, remaining is decoupled and the blocks stay put.
  'task.edit'(state, { id, patch }, { now }) {
    const p = normalizePatch(patch);
    return mapTask(state, id, t => {
      const updated = updateTask(t, p, now);
      if ('estimatedMinutes' in p && updated.scheduledBlocks.length > 0 && t.remainingOverride == null && !t.elapsedSeconds) {
        updated.scheduledBlocks = rescaleBlocks(updated.scheduledBlocks, t.estimatedMinutes, p.estimatedMinutes);
      }
      return updated;
    });
  },

  // deleteTask
  'task.delete'(state, { id }) {
    return mapTask(state, id, t => ({ ...t, isDeleted: true }));
  },

  // completeTask
  'task.complete'(state, { id }, { now }) {
    return mapTask(state, id, t => ({ ...t, isCompleted: true, completedAt: new Date(now), scheduledBlocks: [] }));
  },

  // restoreTask
  'task.restore'(state, { id }) {
    return mapTask(state, id, t => ({ ...t, isCompleted: false, completedAt: null }));
  },

  // toggleLock, made absolute
  'task.setLock'(state, { id, locked }) {
    return mapTask(state, id, t => ({ ...t, isLocked: !!locked }));
  },

  // setRemaining. Plants an anchor at the task's live elapsed reading, so later
  // timer time counts down from `minutes`; null clears the override. Already
  // scheduled blocks are resized to the new remaining.
  'task.setRemaining'(state, { id, minutes }, { now }) {
    return mapTask(state, id, t => {
      const oldRemaining = remainingOf(t);
      const timer = state.activeTimer;
      const elapsed = timer?.taskId === id ? liveSeconds(timer, now) : (t.elapsedSeconds ?? 0);
      const override = minutes == null ? null : { atElapsedSeconds: elapsed, remainingMinutes: minutes };
      const updated = updateTask(t, { remainingOverride: override }, now);
      if (updated.scheduledBlocks.length > 0) {
        updated.scheduledBlocks = rescaleBlocks(updated.scheduledBlocks, oldRemaining, remainingOf(updated));
      }
      return updated;
    });
  },

  // setElapsed. If a timer is live for the task it is rebased, so its running
  // clock continues from the corrected value.
  'task.setElapsed'(state, { id, seconds }, { now }) {
    const total = Math.max(0, Math.round(seconds));
    const next = mapTask(state, id, t => ({ ...t, elapsedSeconds: total })).state;
    const timer = state.activeTimer;
    if (timer?.taskId === id) {
      next.activeTimer = { taskId: id, startedAt: timer.startedAt ? new Date(now) : null, baseSeconds: total };
    }
    return { state: next, result: undefined };
  },

  // ─── scheduling ────────────────────────────────────────────────────────────

  // scheduleTask (a drag commits here) and restoreBlocks (schedule.next's undo).
  // Absolute: the blocks were computed where the drop happened.
  'schedule.place'(state, { id, blocks }, { now }) {
    return mapTask(state, id, t => placeBlockOnTask(t, blocks, now));
  },

  // unscheduleTask
  'schedule.unschedule'(state, { id }, { now }) {
    return mapTask(state, id, t => removeBlocksForTask(t, now));
  },

  // scheduleTaskNext. packSequence with a one-task sequence, so it inherits the
  // bulk scheduler's free-interval walk, buffer, splitting and horizon. The
  // task's own blocks are not obstacles (it must be able to re-place over its
  // own slot), and neither are soft-deleted tasks'.
  'schedule.next'(state, { id }, { now }) {
    const task = state.tasks.find(t => t.id === id);
    if (!task || task.isCompleted || task.isDeleted) return { state, result: { ok: false, reason: 'unavailable' } };

    const obstacles = state.tasks
      .filter(t => t.id !== id && isActive(t))
      .flatMap(t => t.scheduledBlocks);

    const blocks = packSequence(
      [withLiveElapsed(state, task, now)], state.workSchedule, obstacles, state.fixedBlocks, now
    );

    // null: no gap large enough. []: no enabled work days at all.
    if (!blocks) return { state, result: { ok: false, reason: 'no-room' } };
    if (!blocks.length) return { state, result: { ok: false, reason: 'no-work-days' } };

    const previousBlocks = task.scheduledBlocks;
    const next = mapTask(state, id, t => placeBlockOnTask(t, blocks, now)).state;
    return { state: next, result: { ok: true, blocks, previousBlocks } };
  },

  // autoScheduleAll
  'schedule.auto'(state, _args, { now }) {
    const blocks = autoSchedule(
      state.tasks.map(t => withLiveElapsed(state, t, now)), state.workSchedule, state.fixedBlocks, now
    );
    if (!blocks.length) return unchanged(state);
    const byTask = new Map();
    for (const b of blocks) {
      if (!byTask.has(b.taskId)) byTask.set(b.taskId, []);
      byTask.get(b.taskId).push(b);
    }
    return withTasks(state, state.tasks.map(t => {
      const tb = byTask.get(t.id);
      return tb ? placeBlockOnTask(t, tb, now) : t;
    }));
  },

  // clearSchedule. Locked tasks keep their blocks.
  'schedule.clear'(state, _args, { now }) {
    return withTasks(state, state.tasks.map(t =>
      t.scheduledBlocks.length && !t.isLocked ? removeBlocksForTask(t, now) : t
    ));
  },

  // commitOutlookDrop. Places `id` before `insertBeforeId` within `targetDate`
  // (null = at the end), repacks that day in the resulting order, and spills
  // overflow forward. `sourceDate` is the moved card's own day, or null when it
  // came from outside the backlog.
  //
  // One deliberate difference from the store function: the rollback snapshot of
  // each task's blocks is taken from the state before the move. The store took
  // it after it had already cleared the moved task for a cross-day move, so the
  // moved task's "previous blocks" were always empty and a task the packer
  // couldn't place was left unscheduled, the very case the rollback was written
  // for.
  'schedule.outlookMove'(state, { id, sourceDate, targetDate, insertBeforeId }, { now }) {
    const before = state.tasks;

    const dayEntries = before
      .filter(isActive)
      .flatMap(t => t.scheduledBlocks.filter(b => b.date === targetDate).map(b => ({ task: t, block: b })))
      .sort((a, b) => a.block.startMinutes - b.block.startMinutes);

    // Moving between days, or in from outside, frees the source placement first.
    let tasks = sourceDate !== targetDate
      ? before.map(t => (t.id === id ? removeBlocksForTask(t, now) : t))
      : before;

    const live = t => withLiveElapsed(state, t, now);
    const orderedTasks = dayEntries.map(e => live(e.task)).filter(t => t.id !== id);
    const rawMoved = tasks.find(t => t.id === id);
    if (!rawMoved) return unchanged(state);
    const movedTask = live(rawMoved);

    let insertAt = insertBeforeId === null || insertBeforeId === undefined
      ? orderedTasks.length
      : orderedTasks.findIndex(t => t.id === insertBeforeId);
    if (insertAt === -1) insertAt = orderedTasks.length;
    orderedTasks.splice(insertAt, 0, movedTask);

    // Obstacles: fixed blocks, plus scheduled blocks of tasks not being
    // repacked here (repacked tasks' own blocks are about to be rewritten).
    const repackedIds = new Set(orderedTasks.map(t => t.id));
    const otherScheduledBlocks = tasks
      .filter(t => isActive(t) && !repackedIds.has(t.id))
      .flatMap(t => t.scheduledBlocks);
    const occupiedBlocks = [...state.fixedBlocks, ...otherScheduledBlocks];

    const previousBlocks = new Map(
      orderedTasks.map(t => [t.id, before.find(x => x.id === t.id)?.scheduledBlocks ?? []])
    );

    const { blocks, unplaceable } = reorderAndBumpForward(
      orderedTasks, id, insertAt, state.workSchedule, occupiedBlocks, targetDate, now
    );

    tasks = tasks.map(t => (blocks.has(t.id) ? placeBlockOnTask(t, [blocks.get(t.id)], now) : t));

    // A task the packer couldn't place (longer than one work day; backlog cards
    // never split) goes back where it was rather than silently unscheduled.
    for (const taskId of unplaceable) {
      const prior = previousBlocks.get(taskId);
      if (prior?.length) tasks = tasks.map(t => (t.id === taskId ? placeBlockOnTask(t, prior, now) : t));
    }

    return withTasks(state, tasks);
  },

  // ─── timer ─────────────────────────────────────────────────────────────────

  // startTimer. A timer running on another task is finished (flushed) first.
  'timer.start'(state, { id }, ctx) {
    let s = state;
    if (s.activeTimer && s.activeTimer.taskId !== id) {
      s = handlers['timer.finish'](s, { id: s.activeTimer.taskId }, ctx).state;
    }
    const task = s.tasks.find(t => t.id === id);
    const base = task?.elapsedSeconds ?? 0;
    return { state: { ...s, activeTimer: { taskId: id, startedAt: new Date(ctx.now), baseSeconds: base } }, result: undefined };
  },

  // pauseTimer. Flushes the live time to the task.
  'timer.pause'(state, { id }, { now }) {
    const t = state.activeTimer;
    if (!t || t.taskId !== id || !t.startedAt) return unchanged(state);
    const total = liveSeconds(t, now);
    const next = mapTask(state, id, task => ({ ...task, elapsedSeconds: total })).state;
    next.activeTimer = { taskId: id, startedAt: null, baseSeconds: total };
    return { state: next, result: undefined };
  },

  // resumeTimer
  'timer.resume'(state, { id }, { now }) {
    const t = state.activeTimer;
    if (!t || t.taskId !== id || t.startedAt) return unchanged(state);
    return { state: { ...state, activeTimer: { taskId: id, startedAt: new Date(now), baseSeconds: t.baseSeconds } }, result: undefined };
  },

  // finishTimer. Always clears the timer; flushes it only when it belongs to `id`.
  'timer.finish'(state, { id }, { now }) {
    const t = state.activeTimer;
    const total = t && t.taskId === id ? liveSeconds(t, now) : null;
    const cleared = { ...state, activeTimer: null };
    if (total === null) return { state: cleared, result: undefined };
    return { state: { ...cleared, tasks: state.tasks.map(x => (x.id === id ? { ...x, elapsedSeconds: total } : x)) }, result: undefined };
  },

  // ─── settings ──────────────────────────────────────────────────────────────

  // updateWorkSchedule. Finds the earliest scheduled block that no longer fits
  // its day and unschedules that task and every task with a block at or after
  // it, since the auto-scheduler packs sequentially and anything later was
  // built on top of the invalid placement. Fixed blocks that no longer fit are
  // dropped.
  'hours.update'(state, { schedule }, { now }) {
    const blockFits = b => {
      const day = getDaySchedule(parseLocalDate(b.date), schedule);
      return !!day && b.startMinutes >= day.startMinutes && b.startMinutes + b.durationMinutes <= day.endMinutes;
    };

    let cutoff = null; // earliest invalid block: { date, startMinutes }
    for (const t of state.tasks) {
      for (const b of t.scheduledBlocks) {
        if (blockFits(b)) continue;
        if (!cutoff || b.date < cutoff.date || (b.date === cutoff.date && b.startMinutes < cutoff.startMinutes)) {
          cutoff = { date: b.date, startMinutes: b.startMinutes };
        }
      }
    }

    let tasks = state.tasks;
    if (cutoff) {
      const atOrAfter = b => b.date > cutoff.date || (b.date === cutoff.date && b.startMinutes >= cutoff.startMinutes);
      tasks = tasks.map(t => (t.scheduledBlocks.length && t.scheduledBlocks.some(atOrAfter) ? removeBlocksForTask(t, now) : t));
    }

    return {
      state: { ...state, workSchedule: schedule, tasks, fixedBlocks: state.fixedBlocks.filter(blockFits) },
      result: undefined
    };
  },

  // addFixedBlock
  'block.add'(state, { block }) {
    return { state: { ...state, fixedBlocks: [...state.fixedBlocks, block] }, result: undefined };
  },

  // editFixedBlock
  'block.edit'(state, { id, patch }) {
    return { state: { ...state, fixedBlocks: state.fixedBlocks.map(b => (b.id === id ? { ...b, ...patch } : b)) }, result: undefined };
  },

  // removeFixedBlock
  'block.remove'(state, { id }) {
    return { state: { ...state, fixedBlocks: state.fixedBlocks.filter(b => b.id !== id) }, result: undefined };
  }
};

export const OP_TYPES = Object.freeze(Object.keys(handlers));

export function apply(state, op, context) {
  const handler = handlers[op.type];
  if (!handler) throw new Error(`Unknown operation type: ${op.type}`);
  if (!(context?.now instanceof Date) || Number.isNaN(+context.now)) {
    throw new Error(`apply needs context.now as a valid Date (operation ${op.type})`);
  }
  return handler(state, op.args ?? {}, context);
}
