// DOM hit-testing for drag-and-drop. These are the only drag helpers that read
// the live DOM — everything above this layer works with the descriptors they
// return (cells, outlook days, card ids), never with elements directly.

// The Today-planner time cell under the pointer, or null. A cell carries
// `data-date` and `data-start` (minutes-into-day).
export function cellFromPoint(x, y) {
  return document.elementsFromPoint(x, y)
    .find(el => el.dataset.date && el.dataset.start != null) ?? null;
}

// The outlook day container under the pointer, or null. Carries `data-outlook-day`.
export function outlookDayFromPoint(x, y) {
  return document.elementsFromPoint(x, y)
    .find(el => el.dataset.outlookDay) ?? null;
}

// The outlook card under the pointer that belongs to `dayEl`, excluding the
// card for `excludeTaskId` (the one being dragged). Carries `data-outlook-task-id`.
export function outlookCardFromPoint(x, y, dayEl, excludeTaskId) {
  if (!dayEl) return null;
  return document.elementsFromPoint(x, y)
    .find(el => el.dataset.outlookTaskId
             && el.dataset.outlookTaskId !== excludeTaskId
             && dayEl.contains(el)) ?? null;
}

// The narrow-layout pane tab under the pointer, or null. Carries `data-pane`.
// Hovering one mid-drag switches panes, so a drag can still reach the pane that
// the narrow layout has collapsed away.
export function paneTabFromPoint(x, y) {
  return document.elementsFromPoint(x, y)
    .find(el => el.dataset.pane) ?? null;
}

// A stable key for a Today cell, used to skip redundant preview recomputes.
export function cellKey(cell) {
  return cell ? `${cell.dataset.date}:${cell.dataset.start}` : null;
}

// Task IDs of the non-ghost cards for a day, in DOM order.
export function getEntriesForDay(dayDateStr) {
  const dayEl = document.querySelector(`[data-outlook-day="${dayDateStr}"]`);
  if (!dayEl) return [];
  return [...dayEl.querySelectorAll('[data-outlook-task-id]')]
    .filter(el => !el.classList.contains('outlook-card-ghost'))
    .map(el => el.dataset.outlookTaskId);
}
