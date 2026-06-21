<script>
  import { clock } from '../../stores/clock.svelte.js';
  import { pToColor } from '../envelope.js';

  let { task, onchange } = $props();

  const DAY_MS = 24 * 60 * 60 * 1000;
  const VIEW_DAYS = 7;

  // Default view: today midnight → +7 days. Mutable so pan/zoom work.
  function defaultStart() { return new Date(clock.today + 'T00:00:00').getTime(); }

  let viewStartMs = $state(defaultStart());
  let viewEndMs   = $state(defaultStart() + VIEW_DAYS * DAY_MS);

  // Unclamped fraction — values outside [0,1] mean off-screen
  function toFracX(ms) {
    return (ms - viewStartMs) / (viewEndMs - viewStartMs);
  }

  let onsetFrac = $derived(toFracX(task.onset.getTime()));
  let peakFrac  = $derived(toFracX(task.peak.getTime()));
  let peakY     = $derived(task.peakPressure); // 0..1, 1 = top

  // Smoothstep pressure at fractional x
  function prob(x) {
    if (x <= onsetFrac) return 0;
    if (x >= peakFrac)  return peakY;
    let u = (x - onsetFrac) / (peakFrac - onsetFrac);
    u = Math.max(0, Math.min(1, u));
    return peakY * (u * u * (3 - 2 * u));
  }

  // SVG coordinate system: viewBox 0 0 100 100, y=12 at top, y=88 at bottom
  function yc(x) { return 12 + (1 - prob(x)) * 76; }

  // Build SVG paths (N=60 points)
  let paths = $derived((() => {
    const N = 60;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const x = i / N;
      pts.push(`${(x * 100).toFixed(2)} ${yc(x).toFixed(2)}`);
    }
    const line = 'M ' + pts.join(' L ');
    const area = line + ' L 100 100 L 0 100 Z';
    return { line, area };
  })());

  // Handle positions — unclamped so they move off-screen naturally
  // showOnset/showPeak: only render when within ±5% of the visible area
  let onsetLeft    = $derived(onsetFrac * 100);
  let onsetTop     = $derived(yc(Math.max(0, Math.min(1, onsetFrac))));
  let showOnset    = $derived(onsetFrac >= -0.05 && onsetFrac <= 1.05);
  let peakLeft     = $derived(peakFrac * 100);
  let peakTop      = $derived(yc(Math.max(0, Math.min(1, peakFrac))));
  let showPeak     = $derived(peakFrac >= -0.05 && peakFrac <= 1.05);

  // "now" position — unclamped, only show when in view
  let nowFrac  = $derived(toFracX(clock.now.getTime()));
  let nowLeft  = $derived(nowFrac * 100);
  let showNow  = $derived(nowFrac > 0 && nowFrac < 1);

  // Current pressure at now — evaluated directly from task envelope, not from view position
  let nowPressure = $derived((() => {
    const nowMs = clock.now.getTime();
    const onsetMs = task.onset.getTime();
    const peakMs  = task.peak.getTime();
    if (nowMs <= onsetMs) return 0;
    if (nowMs >= peakMs)  return task.peakPressure;
    let u = (nowMs - onsetMs) / (peakMs - onsetMs);
    u = Math.max(0, Math.min(1, u));
    return task.peakPressure * (u * u * (3 - 2 * u));
  })());
  let nowColor = $derived(pToColor(nowPressure));

  // Adaptive tick interval: aim for ~5-8 ticks regardless of zoom level
  let dayLabels = $derived((() => {
    const todayMs = new Date(clock.today + 'T00:00:00').getTime();
    const span = viewEndMs - viewStartMs;
    const labels = [];

    // Pick a tick interval that gives roughly 5-8 ticks
    const HOUR_MS = 3600 * 1000;
    const candidates = [
      2 * HOUR_MS, 4 * HOUR_MS, 6 * HOUR_MS, 12 * HOUR_MS,
      DAY_MS, 2 * DAY_MS, 3 * DAY_MS, 7 * DAY_MS, 14 * DAY_MS
    ];
    const tickInterval = candidates.find(c => span / c <= 8) ?? 14 * DAY_MS;

    // Snap first tick to a clean multiple of the interval
    const firstTick = Math.ceil(viewStartMs / tickInterval) * tickInterval;
    for (let ms = firstTick; ms <= viewEndMs; ms += tickInterval) {
      const left = ((ms - viewStartMs) / span) * 100;
      const d = new Date(ms);
      let label;
      if (ms === todayMs) {
        label = 'Today';
      } else if (tickInterval < DAY_MS) {
        // Sub-day ticks: show time
        label = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      } else if (tickInterval === DAY_MS) {
        label = d.toLocaleDateString('en-US', { weekday: 'short' });
      } else {
        // Multi-day: show weekday + date
        label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
      }
      labels.push({ label, left });
    }
    return labels;
  })());

  // Blend a hex color toward the theme's card color for chip backgrounds
  function chipBg(hex) {
    const card = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-card').trim();
    const parse = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
    if (!card.startsWith('#') || card.length !== 7) return hex + '22';
    const [cr,cg,cb] = parse(card);
    const [hr,hg,hb] = parse(hex);
    const mix = (c, base) => Math.round(c + (base - c) * 0.80);
    return `rgb(${mix(hr,cr)},${mix(hg,cg)},${mix(hb,cb)})`;
  }

  function pressureLabel(p) {
    if (p < 0.22) return { label: 'Low',      color: '#6E8B63' };
    if (p < 0.55) return { label: 'Building', color: '#C68A2E' };
    if (p < 0.75) return { label: 'Elevated', color: '#EF5350' };
    return { label: 'High', color: '#C8553C' };
  }

  let nowPressureInfo = $derived(pressureLabel(nowPressure));

  // ── Drag ────────────────────────────────────────────────────────────────────

  let dragging    = $state(null); // 'onset' | 'peak' | 'pan'
  let chartEl     = $state(null);
  let panAnchorX  = 0; // clientX where pan started
  let panAnchorStart = 0; // viewStartMs at pan start
  let panAnchorEnd   = 0; // viewEndMs at pan start

  function fracFromClientX(clientX) {
    if (!chartEl) return 0;
    const r = chartEl.getBoundingClientRect();
    return (clientX - r.left) / r.width; // unclamped — pan needs values outside [0,1]
  }

  function fracYFromClientY(clientY) {
    if (!chartEl) return 0;
    const r = chartEl.getBoundingClientRect();
    const ysvg = ((clientY - r.top) / r.height) * 100;
    return Math.max(0.05, Math.min(1, 1 - (ysvg - 12) / 76));
  }

  function msFromFrac(frac) {
    return viewStartMs + frac * (viewEndMs - viewStartMs);
  }

  // Called from handle wrappers — captures for handle drags
  function onHandleDown(e, type) {
    e.stopPropagation();
    dragging = type;
    chartEl.setPointerCapture(e.pointerId);
  }

  // Called from the chart background — captures for pan
  function onChartDown(e) {
    dragging = 'pan';
    panAnchorX     = e.clientX;
    panAnchorStart = viewStartMs;
    panAnchorEnd   = viewEndMs;
    chartEl.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const fx = fracFromClientX(e.clientX);

    // Minimum 1-hour gap between onset and peak, expressed as a fraction of the current view
    const minGapFrac = (3600 * 1000) / (viewEndMs - viewStartMs);

    if (dragging === 'onset') {
      const clamped = Math.min(fx, peakFrac - minGapFrac);
      onchange?.({ onset: new Date(msFromFrac(clamped)), peak: task.peak, peakPressure: task.peakPressure });
    } else if (dragging === 'peak') {
      const clampedX = Math.max(onsetFrac + minGapFrac, fx);
      const clampedY = fracYFromClientY(e.clientY);
      onchange?.({ onset: task.onset, peak: new Date(msFromFrac(clampedX)), peakPressure: clampedY });
    } else if (dragging === 'pan') {
      if (!chartEl) return;
      const r = chartEl.getBoundingClientRect();
      const dxFrac = (e.clientX - panAnchorX) / r.width;
      const dxMs   = dxFrac * (panAnchorEnd - panAnchorStart);
      viewStartMs  = panAnchorStart - dxMs;
      viewEndMs    = panAnchorEnd   - dxMs;
    }
  }

  function onPointerUp(e) {
    dragging = null;
    chartEl?.releasePointerCapture(e.pointerId);
  }

  const MIN_SPAN = 6 * 3600 * 1000;  // 6 hours
  const MAX_SPAN = 28 * DAY_MS;      // 4 weeks

  function onWheel(e) {
    e.preventDefault();
    if (!chartEl) return;
    const span   = viewEndMs - viewStartMs;
    const factor = e.deltaY > 0 ? 1.25 : 1 / 1.25;
    const newSpan = Math.max(MIN_SPAN, Math.min(MAX_SPAN, span * factor));
    const r = chartEl.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const pivotMs = viewStartMs + fx * span;
    viewStartMs = pivotMs - fx * newSpan;
    viewEndMs   = pivotMs + (1 - fx) * newSpan;
  }
