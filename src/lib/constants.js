export const STORAGE_KEY = 'taskflow_v2';
export const SNAP_MINUTES = 15;

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
