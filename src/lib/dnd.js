import interact from 'interactjs';
import { setDragState, setPreviewBlock, setOutlookPreview, setBerthGhost } from '../stores/ui.svelte.js';
import { scheduleTask, unscheduleTask, commitOutlookDrop, tasks, withLiveElapsed } from '../stores/tasks.svelte.js';
import { workSchedule, editFixedBlock } from '../stores/schedule.svelte.js';
import {
  cellFromPoint, outlookDayFromPoint, outlookCardFromPoint, cellKey, getEntriesForDay
} from './dnd-hittest.js';
import {
  computeBlocksForCell, resolveFixedBlockDrop, computeOutlookInsertion
} from './drop-placement.js';
import { SNAP_MINUTES } from './constants.js';

// ─── helpers ────────────────────────────────────────────────────────────────

// Task with live timer time folded in, so previewed/committed block size matches
// the "X left" shown on the card while a timer runs.
function getTask(taskId) {
  const t = tasks.value.find(t => t.id === taskId) ?? null;
  return t ? withLiveElapsed(t) : null;
}

// The hit-test layer works with { date, start } cell descriptors; unwrap the
// element's datasets once here.
function cellDescriptor(cell) {
  return cell ? { date: cell.dataset.date, start: parseInt(cell.dataset.start, 10) } : null;
}

function startDragCursor() { document.documentElement.classList.add('dragging-active'); }
function endDragCursor()   { document.documentElement.classList.remove('dragging-active'); }

function clearPreviews() {
  setPreviewBlock(null);
  setOutlookPreview(null);
  setBerthGhost(null);
}

// ─── shared drag core ─────────────────────────────────────────────────────────
// Both drag engines (interact.js task/block drags, and the raw-pointer outlook
// card drag) route through this. Given a pointer position and a drag context it
// updates the live preview (Today block ghost, outlook insertion ghost, or
// berth ghost) and, on drop, commits. All DOM reads go through the hit-test
// layer; all placement math through the placement layer.

// ctx: {
//   getTaskId()            → task being dragged
//   getGrabOffsetMinutes() → work-minutes between task start and the grab point
//   sourceDateStr          → outlook day the card came from, or null
//   dropOutsideUnschedules → show a berth ghost when hovering nothing droppable
// }
function makeDragCore(ctx) {
  let lastCellKey     = null;
  let lastOutlookDrop = null; // { dateStr, insertBeforeTaskId } | null

  // Resolve the outlook target under the pointer into a normalized descriptor
  // for computeOutlookInsertion: { dateStr, hoveredId, pos }.
  function outlookTarget(x, y, dayEl) {
    const dateStr = dayEl.dataset.outlookDay;
    const card = outlookCardFromPoint(x, y, dayEl, ctx.getTaskId());
    if (!card) return { dateStr, hoveredId: null, pos: null };
    const rect = card.getBoundingClientRect();
    return {
      dateStr,
      hoveredId: card.dataset.outlookTaskId,
      pos: y < rect.top + rect.height / 2 ? 'before' : 'after'
    };
  }

  function onMove(x, y) {
    const cell = cellFromPoint(x, y);

    // ── Over a Today-planner slot: preview the task's block ghost ──
    if (cell) {
      const key = cellKey(cell);
      if (key === lastCellKey) return;
      lastCellKey     = key;
      lastOutlookDrop = null;
      setOutlookPreview(null);
      setBerthGhost(null);
      const task = getTask(ctx.getTaskId());
      if (task) {
        setPreviewBlock(computeBlocksForCell(task, cellDescriptor(cell), ctx.getGrabOffsetMinutes(), workSchedule.value));
      }
      return;
    }

    lastCellKey = null;
    setPreviewBlock(null);

    // ── Over an outlook day: preview the insertion ghost ──
    const dayEl = outlookDayFromPoint(x, y);
    if (dayEl) {
      setBerthGhost(null);
      const target   = outlookTarget(x, y, dayEl);
      const idsInDay = getEntriesForDay(target.dateStr);
      const source   = ctx.sourceDateStr ? { dateStr: ctx.sourceDateStr, taskId: ctx.getTaskId() } : null;
      const decision = computeOutlookInsertion(target, idsInDay, lastOutlookDrop, source);

      if (decision.action === 'keep') return;
      if (decision.action === 'clear') {
        lastOutlookDrop = null;
        setOutlookPreview(null);
        return;
      }
      lastOutlookDrop = { dateStr: target.dateStr, insertBeforeTaskId: decision.insertBeforeTaskId };
      setOutlookPreview({ ...lastOutlookDrop, ghostTaskId: ctx.getTaskId() });
      return;
    }

    // ── Over nothing droppable ──
    lastOutlookDrop = null;
    setOutlookPreview(null);
    setBerthGhost(ctx.dropOutsideUnschedules ? ctx.getTaskId() : null);
  }

  function onDrop(x, y) {
    lastCellKey     = null;
    lastOutlookDrop = null;
    const cell = cellFromPoint(x, y);

    if (cell) {
      const task = getTask(ctx.getTaskId());
      if (task) {
        const blocks = computeBlocksForCell(task, cellDescriptor(cell), ctx.getGrabOffsetMinutes(), workSchedule.value);
        if (blocks !== null) scheduleTask(task.id, blocks);
      }
    } else {
      const dayEl = outlookDayFromPoint(x, y);
      if (dayEl) {
        const task = getTask(ctx.getTaskId());
        if (task) {
          const card = outlookCardFromPoint(x, y, dayEl, ctx.getTaskId());
          commitOutlookDrop(task.id, ctx.sourceDateStr, dayEl.dataset.outlookDay, card?.dataset.outlookTaskId ?? null);
        }
      }
    }

    clearPreviews();
    setDragState(null);
  }

  return { onMove, onDrop };
}

