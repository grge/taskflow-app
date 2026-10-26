import { getVisibleWorkDays, parseLocalDate } from './calendar.js';
import { computeFreeIntervals, blockId } from './scheduling.js';
import { schedulableMinutes } from './tasks.js';
import { SCHEDULING_HORIZON_DAYS } from './constants.js';

// Reorder tasks for a given day, packing sequentially from day start.
// Tasks that don't fit on the target day spill to subsequent work days rather
// than being silently dropped. Placement carves around `occupiedBlocks` —
// fixed blocks plus any scheduled tasks on future days that aren't being
// repacked here — so spilled tasks never land on top of existing blocks.
//
// Unlike the auto-scheduler, order is taken as given (the user's drag); this
// routine only decides *where* each task lands, not the sequence.
//
// Outlook cards are single-day placements by design, so a task longer than one
// work day has no interval that can hold it whole. Such tasks are reported in
// `unplaceable` rather than dropped: the caller has usually already cleared the
// task's old blocks to make the move, and silently placing nothing would leave
// it unscheduled with no indication why.
//
// Returns { reordered: Task[], blocks: Map<taskId, ScheduledBlock>,
//           unplaceable: taskId[] }
export function reorderAndBumpForward(orderedTasks, movedTaskId, newIndex, schedule, occupiedBlocks, date, now) {
  const movedTask    = orderedTasks.find(t => t.id === movedTaskId);
  const withoutMoved = orderedTasks.filter(t => t.id !== movedTaskId);
  const reordered    = [
    ...withoutMoved.slice(0, newIndex),
    movedTask,
    ...withoutMoved.slice(newIndex)
  ];

  const blocks = new Map();
  const unplaceable = [];

  // Look ahead enough days to absorb any overflow.
  const visibleDays = getVisibleWorkDays(schedule, SCHEDULING_HORIZON_DAYS, now);
  if (!visibleDays.length) return { reordered, blocks, unplaceable };

  const bufferMinutes = schedule.bufferMinutes ?? 0;
  const fromDate = parseLocalDate(date);

  // Free gaps from the target day onward, carving around everything occupied.
  const intervals = computeFreeIntervals(visibleDays, occupiedBlocks || [], fromDate, bufferMinutes);

  // Outlook cards are single-day placements: each task must fit whole inside one
  // free interval (no cross-day splitting). Pack in the given order, never
  // stepping backward — each task takes the first interval, at or after the
  // previous placement, that's large enough. This keeps chronological order in
  // sync with the user's chosen sequence; overflow spills to future days.
  let cursorIdx = 0;
  for (const task of reordered) {
    const rem = schedulableMinutes(task);

    let placedIdx = -1;
    for (let i = cursorIdx; i < intervals.length; i++) {
      if (intervals[i].endMinutes - intervals[i].startMinutes >= rem) {
        placedIdx = i;
        break;
      }
    }
    if (placedIdx === -1) {
      // No remaining gap holds it whole — most often a task longer than a
      // single work day, which this packer cannot split.
      unplaceable.push(task.id);
      continue;
    }

    const iv = intervals[placedIdx];
    blocks.set(task.id, {
      id:              blockId(task.id, iv.date, iv.startMinutes),
      taskId:          task.id,
      date:            iv.date,
      startMinutes:    iv.startMinutes,
      durationMinutes: rem
    });

    // Consume the placed span (+ buffer); resume the next task from here so
    // placement only ever advances.
    iv.startMinutes += rem + bufferMinutes;
    cursorIdx = placedIdx;
  }

  return { reordered, blocks, unplaceable };
}
