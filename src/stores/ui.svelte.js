import { toISODate } from '../lib/calendar.js';

let _dragState      = $state(null);
let _activeModal    = $state(null);
let _expandedTaskId = $state(null);
let _activeTab      = $state('plan'); // 'plan' | 'insights' | 'settings'
let _previewBlock   = $state([]);
let _activeTimer    = $state(null);
// Ghost card shown in Upcoming during drags: { dateStr, insertBeforeTaskId } | null
let _outlookPreview = $state(null);
// The date currently shown in the day planner (defaults to today, cannot go before today)
let _plannerDate    = $state(toISODate(new Date()));

export const dragState = {
  get value() { return _dragState; }
};

export const activeModal = {
  get value() { return _activeModal; }
};

export const expandedTaskId = {
  get value() { return _expandedTaskId; }
};

export const activeTab = {
  get value() { return _activeTab; }
};

export const previewBlock = {
  get value() { return _previewBlock; }
};

export const activeTimer = {
  get value() { return _activeTimer; }
};

export const outlookPreview = {
  get value() { return _outlookPreview; }
};

export const plannerDate = {
  get value() { return _plannerDate; }
};

export function setDragState(state) {
  _dragState = state;
}

export function setPreviewBlock(blocks) {
  _previewBlock = blocks ?? [];
}

export function openModal(name) {
  _activeModal = name;
}

export function closeModal() {
  _activeModal = null;
}

export function setExpandedTask(id) {
  _expandedTaskId = _expandedTaskId === id ? null : id; // toggle
}

export function setActiveTab(tab) {
  _activeTab = tab;
}

export function setActiveTimer(timer) {
  _activeTimer = timer;
}

export function setOutlookPreview(preview) {
  _outlookPreview = preview; // { dateStr, insertBeforeTaskId } | null
}

export function setPlannerDate(dateStr) {
  const todayStr = toISODate(new Date());
  _plannerDate = dateStr < todayStr ? todayStr : dateStr;
}

export function advancePlannerDay(schedule) {
  // Find next work day after current plannerDate
  const cursor = new Date(_plannerDate + 'T00:00:00');
  cursor.setDate(cursor.getDate() + 1);
  let safety = 0;
  while (safety++ < 14) {
    const dow = cursor.getDay();
    const day = schedule.days.find(d => d.dayOfWeek === dow);
    if (day?.enabled) {
      _plannerDate = toISODate(cursor);
      return;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
}

export function retreatPlannerDay(schedule) {
  const todayStr = toISODate(new Date());
  const cursor = new Date(_plannerDate + 'T00:00:00');
  cursor.setDate(cursor.getDate() - 1);
  let safety = 0;
  while (safety++ < 14) {
    const dateStr = toISODate(cursor);
    if (dateStr < todayStr) {
      _plannerDate = todayStr;
      return;
    }
    const dow = cursor.getDay();
    const day = schedule.days.find(d => d.dayOfWeek === dow);
    if (day?.enabled) {
      _plannerDate = dateStr;
      return;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
}

export function resetPlannerToToday() {
  _plannerDate = toISODate(new Date());
}
