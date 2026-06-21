<script>
  import { closeModal, setActiveTab } from '../../stores/ui.svelte.js';
  import { workSchedule, updateWorkSchedule } from '../../stores/schedule.svelte.js';
  import { theme, setTheme } from '../../stores/theme.svelte.js';

  const THEMES = [
    { id: 'warm-parchment', label: 'Warm Parchment', desc: 'Earthy, nostalgic, old book' },
    { id: 'sage-morning',   label: 'Sage Morning',   desc: 'Botanical, garden-fresh' },
    { id: 'ember-night',    label: 'Ember Night',    desc: 'Dark · warm firelit focus' },
    { id: 'dusk',           label: 'Dusk',           desc: 'Dark · cool, blue hour' },
  ];

  let { inline = false } = $props();
  function dismiss() { inline ? setActiveTab('plan') : closeModal(); }

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Display rows run Mon→Sun; workSchedule.days is stored Sun-first (dayOfWeek 0 = Sun).
  const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function formatClock(minutes) {
    const h24 = Math.floor(minutes / 60);
    const m = minutes % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const suffix = h24 < 12 ? 'a' : 'p';
    return m === 0 ? `${h12}:00${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
  }

  function toggleDay(i, enabled) {
    const days = workSchedule.days.map((d, idx) => idx === i ? { ...d, enabled } : d);
    updateWorkSchedule({ ...workSchedule.value, days });
  }

  function setDayRange(i, startMinutes, endMinutes) {
    const days = workSchedule.days.map((d, idx) => idx === i ? { ...d, startMinutes, endMinutes } : d);
    updateWorkSchedule({ ...workSchedule.value, days });
  }

  function setBuffer(mins) {
    updateWorkSchedule({ ...workSchedule.value, bufferMinutes: mins });
  }

  // ── Work-hours timeline ────────────────────────────────────────────────────
  const TIMELINE_START = 6 * 60;   // 6:00a
  const TIMELINE_END    = 20 * 60; // 8:00p
  const TIMELINE_SPAN   = TIMELINE_END - TIMELINE_START;
  const SNAP_MINUTES    = 15;
  const MIN_DURATION    = 30;

  const HOUR_TICKS = [6, 9, 12, 15, 18, 20].map(h => ({
    hour: h,
    left: ((h * 60 - TIMELINE_START) / TIMELINE_SPAN) * 100,
    label: h === 12 ? '12p' : h > 12 ? `${h - 12}` : `${h}a`,
  }));

  let totalWeeklyMinutes = $derived(
    workSchedule.days.reduce((sum, d) => sum + (d.enabled ? Math.max(0, d.endMinutes - d.startMinutes) : 0), 0)
  );
  let totalWeeklyLabel = $derived((() => {
    const h = Math.floor(totalWeeklyMinutes / 60);
    const m = totalWeeklyMinutes % 60;
    return m === 0 ? `${h}h/wk` : `${h}h${m}m/wk`;
  })());

  function snap(minutes) {
    return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
  }

  function clampRange(start, end) {
    start = Math.max(TIMELINE_START, Math.min(start, TIMELINE_END - MIN_DURATION));
    end = Math.max(start + MIN_DURATION, Math.min(end, TIMELINE_END));
    return [start, end];
  }

  let drag = $state(null); // { dayIndex, mode: 'start'|'end'|'move', trackEl, anchorClientX, anchorStart, anchorEnd }

  function onTrackPointerDown(e, dayIndex, day, mode) {
    e.stopPropagation();
    if (!day.enabled) return;
    const trackEl = e.currentTarget.closest('.hours-track');
    drag = {
      dayIndex, mode, trackEl,
      anchorClientX: e.clientX,
      anchorStart: day.startMinutes,
      anchorEnd: day.endMinutes,
    };
    trackEl.setPointerCapture(e.pointerId);
  }

  function onTrackPointerMove(e) {
    if (!drag) return;
    const r = drag.trackEl.getBoundingClientRect();
    const deltaMinutes = ((e.clientX - drag.anchorClientX) / r.width) * TIMELINE_SPAN;

    if (drag.mode === 'start') {
      const [s, en] = clampRange(snap(drag.anchorStart + deltaMinutes), drag.anchorEnd);
      setDayRange(drag.dayIndex, s, en);
    } else if (drag.mode === 'end') {
      const [s, en] = clampRange(drag.anchorStart, snap(drag.anchorEnd + deltaMinutes));
      setDayRange(drag.dayIndex, s, en);
    } else if (drag.mode === 'move') {
      const duration = drag.anchorEnd - drag.anchorStart;
      let s = snap(drag.anchorStart + deltaMinutes);
      s = Math.max(TIMELINE_START, Math.min(s, TIMELINE_END - duration));
      setDayRange(drag.dayIndex, s, s + duration);
    }
  }

  function onTrackPointerUp(e) {
    if (!drag) return;
    drag.trackEl.releasePointerCapture(e.pointerId);
    drag = null;
  }

  function hardReset() {
    if (!confirm('Delete all tasks and reset to defaults? This cannot be undone.')) return;
    localStorage.clear();
    location.reload();
  }
</script>

<div class={inline ? 'inline-wrap' : 'modal-backdrop'} onclick={inline ? undefined : dismiss} role="dialog" aria-modal="true">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="modal settings-modal" onclick={(e) => e.stopPropagation()} role="document">

    <div class="modal-header">
      <h2>Settings</h2>
      <button class="close-btn" onclick={dismiss} aria-label="Close">×</button>
    </div>

    <div class="settings-body">

      <section>
        <h3 class="section-title">Theme</h3>
        <div class="theme-grid">
          {#each THEMES as t}
            <button
              class="theme-btn"
              class:active={theme.value === t.id}
              onclick={() => setTheme(t.id)}
            >
              <span class="theme-preview" data-theme-preview={t.id}>
                <span class="theme-preview-bar"></span>
                <span class="theme-preview-card"></span>
              </span>
              <span class="theme-copy">
                <span class="theme-name">{t.label}</span>
                <span class="theme-desc">{t.desc}</span>
              </span>
            </button>
          {/each}
        </div>
      </section>

      <section>
        <div class="section-header">
          <h3 class="section-title">Work Hours</h3>
          <span class="section-hint">drag the bars · {totalWeeklyLabel}</span>
        </div>
        <p class="section-subhint">Click a day to switch it on or off · drag a bar's edges to resize, its middle to shift.</p>

        <div class="hours-row hours-axis-row">
          <div class="hours-row-label"></div>
          <div class="hours-axis">
            {#each HOUR_TICKS as t}
              <span class="hours-axis-tick" style="left:{t.left}%">{t.label}</span>
            {/each}
          </div>
          <span class="hours-range-label hours-range-label-spacer"></span>
        </div>

        {#each DISPLAY_ORDER as dow}
          {#each workSchedule.days as day, i}
            {#if day.dayOfWeek === dow}
              <div class="hours-row" class:off={!day.enabled}>
                <button
                  class="hours-row-label"
                  onclick={() => toggleDay(i, !day.enabled)}
                  aria-label="{day.enabled ? 'Disable' : 'Enable'} {DAY_NAMES[dow]}"
                >
                  <span class="day-dot" class:active={day.enabled}></span>
                  <span class="hours-day-name">{DAY_NAMES[dow]}</span>
                </button>

                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="hours-track"
                  onpointermove={onTrackPointerMove}
                  onpointerup={onTrackPointerUp}
                >
                  {#if day.enabled}
                    {@const left = ((day.startMinutes - TIMELINE_START) / TIMELINE_SPAN) * 100}
                    {@const width = ((day.endMinutes - day.startMinutes) / TIMELINE_SPAN) * 100}
                    <div
                      class="hours-bar"
                      style="left:{left}%; width:{width}%"
                      onpointerdown={(e) => onTrackPointerDown(e, i, day, 'move')}
                    >
                      <div class="hours-handle hours-handle-start" onpointerdown={(e) => onTrackPointerDown(e, i, day, 'start')}></div>
                      <div class="hours-handle hours-handle-end" onpointerdown={(e) => onTrackPointerDown(e, i, day, 'end')}></div>
                    </div>
                  {/if}
                </div>

                <span class="hours-range-label">
                  {day.enabled ? `${formatClock(day.startMinutes)} – ${formatClock(day.endMinutes)}` : 'Day off'}
                </span>
              </div>
            {/if}
          {/each}
        {/each}
      </section>

      <section>
        <h3 class="section-title">Scheduling</h3>
        <div class="field-row">
          <div class="field-info">
            <span class="field-label">Buffer between tasks</span>
            <span class="field-hint">Gap left before and after each scheduled block</span>
          </div>
          <div class="buffer-options">
            {#each [0, 5, 10, 15, 30] as mins}
              <button
                class="seg-btn"
                class:active={(workSchedule.value.bufferMinutes ?? 15) === mins}
                onclick={() => setBuffer(mins)}
              >{mins === 0 ? 'None' : `${mins}m`}</button>
            {/each}
          </div>
        </div>
      </section>

    </div>

    <div class="modal-footer">
      <button class="btn btn-danger-ghost" onclick={hardReset}>Reset all data</button>
    </div>

  </div>
</div>

<style>
  .settings-modal {
    min-width: 420px;
    max-width: 640px;
    padding: 0;
  }

  /* ── Theme picker ── */
  .theme-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .theme-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.12s, background 0.12s;
  }

  .theme-btn:hover {
    background: var(--color-bg);
    border-color: var(--color-text-muted);
  }

  .theme-btn.active {
    border-color: var(--color-primary);
    background: var(--color-bg);
    box-shadow: 0 0 0 2px var(--color-primary);
  }

  /* Mini preview renders each theme's real surface/card/primary colours so the
     swatch reads like a tiny screenshot, regardless of the currently active theme. */
  .theme-preview {
    width: 44px;
    height: 38px;
    flex-shrink: 0;
    border-radius: 5px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px;
    border: 1px solid rgba(0,0,0,0.12);
  }

  .theme-preview-bar {
    display: block;
    width: 40%;
    height: 6px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .theme-preview-card {
    display: block;
    flex: 1;
    border-radius: 3px;
  }

  .theme-preview[data-theme-preview="warm-parchment"] { background: #FBF7EF; }
  .theme-preview[data-theme-preview="warm-parchment"] .theme-preview-bar  { background: #C8553C; }
  .theme-preview[data-theme-preview="warm-parchment"] .theme-preview-card { background: #FFFFFF; border: 1px solid #EAE1D2; }

  .theme-preview[data-theme-preview="sage-morning"] { background: #EEF3EB; }
  .theme-preview[data-theme-preview="sage-morning"] .theme-preview-bar  { background: #4A8048; }
  .theme-preview[data-theme-preview="sage-morning"] .theme-preview-card { background: #F4F7F0; border: 1px solid #C8D8C2; }

  .theme-preview[data-theme-preview="ember-night"] { background: #1C1710; }
  .theme-preview[data-theme-preview="ember-night"] .theme-preview-bar  { background: #D47840; }
  .theme-preview[data-theme-preview="ember-night"] .theme-preview-card { background: #261E14; border: 1px solid #382C1E; }

  .theme-preview[data-theme-preview="dusk"] { background: #191C28; }
  .theme-preview[data-theme-preview="dusk"] .theme-preview-bar  { background: #CC6858; }
  .theme-preview[data-theme-preview="dusk"] .theme-preview-card { background: #1E2130; border: 1px solid #2A2E44; }

  .theme-copy {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .theme-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text);
    line-height: 1.2;
  }

  .theme-desc {
    font-size: 11px;
    color: var(--color-text-muted);
    line-height: 1.3;
  }

  /* ── Header ── */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px 16px;
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
    line-height: 1;
    color: var(--color-text-muted);
    padding: 0 2px;
    cursor: pointer;
  }

  .close-btn:hover { color: var(--color-text); }

  /* ── Body sections ── */
  .settings-body {
    padding: 8px 0;
  }

  section {
    padding: 16px 24px;
  }

  section + section {
    border-top: 1px solid var(--color-border);
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
    margin-bottom: 12px;
  }

  /* ── Work hours: header ── */
  .section-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .section-header .section-title { margin-bottom: 0; }

  .section-hint {
    font-size: 11px;
    color: var(--color-text-faint);
    white-space: nowrap;
  }

  .section-subhint {
    font-size: 11.5px;
    color: var(--color-text-muted);
    margin: 0 0 14px;
  }

  /* ── Work hours: hour axis ── */
  .hours-axis-row {
    margin-bottom: 4px;
  }

  .hours-axis {
    position: relative;
    flex: 1;
    height: 14px;
  }

  .hours-axis-tick {
    position: absolute;
    transform: translateX(-50%);
    font-size: 10px;
    color: var(--color-text-faint);
    white-space: nowrap;
  }

  /* ── Work hours: rows ── */
  .hours-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
  }

  .hours-row.off { opacity: 0.55; }

  .hours-row-label {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 61px;
    flex-shrink: 0;
    border: none;
    padding: 0;
    background: none;
    cursor: pointer;
    text-align: left;
  }

  .day-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--color-border);
  }

  .day-dot.active { background: var(--color-accent); }

  .hours-day-name {
    font-size: 13px;
    font-weight: 500;
  }

  .hours-track {
    position: relative;
    flex: 1;
    height: 22px;
    border-radius: 5px;
    background: repeating-linear-gradient(
      90deg,
      var(--color-panel) 0,
      var(--color-panel) calc(7.142% - 1px),
      var(--color-border-light) calc(7.142% - 1px),
      var(--color-border-light) 7.142%
    );
    touch-action: none;
  }

  .hours-bar {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 5px;
    background: var(--color-accent);
    opacity: 0.85;
    cursor: grab;
  }

  .hours-bar:active { cursor: grabbing; }

  .hours-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 8px;
    cursor: ew-resize;
  }

  .hours-handle-start { left: -1px; border-radius: 5px 0 0 5px; }
  .hours-handle-end   { right: -1px; border-radius: 0 5px 5px 0; }

  .hours-handle::after {
    content: '';
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: 2px;
    border-radius: 1px;
    background: rgba(0,0,0,0.25);
  }

  .hours-range-label {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--color-text);
    width: 118px;
    flex-shrink: 0;
    text-align: right;
  }

  .hours-row.off .hours-range-label {
    font-weight: 400;
    color: var(--color-text-muted);
  }

  /* ── Field row (label + control side by side) ── */
  .field-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .field-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .field-label {
    font-size: 13px;
    font-weight: 500;
  }

  .field-hint {
    font-size: 11px;
    color: var(--color-text-muted);
  }

  /* ── Segmented button group ── */
  .buffer-options {
    display: flex;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .seg-btn {
    padding: 5px 11px;
    font-size: 12px;
    font-weight: 500;
    border: none;
    border-left: 1px solid var(--color-border);
    background: var(--color-surface);
    cursor: pointer;
    color: var(--color-text-muted);
    transition: background 0.1s, color 0.1s;
  }

  .seg-btn:first-child { border-left: none; }

  .seg-btn:hover:not(.active) {
    background: var(--color-bg);
    color: var(--color-text);
  }

  .seg-btn.active {
    background: var(--color-primary);
    color: white;
  }

  /* ── Footer ── */
  .modal-footer {
    display: flex;
    align-items: center;
    padding: 14px 24px;
    border-top: 1px solid var(--color-border);
    background: var(--color-bg);
    border-radius: 0 0 var(--radius) var(--radius);
  }

  .btn-danger-ghost {
    background: none;
    border: none;
    font-size: 12px;
    color: var(--color-text-muted);
    padding: 6px 4px;
    cursor: pointer;
    transition: color 0.15s;
  }

  .btn-danger-ghost:hover { color: #EF5350; }
</style>
