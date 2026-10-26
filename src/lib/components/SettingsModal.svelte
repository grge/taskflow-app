<script>
  import { closeModal, setActiveTab, connectLink, setConnectLink } from '../../stores/ui.svelte.js';
  import { workSchedule, updateWorkSchedule } from '../../stores/schedule.svelte.js';
  import { theme, setTheme } from '../../stores/theme.svelte.js';
  import { data, exportData, readImport, importData, sync, connect, disconnect, TIME_ZONE } from '../../stores/data.svelte.js';
  import { probeBackend, firstConnectPlan, liveTaskCount as countLive } from '../../sync/connect.js';
  import { describeSync } from '../sync-status.js';
  import { toISODate } from '../calendar.js';

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

  // ── Your data: export and import ─────────────────────────────────────────
  const liveTaskCount = $derived(data.tasks.filter(t => !t.isDeleted).length);
  let importStatus = $state(null); // { ok, message }
  let fileInput;

  function downloadExport() {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `taskflow-${toISODate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onImportFile(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // so choosing the same file again still fires
    if (!file) return;
    importStatus = null;
    const read = readImport(await file.text());
    if (!read.ok) {
      importStatus = { ok: false, message: read.reason };
      return;
    }
    const plural = n => `${n} task${n === 1 ? '' : 's'}`;
    if (liveTaskCount > 0 && !confirm(`Replace your ${plural(liveTaskCount)}, work hours and fixed blocks with the ${plural(read.tasks)} in ${file.name}?${sync.connected ? ' This replaces them on every connected device.' : ''} Export first if you might want yours back.`)) return;
    const r = importData(read.data);
    importStatus = r.ok
      ? { ok: true, message: `Imported ${plural(r.tasks)} from ${file.name}.` }
      : { ok: false, message: r.reason };
  }

  // ── Sync backend ───────────────────────────────────────────────────────────
  // A connect link fills the form in; connecting still waits for a click, so a
  // link someone else sent can't attach this device to their backend unseen.
  const link = connectLink.value;
  setConnectLink(null);
  let urlInput   = $state(link?.url ?? '');
  let tokenInput = $state(link?.token ?? '');
  let fromLink   = $state(!!link);
  let checking   = $state(false);
  let syncError  = $state(null);
  let syncDone   = $state(null);
  let choosing   = $state(null); // { probe, device, backend } while asking what to keep
  let syncSection;

  // Arriving from a link, the form is the point; it sits below the fold.
  $effect(() => {
    if (link) syncSection?.scrollIntoView({ block: 'center' });
  });

  const hostOf = url => { try { return new URL(url).host; } catch { return url; } };
  const described = $derived(describeSync(sync.status, sync.pending));
  const homeZone = $derived(sync.info?.homeTimeZone ?? null);
  const plural = n => `${n} task${n === 1 ? '' : 's'}`;

  async function onConnect(e) {
    e.preventDefault();
    syncError = syncDone = null;
    checking = true;
    const probe = await probeBackend({ url: urlInput, token: tokenInput });
    checking = false;
    if (!probe.ok) { syncError = probe.reason; return; }
    const device = { tasks: data.tasks, workSchedule: data.workSchedule, fixedBlocks: data.fixedBlocks, activeTimer: data.activeTimer };
    const plan = firstConnectPlan(device, probe.state);
    if (plan === 'ask') {
      choosing = { probe, device: countLive(device), backend: countLive(probe.state) };
      return;
    }
    finish(probe, null, plan === 'upload'
      ? `Connected. ${plural(countLive(device))} from this device ${countLive(device) === 1 ? 'is' : 'are'} being sent to the backend.`
      : `Connected. ${countLive(probe.state) ? `Loaded ${plural(countLive(probe.state))} from the backend.` : 'The backend is empty; changes made here will sync from now on.'}`);
  }

  function choose(choice) {
    const { probe, device, backend } = choosing;
    choosing = null;
    finish(probe, choice, {
      merge:   `Connected and merged: every task from both is kept.`,
      backend: `Connected. This device now shows the backend's ${plural(backend)}.`,
      device:  `Connected. This device's ${plural(device)} replaced the backend's.`
    }[choice]);
  }

  function finish(probe, choice, message) {
    connect(probe, { token: tokenInput, choice });
    tokenInput = '';
    fromLink = false;
    syncDone = message;
  }

  function onDisconnect() {
    const n = sync.pending;
    if (n && !confirm(`${n} change${n === 1 ? '' : 's'} made here ${n === 1 ? 'hasn\'t' : 'haven\'t'} reached the backend. ${n === 1 ? 'It stays' : 'They stay'} on this device but won't sync. Disconnect anyway?`)) return;
    urlInput = sync.url ?? '';
    disconnect();
    syncDone = 'Disconnected. This device keeps its copy of everything and works on its own.';
  }

  function hardReset() {
    const message = sync.connected
      ? 'Delete everything on this device and disconnect it? The backend and your other devices keep their data.'
      : 'Delete all tasks and reset to defaults? This cannot be undone.';
    if (!confirm(message)) return;
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

      <section data-testid="sync-section" bind:this={syncSection}>
        <h3 class="section-title">Sync backend</h3>
        {#if sync.connected}
          <div class="field-row">
            <div class="field-info">
              <span class="field-label sync-host"><span class="sync-dot tone-{described.tone}"></span>{hostOf(sync.url)}</span>
              <span class="field-hint" data-testid="sync-status">{described.long}</span>
            </div>
            <div class="data-actions">
              <button class="btn btn-sm" onclick={onDisconnect}>Disconnect</button>
            </div>
          </div>
          {#if homeZone && TIME_ZONE && homeZone !== TIME_ZONE}
            <p class="sync-note">The backend schedules in {homeZone} time and this device is on {TIME_ZONE}, so blocks scheduled here may move when they sync.</p>
          {/if}
        {:else if choosing}
          <div class="sync-choice" data-testid="sync-choice">
            <p class="sync-question">This device has {plural(choosing.device)} and {hostOf(choosing.probe.url)} has {plural(choosing.backend)}. What should connecting do?</p>
            <button class="choice-btn" onclick={() => choose('merge')}>
              <span class="field-label">Merge both</span>
              <span class="field-hint">Keep every task from both. Where both have the same task, the more recently changed copy wins. Work hours come from the backend.</span>
            </button>
            <button class="choice-btn" onclick={() => choose('backend')}>
              <span class="field-label">Use the backend's</span>
              <span class="field-hint">Replace what is on this device with the backend's {plural(choosing.backend)}.</span>
            </button>
            <button class="choice-btn" onclick={() => choose('device')}>
              <span class="field-label">Use this device's</span>
              <span class="field-hint">Replace the backend's data, on every connected device, with this device's {plural(choosing.device)}.</span>
            </button>
            <button class="btn btn-sm btn-ghost" onclick={() => (choosing = null)}>Cancel</button>
          </div>
        {:else}
          <p class="field-hint sync-intro">This device keeps its data to itself. To sync it with your other devices, connect a backend you run (see <code>server/README.md</code>).</p>
          {#if fromLink}
            <p class="sync-note from-link">A connect link filled these in. Check the URL is your own backend, then connect.</p>
          {/if}
          <form class="sync-form" onsubmit={onConnect}>
            <div class="form-field">
              <label for="sync-url">Backend URL</label>
              <input id="sync-url" type="url" inputmode="url" placeholder="https://your-backend.fly.dev" autocomplete="off" spellcheck="false" bind:value={urlInput} />
            </div>
            <div class="form-field">
              <label for="sync-token">Token</label>
              <input id="sync-token" type="password" placeholder="tf_…" autocomplete="off" spellcheck="false" bind:value={tokenInput} />
            </div>
            <button class="btn btn-sm btn-primary" type="submit" disabled={checking}>{checking ? 'Checking…' : 'Connect'}</button>
          </form>
        {/if}
        {#if syncError}
          <p class="import-status error" role="status">{syncError}</p>
        {:else if syncDone}
          <p class="import-status" role="status">{syncDone}</p>
        {/if}
      </section>

      <section>
        <h3 class="section-title">Your data</h3>
        <div class="field-row">
          <div class="field-info">
            <span class="field-label">Back up or move your data</span>
            <span class="field-hint">Tasks, work hours and fixed blocks as one JSON file. Importing replaces what is here.</span>
          </div>
          <div class="data-actions">
            <button class="btn btn-sm" onclick={downloadExport}>Export</button>
            <button class="btn btn-sm" onclick={() => fileInput.click()}>Import…</button>
            <input
              bind:this={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onchange={onImportFile}
              data-testid="import-file"
            />
          </div>
        </div>
        {#if importStatus}
          <p class="import-status" class:error={!importStatus.ok} role="status">{importStatus.message}</p>
        {/if}
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
    border-radius: var(--radius-sm);
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
    border-radius: var(--radius-xs);
    flex-shrink: 0;
  }

  .theme-preview-card {
    display: block;
    flex: 1;
    border-radius: var(--radius-xs);
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
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--color-text);
    line-height: 1.2;
  }

  .theme-desc {
    font-size: var(--text-xs);
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
    font-size: var(--text-lg);
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
    font-size: var(--text-xs);
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
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    white-space: nowrap;
  }

  .section-subhint {
    font-size: var(--text-xs);
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
    font-size: var(--text-2xs);
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
    font-size: var(--text-md);
    font-weight: 500;
  }

  .hours-track {
    position: relative;
    flex: 1;
    height: 22px;
    border-radius: var(--radius-sm);
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
    border-radius: var(--radius-sm);
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

  .hours-handle-start { left: -1px; border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
  .hours-handle-end   { right: -1px; border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }

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
    font-size: var(--text-md);
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
    font-size: var(--text-md);
    font-weight: 500;
  }

  .field-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* ── Segmented button group ── */
  .buffer-options {
    display: flex;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    flex-shrink: 0;
  }

  /* ── Your data ── */
  .data-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .import-status {
    margin: 10px 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .import-status.error { color: var(--color-danger); }

  /* ── Sync backend ── */
  .sync-intro { margin: 0 0 12px; display: block; }
  .sync-intro code { font-size: 0.95em; }

  .sync-form {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 10px;
    align-items: end;
  }

  .sync-form .form-field { margin-bottom: 0; min-width: 0; }

  .sync-host {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .sync-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--color-text-faint);
  }

  .sync-dot.tone-ok    { background: var(--color-success); }
  .sync-dot.tone-busy  { background: var(--color-accent); }
  .sync-dot.tone-error { background: var(--color-danger); }

  .sync-note {
    margin: 10px 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .sync-note.from-link { margin: 0 0 12px; }

  .sync-question {
    margin: 0 0 10px;
    font-size: var(--text-md);
  }

  .sync-choice {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .sync-choice > .btn { align-self: flex-start; }

  .choice-btn {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
  }

  .choice-btn:hover {
    background: var(--color-bg);
    border-color: var(--color-text-muted);
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
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    padding: 6px 4px;
    cursor: pointer;
    transition: color 0.15s;
  }

  .btn-danger-ghost:hover { color: var(--color-danger); }

  /* The hours drag is horizontal, so pan-y hands vertical scrolling back to the
     modal while the drag itself keeps working. */
  @media (pointer: coarse) {
    .hours-track { touch-action: pan-y; }
  }

  /* ── Phone ────────────────────────────────────────────────────────────────
     The 420px floor plus the section padding overflowed a 390px viewport, and
     the panel clipped instead of scrolling — so the right theme column, the
     hours ranges and the Scheduling controls all ran off the edge. */
  @media (max-width: 759px) {
    .settings-modal {
      min-width: 0;
      max-width: 100%;
    }

    section { padding: 16px 14px; }

    /* Two 1fr columns leave ~150px per card, less than the swatch plus name. */
    .theme-grid { grid-template-columns: 1fr; }

    /* The hint sits beside the title on one baseline; at this width it has to
       drop under it or push the title out of the box. */
    .section-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
    }

    .section-hint { white-space: normal; }

    /* Label + track + range is ~60 + track + 118px. Narrow the fixed columns
       and let the range wrap rather than truncate to "9:00a – 5:0…". */
    .hours-row { gap: 8px; }
    .hours-row-label { width: 52px; }

    .hours-range-label {
      width: 96px;
      font-size: var(--text-sm);
    }

    .hours-axis-row .hours-range-label-spacer { width: 96px; }

    .sync-form { grid-template-columns: 1fr; }
    .sync-form .btn { justify-self: start; }

    /* Label and segmented control side by side don't fit; stack them. */
    .field-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }
  }
</style>
