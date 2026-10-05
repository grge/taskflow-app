const STORAGE_KEY = 'taskflow_layout';

// Bounds for the manually resized task panel. The floor is where task rows stop
// being readable (phase 3 found 260px already cramped); the ceiling is a
// judgement about how much of the window a sidebar may claim.
export const TASK_PANEL_MIN = 240;
export const TASK_PANEL_MAX = 560;

// Whatever the sidebar takes, the work region keeps at least this much, so a
// width saved on a wide screen can't swallow a narrow one.
const MIN_WORK_REGION = 360;

export function clampTaskPanelWidth(px) {
  const viewportMax = typeof window !== 'undefined'
    ? window.innerWidth - MIN_WORK_REGION
    : Infinity;
  const max = Math.max(TASK_PANEL_MIN, Math.min(TASK_PANEL_MAX, viewportMax));
  return Math.round(Math.min(max, Math.max(TASK_PANEL_MIN, px)));
}

// null means "never resized" — the CSS default applies, and stays fluid.
function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const width = saved?.taskPanelWidth;
    return Number.isFinite(width) ? clampTaskPanelWidth(width) : null;
  } catch {
    return null;
  }
}

let _taskPanelWidth = $state(loadSaved());

export const taskPanelWidth = {
  get value() { return _taskPanelWidth; }
};

export function setTaskPanelWidth(px) {
  _taskPanelWidth = clampTaskPanelWidth(px);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ taskPanelWidth: _taskPanelWidth }));
  } catch {}
}

// Back to the fluid default rather than to a hard-coded number.
export function resetTaskPanelWidth() {
  _taskPanelWidth = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
