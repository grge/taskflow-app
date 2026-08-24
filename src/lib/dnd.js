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

// ─── touch lift gate ─────────────────────────────────────────────────────────
// A mouse drags the moment it moves. A finger can't: the same gesture is how you
// scroll the list the card sits in, so a press has to dwell before it becomes a
// drag. Until it does the browser keeps the gesture and pans, which is why the
// cards carry touch-action: pan-y on coarse pointers.
//
// Once the hold completes we take the gesture over, and that means preventing
// the pan on the next touchmove. It works only because the finger has been
// still — the browser hasn't begun scrolling, so its default is still ours to
// cancel — and only if the listener is non-passive.

const TOUCH_HOLD_MS = 200;
const HOLD_SLOP_PX  = 8;

function liftGate(node) {
  let armed  = false;
  let timer  = null;
  let origin = null;
  let isTouch = false;

  function release() {
    clearTimeout(timer);
    timer  = null;
    armed  = false;
    origin = null;
    node.classList.remove('is-lifted');
  }

  function onDown(e) {
    isTouch = e.pointerType !== 'mouse';
    origin  = { x: e.clientX, y: e.clientY };
    // A mouse never waits — this is exactly the behaviour it always had.
    armed = !isTouch;
    clearTimeout(timer);
    if (isTouch) {
      timer = setTimeout(() => {
        armed = true;
        // Immediate feedback: the hold completes before any movement, so
        // without this the card looks inert until the finger travels.
        node.classList.add('is-lifted');
      }, TOUCH_HOLD_MS);
    }
  }

  // Movement before the hold completes means the user is scrolling, not lifting.
  function onMove(e) {
    if (!isTouch || armed || !origin) return;
    if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > HOLD_SLOP_PX) release();
  }

  function onTouchMove(e) {
    if (armed && isTouch) e.preventDefault();
  }

  node.addEventListener('pointerdown',   onDown);
  node.addEventListener('pointermove',   onMove);
  node.addEventListener('pointerup',     release);
  node.addEventListener('pointercancel', release);
  node.addEventListener('touchmove',     onTouchMove, { passive: false });

  return {
    get armed() { return armed; },
    release,
    destroy() {
      clearTimeout(timer);
      node.removeEventListener('pointerdown',   onDown);
      node.removeEventListener('pointermove',   onMove);
      node.removeEventListener('pointerup',     release);
      node.removeEventListener('pointercancel', release);
      node.removeEventListener('touchmove',     onTouchMove);
    }
  };
}

// Autoscroll. The scrollers here are the panels, not the window, so interact's
// own autoScroll (which targets the window) would do nothing — this drives the
// nearest scrolling ancestor instead, and serves both drag engines identically.
function scrollParent(node) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
  }
  return null;
}

const EDGE_MARGIN_PX = 56;
const EDGE_MAX_PX_PER_FRAME = 14;

function edgeScroller(node) {
  let container = null;
  let frame = null;
  let velocity = 0;

  function step() {
    if (!velocity || !container) { frame = null; return; }
    container.scrollTop += velocity;
    frame = requestAnimationFrame(step);
  }

  return {
    // Resolved at drag start, not bind time: panels mount and re-render, and on
    // the phone the pane a card lives in may not have existed when it bound.
    begin() { container = scrollParent(node); },
    update(y) {
      if (!container) return;
      const r = container.getBoundingClientRect();
      if (y < r.top + EDGE_MARGIN_PX) {
        velocity = -Math.ceil(EDGE_MAX_PX_PER_FRAME * Math.min(1, (r.top + EDGE_MARGIN_PX - y) / EDGE_MARGIN_PX));
      } else if (y > r.bottom - EDGE_MARGIN_PX) {
        velocity = Math.ceil(EDGE_MAX_PX_PER_FRAME * Math.min(1, (y - r.bottom + EDGE_MARGIN_PX) / EDGE_MARGIN_PX));
      } else {
        velocity = 0;
      }
      if (velocity && !frame) frame = requestAnimationFrame(step);
    },
    stop() {
      velocity = 0;
      if (frame) cancelAnimationFrame(frame);
      frame = null;
    }
  };
}

