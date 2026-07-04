import { getVisibleWorkDays, parseLocalDate } from './calendar.js';
import { computeFreeIntervals } from './scheduling.js';
import { schedulableMinutes } from './tasks.js';

// Reorder tasks for a given day, packing sequentially from day start.
// Tasks that don't fit on the target day spill to subsequent work days rather
// than being silently dropped. Placement carves around `occupiedBlocks` —
// fixed blocks plus any scheduled tasks on future days that aren't being
// repacked here — so spilled tasks never land on top of existing blocks.
//
// Unlike the auto-scheduler, order is taken as given (the user's drag); this
// routine only decides *where* each task lands, not the sequence.
//
// Returns { reordered: Task[], blocks: Map<taskId, ScheduledBlock> }
export function reorderAndBumpForward(orderedTasks, movedTaskId, newIndex, schedule, occupiedBlocks, date) {
  const movedTask    = orderedTasks.find(t => t.id === movedTaskId);
  const withoutMoved = orderedTasks.filter(t => t.id !== movedTaskId);
  const reordered    = [
    ...withoutMoved.slice(0, newIndex),
    movedTask,
    ...withoutMoved.slice(newIndex)
  ];

  const blocks = new Map();

  // Look ahead enough days to absorb any overflow.
  const visibleDays = getVisibleWorkDays(schedule, 21);
  if (!visibleDays.length) return { reordered, blocks };

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
    if (placedIdx === -1) continue; // no gap ahead fits it — leave unscheduled

    const iv = intervals[placedIdx];
    blocks.set(task.id, {
      id:              crypto.randomUUID(),
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

  return { reordered, blocks };
}
