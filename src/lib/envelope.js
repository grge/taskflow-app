import { PRESSURE_SCALE, ENVELOPE_COLOR_STOPS } from './constants.js';

export function pAt(task, t) {
  const tMs     = t instanceof Date ? t.getTime() : t;
  const onsetMs = task.onset.getTime();
  const peakMs  = task.peak.getTime();

  if (tMs <= onsetMs)        return 0;
  if (peakMs <= onsetMs)     return task.peakPressure;

  const riseSpanMs = peakMs - onsetMs;
  const elapsed    = tMs - onsetMs;

  if (elapsed >= riseSpanMs) return task.peakPressure;
  return task.peakPressure * (elapsed / riseSpanMs);
}

// Analytical integral of pAt over [task.createdAt, completionTime].
// Returns pressure-hours (comparable to prior "problemness-hours").
export function accumulatedPressure(task, completionTime) {
  const P       = task.peakPressure;
  const onsetMs = task.onset.getTime();
  const peakMs  = task.peak.getTime();
  const riseMs  = Math.max(1, peakMs - onsetMs);
  const aMs     = task.createdAt.getTime();
  const bMs     = completionTime instanceof Date ? completionTime.getTime() : completionTime;

  if (bMs <= onsetMs || bMs <= aMs) return 0;

  let integral = 0;

  // Rise phase: [max(aMs, onsetMs), min(bMs, peakMs)]
  const lo2 = Math.max(aMs, onsetMs);
  const hi2 = Math.min(bMs, peakMs);
  if (hi2 > lo2) {
    const loOff = lo2 - onsetMs;
    const hiOff = hi2 - onsetMs;
    integral += (P / riseMs) * (hiOff * hiOff - loOff * loOff) / 2;
  }

  // Plateau phase: [max(aMs, peakMs), bMs]
  const lo3 = Math.max(aMs, peakMs);
  if (bMs > lo3) {
    integral += P * (bMs - lo3);
  }

  return integral / 3_600_000; // ms → hours
}

// Returns breakpoints [{ms, p}] for the piecewise-linear curve within the view window.
// Caller maps ms to SVG x-coords and p to y-coords.
export function getEnvelopeVertices(task, viewStartMs, viewEndMs) {
  const onsetMs = task.onset.getTime();
  const peakMs  = task.peak.getTime();

  const candidates = [viewStartMs, onsetMs, peakMs, viewEndMs];
  const pts = [...new Set(candidates)]
    .filter(ms => ms >= viewStartMs && ms <= viewEndMs)
    .sort((a, b) => a - b)
    .map(ms => ({ ms, p: pAt(task, ms) }));

  return pts;
}

// Returns 30-point Hermite S-curve samples from onset to peak, plus a plateau point.
// Used only for smooth rendering in the EnvelopeEditor — scheduler uses piecewise-linear.
export function hermiteSamples(task, n = 30) {
  const onsetMs = task.onset.getTime();
  const peakMs  = task.peak.getTime();
  const P       = task.peakPressure;
  const pts     = [];

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const h01 = -2 * t * t * t + 3 * t * t; // Hermite basis, horizontal tangents both ends
    pts.push({ ms: onsetMs + t * (peakMs - onsetMs), p: h01 * P });
  }

  return pts;
}

export function pToColor(p) {
  const stops   = ENVELOPE_COLOR_STOPS;
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
  const r  = Math.round(ar + (br - ar) * t).toString(16).padStart(2, '0');
  const g  = Math.round(ag + (bg - ag) * t).toString(16).padStart(2, '0');
  const bv = Math.round(ab + (bb - ab) * t).toString(16).padStart(2, '0');
  return `#${r}${g}${bv}`;
}

export function getPressureTier(value) {
  return PRESSURE_SCALE.find(t => value >= t.min && value < t.max)
    ?? PRESSURE_SCALE[PRESSURE_SCALE.length - 1];
}
