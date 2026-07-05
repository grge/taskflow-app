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

// Parse a human-typed duration into minutes, or null if unparseable/negative.
// Accepts "1h 47m", "1h", "47m", "90", a bare "1:47" (h:m) or "1:47:30" (h:m:s),
// and a lone decimal-hour like "1.5h". Whitespace and case are ignored.
export function parseDuration(input) {
  const s = String(input).trim().toLowerCase();
  if (!s) return null;

  // Clock form: "h:m" or "h:m:s".
  if (s.includes(':')) {
    const parts = s.split(':').map(p => p.trim());
    if (parts.length < 2 || parts.length > 3) return null;
    const nums = parts.map(Number);
    if (nums.some(n => !Number.isFinite(n) || n < 0)) return null;
    const [h, m, sec = 0] = nums;
    return Math.round(h * 60 + m + sec / 60);
  }

  // Unit form: any mix of "<n>h" and "<n>m" tokens, e.g. "1h 47m", "1.5h", "90m".
  const unit = [...s.matchAll(/(\d+(?:\.\d+)?)\s*([hm])/g)];
  if (unit.length) {
    let mins = 0;
    for (const [, n, u] of unit) mins += u === 'h' ? Number(n) * 60 : Number(n);
    return Math.round(mins);
  }

  // Bare number → minutes.
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
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
