// What the Insights tab shows, as pure functions over history. Time is host-local,
// as everywhere: a day or a week is the one on the clock in front of you.
//
// History is a list of events, each moving the backlog (the minutes of work left
// on open tasks) by a signed amount:
//
//   { at, taskId, type, minutes }
//     added        a task arrived            (+)
//     reestimated  its time left was changed (±)
//     worked       time was logged on it     (−)
//     done         it was completed          (− whatever was still left on it)
//     dropped      it was deleted while open (− the same)
//
// So the events' minutes always sum to the backlog, which is what makes the
// "why it moved" breakdown add up. They come from one of two places:
//
// - historyFromOps replays the backend's operation log through the domain core,
//   which is exact. Scheduling operations are skipped: they can't change what is
//   left on a task, and skipping them means a change to the scheduler can't
//   change the past. Replaying through today's core also corrects old operations
//   where the rules have since been fixed: a timer left running on a completed
//   task used to keep counting, and here it stops at completion.
// - eventsFromTasks reads only the dates on the tasks, for a device with no log.
//   Task counts are right; hours assume nothing was re-estimated along the way.

import { apply } from '../core/apply.js';
import { emptyState } from '../core/state.js';
import { remainingMinutes } from './tasks.js';
import { pAt } from './envelope.js';

const DAY_MS = 86_400_000;
const isOpen = t => !t.isCompleted && !t.isDeleted;
const left = t => (t && isOpen(t) ? remainingMinutes(t) : 0);
const byTime = (a, b) => a.at - b.at;
const MOVES_TIME = /^(timer\.|task\.setElapsed$)/;
const IGNORED = /^(schedule\.|block\.|hours\.)/;

export function eventsFromTasks(tasks) {
  const events = [];
  for (const t of tasks) {
    const minutes = remainingMinutes(t);
    if (t.isCompleted && !t.completedAt && !t.isDeleted) continue;
    events.push({ at: new Date(t.createdAt), taskId: t.id, type: 'added', minutes });
    if (t.isCompleted && t.completedAt) {
      events.push({ at: new Date(t.completedAt), taskId: t.id, type: 'done', minutes: -minutes });
    } else if (t.isDeleted) {
      // lastModifiedAt is the latest thing known about a task deleted before
      // deletedAt existed.
      events.push({ at: new Date(t.deletedAt ?? t.lastModifiedAt), taskId: t.id, type: 'dropped', minutes: -minutes });
    }
  }
  return events.sort(byTime);
}

export function historyFromOps(ops) {
  let state = emptyState();
  let events = [];
  const completions = new Map(); // taskId → its 'done' event, undone by a restore

  for (const op of ops) {
    if (IGNORED.test(op.type)) continue;
    const at = new Date(op.at);
    let next;
    try {
      next = apply(state, op, { now: at }).state;
    } catch {
      continue; // an operation this version of the app doesn't know
    }
    if (next.tasks === state.tasks) { state = next; continue; }

    // An import replaces everything, so history restarts from its dates.
    if (op.type === 'data.import') {
      events = eventsFromTasks(next.tasks);
      completions.clear();
      for (const e of events) if (e.type === 'done') completions.set(e.taskId, e);
      state = next;
      continue;
    }

    // Tasks are only ever appended, so positions line up, and a handler returns
    // the same object for every task it didn't touch.
    next.tasks.forEach((t, i) => {
      const before = state.tasks[i];
      if (t === before) return;
      const event = (type, minutes) => {
        const e = { at, taskId: t.id, type, minutes };
        events.push(e);
        return e;
      };
      if (!before) {
        event('added', left(t));
      } else if (isOpen(before) && t.isDeleted) {
        event('dropped', -left(before));
      } else if (isOpen(before) && t.isCompleted) {
        completions.set(t.id, event('done', -left(before)));
      } else if (!isOpen(before) && isOpen(t)) {
        // A restore takes the completion back, as if it hadn't happened.
        const done = completions.get(t.id);
        events = events.filter(e => e !== done);
        completions.delete(t.id);
        const change = left(t) + (done ? done.minutes : 0);
        if (change) event('reestimated', change);
      } else if (left(t) !== left(before)) {
        event(MOVES_TIME.test(op.type) ? 'worked' : 'reestimated', left(t) - left(before));
      }
    });
    state = next;
  }

  // A task's creation time can be corrected after the fact, and the corrected
  // one is when it arrived.
  const createdAt = new Map(state.tasks.map(t => [t.id, t.createdAt]));
  for (const e of events) if (e.type === 'added' && createdAt.has(e.taskId)) e.at = new Date(createdAt.get(e.taskId));
  return { events: events.sort(byTime), tasks: state.tasks };
}

