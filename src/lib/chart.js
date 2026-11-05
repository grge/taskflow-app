// Small helpers shared by the hand-drawn SVG charts in the Insights tab.

// A round top for an axis: the smallest of 1, 2 or 5 × 10ⁿ at or above value.
export function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

// A column growing from a baseline: rounded at its data end, square at the
// baseline. A negative height grows downward.
export function columnPath(x, baseline, width, height, radius = 4) {
  if (!height) return '';
  const dir = height > 0 ? -1 : 1;
  const tall = Math.abs(height);
  const r = Math.min(radius, width / 2, tall);
  const tip = baseline + dir * tall;
  const sweep = dir < 0 ? 1 : 0;
  return `M${x},${baseline}V${tip - dir * r}A${r},${r} 0 0 ${sweep} ${x + r},${tip}H${x + width - r}A${r},${r} 0 0 ${sweep} ${x + width},${tip - dir * r}V${baseline}Z`;
}

// How many periods to step between x-axis labels so they don't collide.
export function labelStep(count, plotWidth, labelWidth = 52) {
  return Math.max(1, Math.ceil(count * labelWidth / Math.max(1, plotWidth)));
}

export function periodLabel(start, granularity) {
  return granularity === 'month'
    ? start.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
    : start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// The full name of a period, for tooltips and the table.
export function periodName(start, granularity) {
  if (granularity === 'month') return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const date = start.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return granularity === 'week' ? `Week of ${date}` : date;
}

// Whole hours from 10 up, one decimal below, so small changes stay visible.
export function formatHours(minutes) {
  const hours = Math.abs(minutes) / 60;
  return `${hours >= 10 || hours === 0 ? Math.round(hours) : hours.toFixed(1)}h`;
}

export function signedHours(minutes) {
  if (!Math.round(Math.abs(minutes) / 6)) return '0h';
  return `${minutes > 0 ? '+' : '−'}${formatHours(minutes)}`;
}
