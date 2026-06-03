<script>
  import { closeModal } from '../../stores/ui.svelte.js';
  import { completedTasks } from '../../stores/tasks.svelte.js';
  import { estimationMultiplier } from '../../stores/estimation.svelte.js';

  const IMPORTANCE_COLORS = {
    low:    '#4CAF50',
    medium: '#FFA726',
    high:   '#EF5350',
  };

  // SVG plot dimensions
  const W = 420, H = 260;
  const PAD = { top: 16, right: 16, bottom: 40, left: 48 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const entries = $derived(
    completedTasks.value.filter(t => t.elapsedSeconds > 0 && t.estimatedMinutes > 0)
      .map(t => ({
        estimatedMinutes: t.estimatedMinutes,
        actualMinutes: t.elapsedSeconds / 60,
        importance: t.importance,
        urgencyProfile: t.urgencyProfile,
      }))
  );
  const n = $derived(entries.length);
  const multiplier = $derived(estimationMultiplier.value);

  // --- stats ---
  const ratios = $derived(entries.map(e => e.actualMinutes / e.estimatedMinutes));
  const meanRatio = $derived(ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null);

  // --- scatter plot scales ---
  const maxEst = $derived(entries.length ? Math.max(...entries.map(e => e.estimatedMinutes)) * 1.1 : 120);
  const maxRatio = $derived(ratios.length ? Math.max(2.5, Math.max(...ratios) * 1.1) : 2.5);

  function xScale(estimatedMinutes) {
    return PAD.left + (estimatedMinutes / maxEst) * plotW;
  }
  function yScale(ratio) {
    // y=0 at bottom, but SVG y increases downward
    return PAD.top + plotH - (ratio / maxRatio) * plotH;
  }

  // Simple linear regression on (estimatedMinutes, ratio) pairs
  const regression = $derived((() => {
    if (entries.length < 2) return null;
    const xs = entries.map(e => e.estimatedMinutes);
    const ys = ratios;
    const n2 = xs.length;
    const xBar = xs.reduce((a, b) => a + b, 0) / n2;
    const yBar = ys.reduce((a, b) => a + b, 0) / n2;
    const num = xs.reduce((sum, x, i) => sum + (x - xBar) * (ys[i] - yBar), 0);
    const den = xs.reduce((sum, x) => sum + (x - xBar) ** 2, 0);
    if (den === 0) return null;
    const slope = num / den;
    const intercept = yBar - slope * xBar;
    return {
      x1: xScale(0),
      y1: yScale(intercept),
      x2: xScale(maxEst),
      y2: yScale(slope * maxEst + intercept),
    };
  })());

  // Y-axis tick values
  const yTicks = [0, 0.5, 1.0, 1.5, 2.0, 2.5].filter(v => v <= maxRatio);

  // X-axis ticks: sensible minute values
  function xTicks(max) {
    const step = max <= 60 ? 15 : max <= 180 ? 30 : max <= 480 ? 60 : 120;
    const ticks = [];
    for (let v = 0; v <= max; v += step) ticks.push(v);
    return ticks;
  }
</script>

<div class="modal-backdrop" onclick={closeModal} role="dialog" aria-modal="true">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal insights-modal" onclick={(e) => e.stopPropagation()} role="document">

    <div class="modal-header">
      <h2>Insights</h2>
      <button class="close-btn" onclick={closeModal} aria-label="Close">×</button>
    </div>

    <div class="stats-row">
      <div class="stat">
        <span class="stat-value">{n}</span>
        <span class="stat-label">timed tasks</span>
      </div>
      <div class="stat">
        <span class="stat-value">
          {n >= 5 ? (multiplier * 100).toFixed(0) + '%' : '—'}
        </span>
        <span class="stat-label">median actual/est</span>
      </div>
      <div class="stat">
        <span class="stat-value">
          {meanRatio !== null ? (meanRatio * 100).toFixed(0) + '%' : '—'}
        </span>
        <span class="stat-label">mean actual/est</span>
      </div>
      <div class="stat">
        <span class="stat-value multiplier" class:active={n >= 5}>
          {n >= 5 ? multiplier.toFixed(2) + '×' : '1.20× (prior)'}
        </span>
        <span class="stat-label">scheduler multiplier</span>
      </div>
    </div>

    {#if n === 0}
      <div class="empty-state">
        <p>No completed timed tasks yet.</p>
        <p>Start a timer on a task and stop it when done — your estimation accuracy will appear here.</p>
      </div>
    {:else}
      <div class="chart-wrap">
        <svg width={W} height={H}>
          <!-- Grid lines -->
          {#each yTicks as tick}
            <line
              x1={PAD.left} y1={yScale(tick)}
              x2={W - PAD.right} y2={yScale(tick)}
              stroke={tick === 1.0 ? '#999' : '#e8e8e8'}
              stroke-width={tick === 1.0 ? 1.5 : 1}
              stroke-dasharray={tick === 1.0 ? 'none' : '3 3'}
            />
            <text x={PAD.left - 6} y={yScale(tick) + 4} text-anchor="end" font-size="11" fill="#888">
              {tick.toFixed(1)}
            </text>
          {/each}

          {#each xTicks(maxEst) as tick}
            <line
              x1={xScale(tick)} y1={PAD.top}
              x2={xScale(tick)} y2={PAD.top + plotH}
              stroke="#e8e8e8" stroke-width="1" stroke-dasharray="3 3"
            />
            <text x={xScale(tick)} y={H - PAD.bottom + 14} text-anchor="middle" font-size="11" fill="#888">
              {tick}m
            </text>
          {/each}

          <!-- Axes -->
          <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + plotH} stroke="#ccc" stroke-width="1" />
          <line x1={PAD.left} y1={PAD.top + plotH} x2={W - PAD.right} y2={PAD.top + plotH} stroke="#ccc" stroke-width="1" />

          <!-- Regression line -->
          {#if regression}
            <line
              x1={regression.x1} y1={regression.y1} x2={regression.x2} y2={regression.y2}
              stroke="#4A90E2" stroke-width="1.5" stroke-dasharray="5 3" opacity="0.7"
            />
          {/if}

          <!-- Data points -->
          {#each entries as entry, i}
            <circle
              cx={xScale(entry.estimatedMinutes)}
              cy={yScale(ratios[i])}
              r="5"
              fill={IMPORTANCE_COLORS[entry.importance] ?? '#888'}
              opacity="0.85"
              stroke="white"
              stroke-width="1"
            >
              <title>{entry.urgencyProfile} · {entry.estimatedMinutes}m est · {entry.actualMinutes.toFixed(0)}m actual</title>
            </circle>
          {/each}
        </svg>

        <!-- Axis labels -->
        <div class="x-label">Estimated (minutes)</div>
        <div class="y-label">Actual / Estimated</div>

        <!-- Legend -->
        <div class="legend">
          {#each Object.entries(IMPORTANCE_COLORS) as [imp, color]}
            <span class="legend-item">
              <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill={color} /></svg>
              {imp}
            </span>
          {/each}
          <span class="legend-item">
            <svg width="18" height="10"><line x1="0" y1="5" x2="18" y2="5" stroke="#4A90E2" stroke-width="1.5" stroke-dasharray="5 3"/></svg>
            fit
          </span>
        </div>
      </div>
    {/if}

    <div class="modal-footer">
      <button class="btn btn-primary" onclick={closeModal}>Done</button>
    </div>

  </div>
</div>

<style>
  .insights-modal {
    min-width: 500px;
    max-width: 560px;
    padding: 0;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--color-border);
  }

  .modal-header h2 {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 20px;
    color: var(--color-text-muted);
    line-height: 1;
    padding: 0 4px;
  }
  .close-btn:hover { color: var(--color-text); }

  .stats-row {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--color-border);
  }

  .stat {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 14px 8px;
    border-right: 1px solid var(--color-border);
  }
  .stat:last-child { border-right: none; }

  .stat-value {
    font-size: 18px;
    font-weight: 700;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .stat-value.multiplier.active {
    color: var(--color-primary);
  }

  .stat-label {
    font-size: 11px;
    color: var(--color-text-muted);
    margin-top: 2px;
    text-align: center;
  }

  .empty-state {
    padding: 40px 24px;
    text-align: center;
    color: var(--color-text-muted);
    line-height: 1.8;
  }

  .chart-wrap {
    position: relative;
    padding: 8px 20px 0;
  }

  .x-label {
    text-align: center;
    font-size: 11px;
    color: var(--color-text-muted);
    margin-top: -4px;
    margin-bottom: 4px;
  }

  .y-label {
    position: absolute;
    left: 4px;
    top: 50%;
    transform: translateY(-50%) rotate(-90deg);
    font-size: 11px;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .legend {
    display: flex;
    gap: 12px;
    justify-content: center;
    font-size: 11px;
    color: var(--color-text-muted);
    padding-bottom: 8px;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 20px;
    border-top: 1px solid var(--color-border);
  }

  .btn {
    padding: 6px 16px;
    border-radius: var(--radius);
    border: none;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-primary {
    background: var(--color-primary);
    color: white;
  }
  .btn-primary:hover { background: var(--color-primary-hover); }
</style>
