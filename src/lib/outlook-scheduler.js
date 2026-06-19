import { getDaySchedule, getVisibleWorkDays, toISODate } from './calendar.js';
import { splitTaskAcrossDays } from './scheduling.js';

// Advance cursor past any fixed blocks that conflict with [cursor, cursor+duration).
// Returns the first valid start, or null if the task won't fit before dayEnd.
function advancePastFixedBlocks(cursor, durationMinutes, dayFixedBlocks, daySchedule) {
  let pos = cursor;
  while (pos + durationMinutes <= daySchedule.endMinutes) {
    const conflict = dayFixedBlocks.find(fb =>
      pos < fb.startMinutes + fb.durationMinutes &&
      pos + durationMinutes > fb.startMinutes
    );
    if (!conflict) return pos;
    pos = conflict.startMinutes + conflict.durationMinutes;
  }
  return null;
}

// Reorder tasks for a given day, packing sequentially from day start.
// Tasks that don't fit on the target day spill to subsequent work days via
// splitTaskAcrossDays rather than being silently dropped.
//
// Returns { reordered: Task[], blocks: Map<taskId, ScheduledBlock> }
export function reorderAndBumpForward(orderedTasks, movedTaskId, newIndex, schedule, fixedBlocks, date) {
  const movedTask    = orderedTasks.find(t => t.id === movedTaskId);
  const withoutMoved = orderedTasks.filter(t => t.id !== movedTaskId);
  const reordered    = [
    ...withoutMoved.slice(0, newIndex),
    movedTask,
    ...withoutMoved.slice(newIndex)
  ];

  const dayDate      = new Date(date + 'T00:00:00');
  const daySchedule  = getDaySchedule(dayDate, schedule);
  const blocks       = new Map();

  if (!daySchedule) return { reordered, blocks };

  const bufferMinutes  = schedule.bufferMinutes ?? 0;
  const dayFixedBlocks = (fixedBlocks || [])
    .filter(b => b.date === date)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  // Look ahead enough days to absorb any overflow
  const visibleDays = getVisibleWorkDays(schedule, 21);

  let cursor = daySchedule.startMinutes;

  for (const task of reordered) {
    const start = advancePastFixedBlocks(cursor, task.estimatedMinutes, dayFixedBlocks, daySchedule);

    if (start !== null) {
      // Fits on the target day
      blocks.set(task.id, {
        id:              crypto.randomUUID(),
        taskId:          task.id,
        date,
        startMinutes:    start,
        durationMinutes: task.estimatedMinutes
      });
      cursor = start + task.estimatedMinutes + bufferMinutes;
    } else {
      // Overflows — spill to the next available work day after the target date
      const futureDays = visibleDays.filter(d => toISODate(d.date) > date);
      let placed = false;
      for (const { date: spillDate } of futureDays) {
        const spillDateStr  = toISODate(spillDate);
        const spillSchedule = getDaySchedule(spillDate, schedule);
        if (!spillSchedule) continue;
        const spillFixed = (fixedBlocks || []).filter(b => b.date === spillDateStr);
        const spillStart = advancePastFixedBlocks(
          spillSchedule.startMinutes, task.estimatedMinutes, spillFixed, spillSchedule
        );
        if (spillStart !== null) {
          blocks.set(task.id, {
            id:              crypto.randomUUID(),
            taskId:          task.id,
            date:            spillDateStr,
            startMinutes:    spillStart,
            durationMinutes: task.estimatedMinutes
          });
          placed = true;
          break;
        }
      }
      // If no future day can fit it either, leave it unscheduled (no entry in blocks map)
    }
  }

  return { reordered, blocks };
}
