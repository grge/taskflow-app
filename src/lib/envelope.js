import { URGENCY_ENVELOPES, IMPORTANCE_PEAKS, PROBLEMNESS_SCALE } from './constants.js';

export function computeRiseHours(profile, createdAt) {
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

  return URGENCY_ENVELOPES[profile].riseHours;
}

export function buildEnvelopeParams(profile, importance, createdAt) {
  return {
    background: 0,
    graceHours: URGENCY_ENVELOPES[profile].graceHours,
    riseHours: computeRiseHours(profile, createdAt),
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

export function getProblemnessTier(value) {
  return PROBLEMNESS_SCALE.find(t => value >= t.min && value < t.max)
    ?? PROBLEMNESS_SCALE[PROBLEMNESS_SCALE.length - 1];
}
