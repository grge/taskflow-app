export const IMPORTANCE_PEAKS = {
  low: 0.4,
  medium: 0.7,
  high: 1.0
};

export const URGENCY_ENVELOPES = {
  'next-couple-hours': { graceHours: 0, riseHours: 2 },
  'cob-today':         { graceHours: 0, riseHours: 0 },
  'cob-tomorrow':      { graceHours: 0, riseHours: 0 },
  'few-days':          { graceHours: 0, riseHours: 72 },
  'end-of-week':       { graceHours: 0, riseHours: 0 },
  'whenever':          { graceHours: 168, riseHours: 168 }
};

export const URGENCY_PROFILE_LABELS = {
  'next-couple-hours': 'Next Couple Hours',
  'cob-today':         'COB Today',
  'cob-tomorrow':      'COB Tomorrow',
  'few-days':          'Few Days',
  'end-of-week':       'End of Week',
  'whenever':          'Whenever'
};

export const URGENCY_PROFILE_ORDER = [
  'next-couple-hours',
  'cob-today',
  'cob-tomorrow',
  'few-days',
  'end-of-week',
  'whenever'
];

export const PROBLEMNESS_SCALE = [
  { min: 0.00, max: 0.20, level: 1, label: 'No Problem',    emoji: '😌', color: '#4CAF50' },
  { min: 0.20, max: 0.40, level: 2, label: 'Oopsie',        emoji: '😬', color: '#8BC34A' },
  { min: 0.40, max: 0.65, level: 3, label: 'Uh oh',         emoji: '😰', color: '#FFA726' },
  { min: 0.65, max: 0.85, level: 4, label: 'OH CRAP',       emoji: '🚨', color: '#EF5350' },
  { min: 0.85, max: 1.01, level: 5, label: 'I am so sorry', emoji: '💀', color: '#B71C1C' }
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
