import { URGENCY_ENVELOPES, IMPORTANCE_PEAKS, PROBLEMNESS_SCALE, ENVELOPE_COLOR_STOPS } from './constants.js';

// Returns hours from createdAt to the deadline for deadline-anchored presets,
// or the static due time for fixed presets.
export function computeDueHours(profile, createdAt) {
  const msPerHour = 1000 * 60 * 60;

  if (profile === 'cob-today') {
    const deadline = new Date(createdAt);
    deadline.setHours(17, 0, 0, 0);
    if (createdAt.getTime() >= deadline.getTime()) {
      deadline.setDate(deadline.getDate() + 1);
      while (deadline.getDay() === 0 || deadline.getDay() === 6) {
        deadline.setDate(deadline.getDate() + 1);
      }
      deadline.setHours(17, 0, 0, 0);
    }
    return (deadline.getTime() - createdAt.getTime()) / msPerHour;
  }

  if (profile === 'cob-tomorrow') {
    const eodToday = new Date(createdAt);
    eodToday.setHours(17, 0, 0, 0);
    const startDay = new Date(createdAt);
    if (createdAt.getTime() >= eodToday.getTime()) {
      startDay.setDate(startDay.getDate() + 1);
    }
    const deadline = new Date(startDay);
    deadline.setDate(deadline.getDate() + 1);
    while (deadline.getDay() === 0 || deadline.getDay() === 6) {
      deadline.setDate(deadline.getDate() + 1);
    }
    deadline.setHours(17, 0, 0, 0);
    return Math.max(0, (deadline.getTime() - createdAt.getTime()) / msPerHour);
  }

  if (profile === 'end-of-week') {
    const deadline = new Date(createdAt);
    const day = deadline.getDay();
    const daysUntilFriday = day <= 5 ? 5 - day : 6;
    deadline.setDate(deadline.getDate() + daysUntilFriday);
    deadline.setHours(17, 0, 0, 0);
    return Math.max(0, (deadline.getTime() - createdAt.getTime()) / msPerHour);
  }

  return URGENCY_ENVELOPES[profile].dueHours;
}

export function buildEnvelopeParams(profile, importance, createdAt) {
  const dueHours = computeDueHours(profile, createdAt);
  const riseHours = URGENCY_ENVELOPES[profile].riseHours;
  const graceHours = Math.max(0, dueHours - riseHours / 2);
  return {
    background: 0,
    graceHours,
    riseHours,
    peakProblemness: IMPORTANCE_PEAKS[importance]
  };
}

export function getTaskEnvelope(task) {
  if (task.customEnvelope) return task.customEnvelope;
  return buildEnvelopeParams(task.urgencyProfile, task.importance, task.createdAt);
}

export function calculateProblemness(task, currentTime) {
  const envelope = getTaskEnvelope(task);
  const hoursElapsed = (currentTime.getTime() - task.createdAt.getTime()) / (1000 * 60 * 60);

  if (hoursElapsed < envelope.graceHours) {
    return envelope.background;
  }

  const riseElapsed = hoursElapsed - envelope.graceHours;
  if (riseElapsed < envelope.riseHours) {
    const progress = riseElapsed / envelope.riseHours;
    return envelope.background + (envelope.peakProblemness - envelope.background) * progress;
  }

  return envelope.peakProblemness;
}

export function accumulatedProblemness(task, completionTime) {
  const envelope = getTaskEnvelope(task);
  const hoursToComplete = (completionTime.getTime() - task.createdAt.getTime()) / (1000 * 60 * 60);
  const { background: b, graceHours: a, riseHours: r, peakProblemness: m } = envelope;

  if (hoursToComplete <= a) {
    return b * hoursToComplete;
  }

  if (hoursToComplete <= a + r) {
    const tRise = hoursToComplete - a;
    return b * a + (b * tRise + (m - b) * tRise * tRise / (2 * r));
  }

  const tPlat = hoursToComplete - a - r;
  return b * a + (b * r + (m - b) * r / 2) + m * tPlat;
}

export function pToColor(p) {
  const stops = ENVELOPE_COLOR_STOPS;
  const clamped = Math.max(0, Math.min(1, p));
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped <= stops[i + 1].p) {
      const t = (clamped - stops[i].p) / (stops[i + 1].p - stops[i].p);
      return lerpHex(stops[i].color, stops[i + 1].color, t);
    }
  }
  return stops[stops.length - 1].color;
}

function lerpHex(a, b, t) {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t).toString(16).padStart(2, '0');
  const g = Math.round(ag + (bg - ag) * t).toString(16).padStart(2, '0');
  const bv = Math.round(ab + (bb - ab) * t).toString(16).padStart(2, '0');
  return `#${r}${g}${bv}`;
}

/**
 * Compute per-phase segments for the envelope chart.
 * Returns an array of phases: { type, tStart, tEnd, pStart, pEnd }
 * where t values are task-relative hours and p values are 0-1 problemness.
 * All times are clipped to the visible window [hoursElapsed, hoursElapsed + windowHours].
 */
export function getEnvelopeVertices(task, windowHours, now) {
  const env = getTaskEnvelope(task);
  const { background: b, graceHours: a, riseHours: r, peakProblemness: m } = env;

  const msPerHour = 1000 * 60 * 60;
  const hoursElapsed = (now.getTime() - task.createdAt.getTime()) / msPerHour;

  const t0 = hoursElapsed;
  const t3 = hoursElapsed + windowHours;

  // Key phase boundaries in task-relative hours
  const t1 = a;           // grace end
  const t2 = a + r;       // rise end / plateau start

  function pAt(t) {
    if (t <= a) return b;
    const rise = t - a;
    if (rise < r) return b + (m - b) * (rise / r);
    return m;
  }

  const rawPhases = [
    { type: 'grace',   tStart: 0,  tEnd: t1, pStart: b, pEnd: b },
    { type: 'rise',    tStart: t1, tEnd: t2, pStart: b, pEnd: m },
    { type: 'plateau', tStart: t2, tEnd: Infinity, pStart: m, pEnd: m },
  ];

  const phases = [];
  for (const phase of rawPhases) {
    const start = Math.max(phase.tStart, t0);
    const end = Math.min(phase.tEnd === Infinity ? t3 : phase.tEnd, t3);
    if (end <= start) continue;
    // Re-evaluate p values at the clipped endpoints
    phases.push({
      type: phase.type,
      tStart: start,
      tEnd: end,
      pStart: pAt(start),
      pEnd: pAt(end),
    });
  }

  return { phases, t0, t3, windowHours };
}

export function getProblemnessTier(value) {
  return PROBLEMNESS_SCALE.find(t => value >= t.min && value < t.max)
    ?? PROBLEMNESS_SCALE[PROBLEMNESS_SCALE.length - 1];
}
