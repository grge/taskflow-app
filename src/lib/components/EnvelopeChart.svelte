<script>
  import { getEnvelopeVertices, pToColor } from '../envelope.js';
  import { clock } from '../../stores/clock.svelte.js';

  let { task, windowHours } = $props();

  const SVG_W = 100;
  const SVG_H = 100;
  // Corner rounding radius in SVG units. Keep small relative to SVG_W.
  const R = 6;

  let env = $derived.by(() => {
    void clock.minute;
    return getEnvelopeVertices(task, windowHours, new Date());
  });

  // Build the single filled path for the whole envelope curve.
  // Top edge follows the piecewise-linear curve with rounded corners.
  // Bottom edge is a flat line at SVG_H.
  let pathD = $derived.by(() => {
    const { phases, t0 } = env;
    if (!phases.length) return '';

    function tx(t) { return ((t - t0) / windowHours) * SVG_W; }
    function py(p) { return (1 - p) * SVG_H; }

    // Collect the raw corner points on the top edge (left-to-right).
    // These are the transitions between phases.
    const corners = [];
    for (let i = 0; i < phases.length; i++) {
      const ph = phases[i];
      // Left endpoint of this phase (first phase adds x0)
      if (i === 0) corners.push({ x: tx(ph.tStart), y: py(ph.pStart) });
      // Right endpoint / start of next phase
      corners.push({ x: tx(ph.tEnd), y: py(ph.pEnd) });
    }
    // corners[0] = leftmost point, corners[last] = rightmost point

    if (corners.length < 2) return '';

    // Build path: start at bottom-left, up to first corner, trace top edge
    // with bezier rounding at interior corners, down to bottom-right, close.
    const x0 = corners[0].x;
    const xN = corners[corners.length - 1].x;

    let d = `M ${x0},${SVG_H} L ${x0},${corners[0].y}`;

    for (let i = 0; i < corners.length - 1; i++) {
      const cur = corners[i];
      const nxt = corners[i + 1];

      if (i === corners.length - 2) {
        // Last segment — just line to the final point
        d += ` L ${nxt.x},${nxt.y}`;
      } else {
        // Interior corner at nxt: round it with a cubic bezier.
        // Approach direction: from cur toward nxt.
        // Departure direction: from nxt toward corners[i+2].
        const after = corners[i + 2];
        const dx_in  = nxt.x - cur.x;
        const dy_in  = nxt.y - cur.y;
        const len_in = Math.sqrt(dx_in * dx_in + dy_in * dy_in) || 1;
        const dx_out  = after.x - nxt.x;
        const dy_out  = after.y - nxt.y;
        const len_out = Math.sqrt(dx_out * dx_out + dy_out * dy_out) || 1;

        const r_in  = Math.min(R, len_in  * 0.4);
        const r_out = Math.min(R, len_out * 0.4);

        // Point just before the corner (along incoming direction)
        const bx = nxt.x - (dx_in / len_in)  * r_in;
        const by = nxt.y - (dy_in / len_in)  * r_in;
        // Point just after the corner (along outgoing direction)
        const ax = nxt.x + (dx_out / len_out) * r_out;
        const ay = nxt.y + (dy_out / len_out) * r_out;

        // Line to just-before, then cubic through corner
        d += ` L ${bx},${by} C ${nxt.x},${nxt.y} ${nxt.x},${nxt.y} ${ax},${ay}`;
      }
    }

    d += ` L ${xN},${SVG_H} Z`;
    return d;
  });

  // Build gradient stops: one stop per phase boundary so colour tracks p(x) exactly.
  // Each phase contributes a stop at its start and end; adjacent identical stops
  // (shared boundaries) are deduplicated by the browser, but we emit them explicitly
  // so a flat grace → rise transition gets a hard colour step at x=t1.
  let gradStops = $derived.by(() => {
    const { phases, t0 } = env;
    if (!phases.length) return [];
    const gx1 = ((phases[0].tStart - t0) / windowHours) * SVG_W;
    const gx2 = ((phases[phases.length - 1].tEnd - t0) / windowHours) * SVG_W;
    const span = gx2 - gx1 || 1;

    const stops = [];
    for (const ph of phases) {
      const x1 = ((ph.tStart - t0) / windowHours) * SVG_W;
      const x2 = ((ph.tEnd   - t0) / windowHours) * SVG_W;
      stops.push({ offset: ((x1 - gx1) / span * 100).toFixed(3) + '%', color: pToColor(ph.pStart) });
      stops.push({ offset: ((x2 - gx1) / span * 100).toFixed(3) + '%', color: pToColor(ph.pEnd)   });
    }
    return stops;
  });

  let gx1 = $derived(env.phases.length ? ((env.phases[0].tStart - env.t0) / windowHours) * SVG_W : 0);
  let gx2 = $derived(env.phases.length ? ((env.phases[env.phases.length - 1].tEnd - env.t0) / windowHours) * SVG_W : SVG_W);
</script>

<svg
  class="envelope-svg"
  viewBox="0 0 {SVG_W} {SVG_H}"
  preserveAspectRatio="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <defs>
    <linearGradient id="env-grad-{task.id}" x1={gx1} y1="0" x2={gx2} y2="0" gradientUnits="userSpaceOnUse">
      {#each gradStops as stop}
        <stop offset={stop.offset} stop-color={stop.color} stop-opacity="0.22" />
      {/each}
    </linearGradient>
  </defs>

  {#if pathD}
    <path d={pathD} fill="url(#env-grad-{task.id})" />
  {/if}
</svg>

<style>
  .envelope-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  }
</style>
