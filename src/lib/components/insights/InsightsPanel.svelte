<script>
  import { onMount } from 'svelte';
  import { data, sync, fetchOpLog } from '../../../stores/data.svelte.js';
  import { clock } from '../../../stores/clock.svelte.js';
  import { historyFromOps, eventsFromTasks, flowSeries, backlogBridge, runway, letAloneCandidates } from '../../analytics.js';
  import { formatHours, signedHours, periodName } from '../../chart.js';
  import FlowChart from './FlowChart.svelte';
  import BacklogChart from './BacklogChart.svelte';
  import BacklogBridge from './BacklogBridge.svelte';
  import EstimateAccuracy from './EstimateAccuracy.svelte';

  const DAY_MS = 86_400_000;
  const PERIODS = [['day', 'Days'], ['week', 'Weeks'], ['month', 'Months']];

  // The dates on the tasks draw at once; the log replaces them when it arrives.
  // A device with no log, or that can't reach it, stays on the dates and says so.
  const fromTasks = eventsFromTasks(data.tasks);
  let events = $state.raw(fromTasks);
  let source = $state(sync.connected ? 'loading' : 'dates');

  onMount(async () => {
    if (!sync.connected) return;
    const ops = await fetchOpLog();
    if (ops) events = historyFromOps(ops).events;
    source = ops ? 'log' : 'dates';
  });

  const now = $derived(clock.minute);
  const young = fromTasks.length && (Date.now() - fromTasks[0].at) / DAY_MS < 21;
  let granularity = $state(young ? 'day' : 'week');

  const series = $derived(flowSeries(events, granularity, now));
  const bridge = $derived(backlogBridge(series));
  const pace = $derived(runway(events, now));
  const openCount = $derived(data.tasks.filter(t => !t.isCompleted && !t.isDeleted).length);
  const candidates = $derived(letAloneCandidates(data.tasks, now));
  const paceDays = $derived(Math.round(pace.days));
  const ageDays = t => Math.floor((now - t.createdAt) / DAY_MS);
</script>