</script>

<div class="envelope-editor">
  <!-- Label + chart row -->
  <div class="chart-row">
    <!-- Y-axis labels -->
    <div class="y-axis">
      <span class="y-label y-severe">severe</span>
      <span class="y-label y-mild">mild</span>
    </div>

    <!-- Chart area -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="chart"
      class:panning={dragging === 'pan'}
      bind:this={chartEl}
      onpointerdown={onChartDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onwheel={onWheel}
    >
      <!-- Horizontal dashed guides -->
      <div class="guide" style="top:33.3%"></div>
      <div class="guide" style="top:66.6%"></div>

      <!-- SVG: gradient fill + line -->
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="chart-svg">
        <defs>
          <linearGradient id="env-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0"    stop-color="#6E8B63" stop-opacity="0.22" />
            <stop offset="0.55" stop-color="#E0A03C" stop-opacity="0.26" />
            <stop offset="1"    stop-color="#C8553C" stop-opacity="0.30" />
          </linearGradient>
        </defs>
        <path d={paths.area} fill="url(#env-grad)" />
        <path d={paths.line} fill="none" stroke="#C8553C" stroke-width="1.7" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
      </svg>

      <!-- Now line -->
      {#if showNow}
        <div class="now-line" style="left:{nowLeft}%">
          <div class="now-tick"></div>
          <span class="now-label">now</span>
        </div>
      {/if}

      <!-- Onset handle (green, horizontal drag) — hidden when off-screen -->
      {#if showOnset}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="handle-wrap"
          style="left:{onsetLeft}%; top:{onsetTop}%"
          onpointerdown={(e) => onHandleDown(e, 'onset')}
        >
          <div class="handle handle-onset"></div>
        </div>
      {/if}

      <!-- Peak handle (red, 2D drag) — hidden when off-screen -->
      {#if showPeak}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="handle-wrap"
          style="left:{peakLeft}%; top:{peakTop}%"
          onpointerdown={(e) => onHandleDown(e, 'peak')}
        >
          <div class="handle handle-peak"></div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Day axis -->
  <div class="day-axis">
    {#each dayLabels as { label, left }}
      <span class="day-tick" style="left:{left}%">{label}</span>
    {/each}
  </div>

  <!-- Now pressure pill -->
  <div class="chips">
    <span class="chip chip-now" style="background:{chipBg(nowPressureInfo.color)}">
      <span class="chip-now-label">now</span>
      <span class="chip-now-value" style="color:{nowPressureInfo.color}">{nowPressureInfo.label} · {Math.round(nowPressure * 100)}%</span>
    </span>
  </div>
</div>

<style>
  .envelope-editor {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* ── Chart row ── */
  .chart-row {
    display: flex;
    gap: 6px;
    align-items: stretch;
  }

  /* ── Y-axis ── */
  .y-axis {
    width: 14px;
    flex-shrink: 0;
    position: relative;
  }

  .y-label {
    position: absolute;
    left: 0;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .y-severe { top: 2px;    color: #C8553C; }
  .y-mild   { bottom: 2px; color: #9BB08D; }

  /* ── Chart ── */
  .chart {
    flex: 1;
    height: 150px;
    position: relative;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    overflow: hidden;
    touch-action: none;
    cursor: grab;
    background: repeating-linear-gradient(
      90deg,
      var(--color-card) 0,
      var(--color-card) calc(14.285% - 1px),
      var(--color-border-light) calc(14.285% - 1px),
      var(--color-border-light) 14.285%
    );
  }

  .chart.panning { cursor: grabbing; }

  .guide {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px dashed var(--color-border);
    pointer-events: none;
  }

  .chart-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }

  /* ── Now line ── */
  .now-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    pointer-events: none;
    z-index: 4;
  }

  .now-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 0;
    border-left: 2px solid var(--color-text);
    opacity: 0.5;
  }

  .now-label {
    position: absolute;
    top: 5px;
    left: 4px;
    font-size: 9px;
    font-weight: 700;
    color: var(--color-text);
    background: var(--color-card);
    opacity: 0.85;
    padding: 1px 3px;
    border-radius: 2px;
  }

  /* ── Handles ── */
  .handle-wrap {
    position: absolute;
    transform: translate(-50%, -50%);
    z-index: 6;
    touch-action: none;
  }

  .handle {
    border-radius: 50%;
    background: var(--color-card);
    box-shadow: 0 2px 5px rgba(0,0,0,0.25);
  }

  .handle-onset {
    width: 15px;
    height: 15px;
    border: 3px solid #6E8B63;
    cursor: ew-resize;
  }

  .handle-peak {
    width: 17px;
    height: 17px;
    border: 3px solid #C8553C;
    box-shadow: 0 2px 6px rgba(0,0,0,0.22);
    cursor: move;
  }

  /* ── Day axis ── */
  .day-axis {
    position: relative;
    height: 18px;
    margin-left: 20px; /* align with chart (y-axis width + gap) */
  }

  .day-tick {
    position: absolute;
    transform: translateX(-50%);
    font-size: 10px;
    font-weight: 600;
    color: var(--color-text-faint);
    white-space: nowrap;
  }

  /* ── Chips ── */
  .chips {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    flex-wrap: wrap;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }

  .chip-now {
    margin-left: auto;
    gap: 7px;
    padding: 5px 11px;
    border-radius: 999px;
  }

  .chip-now-label { font-size: 11.5px; color: var(--color-text-muted); font-weight: 600; }
  .chip-now-value { font-size: 12.5px; font-weight: 700; }
</style>