// ─── draggableTask action ────────────────────────────────────────────────────
// Task chips in the task list. No grab offset (drags from the chip origin) and
// no source day (comes from outside the outlook).

export function draggableTask(node, { taskId }) {
  const core = makeDragCore({
    getTaskId: () => taskId,
    getGrabOffsetMinutes: () => 0,
    sourceDateStr: null
  });

  interact(node).draggable({
    listeners: {
      start() {
        setDragState({ type: 'task', taskId });
        startDragCursor();
      },
      move(event) { core.onMove(event.client.x, event.client.y); },
      end(event) {
        endDragCursor();
        core.onDrop(event.client.x, event.client.y);
      }
    }
  });

  return {
    update(params) { taskId = params.taskId; },
    destroy() { interact(node).unset(); }
  };
}

// ─── draggableBlockVertical action ───────────────────────────────────────────
// Scheduled blocks on the Today timeline. Grab offset is in work-minutes (split
// blocks account for parts already elapsed on earlier days); dropping outside a
// droppable target unschedules the task.

export function draggableBlockVertical(node, { taskId, block }) {
  let grabOffsetMinutes = 0;
  const core = makeDragCore({
    getTaskId: () => taskId,
    getGrabOffsetMinutes: () => grabOffsetMinutes,
    sourceDateStr: null,
    dropOutsideUnschedules: true
  });

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
      move(event) { core.onMove(event.client.x, event.client.y); },
      end(event) {
        endDragCursor();
        const { x, y } = event.client;
        // Dropped on nothing droppable → unschedule (berth ghost committed).
        if (!cellFromPoint(x, y) && !outlookDayFromPoint(x, y)) {
          unscheduleTask(taskId);
          clearPreviews();
          setDragState(null);
          return;
        }
        core.onDrop(x, y);
      }
    }
  });

  return {
    update(params) { taskId = params.taskId; block = params.block; },
    destroy() { interact(node).unset(); }
  };
}

// ─── draggableFixedBlock action ──────────────────────────────────────────────
// Fixed blocks live on a single day and never split — drag is confined to Today
// planner cells, snapped and clamped to the work day. Manual placement is
// unrestricted (can overlap tasks/other fixed blocks); only the auto-scheduler
// treats fixed blocks as obstacles.

export function draggableFixedBlock(node, { fixedBlockId, block }) {
  let grabOffsetMinutes = 0;
  let lastKey = null;

  function previewFromPoint(x, y) {
    const cell = cellFromPoint(x, y);
    if (!cell) { lastKey = null; setPreviewBlock(null); return; }

    const key = cellKey(cell);
    if (key === lastKey) return;
    lastKey = key;

    const drop = resolveFixedBlockDrop(cellDescriptor(cell), grabOffsetMinutes, block.durationMinutes, workSchedule.value);
    if (!drop) { setPreviewBlock(null); return; }

    setPreviewBlock([{ date: drop.date, startMinutes: drop.startMinutes, durationMinutes: block.durationMinutes }]);
  }

  interact(node).draggable({
    listeners: {
      start(event) {
        const quarterCell = document.querySelector('[data-start]');
        const pixelsPerMinute = quarterCell ? quarterCell.getBoundingClientRect().height / SNAP_MINUTES : 1;
        const pyIntoBlock = event.client.y - node.getBoundingClientRect().top;
        grabOffsetMinutes = pyIntoBlock / pixelsPerMinute;
        setDragState({ type: 'fixedBlock', fixedBlockId });
        startDragCursor();
      },
      move(event) { previewFromPoint(event.client.x, event.client.y); },
      end(event) {
        endDragCursor();
        lastKey = null;
        const cell = cellFromPoint(event.client.x, event.client.y);
        if (cell) {
          const drop = resolveFixedBlockDrop(cellDescriptor(cell), grabOffsetMinutes, block.durationMinutes, workSchedule.value);
          if (drop) editFixedBlock(fixedBlockId, { date: drop.date, startMinutes: drop.startMinutes });
        }
        setPreviewBlock(null);
        setDragState(null);
      }
    }
  });

  return {
    update(params) { fixedBlockId = params.fixedBlockId; block = params.block; },
    destroy() { interact(node).unset(); }
  };
}

// ─── draggableOutlookCard action ─────────────────────────────────────────────
// Outlook backlog cards. Raw pointer events (rather than interact.js) so the
// card can be dragged out of a scrolling list reliably. Reorders within/between
// outlook days and cross-drops to the Today planner; shares the drag core, with
// its own day as the reorder source so same-day no-ops are suppressed.

export function draggableOutlookCard(node, { taskId, dateStr: initialDateStr }) {
  let dateStr = initialDateStr;
  let pointerId = null;

  const core = makeDragCore({
    getTaskId: () => taskId,
    getGrabOffsetMinutes: () => 0,
    get sourceDateStr() { return dateStr; }
  });

  function onPointerDown(e) {
    if (e.target.closest('button')) return;
    e.stopPropagation();
    pointerId = e.pointerId;
    setDragState({ type: 'outlookCard', taskId });
    startDragCursor();
    node.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (e.pointerId !== pointerId) return;
    core.onMove(e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    endDragCursor();
    core.onDrop(e.clientX, e.clientY);
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
