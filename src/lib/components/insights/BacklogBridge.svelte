<script>
  import { formatHours, signedHours } from '../../chart.js';

  // Why the backlog moved: from where it started, each cause in turn, to where it
  // is now. Every row carries its number, so nothing here depends on hovering.
  let { bridge } = $props();

  const rows = $derived.by(() => {
    const { opening, added, reestimated, workedOff, dropped, closing } = bridge;
    let at = opening;
    const step = (label, minutes, color) => {
      const row = { label, from: Math.min(at, at + minutes), to: Math.max(at, at + minutes), value: signedHours(minutes), color };
      at += minutes;
      return row;
    };
    return [
      { label: 'Start', from: 0, to: opening, value: formatHours(opening), color: 'var(--chart-ink)', total: true },
      step('New work', added, 'var(--chart-added)'),
      step('Re-estimates', reestimated, 'var(--chart-neutral)'),
      step('Worked off', workedOff, 'var(--chart-done)'),
      step('Dropped', dropped, 'var(--chart-dropped)'),
      { label: 'Now', from: 0, to: closing, value: formatHours(closing), color: 'var(--chart-ink)', total: true }
    ];
  });
  const scale = $derived(Math.max(1, ...rows.map(r => r.to)));
</script>

<div class="bridge">
  {#each rows as r}
    <div class="bridge-row" class:total={r.total}>
      <span class="bridge-label">{r.label}</span>
      <span class="bridge-track">
        {#if r.to > r.from}
          <i style="left: {(r.from / scale) * 100}%; width: max(2px, {((r.to - r.from) / scale) * 100}%); background: {r.color}"></i>
        {/if}
      </span>
      <span class="bridge-value">{r.value}</span>
    </div>
  {/each}
</div>

<style>
  .bridge { display: grid; gap: 8px; }
  .bridge-row {
    display: grid;
    grid-template-columns: 84px 1fr 48px;
    align-items: center;
    gap: 8px;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .bridge-row.total { color: var(--color-text); font-weight: 600; }
  .bridge-track { position: relative; height: 16px; }
  .bridge-track i { position: absolute; top: 0; bottom: 0; border-radius: var(--radius-xs); }
  .bridge-value { text-align: right; font-variant-numeric: tabular-nums; color: var(--color-text); }
</style>
