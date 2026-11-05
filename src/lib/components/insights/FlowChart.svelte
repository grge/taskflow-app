<script>
  import { niceMax, columnPath, labelStep, periodLabel, periodName } from '../../chart.js';

  // Tasks in and out per period: what arrived above the line, what left below,
  // so a period's balance reads as which side is longer.
  let { series, granularity } = $props();

  let width = $state(0);
  const H = 220, PAD = { top: 8, right: 4, bottom: 22, left: 28 }, GAP = 2;
  const plotW = $derived(Math.max(0, width - PAD.left - PAD.right));
  const plotH = H - PAD.top - PAD.bottom;

  const maxIn = $derived(Math.max(0, ...series.map(r => r.added)));
  const maxOut = $derived(Math.max(0, ...series.map(r => r.done + r.dropped)));
  const top = $derived(niceMax(maxIn));
  const bottom = $derived(maxOut ? niceMax(maxOut) : 0);
  const unit = $derived(plotH / (top + bottom));
  const baseline = $derived(PAD.top + top * unit);

  const slot = $derived(series.length ? plotW / series.length : 0);
  const barW = $derived(Math.max(2, Math.min(24, slot - 2 * GAP)));
  const barX = i => PAD.left + i * slot + (slot - barW) / 2;
  const step = $derived(labelStep(series.length, plotW));

  let hover = $state(null);
  const row = $derived(hover === null ? null : series[hover]);
  const tipLeft = $derived(hover === null ? 0 : Math.min(Math.max(PAD.left + (hover + 0.5) * slot - 70, 0), Math.max(0, width - 140)));
</script>

<div class="chart" bind:clientWidth={width} role="img" aria-label="Tasks added, done and dropped per period. The table below has the same numbers.">
  <div class="legend">
    <span><i style="background: var(--chart-added)"></i>Added</span>
    <span><i style="background: var(--chart-done)"></i>Done</span>
    <span><i style="background: var(--chart-dropped)"></i>Dropped</span>
  </div>
  <div class="plot">
    {#if width}
      <svg {width} height={H}>
        <text class="tick" x={PAD.left - 6} y={PAD.top + 8} text-anchor="end">{top}</text>
        {#if bottom}<text class="tick" x={PAD.left - 6} y={H - PAD.bottom} text-anchor="end">{bottom}</text>{/if}
        <text class="tick" x={PAD.left - 6} y={baseline + 3} text-anchor="end">0</text>

        {#each series as r, i}
          {#if hover === i}<rect class="slot-hover" x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} />{/if}
          <path d={columnPath(barX(i), baseline - GAP / 2, barW, r.added * unit)} fill="var(--chart-added)" />
          <path d={columnPath(barX(i), baseline + GAP / 2, barW, -(r.done * unit - (r.dropped ? GAP : 0)), r.dropped ? 0 : 4)} fill="var(--chart-done)" />
          {#if r.dropped}
            <path d={columnPath(barX(i), baseline + GAP / 2 + r.done * unit, barW, -r.dropped * unit)} fill="var(--chart-dropped)" />
          {/if}
          {#if i % step === 0}
            <text class="tick" x={PAD.left + (i + 0.5) * slot} y={H - 6} text-anchor="middle">{periodLabel(r.start, granularity)}</text>
          {/if}
        {/each}
        <line class="axis" x1={PAD.left} x2={width - PAD.right} y1={baseline} y2={baseline} />

        {#each series as _, i}
          <rect class="hit" x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH}
            onpointerenter={() => (hover = i)} onpointerleave={() => (hover = null)} />
        {/each}
      </svg>
    {/if}
    {#if row}
      <div class="tip" style="left: {tipLeft}px">
        <div class="tip-title">{periodName(row.start, granularity)}</div>
        <div class="tip-row"><i style="background: var(--chart-added)"></i><strong>{row.added}</strong> added</div>
        <div class="tip-row"><i style="background: var(--chart-done)"></i><strong>{row.done}</strong> done</div>
        <div class="tip-row"><i style="background: var(--chart-dropped)"></i><strong>{row.dropped}</strong> dropped</div>
      </div>
    {/if}
  </div>
</div>