// ─── periods ─────────────────────────────────────────────────────────────────

const PERIODS = {
  day:   { limit: 30, floor: d => new Date(d.getFullYear(), d.getMonth(), d.getDate()),
           next:  d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1),
           back:  (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - n) },
  week:  { limit: 26, floor: d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)), // Monday
           next:  d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7),
           back:  (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7 * n) },
  month: { limit: 12, floor: d => new Date(d.getFullYear(), d.getMonth(), 1),
           next:  d => new Date(d.getFullYear(), d.getMonth() + 1, 1),
           back:  (d, n) => new Date(d.getFullYear(), d.getMonth() - n, 1) }
};

const emptyTotals = () => ({ added: 0, done: 0, dropped: 0, addedMinutes: 0, reestimatedMinutes: 0, workedMinutes: 0, doneMinutes: 0, droppedMinutes: 0 });

// One row per period up to now, oldest first, starting at the first event or the
// period's limit back, whichever is later. Each has the period's totals and the
// backlog and open-task count at its end. Periods with nothing in them are kept:
// a quiet week is part of the picture.
export function flowSeries(events, granularity, now) {
  if (!events.length) return [];
  const { limit, floor, next, back } = PERIODS[granularity];
  const earliest = back(floor(now), limit - 1);
  const firstEvent = floor(events[0].at);
  let start = firstEvent > earliest ? firstEvent : earliest;

  let backlog = 0, open = 0, i = 0;
  const absorb = (e, totals) => {
    backlog += e.minutes;
    if (e.type === 'added') open += 1;
    if (e.type === 'done' || e.type === 'dropped') open -= 1;
    if (!totals) return;
    if (e.type === 'added' || e.type === 'done' || e.type === 'dropped') totals[e.type] += 1;
    totals[`${e.type}Minutes`] += e.minutes;
  };
  for (; i < events.length && events[i].at < start; i++) absorb(events[i]);

  const series = [];
  while (start <= now) {
    const end = next(start);
    const totals = emptyTotals();
    const opening = backlog;
    for (; i < events.length && events[i].at < end; i++) absorb(events[i], totals);
    series.push({ start, end, opening, backlog, open, ...totals });
    start = end;
  }
  return series;
}

// The backlog's change across a run of periods, split by cause. The parts sum to
// closing − opening.
export function backlogBridge(series) {
  if (!series.length) return null;
  const sum = key => series.reduce((s, row) => s + row[key], 0);
  return {
    from: series[0].start,
    opening: series[0].opening,
    added: sum('addedMinutes'),
    reestimated: sum('reestimatedMinutes'),
    workedOff: sum('workedMinutes') + sum('doneMinutes'),
    dropped: sum('droppedMinutes'),
    closing: series[series.length - 1].backlog
  };
}

// How long the backlog would last at the recent pace, in estimated hours on both
// sides, so habitual underestimating doesn't skew the ratio. Paces come from the
// last four weeks, or from all of history if that is shorter, but never from less
// than a week, so one busy day can't set the pace. What was added on the very first
// day isn't counted as arriving: that is the backlog being entered, not new work.
export function runway(events, now, { windowDays = 28, minDays = 7 } = {}) {
  const backlog = events.reduce((s, e) => s + e.minutes, 0);
  if (!events.length) return { backlog, days: 0, outPerWeek: 0, inPerWeek: 0, weeks: null };
  const known = (now - events[0].at) / DAY_MS;
  const days = Math.max(minDays, Math.min(windowDays, known));
  const since = +now - days * DAY_MS;
  const firstDay = new Date(events[0].at.getFullYear(), events[0].at.getMonth(), events[0].at.getDate() + 1);
  let out = 0, inward = 0;
  for (const e of events) {
    if (+e.at < since || e.at > now) continue;
    if (e.type === 'worked' || e.type === 'done') out -= e.minutes;
    if (e.type === 'added' && e.at >= firstDay) inward += e.minutes;
    if (e.type === 'reestimated') { if (e.minutes > 0) inward += e.minutes; else out -= e.minutes; }
  }
  const outPerWeek = out / days * 7;
  const inPerWeek = inward / days * 7;
  return { backlog, days, outPerWeek, inPerWeek, weeks: outPerWeek > 0 ? backlog / outPerWeek : null };
}

// Tasks that have sat for a while without pressing or being planned: candidates
// for dropping, oldest first.
export function letAloneCandidates(tasks, now, { minAgeDays = 14, maxPressure = 0.2 } = {}) {
  return tasks
    .filter(t => isOpen(t) && !t.scheduledBlocks.length && pAt(t, now) < maxPressure && (now - t.createdAt) / DAY_MS >= minAgeDays)
    .sort((a, b) => a.createdAt - b.createdAt);
}
