import interact from 'interactjs';
import { setDragState, setPreviewBlock, setOutlookPreview, setBerthGhost } from '../stores/ui.svelte.js';
import { scheduleTask, unscheduleTask, tasks } from '../stores/tasks.svelte.js';
import { splitTaskAcrossDays, latestValidDropPosition } from './scheduling.js';
import { getVisibleWorkDays, retreatWork, toISODate, getDaySchedule } from './calendar.js';
import { workSchedule, fixedBlocks } from '../stores/schedule.svelte.js';
import { reorderAndBumpForward } from './outlook-scheduler.js';
import { SNAP_MINUTES } from './constants.js';

// ─── DOM hit-testing ─────────────────────────────────────────────────────────

function cellFromPoint(x, y) {
  return document.elementsFromPoint(x, y)
    .find(el => el.dataset.date && el.dataset.start != null) ?? null;
}

// Returns the outlook day container element under the pointer, or null.
function outlookDayFromPoint(x, y) {
  return document.elementsFromPoint(x, y)
    .find(el => el.dataset.outlookDay) ?? null;
}


// Returns the outlook card element under the pointer that belongs to dayEl,
// excluding the card for excludeTaskId (the one being dragged).
function outlookCardFromPoint(x, y, dayEl, excludeTaskId) {
  if (!dayEl) return null;
  return document.elementsFromPoint(x, y)
    .find(el => el.dataset.outlookTaskId
             && el.dataset.outlookTaskId !== excludeTaskId
             && dayEl.contains(el)) ?? null;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function getTask(taskId) {
  return tasks.value.find(t => t.id === taskId) ?? null;
}

function startDragCursor() { document.documentElement.classList.add('dragging-active'); }
function endDragCursor()   { document.documentElement.classList.remove('dragging-active'); }

function cellKey(cell) {
  return cell ? `${cell.dataset.date}:${cell.dataset.start}` : null;
}

// Read current non-ghost card task IDs for a day, in DOM order.
function getEntriesForDay(dayDateStr) {
  const dayEl = document.querySelector(`[data-outlook-day="${dayDateStr}"]`);
  if (!dayEl) return [];
  return [...dayEl.querySelectorAll('[data-outlook-task-id]')]
    .filter(el => !el.classList.contains('outlook-card-ghost'))
    .map(el => el.dataset.outlookTaskId);
}

// Walk back grabOffsetMinutes of work-time from the cell under the pointer
// to find where the task should start. Returns { date, startMinutes } or null.
function resolveTaskStart(cell, grabOffsetMinutes, schedule) {
  const pointerDate = new Date(cell.dataset.date + 'T00:00:00');
  pointerDate.setMinutes(parseInt(cell.dataset.start, 10));

  const taskStart = retreatWork(pointerDate, grabOffsetMinutes, schedule);
  const totalMinutes = taskStart.getHours() * 60 + taskStart.getMinutes();
  const snapped = Math.round(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;

  const dateStr = toISODate(taskStart);
  const day = getDaySchedule(taskStart, schedule);
  if (!day) return null;

  const clampedStart = Math.max(day.startMinutes, Math.min(snapped, day.endMinutes - SNAP_MINUTES));
  return { date: dateStr, startMinutes: clampedStart };
}

// Compute preview blocks for a task dropped at a given Today cell.
function computeBlocksForCell(task, cell, grabOffsetMinutes) {
  const schedule = workSchedule.value;
  const visibleDays = getVisibleWorkDays(schedule, 7);

  const taskStart = grabOffsetMinutes > 0
    ? resolveTaskStart(cell, grabOffsetMinutes, schedule)
    : { date: cell.dataset.date, startMinutes: parseInt(cell.dataset.start, 10) };

  if (!taskStart) return null;

  let blocks = splitTaskAcrossDays(task.id, taskStart.date, taskStart.startMinutes, task.estimatedMinutes, visibleDays);
  if (blocks === null) {
    // taskStart resolved to before the visible window (grab offset retreated past
    // today's start) — clamp to the earliest available slot, not the latest.
    const first = visibleDays[0];
    if (first && taskStart.date < toISODate(first.date)) {
      blocks = splitTaskAcrossDays(task.id, toISODate(first.date), first.daySchedule.startMinutes, task.estimatedMinutes, visibleDays);
    }
  }
  return blocks;
}

// ─── outlook drop logic ──────────────────────────────────────────────────────

// Compute { insertBeforeTaskId, isNoOp } for a drag over an outlook card.
// entriesForDay: current [{ task, block }] for that day.
// pos: 'before' | 'after' relative to targetCardTaskId.
// sourceTaskId: task being dragged (null if from outside outlook).
// sourceDateStr: day it came from (null if from outside outlook).
function outlookInsertionPoint(entriesForDay, targetCardTaskId, pos, sourceTaskId, sourceDateStr, targetDateStr) {
  const targetIdx = entriesForDay.findIndex(en => en.task.id === targetCardTaskId);

  const insertBeforeTaskId = pos === 'before'
    ? (entriesForDay[targetIdx]?.task.id ?? null)
    : (entriesForDay[targetIdx + 1]?.task.id ?? null);

  // No-op suppression: only relevant for same-day reorders
  if (sourceTaskId && sourceDateStr === targetDateStr) {
    const myIdx  = entriesForDay.findIndex(en => en.task.id === sourceTaskId);
    const afterMe = entriesForDay[myIdx + 1]?.task.id ?? null;
    const isNoOp = insertBeforeTaskId === sourceTaskId || insertBeforeTaskId === afterMe;
    return { insertBeforeTaskId, isNoOp };
  }

  return { insertBeforeTaskId, isNoOp: false };
}

// Commit a drop onto an outlook day. Handles both cross-day moves and
// drops from outside the outlook (sourceTaskId from task list / today planner).
function commitOutlookDrop(movedTaskId, sourceDateStr, targetDateStr, insertBeforeTaskId) {
  // Snapshot entries before any mutations
  const dayEntries = tasks.value
    .filter(t => !t.isCompleted && !t.isDeleted)
    .flatMap(t => t.scheduledBlocks
      .filter(b => b.date === targetDateStr)
      .map(b => ({ task: t, block: b })))
    .sort((a, b) => a.block.startMinutes - b.block.startMinutes);

  // Unschedule from source if moving between days (or from today planner)
  if (sourceDateStr !== targetDateStr) {
    unscheduleTask(movedTaskId);
  }

  // Build ordered task list for the target day, including the moved task
  let orderedTasks = dayEntries.map(e => e.task).filter(t => t.id !== movedTaskId);
  const movedTask = getTask(movedTaskId);
  if (!movedTask) return;

  // Find insertion index based on insertBeforeTaskId
  let newIndex;
  if (insertBeforeTaskId === null) {
    newIndex = orderedTasks.length; // append at end
  } else {
    newIndex = orderedTasks.findIndex(t => t.id === insertBeforeTaskId);
    if (newIndex === -1) newIndex = orderedTasks.length;
  }

  orderedTasks.splice(newIndex, 0, movedTask);

  const { blocks } = reorderAndBumpForward(
    orderedTasks, movedTaskId, newIndex,
    workSchedule.value, fixedBlocks.value, targetDateStr
  );

  for (const [taskId, block] of blocks) {
    scheduleTask(taskId, [block]);
  }
}

// ─── shared move/end handlers (Today planner + task list drags) ──────────────

function makeDragHandlers({ getTaskId, getGrabOffsetMinutes, dropOutsideUnschedules = false }) {
  let lastKey          = null;
  let lastOutlookDrop  = null; // { dateStr, insertBeforeTaskId } — mirrors pendingDrop in draggableOutlookCard

  function onMove(event) {
    const { x, y } = event.client;
    const cell = cellFromPoint(x, y);

    if (cell) {
      // Over a Today planner slot
      const key = cellKey(cell);
      if (key === lastKey) return;
      lastKey = key;
      lastOutlookDrop = null;
      setOutlookPreview(null);
      setBerthGhost(null);
      const task = getTask(getTaskId());
      if (task) setPreviewBlock(computeBlocksForCell(task, cell, getGrabOffsetMinutes()));
    } else {
      lastKey = null;
      setPreviewBlock(null);

      const dayEl = outlookDayFromPoint(x, y);
      if (dayEl) {
        setBerthGhost(null);
        const dayDateStr = dayEl.dataset.outlookDay;
        const card       = outlookCardFromPoint(x, y, dayEl, null);

        if (card) {
          const hoveredId = card.dataset.outlookTaskId;

          // Same hysteresis as draggableOutlookCard: don't update if pointer is
          // still within the gap the ghost already occupies.
          if (lastOutlookDrop?.dateStr === dayDateStr) {
            const idsInDay    = getEntriesForDay(dayDateStr);
            const insertIdx   = lastOutlookDrop.insertBeforeTaskId === null
              ? idsInDay.length
              : idsInDay.indexOf(lastOutlookDrop.insertBeforeTaskId);
            const gapBefore = idsInDay[insertIdx - 1] ?? null;
            const gapAfter  = idsInDay[insertIdx]     ?? null;
            if (hoveredId === gapBefore || hoveredId === gapAfter) return;
          }

          const rect = card.getBoundingClientRect();
          const pos  = y < rect.top + rect.height / 2 ? 'before' : 'after';
          const idsInDay  = getEntriesForDay(dayDateStr);
          const targetIdx = idsInDay.indexOf(hoveredId);
          const insertBeforeTaskId = pos === 'before'
            ? (idsInDay[targetIdx] ?? null)
            : (idsInDay[targetIdx + 1] ?? null);

          lastOutlookDrop = { dateStr: dayDateStr, insertBeforeTaskId };
          setOutlookPreview({ dateStr: dayDateStr, insertBeforeTaskId, ghostTaskId: getTaskId() });
        } else {
          // Empty day area — append at end
          lastOutlookDrop = { dateStr: dayDateStr, insertBeforeTaskId: null };
          setOutlookPreview({ dateStr: dayDateStr, insertBeforeTaskId: null, ghostTaskId: getTaskId() });
        }
      } else {
        lastOutlookDrop = null;
        setOutlookPreview(null);
        setBerthGhost(dropOutsideUnschedules ? getTaskId() : null);
      }
    }
  }

  function onEnd(event) {
    lastKey         = null;
    lastOutlookDrop = null;
    const { x, y } = event.client;
    const cell = cellFromPoint(x, y);

    if (cell) {
      const task = getTask(getTaskId());
      if (task) {
        const blocks = computeBlocksForCell(task, cell, getGrabOffsetMinutes());
        if (blocks !== null) scheduleTask(task.id, blocks);
      }
    } else {
      const dayEl = outlookDayFromPoint(x, y);
      if (dayEl) {
        const task = getTask(getTaskId());
        if (task) {
          const card = outlookCardFromPoint(x, y, dayEl, null);
          commitOutlookDrop(task.id, null, dayEl.dataset.outlookDay, card?.dataset.outlookTaskId ?? null);
        }
      }
    }

    setPreviewBlock(null);
    setOutlookPreview(null);
    setBerthGhost(null);
    setDragState(null);
  }

  return { onMove, onEnd };
}

// ─── draggableTask action ────────────────────────────────────────────────────

export function draggableTask(node, { taskId }) {
  const handlers = makeDragHandlers({ getTaskId: () => taskId, getGrabOffsetMinutes: () => 0 });

  interact(node).draggable({
    listeners: {
      start() {
        setDragState({ type: 'task', taskId });
        startDragCursor();
      },
      move: handlers.onMove,
      end(event) {
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

// ─── draggableBlockVertical action ───────────────────────────────────────────

export function draggableBlockVertical(node, { taskId, block }) {
  let grabOffsetMinutes = 0;
  const handlers = makeDragHandlers({ getTaskId: () => taskId, getGrabOffsetMinutes: () => grabOffsetMinutes, dropOutsideUnschedules: true });

  interact(node).draggable({
    listeners: {
      start(event) {
        const quarterCell = document.querySelector('[data-start]');
        const pixelsPerMinute = quarterCell ? quarterCell.getBoundingClientRect().height / SNAP_MINUTES : 1;
        const pyIntoBlock = event.client.y - node.getBoundingClientRect().top;

        const task = getTask(taskId);
        const precedingMinutes = task
          ? task.scheduledBlocks
              .filter(b => b.partIndex != null && b.partIndex < (block.partIndex ?? 1))
              .reduce((sum, b) => sum + b.durationMinutes, 0)
          : 0;

        grabOffsetMinutes = precedingMinutes + (pyIntoBlock / pixelsPerMinute);
        setDragState({ type: 'block', taskId });
        startDragCursor();
      },
      move: handlers.onMove,
      end(event) {
        endDragCursor();
        const { x, y } = event.client;
        if (!cellFromPoint(x, y) && !outlookDayFromPoint(x, y)) {
          unscheduleTask(taskId);
          setPreviewBlock(null);
          setOutlookPreview(null);
          setBerthGhost(null);
          setDragState(null);
          return;
        }
        handlers.onEnd(event);
      }
    }
  });

  return {
    update(params) { taskId = params.taskId; block = params.block; },
    destroy() { interact(node).unset(); }
  };
}

// ─── draggableOutlookCard action ─────────────────────────────────────────────
// Used by OutlookSection cards. Handles reorder within/between outlook days
// and cross-drop to Today planner.

export function draggableOutlookCard(node, { taskId, dateStr: initialDateStr }) {
  let dateStr = initialDateStr;

  let pointerId   = null;
  let pendingDrop = null; // { targetDateStr, insertBeforeTaskId } | null

  function onPointerDown(e) {
    if (e.target.closest('button')) return;
    e.stopPropagation();
    pointerId = e.pointerId;
    pendingDrop = null;
    setDragState({ type: 'outlookCard', taskId });
    document.documentElement.classList.add('dragging-active');
    node.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (e.pointerId !== pointerId) return;

    const { clientX: x, clientY: y } = e;

    // Check Today planner first
    const cell = cellFromPoint(x, y);
    if (cell) {
      pendingDrop = null;
      setOutlookPreview(null);
      const task = getTask(taskId);
      if (task) {
        const blocks = computeBlocksForCell(task, cell, 0);
        setPreviewBlock(blocks);
      }
      return;
    }

    setPreviewBlock(null);

    const dayEl = outlookDayFromPoint(x, y);
    if (!dayEl) {
      pendingDrop = null;
      setOutlookPreview(null);
      return;
    }

    const targetDateStr = dayEl.dataset.outlookDay;
    const card = outlookCardFromPoint(x, y, dayEl, taskId);

    if (card) {
      const hoveredId = card.dataset.outlookTaskId;

      // Hysteresis: if we already have a pending drop on this same day, only
      // update if the pointer has entered a different card's territory. This
      // prevents the ghost insertion shifting cards which shifts midpoints which
      // flips pos which moves the ghost — the classic feedback loop.
      if (pendingDrop?.targetDateStr === targetDateStr) {
        const idsInDay = getEntriesForDay(targetDateStr);
        const insertedBeforeId = pendingDrop.insertBeforeTaskId; // null = end
        // The gap the ghost currently occupies is between the card just before
        // insertedBeforeId and insertedBeforeId itself. The pointer is still in
        // that gap if the hovered card is either of those two neighbours.
        const insertIdx = insertedBeforeId === null
          ? idsInDay.length
          : idsInDay.indexOf(insertedBeforeId);
        const gapBefore = idsInDay[insertIdx - 1] ?? null;
        const gapAfter  = idsInDay[insertIdx]     ?? null;
        if (hoveredId === gapBefore || hoveredId === gapAfter) {
          // Still in the same gap — don't update, prevents oscillation
          return;
        }
      }

      // Pointer has entered a new card's territory — recompute insertion point
      const rect = card.getBoundingClientRect();
      const pos  = y < rect.top + rect.height / 2 ? 'before' : 'after';

      const idsInDay  = getEntriesForDay(targetDateStr);
      const targetIdx = idsInDay.indexOf(hoveredId);
      const insertBeforeTaskId = pos === 'before'
        ? (idsInDay[targetIdx] ?? null)
        : (idsInDay[targetIdx + 1] ?? null);

      // Suppress no-op for same-day reorders
      if (targetDateStr === dateStr) {
        const myIdx  = idsInDay.indexOf(taskId);
        const afterMe = idsInDay[myIdx + 1] ?? null;
        if (insertBeforeTaskId === taskId || insertBeforeTaskId === afterMe) {
          pendingDrop = null;
          setOutlookPreview(null);
          return;
        }
      }

      pendingDrop = { targetDateStr, insertBeforeTaskId };
      setOutlookPreview({ dateStr: targetDateStr, insertBeforeTaskId, ghostTaskId: taskId });
    } else {
      // Over empty day area (no card under pointer in this day)
      if (targetDateStr === dateStr) {
        // Already on this day with no other card — no-op
        pendingDrop = null;
        setOutlookPreview(null);
      } else {
        pendingDrop = { targetDateStr, insertBeforeTaskId: null };
        setOutlookPreview({ dateStr: targetDateStr, insertBeforeTaskId: null, ghostTaskId: taskId });
      }
    }
  }

  function onPointerUp(e) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;

    document.documentElement.classList.remove('dragging-active');
    setPreviewBlock(null);
    setOutlookPreview(null);
    setDragState(null);

    const { clientX: x, clientY: y } = e;
    const cell = cellFromPoint(x, y);

    if (cell) {
      // Drop onto Today planner
      unscheduleTask(taskId);
      const task = getTask(taskId);
      if (task) {
        const blocks = computeBlocksForCell(task, cell, 0);
        if (blocks) scheduleTask(task.id, blocks);
      }
    } else if (pendingDrop) {
      commitOutlookDrop(taskId, dateStr, pendingDrop.targetDateStr, pendingDrop.insertBeforeTaskId);
    }

    pendingDrop = null;
    node.releasePointerCapture(e.pointerId);
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup',   onPointerUp);

  return {
    update(params) { taskId = params.taskId; dateStr = params.dateStr; },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup',   onPointerUp);
    }
  };
}
