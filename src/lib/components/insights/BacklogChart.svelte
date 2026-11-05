<script>
  import { niceMax, labelStep, periodLabel, periodName, formatHours } from '../../chart.js';

  // The backlog at the end of each period.
  let { series, granularity } = $props();

  let width = $state(0);
  const H = 220, PAD = { top: 18, right: 40, bottom: 22, left: 34 };
  const plotW = $derived(Math.max(0, width - PAD.left - PAD.right));
  const plotH = H - PAD.top - PAD.bottom;

  const top = $derived(niceMax(Math.max(...series.map(r => r.backlog)) / 60) * 60);
  const x = i => PAD.left + (series.length > 1 ? (i / (series.length - 1)) * plotW : plotW / 2);
  const y = minutes => PAD.top + plotH - (minutes / top) * plotH;
  const line = $derived(series.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r.backlog)}`).join(''));
  const area = $derived(`${line}L${x(series.length - 1)},${y(0)}L${x(0)},${y(0)}Z`);
  const step = $derived(labelStep(series.length, plotW));
  const last = $derived(series[series.length - 1]);

  let hover = $state(null);
  const row = $derived(hover === null ? null : series[hover]);
  const tipLeft = $derived(hover === null ? 0 : Math.min(Math.max(x(hover) - 70, 0), Math.max(0, width - 140)));

  function track(e) {
    const box = e.currentTarget.getBoundingClientRect();
    const span = series.length > 1 ? plotW / (series.length - 1) : plotW;
    hover = Math.max(0, Math.min(series.length - 1, Math.round((e.clientX - box.left - PAD.left) / span)));
  }
</script>

<div class="chart" bind:clientWidth={width} role="img" aria-label="Estimated hours of work left over time. The table below has the same numbers.">
  <div class="plot">
    {#if width}
      <svg {width} height={H} onpointermove={track} onpointerdown={track} onpointerleave={() => (hover = null)}>
        <line class="grid" x1={PAD.left} x2={width - PAD.right} y1={y(top)} y2={y(top)} />
        <line class="grid" x1={PAD.left} x2={width - PAD.right} y1={y(top / 2)} y2={y(top / 2)} />
        <line class="axis" x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} />
        <text class="tick" x={PAD.left - 6} y={y(top) + 3} text-anchor="end">{formatHours(top)}</text>
        <text class="tick" x={PAD.left - 6} y={y(top / 2) + 3} text-anchor="end">{formatHours(top / 2)}</text>
        <text class="tick" x={PAD.left - 6} y={y(0) + 3} text-anchor="end">0</text>

        <path d={area} fill="var(--chart-ink)" opacity="0.08" />
        <path d={line} fill="none" stroke="var(--chart-ink)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />

        {#each series as r, i}
          {#if i % step === 0}
            <text class="tick" x={x(i)} y={H - 6} text-anchor="middle">{periodLabel(r.start, granularity)}</text>
          {/if}
        {/each}

        <circle cx={x(series.length - 1)} cy={y(last.backlog)} r="4" fill="var(--chart-ink)" stroke="var(--color-card)" stroke-width="2" />
        <text class="end-label" x={x(series.length - 1) + 8} y={y(last.backlog) + 4}>{formatHours(last.backlog)}</text>

        {#if row}
          <line class="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} />
          <circle cx={x(hover)} cy={y(row.backlog)} r="4" fill="var(--chart-ink)" stroke="var(--color-card)" stroke-width="2" />
        {/if}
      </svg>
    {/if}
    {#if row}
      <div class="tip" style="left: {tipLeft}px">
        <div class="tip-title">{periodName(row.start, granularity)}</div>
        <div class="tip-row"><strong>{formatHours(row.backlog)}</strong> left at the end</div>
        <div class="tip-row"><strong>{row.open}</strong> open tasks</div>
      </div>
    {/if}
  </div>
</div>