// One pointer-event drag engine for every surface. interact.js was used here
// only as a gesture recogniser — none of these actions move their element — and
// its manualStart hook proved unusable for the lift gate: interact delivers the
// pointer 'move' it exposes to the interactable under the pointer, and these
// cards are small enough that a drag leaves them on the first step, so the
// armed card's own handler never ran and the drag never started. Driving the
// pointer directly makes one start policy cover mouse and touch alike.
//
// The drag begins on the first move after the gate arms, but the grab offset is
// measured from where the press landed — otherwise the block would jump by
// however far the finger travelled before the drag engaged.
function pointerDrag(node, { ignoreFrom, onStart, onMove, onDrop, onCancel }) {
  const gate     = liftGate(node);
  const scroller = edgeScroller(node);
  let pointerId  = null;
  let dragging   = false;
  let origin     = null;

  function onDown(e) {
    if (ignoreFrom && e.target.closest(ignoreFrom)) { gate.release(); return; }
    e.stopPropagation();
    origin    = { clientX: e.clientX, clientY: e.clientY };
    pointerId = e.pointerId;
    // Capture on the press, not on the first move. These cards are small — a
    // chip is ~26px tall — so the pointer leaves the element on the very first
    // move of a drag, and without capture the move that would start the drag is
    // delivered to whatever is underneath instead. Capture does not affect
    // touch-action, so a scroll still wins until the gate arms; the browser
    // just cancels the pointer, which releases it below.
    node.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (e.pointerId !== pointerId) return;
    if (!dragging) {
      if (!gate.armed || !origin) return;
      dragging = true;
      scroller.begin();
      startDragCursor();
      onStart(origin);
    }
    scroller.update(e.clientY);
    onMove(e.clientX, e.clientY);
  }

  function finish(e, cancelled) {
    if (node.hasPointerCapture?.(e.pointerId)) node.releasePointerCapture(e.pointerId);
    origin    = null;
    pointerId = null;
    if (!dragging) return;
    dragging = false;
    scroller.stop();
    endDragCursor();
    if (cancelled) onCancel?.();
    else onDrop(e.clientX, e.clientY);
  }

  const onUp     = (e) => finish(e, false);
  const onCancelEv = (e) => finish(e, true);

  node.addEventListener('pointerdown',   onDown);
  node.addEventListener('pointermove',   onPointerMove);
  node.addEventListener('pointerup',     onUp);
  node.addEventListener('pointercancel', onCancelEv);

  return {
    destroy() {
      scroller.stop();
      gate.destroy();
      node.removeEventListener('pointerdown',   onDown);
      node.removeEventListener('pointermove',   onPointerMove);
      node.removeEventListener('pointerup',     onUp);
      node.removeEventListener('pointercancel', onCancelEv);
    }
  };
}

// ─── shared drag core ─────────────────────────────────────────────────────────
// Every drag surface routes through this. Given a pointer position and a drag
// context it
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

  const drag = pointerDrag(node, {
    ignoreFrom: 'button',
    onStart() { setDragState({ type: 'task', taskId }); },
    onMove: core.onMove,
    onDrop: core.onDrop,
    onCancel() { clearPreviews(); setDragState(null); }
  });

  return {
    update(params) { taskId = params.taskId; },
    destroy() { drag.destroy(); }
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

  const drag = pointerDrag(node, {
    ignoreFrom: 'button',
    onStart(origin) {
      const quarterCell = document.querySelector('[data-start]');
      const pixelsPerMinute = quarterCell ? quarterCell.getBoundingClientRect().height / SNAP_MINUTES : 1;
      const pyIntoBlock = origin.clientY - node.getBoundingClientRect().top;

      const task = getTask(taskId);
      const precedingMinutes = task
        ? task.scheduledBlocks
            .filter(b => b.partIndex != null && b.partIndex < (block.partIndex ?? 1))
            .reduce((sum, b) => sum + b.durationMinutes, 0)
        : 0;

      grabOffsetMinutes = precedingMinutes + (pyIntoBlock / pixelsPerMinute);
      setDragState({ type: 'block', taskId });
    },
    onMove: core.onMove,
    onDrop(x, y) {
      // Dropped on nothing droppable → unschedule (berth ghost committed).
      if (!cellFromPoint(x, y) && !outlookDayFromPoint(x, y)) {
        unscheduleTask(taskId);
        clearPreviews();
        setDragState(null);
        return;
      }
      core.onDrop(x, y);
    },
    onCancel() { clearPreviews(); setDragState(null); }
  });

  return {
    update(params) { taskId = params.taskId; block = params.block; },
    destroy() { drag.destroy(); }
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

  const drag = pointerDrag(node, {
    ignoreFrom: 'button',
    onStart(origin) {
      const quarterCell = document.querySelector('[data-start]');
      const pixelsPerMinute = quarterCell ? quarterCell.getBoundingClientRect().height / SNAP_MINUTES : 1;
      const pyIntoBlock = origin.clientY - node.getBoundingClientRect().top;
      grabOffsetMinutes = pyIntoBlock / pixelsPerMinute;
      setDragState({ type: 'fixedBlock', fixedBlockId });
    },
    onMove: previewFromPoint,
    onDrop(x, y) {
      lastKey = null;
      const cell = cellFromPoint(x, y);
      if (cell) {
        const drop = resolveFixedBlockDrop(cellDescriptor(cell), grabOffsetMinutes, block.durationMinutes, workSchedule.value);
        if (drop) editFixedBlock(fixedBlockId, { date: drop.date, startMinutes: drop.startMinutes });
      }
      setPreviewBlock(null);
      setDragState(null);
    },
    onCancel() { lastKey = null; setPreviewBlock(null); setDragState(null); }
  });

  return {
    update(params) { fixedBlockId = params.fixedBlockId; block = params.block; },
    destroy() { drag.destroy(); }
  };
}

// ─── draggableOutlookCard action ─────────────────────────────────────────────
// Outlook backlog cards. Reorders within/between outlook days and cross-drops to
// the Today planner; shares the drag core, with its own day as the reorder
// source so same-day no-ops are suppressed.

export function draggableOutlookCard(node, { taskId, dateStr: initialDateStr }) {
  let dateStr = initialDateStr;

  const core = makeDragCore({
    getTaskId: () => taskId,
    getGrabOffsetMinutes: () => 0,
    get sourceDateStr() { return dateStr; }
  });

  const drag = pointerDrag(node, {
    ignoreFrom: 'button',
    onStart() { setDragState({ type: 'outlookCard', taskId }); },
    onMove: core.onMove,
    onDrop: core.onDrop,
    onCancel() { clearPreviews(); setDragState(null); }
  });

  return {
    update(params) { taskId = params.taskId; dateStr = params.dateStr; },
    destroy() { drag.destroy(); }
  };
}
