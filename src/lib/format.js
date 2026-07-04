// Human-readable formatters shared across components. Kept separate from
// calendar.js (which owns work-day/date math) — these are pure presentation.

// Minutes → compact duration: "45m" / "1h" / "1.2h". Whole hours drop the
// decimal; fractional hours show one place. Used on chips, cards, stat lines.
export function formatDuration(mins) {
  if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
  if (mins >= 60) return `${(mins / 60).toFixed(1)}h`;
  return `${mins}m`;
}

// Minutes → "1h 11m" / "45m" / "1h" (hours + whole minutes, no decimals).
// Reads clearer than formatDuration in the expanded stat panels where "1h 11m"
// beats "1.2h".
export function formatHoursMinutes(mins) {
  const m = Math.round(mins);
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

// Seconds → running-clock display: "45" / "4:05" / "1:04:05". Hours appear only
// once needed, and the minute field zero-pads only when hours are shown.
export function formatClock(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// A Date (or date-ish value) → relative day label for a task's peak:
// "today" / "tomorrow" / weekday name (within the week) / "next week".
export function peaksLabel(peak) {
  const d = peak instanceof Date ? peak : new Date(peak);
  const today = new Date();
  const diffDays = Math.round((d.setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86_400_000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays <= 6) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return 'next week';
}
