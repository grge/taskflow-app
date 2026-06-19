<script>
  import { pAt, pToColor, getEnvelopeVertices } from '../envelope.js';
  import { clock } from '../../stores/clock.svelte.js';

  let { task } = $props();

  const W = 48, H = 18;
  const DAY_MS = 24 * 60 * 60 * 1000;

  let points = $derived((() => {
    const now = clock.minute.getTime();
    const viewStart = now;
    const viewEnd   = now + 7 * DAY_MS;
    const verts = getEnvelopeVertices(task, viewStart, viewEnd);
    if (verts.length < 2) return '';
    return verts.map(v => {
      const x = ((v.ms - viewStart) / (viewEnd - viewStart)) * W;
      const y = H - v.p * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  })());

  let currentP  = $derived(pAt(task, clock.minute));
  let fillColor = $derived(pToColor(currentP));
</script>

<svg width={W} height={H} viewBox="0 0 {W} {H}" style="display:block;flex-shrink:0;overflow:visible">
  {#if points}
    <polyline
      {points}
      fill="none"
      stroke={fillColor}
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      opacity="0.8"
    />
  {/if}
</svg>
