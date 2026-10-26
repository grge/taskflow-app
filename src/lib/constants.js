export const STORAGE_KEY = 'taskflow_v2';
export const SYNC_STORAGE_KEY = 'taskflow_sync';
export const SNAP_MINUTES = 15;
// Smallest block the scheduler will place. Remaining time is shown to the user
// clamped at 0 ("0m left"), but a task with near-zero remaining still needs a
// non-degenerate block — avoids zero-height cards and divide-by-zero in scoring.
export const MIN_BLOCK_MINUTES = 5;

// How many work days ahead any scheduler may place work. Every placement path
// (auto-schedule, single-task, outlook reorder, drag-drop) reads this, so a
// task placeable on one surface is placeable on all of them. Previously each
// call site passed its own literal (7 / 7 / 21), which meant the outlook
// backlog could park a task on a day autoSchedule could not see.
//
// Distinct from the outlook panel's *rendering* window, which counts days
// forward from whichever day is being viewed rather than from today.
export const SCHEDULING_HORIZON_DAYS = 21;

export const PRESSURE_SCALE = [
  { min: 0.00, max: 0.20, level: 1, label: 'Low',      emoji: '😌', color: '#4CAF50' },
  { min: 0.20, max: 0.40, level: 2, label: 'Building',  emoji: '😬', color: '#8BC34A' },
  { min: 0.40, max: 0.65, level: 3, label: 'Elevated',  emoji: '😰', color: '#FFA726' },
  { min: 0.65, max: 0.85, level: 4, label: 'High',      emoji: '🚨', color: '#EF5350' },
  { min: 0.85, max: 1.01, level: 5, label: 'Critical',  emoji: '💀', color: '#B71C1C' }
];

export const ENVELOPE_COLOR_STOPS = [
  { p: 0.00, color: '#4CAF50' },
  { p: 0.20, color: '#8BC34A' },
  { p: 0.40, color: '#FFA726' },
  { p: 0.65, color: '#EF5350' },
  { p: 0.85, color: '#B71C1C' },
  { p: 1.00, color: '#B71C1C' },
];

export const DEFAULT_WORK_SCHEDULE = {
  bufferMinutes: 15,
  days: [
    { dayOfWeek: 0, enabled: false, startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 1, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 2, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 3, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 4, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 5, enabled: true,  startMinutes: 540, endMinutes: 1020 },
    { dayOfWeek: 6, enabled: false, startMinutes: 540, endMinutes: 1020 }
  ]
};
