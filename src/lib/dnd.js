import interact from 'interactjs';
import { setDragState, setPreviewBlock } from '../stores/ui.svelte.js';
import { scheduleTask, unscheduleTask, tasks } from '../stores/tasks.svelte.js';
import { splitTaskAcrossDays, latestValidDropPosition } from './scheduling.js';
import { getVisibleWorkDays, retreatWork, toISODate, getDaySchedule } from './calendar.js';
import { workSchedule } from '../stores/schedule.svelte.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function getTask(taskId) {
  return tasks.value.find(t => t.id === taskId) ?? null;
}

function startDragCursor() {
  document.documentElement.classList.add('dragging-active');
}

function endDragCursor() {
  document.documentElement.classList.remove('dragging-active');
}

function cellFromPoint(x, y) {
  return document.elementsFromPoint(x, y)
    .find(el => el.dataset.date && el.dataset.start != null) ?? null;
}

function cellKey(cell) {
  return cell ? `${cell.dataset.date}:${cell.dataset.start}` : null;
}

// Given the cell directly under the pointer and a grab offset in work-minutes,
// walk back through work time to find where the task should start.
// Returns { date, startMinutes } snapped to the nearest 15-min slot, or null.
function resolveTaskStart(cell, grabOffsetMinutes, schedule) {
  // The cell under the pointer is the "grabbed point" in the timeline.
  // Build a Date for that moment.
  const pointerDate = new Date(cell.dataset.date + 'T00:00:00');
  pointerDate.setMinutes(parseInt(cell.dataset.start, 10));

  // Walk backwards by the grab offset to find where part 1 should start.
  const taskStart = retreatWork(pointerDate, grabOffsetMinutes, schedule);

  // Snap to 15-min grid.
  const totalMinutes = taskStart.getHours() * 60 + taskStart.getMinutes();
  const snapped = Math.round(totalMinutes / 15) * 15;

  // Make sure the snapped time is still within a work period on that day.
  const dateStr = toISODate(taskStart);
  const day = getDaySchedule(taskStart, schedule);
  if (!day) return null;

  const clampedStart = Math.max(day.startMinutes, Math.min(snapped, day.endMinutes - 15));
  return { date: dateStr, startMinutes: clampedStart };
}

// ─── shared drag logic ───────────────────────────────────────────────────────

function makeDragHandlers({ getTaskId, getGrabOffsetMinutes }) {
  let lastKey = null;

  function computeBlocks(task, cell) {
    const schedule = workSchedule.value;
    const visibleDays = getVisibleWorkDays(schedule, 7);

    const grabOffsetMinutes = getGrabOffsetMinutes();
    const taskStart = grabOffsetMinutes > 0
      ? resolveTaskStart(cell, grabOffsetMinutes, schedule)
      : { date: cell.dataset.date, startMinutes: parseInt(cell.dataset.start, 10) };

    if (!taskStart) return null;

    let blocks = splitTaskAcrossDays(task.id, taskStart.date, taskStart.startMinutes, task.estimatedMinutes, visibleDays);
    if (blocks === null) {
      const clamped = latestValidDropPosition(task.estimatedMinutes, visibleDays);
      if (clamped !== null) {
        blocks = splitTaskAcrossDays(task.id, clamped.date, clamped.startMinutes, task.estimatedMinutes, visibleDays);
      }
    }
    return blocks; // null means task doesn't fit anywhere
  }

  function onMove(event) {
    const cell = cellFromPoint(event.client.x, event.client.y);
    const key = cellKey(cell);
    if (key === lastKey) return;
    lastKey = key;

    if (cell) {
      const task = getTask(getTaskId());
      if (!task) return;
      setPreviewBlock(computeBlocks(task, cell)); // null → [] via store setter
    } else {
      setPreviewBlock(null);
    }
  }

  function onEnd(event) {
    lastKey = null;
    const cell = cellFromPoint(event.client.x, event.client.y);
    if (cell) {
      const task = getTask(getTaskId());
      if (task) {
        const blocks = computeBlocks(task, cell);
        if (blocks !== null) {
          scheduleTask(task.id, blocks);
        }
        // null means task is too long for the window — drop is a no-op
      }
    }
    setPreviewBlock(null);
    setDragState(null);
  }

  return { onMove, onEnd };
}

// ─── draggableTask action ────────────────────────────────────────────────────

export function draggableTask(node, { taskId }) {
  // Dragging from the task list — no grab offset, task starts at the drop point.
  const handlers = makeDragHandlers({ getTaskId: () => taskId, getGrabOffsetMinutes: () => 0 });

  interact(node).draggable({
    listeners: {
      start() {
        setDragState({ type: 'task', taskId });
        node.classList.add('dragging');
        startDragCursor();
      },
      move: handlers.onMove,
      end(event) {
        node.classList.remove('dragging');
        endDragCursor();
        handlers.onEnd(event);
      }
    }
  });

  return {
    update(params) { taskId = params.taskId; },
    destroy() { interact(node).unset(); }
  };
}

// ─── draggableBlock action ───────────────────────────────────────────────────

export function draggableBlock(node, { taskId, block }) {
  let grabOffsetMinutes = 0;
  const handlers = makeDragHandlers({ getTaskId: () => taskId, getGrabOffsetMinutes: () => grabOffsetMinutes });

  interact(node).draggable({
    listeners: {
      start(event) {
        // How many work-minutes into the task did the user grab?
        // = work-minutes in all preceding parts + pixel offset within this block converted to minutes.
        const quarterCell = document.querySelector('[data-start]');
        const pixelsPerMinute = quarterCell ? quarterCell.getBoundingClientRect().width / 15 : 1;
        const pxIntoBlock = event.client.x - node.getBoundingClientRect().left;
        const minutesIntoBlock = pxIntoBlock / pixelsPerMinute;

        const task = getTask(taskId);
        const precedingMinutes = task
          ? task.scheduledBlocks
              .filter(b => b.partIndex != null && b.partIndex < (block.partIndex ?? 1))
              .reduce((sum, b) => sum + b.durationMinutes, 0)
          : 0;

        grabOffsetMinutes = precedingMinutes + minutesIntoBlock;
        setDragState({ type: 'block', taskId });
        node.style.opacity = '0.3';
        startDragCursor();
      },
      move: handlers.onMove,
      end(event) {
        node.style.opacity = '';
        endDragCursor();
        const cell = cellFromPoint(event.client.x, event.client.y);
        if (!cell) unscheduleTask(taskId);
        handlers.onEnd(event);
      }
    }
  });

  return {
    update(params) { taskId = params.taskId; block = params.block; },
    destroy() { interact(node).unset(); }
  };
}