<div class="insights">
  <div class="tiles">
    <div class="tile">
      <span class="tile-label">Backlog</span>
      <span class="tile-value">{formatHours(pace.backlog)}</span>
      <span class="tile-note">{openCount} open {openCount === 1 ? 'task' : 'tasks'}</span>
    </div>
    <div class="tile">
      <span class="tile-label">Runway</span>
      <span class="tile-value">{pace.weeks === null ? '—' : `${pace.weeks < 10 ? pace.weeks.toFixed(1) : Math.round(pace.weeks)} wk`}</span>
      <span class="tile-note">
        {#if pace.weeks === null}Nothing worked off yet{:else}if nothing new arrives, working off {formatHours(pace.outPerWeek)} a week{/if}
      </span>
    </div>
    <div class="tile">
      <span class="tile-label">Coming in</span>
      <span class="tile-value">{formatHours(pace.inPerWeek)}<small>a week</small></span>
      <span class="tile-note">last {paceDays} days, {signedHours(pace.inPerWeek - pace.outPerWeek)} a week net</span>
    </div>
  </div>

  {#if !series.length}
    <p class="empty">No tasks yet. Trends appear here once there are some.</p>
  {:else}
    <div class="period-row" role="group" aria-label="Period">
      {#each PERIODS as [value, label]}
        <button class="period" class:active={granularity === value} aria-pressed={granularity === value} onclick={() => (granularity = value)}>{label}</button>
      {/each}
      {#if source === 'dates'}
        <span class="source-note">From task dates only{sync.connected ? ": the backend's history couldn't be read" : ': connect a sync backend for exact history'}. Hours assume no re-estimates.</span>
      {/if}
    </div>

    <div class="panels">
      <section class="panel">
        <h3>Tasks in and out</h3>
        <FlowChart {series} {granularity} />
      </section>
      <section class="panel">
        <h3>Hours left</h3>
        <BacklogChart {series} {granularity} />
      </section>
      <section class="panel">
        <h3>Why it moved <small>since {bridge.from.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small></h3>
        <BacklogBridge {bridge} />
      </section>
      <section class="panel">
        <h3>Could be let alone</h3>
        {#if candidates.length}
          <p class="panel-note">Open for two weeks or more, not planned, and not pressing. Dropping one is a fine outcome.</p>
          <ul class="let-alone">
            {#each candidates.slice(0, 8) as t (t.id)}
              <li><span class="la-title">{t.description}</span><span class="la-meta">{ageDays(t)}d · {formatHours(t.estimatedMinutes)}</span></li>
            {/each}
          </ul>
          {#if candidates.length > 8}<p class="panel-note">and {candidates.length - 8} more</p>{/if}
        {:else}
          <p class="panel-note">Nothing yet. Tasks show up here after two weeks open, if they're not planned and not pressing.</p>
        {/if}
      </section>
      <section class="panel wide">
        <h3>Estimates vs actuals</h3>
        <EstimateAccuracy />
      </section>
    </div>

    <details class="table-view">
      <summary>Show as a table</summary>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Period</th><th>Added</th><th>Done</th><th>Dropped</th><th>Hours left</th><th>Open</th></tr></thead>
          <tbody>
            {#each [...series].reverse() as r}
              <tr><td>{periodName(r.start, granularity)}</td><td>{r.added}</td><td>{r.done}</td><td>{r.dropped}</td><td>{formatHours(r.backlog)}</td><td>{r.open}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
  {/if}
</div>

<style>
  .insights { display: grid; gap: 16px; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
  .tile, .panel {
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: 0 1px 4px var(--color-shadow);
  }
  .tile { display: flex; flex-direction: column; gap: 2px; padding: 12px 16px; }
  .tile-label { font-size: var(--text-sm); color: var(--color-text-muted); }
  .tile-value { font-size: 28px; font-weight: 600; color: var(--color-text); line-height: 1.2; }
  .tile-value small { margin-left: 4px; font-size: var(--text-sm); font-weight: 400; color: var(--color-text-muted); }
  .tile-note { font-size: var(--text-xs); color: var(--color-text-muted); }

  .period-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .period {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: 4px 12px;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .period:hover { color: var(--color-text); }
  .period.active { background: var(--color-card); border-color: var(--color-border); color: var(--color-text); font-weight: 600; }
  .source-note { margin-left: 8px; font-size: var(--text-xs); color: var(--color-text-muted); }

  .panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 12px; }
  .panel { padding: 14px 16px; min-width: 0; }
  .panel.wide { grid-column: 1 / -1; }
  .panel h3 { margin: 0 0 12px; font-size: var(--text-base); font-weight: 600; color: var(--color-text); }
  .panel h3 small { font-size: var(--text-xs); font-weight: 400; color: var(--color-text-muted); margin-left: 4px; }
  .panel-note { margin: 0 0 8px; font-size: var(--text-sm); line-height: 1.5; color: var(--color-text-muted); }
  .empty { padding: 32px; text-align: center; color: var(--color-text-muted); }

  .let-alone { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 6px; }
  .let-alone li { display: flex; justify-content: space-between; gap: 12px; font-size: var(--text-md); color: var(--color-text); }
  .la-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .la-meta { flex: none; color: var(--color-text-muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }

  .table-view summary { cursor: pointer; font-size: var(--text-sm); color: var(--color-text-muted); }
  .table-scroll { overflow-x: auto; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); color: var(--color-text); }
  th { text-align: right; font-weight: 500; color: var(--color-text-muted); }
  td { text-align: right; font-variant-numeric: tabular-nums; }
  th, td { padding: 4px 8px; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; }

  /* Shared by the charts, which only draw. */
  .insights :global(.chart) { position: relative; min-width: 0; touch-action: pan-y; }
  .insights :global(.plot) { position: relative; }
  .insights :global(.chart svg) { display: block; }
  .insights :global(.legend) { display: flex; gap: 12px; margin-bottom: 8px; font-size: var(--text-xs); color: var(--color-text-muted); }
  .insights :global(.legend span) { display: flex; align-items: center; gap: 4px; }
  .insights :global(.legend i) { width: 10px; height: 10px; border-radius: 2px; }
  .insights :global(.tick) { font-size: 10px; fill: var(--color-text-muted); font-variant-numeric: tabular-nums; }
  .insights :global(.end-label) { font-size: var(--text-sm); font-weight: 600; fill: var(--color-text); }
  .insights :global(.axis) { stroke: var(--color-text-faint); stroke-width: 1; }
  .insights :global(.grid) { stroke: var(--color-border); stroke-width: 1; }
  .insights :global(.crosshair) { stroke: var(--color-text-faint); stroke-width: 1; }
  .insights :global(.slot-hover) { fill: var(--color-text); opacity: 0.06; }
  .insights :global(.hit) { fill: transparent; }
  .insights :global(.tip) {
    position: absolute;
    top: 0;
    width: 140px;
    padding: 6px 10px;
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    box-shadow: 0 2px 10px var(--color-shadow);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    pointer-events: none;
  }
  .insights :global(.tip-title) { margin-bottom: 4px; color: var(--color-text); font-weight: 600; }
  .insights :global(.tip-row) { display: flex; align-items: center; gap: 4px; }
  .insights :global(.tip-row strong) { color: var(--color-text); font-variant-numeric: tabular-nums; }
  .insights :global(.tip-row i) { width: 8px; height: 2px; border-radius: 1px; }
</style>
