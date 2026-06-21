<script>
  import { editTask, deleteTask, completeTask, unscheduleTask, startTimer, pauseTimer, resumeTimer, finishTimer, liveSeconds } from '../../stores/tasks.svelte.js';
  import { setExpandedTask, expandedTaskId, activeTimer, berthGhost, dragState } from '../../stores/ui.svelte.js';
  import { draggableTask } from '../dnd.js';
  import { minutesToTimeString, toISODate } from '../calendar.js';
  import { clock } from '../../stores/clock.svelte.js';
  import { pAt, pToColor, getPressureTier } from '../envelope.js';
  import EnvelopeEditor from './EnvelopeEditor.svelte';

  let { task } = $props();

  const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 480];

  let isTimerRunning  = $derived(activeTimer.value?.taskId === task.id);
  let isTimerPaused   = $derived(isTimerRunning && !activeTimer.value?.startedAt);
  let isScheduled     = $derived(task.scheduledBlocks.length > 0);
  let isExpanded      = $derived(expandedTaskId.value === task.id);
  let isPastScheduled = $derived(task.scheduledBlocks.some(b => b.date < clock.today));
  let isBerthGhosting = $derived(isScheduled && berthGhost.value === task.id);
  let isChipDragging  = $derived(dragState.value?.taskId === task.id);

  let currentPressure = $derived(pAt(task, clock.minute));
  let pressureTier    = $derived(getPressureTier(currentPressure));
  let pillColor       = $derived(pToColor(currentPressure));

  let editValue     = $state(task.description);
  let isEditingDesc = $state(false);

  let totalElapsedSeconds = $derived((() => {
    const t = activeTimer.value;
    if (!t || t.taskId !== task.id) return task.elapsedSeconds ?? 0;
    void clock.now;
    return liveSeconds(t);
  })());

  // Footer (timer strip) shows for the running task, the paused task, or any task with elapsed time logged
  let showFooter   = $derived(isTimerRunning || totalElapsedSeconds > 0);
  let estSeconds   = $derived(task.estimatedMinutes * 60);
  let progressFrac = $derived(estSeconds > 0 ? Math.min(1, totalElapsedSeconds / estSeconds) : 0);
  let overSeconds  = $derived(Math.max(0, totalElapsedSeconds - estSeconds));

  function formatElapsed(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60) % 60;
    const h = Math.floor(seconds / 3600);
    if (h > 0) return m === 0 ? `${h}h` : `${h}h ${m}m`;
    return `${m}m`;
  }

  function formatDuration(mins) {
    if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
    if (mins >= 60) return `${(mins / 60).toFixed(1)}h`;
    return `${mins}m`;
  }

  function formatClock(seconds) {
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor(total / 60) % 60;
    const s = total % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function firstScheduledBadge(blocks) {
    if (!blocks.length) return null;
    const sorted = [...blocks].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMinutes - b.startMinutes
    );
    const b = sorted[0];
    const today = toISODate(new Date());
    if (b.date === today) return minutesToTimeString(b.startMinutes);
    const d = new Date(b.date + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }

  function peaksLabel(peak) {
    const d = peak instanceof Date ? peak : new Date(peak);
    const today = new Date();
    const diffDays = Math.round((d.setHours(0,0,0,0) - new Date(today).setHours(0,0,0,0)) / 86_400_000);
    if (diffDays <= 0) return 'today';
    if (diffDays === 1) return 'tomorrow';
    if (diffDays <= 6) return d.toLocaleDateString('en-US', { weekday: 'long' });
    return 'next week';
  }

  function startEdit() {
    editValue = task.description;
    isEditingDesc = true;
  }

  function commitEdit() {
    if (editValue.trim() && editValue !== task.description) {
      editTask(task.id, { description: editValue.trim() });
    }
    isEditingDesc = false;
  }

  function onDescKeydown(e) {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') isEditingDesc = false;
  }

  function stepDuration(dir) {
    const idx = DURATION_OPTIONS.indexOf(task.estimatedMinutes);
    const next = idx === -1
      ? (dir > 0 ? DURATION_OPTIONS[0] : DURATION_OPTIONS[DURATION_OPTIONS.length - 1])
      : DURATION_OPTIONS[Math.max(0, Math.min(DURATION_OPTIONS.length - 1, idx + dir))];
    editTask(task.id, { estimatedMinutes: next });
  }

  function handleEnvelopeChange({ onset, peak, peakPressure }) {
    editTask(task.id, { onset, peak, peakPressure });
  }

  const scheduledBadge = $derived(firstScheduledBadge(task.scheduledBlocks));
</script>

<div
  class="task-card"
  class:is-expanded={isExpanded}
  class:timer-running={isTimerRunning && !isTimerPaused}
  class:timer-paused={isTimerPaused}
  style={isTimerRunning && !isTimerPaused ? `--spine:${pillColor}` : undefined}
>
  <!-- ── Collapsed header ── -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="task-header" onclick={() => setExpandedTask(task.id)}>

    <!-- Complete checkbox -->
    <button
      class="complete-circle"
      title="Mark complete"
      onclick={(e) => { e.stopPropagation(); completeTask(task.id); }}
    >✓</button>

    <!-- Description + sub-line -->
    <div class="task-main">
      <div class="task-title-row">
        {#if isEditingDesc}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="desc-input"
            bind:value={editValue}
            onblur={commitEdit}
            onkeydown={onDescKeydown}
            onclick={(e) => e.stopPropagation()}
            autofocus
          />
        {:else}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="task-desc"
            title={task.description}
            onclick={(e) => e.stopPropagation()}
            ondblclick={(e) => { e.stopPropagation(); startEdit(); }}
          >{task.description}</span>
        {/if}
        {#if isTimerRunning && !isTimerPaused}
          <span class="status-badge badge-working">● WORKING</span>
        {:else if isTimerPaused}
          <span class="status-badge badge-paused">PAUSED</span>
        {/if}
      </div>
      <span class="task-subline">
        {#if isPastScheduled}
          <span class="status-dot" style="background:{pillColor}"></span>
          <span class="past-flag" title="Past scheduled time">past scheduled time</span>
        {:else if showFooter}
          {#if isScheduled}
            ◷ {scheduledBadge} · est {formatDuration(task.estimatedMinutes)}
          {:else}
            Unscheduled · est {formatDuration(task.estimatedMinutes)}
          {/if}
        {:else}
          <span class="status-dot" style="background:{pillColor}"></span>
          {pressureTier?.label ?? 'Unscheduled'} · peaks {peaksLabel(task.peak)}
        {/if}
      </span>
    </div>

    <!-- Hover-reveal play button (inactive rows only) -->
    {#if !isTimerRunning}
      <button class="play-hover-btn" title="Start timer"
        onclick={(e) => { e.stopPropagation(); startTimer(task.id); }}>▶</button>
    {/if}

    <!-- Berth (right) -->
    <div class="berth" data-berth-task-id={task.id}>
      {#if isBerthGhosting}
        <div class="task-chip chip-ghost" style="--spine:{pillColor}">
          <div class="chip-accent"></div>
          <span class="chip-handle">⠿</span>
          <span class="chip-duration">{formatDuration(task.estimatedMinutes)}</span>
        </div>
      {:else if !isScheduled}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="task-chip" class:is-dragging={isChipDragging} style="--spine:{pillColor}" title="Drag to schedule"
          use:draggableTask={{ taskId: task.id }}
          onclick={(e) => e.stopPropagation()}>
          <div class="chip-accent"></div>
          <span class="chip-handle">⠿</span>
          <span class="chip-duration">{formatDuration(task.estimatedMinutes)}</span>
        </div>
      {:else}
        <span class="berth-schedule" title="Scheduled">◷ {scheduledBadge}</span>
      {/if}
    </div>

  </div>

  <!-- ── Timer footer ── -->
  {#if showFooter}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="task-footer" onclick={(e) => e.stopPropagation()}>
      <span class="footer-elapsed" class:over={overSeconds > 0}>{formatClock(totalElapsedSeconds)}</span>
      <div class="footer-bar-track">
        <div class="footer-bar-fill" class:over={overSeconds > 0} style="width:{Math.max(progressFrac, overSeconds > 0 ? 1 : 0) * 100}%"></div>
      </div>
      <span class="footer-est">est {formatDuration(task.estimatedMinutes)}</span>
      {#if overSeconds > 0}
        <span class="footer-over">+{formatElapsed(overSeconds)} over</span>
      {/if}
      <div class="footer-controls">
        {#if isTimerRunning}
          {#if isTimerPaused}
            <button class="footer-btn" title="Resume timer" onclick={() => resumeTimer(task.id)}>▶</button>
          {:else}
            <button class="footer-btn" title="Pause timer" onclick={() => pauseTimer(task.id)}>⏸</button>
          {/if}
        {:else}
          <button class="footer-btn" title="Start timer" onclick={() => startTimer(task.id)}>▶</button>
        {/if}
        <button class="footer-btn" title="Stop timer" onclick={() => finishTimer(task.id)}>■</button>
      </div>
    </div>
  {/if}

  <!-- ── Expanded panel ── -->
  {#if isExpanded}
    <div class="task-expanded">

      <!-- Duration stepper (matches mockup layout: label + − value + ) -->
      <div class="duration-row" onclick={(e) => e.stopPropagation()}>
        <div class="duration-label-block">
          <span class="duration-title">Estimated time</span>
          <span class="duration-hint">sets how big its block is</span>
        </div>
        <div class="duration-stepper">
          <button class="stepper-btn" onclick={(e) => { e.stopPropagation(); stepDuration(-1); }}>−</button>
          <span class="stepper-val">{formatDuration(task.estimatedMinutes)}</span>
          <button class="stepper-btn" onclick={(e) => { e.stopPropagation(); stepDuration(1); }}>＋</button>
        </div>
      </div>

      <!-- Envelope editor -->
      <div class="envelope-section">
        <div class="section-label">Pressure envelope — how urgent this becomes over time</div>
        <EnvelopeEditor {task} onchange={handleEnvelopeChange} />
      </div>

      <!-- Meta row: elapsed + actions -->
      <div class="expanded-meta">
        <!-- Elapsed -->
        {#if totalElapsedSeconds > 0}
          <span class="meta-chip elapsed-chip" class:elapsed-running={isTimerRunning}>
            {formatElapsed(totalElapsedSeconds)} elapsed
          </span>
        {/if}

        <!-- Actions -->
        <div class="expanded-actions">
          {#if isScheduled}
            <button class="action-text unschedule-btn"
              onclick={(e) => { e.stopPropagation(); unscheduleTask(task.id); }}>
              Unschedule
            </button>
          {/if}
          <button class="action-text delete-btn"
            onclick={(e) => { e.stopPropagation(); deleteTask(task.id); }}>
            Delete
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* ── Card wrapper ── */
  .task-card {
    background: transparent;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    border-bottom: 1px solid var(--color-border-light);
    border-left: 3px solid transparent;
    transition: background 0.15s, border-color 0.15s;
  }

  .task-card:hover {
    background: var(--color-panel);
  }

  .task-card.timer-running {
    background: color-mix(in srgb, var(--spine) 8%, var(--color-card));
    border-color: color-mix(in srgb, var(--spine) 35%, var(--color-border-light));
    border-left-color: var(--spine);
  }

  .task-card.timer-paused {
    background: var(--color-panel);
    border-left-color: var(--color-text-faint);
  }

  .task-card.is-expanded {
    background: var(--color-panel);
    border-color: var(--color-accent-border);
  }

  /* ── Collapsed header ── */
  .task-header {
    display: flex;
    align-items: center;
    padding: 10px 10px 10px 10px;
    gap: 8px;
    cursor: pointer;
    min-width: 0;
  }

  /* ── Complete checkbox ── */
  .complete-circle {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid var(--color-border);
    background: var(--color-card);
    color: transparent;
    font-size: 13px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }

  .complete-circle:hover {
    background: #6E8B63;
    border-color: #6E8B63;
    color: #fff;
  }

  /* ── Description block ── */
  .task-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .task-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .status-badge {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.03em;
    padding: 2px 7px;
    border-radius: 999px;
    white-space: nowrap;
  }

  .badge-working {
    background: rgba(110,139,99,0.16);
    color: #6E8B63;
  }

  .badge-paused {
    background: var(--color-border-light);
    color: var(--color-text-muted);
  }

  .task-desc {
    font-size: 14px;
    font-weight: 500;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
    cursor: default;
    width: fit-content;
    max-width: 100%;
  }

  .task-desc:hover {
    cursor: text;
  }

  .desc-input {
    width: 100%;
    font-size: 14px;
    font-weight: 500;
    font-family: inherit;
    border: none;
    border-bottom: 1.5px solid var(--color-text-muted);
    background: transparent;
    outline: none;
    padding: 0;
    color: var(--color-text);
    line-height: 1.3;
  }

  .task-subline {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .past-flag {
    font-weight: 700;
    color: var(--color-accent);
  }

  /* ── Hover-reveal play button (inactive rows) ── */
  .play-hover-btn {
    flex-shrink: 0;
    width: 0;
    height: 26px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    font-size: 11px;
    cursor: pointer;
    overflow: hidden;
    opacity: 0;
    transition: width 0.15s, opacity 0.15s, background 0.1s, color 0.1s;
  }

  .task-card:hover .play-hover-btn {
    width: 26px;
    opacity: 1;
  }

  .play-hover-btn:hover { background: var(--color-card); color: var(--color-text); }

  /* ── Berth: a slot the card-chip docks into; stays visible (bevelled) even once occupied ── */
  .berth {
    width: 84px;
    height: 38px;
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
    justify-content: center;
    margin-left: 6px;
    padding: 4px;
    box-sizing: border-box;
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    box-shadow:
      inset 0 1px 3px var(--color-inset-shadow),
      inset 0 -1px 0 var(--color-inset-highlight),
      inset 0 0 0 1px var(--color-border);
  }

  .berth-schedule {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-muted);
    text-align: center;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .task-chip {
    width: 100%;
    display: flex;
    align-items: stretch;
    background: var(--color-card);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-sm);
    box-shadow: 0 1px 3px var(--color-shadow);
    cursor: grab;
    touch-action: none;
    user-select: none;
    overflow: hidden;
    transition: box-shadow 0.1s, border-color 0.1s;
  }

  .task-chip:hover {
    border-color: var(--color-border);
    box-shadow: 0 2px 6px var(--color-shadow);
  }

  .task-chip:active { cursor: grabbing; }

  .task-chip.is-dragging {
    opacity: 0.35;
    box-shadow: none;
  }

  .task-chip.chip-ghost {
    opacity: 0.45;
    border: 1.5px dashed var(--color-border);
    cursor: default;
    pointer-events: none;
    background: var(--color-panel);
    box-shadow: none;
  }

  .task-chip.chip-ghost .chip-accent {
    background: var(--color-border);
  }

  .chip-accent {
    width: 4px;
    flex-shrink: 0;
    background: var(--spine);
  }

  .chip-handle {
    display: flex;
    align-items: center;
    padding-left: 6px;
    font-size: 10px;
    color: var(--color-text-faint);
  }

  .chip-duration {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text);
    white-space: nowrap;
  }

  /* ── Timer footer ── */
  .task-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px 10px 44px;
    cursor: default;
  }

  .footer-elapsed {
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #6E8B63;
    flex-shrink: 0;
    min-width: 44px;
  }

  .footer-elapsed.over {
    color: #C0392B;
  }

  .footer-bar-track {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--color-border-light);
    overflow: hidden;
  }

  .footer-bar-fill {
    height: 100%;
    border-radius: 3px;
    background: #6E8B63;
    transition: width 0.2s;
  }

  .footer-bar-fill.over {
    background: #C0392B;
  }

  .footer-est {
    font-size: 12px;
    color: var(--color-text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .footer-over {
    font-size: 12px;
    font-weight: 600;
    color: #C0392B;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .footer-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .footer-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-card);
    color: var(--color-text-muted);
    font-size: 10px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }

  .footer-btn:hover {
    background: var(--color-panel);
    color: var(--color-text);
    border-color: var(--color-text-muted);
  }

  /* ── Expanded panel ── */
  .task-expanded {
    padding: 0 14px 14px;
    border-top: 1px solid var(--color-border-light);
  }

  .desc-input {
    width: 100%;
    font-size: 15px;
    font-weight: 500;
    border: none;
    border-bottom: 2px solid var(--color-text-muted);
    background: transparent;
    outline: none;
    padding: 0;
    color: var(--color-text);
  }

  /* ── Duration stepper ── */
  .duration-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0 8px;
  }

  .duration-label-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .duration-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text);
  }

  .duration-hint {
    font-size: 11px;
    color: var(--color-text-faint);
  }

  .duration-stepper {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .stepper-btn {
    width: 30px;
    height: 30px;
    border: 1px solid var(--color-border);
    background: var(--color-card);
    color: var(--color-text-muted);
    border-radius: var(--radius-sm);
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.1s, color 0.1s;
    flex-shrink: 0;
  }
  .stepper-btn:hover { border-color: var(--color-text-muted); color: var(--color-text); }

  .stepper-val {
    font-size: 18px;
    font-weight: 600;
    color: var(--color-text);
    min-width: 44px;
    text-align: center;
  }

  /* ── Envelope section ── */
  .envelope-section { margin: 2px 0 8px; }

  .section-label {
    font-size: 12.5px;
    font-weight: 400;
    color: var(--color-text-muted);
    margin-bottom: 8px;
  }

  /* ── Meta row ── */
  .expanded-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 10px;
  }

  .meta-chip {
    font-size: 12px;
    color: var(--color-text-muted);
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 3px 8px;
    white-space: nowrap;
  }

  .elapsed-chip { font-variant-numeric: tabular-nums; }
  .elapsed-chip.elapsed-running { color: #6E8B63; border-color: #A8D5A2; background: rgba(110,139,99,0.08); }

  .expanded-actions {
    margin-left: auto;
    display: flex;
    gap: 10px;
  }

  .action-text {
    font-size: 12px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    color: var(--color-text-faint);
    transition: color 0.1s;
    font-weight: 500;
  }
  .unschedule-btn:hover { color: var(--color-text-muted); }
  .delete-btn:hover { color: var(--color-accent); }

</style>
