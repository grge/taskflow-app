<script>
  import { editTask, deleteTask, completeTask, unscheduleTask, toggleLock, setRemaining, startTimer, pauseTimer, resumeTimer, finishTimer, liveSeconds } from '../../stores/tasks.svelte.js';
  import { setExpandedTask, expandedTaskId, activeTimer, berthGhost, dragState } from '../../stores/ui.svelte.js';
  import { draggableTask } from '../dnd.js';
  import { minutesToTimeString, toISODate } from '../calendar.js';
  import { clock } from '../../stores/clock.svelte.js';
  import { pAt, pToColor, getPressureTier } from '../envelope.js';
  import { remainingMinutes } from '../tasks.js';
  import EnvelopeEditor from './EnvelopeEditor.svelte';
  import LockIcon from './LockIcon.svelte';

  let { task } = $props();

  let isTimerRunning  = $derived(activeTimer.value?.taskId === task.id);
  let isTimerPaused   = $derived(isTimerRunning && !activeTimer.value?.startedAt);
  let isScheduled     = $derived(task.scheduledBlocks.length > 0);
  let isLocked        = $derived(task.isLocked);
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
  // Minutes of work left — what the scheduler packs against and we display.
  // Uses the live elapsed reading so it ticks down while the timer runs.
  let remainMinutes = $derived(remainingMinutes(task, totalElapsedSeconds));
  // Progress is measured against the current best-estimate total (work done +
  // work left), not the original estimate. Stays honest after an override and
  // reaches 100% exactly as remaining hits 0 — so there's no "over" state.
  let progressFrac = $derived((() => {
    const remainSeconds = remainMinutes * 60;
    const total = totalElapsedSeconds + remainSeconds;
    return total > 0 ? Math.min(1, totalElapsedSeconds / total) : 0;
  })());

  // Minutes → "1h 11m" / "45m" / "1h" (hours+minutes, no decimals). Used in the
  // expanded stat panels where "1h 11m" reads clearer than "1.2h".
  function formatHM(mins) {
    const m = Math.round(mins);
    const h = Math.floor(m / 60);
    const rem = m % 60;
    if (h === 0) return `${rem}m`;
    return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
  }

  function formatDuration(mins) {
    if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
    if (mins >= 60) return `${(mins / 60).toFixed(1)}h`;
    return `${mins}m`;
  }

  // True once remaining has diverged from the plain estimate — i.e. work has
  // been logged or the user set a manual override. Drives "X left" vs "est X".
  let hasProgress    = $derived(totalElapsedSeconds > 0 || task.remainingOverride != null);
  let remainingLabel = $derived(
    hasProgress ? `${formatDuration(remainMinutes)} left` : `est ${formatDuration(task.estimatedMinutes)}`
  );

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

  function handleEnvelopeChange({ onset, peak, peakPressure }) {
    editTask(task.id, { onset, peak, peakPressure });
  }

  const REMAINING_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480];

  function stepRemaining(dir) {
    const cur = remainMinutes;
    // Snap to the nearest option in the step direction so repeated clicks move cleanly.
    const next = dir > 0
      ? REMAINING_OPTIONS.find(o => o > cur) ?? REMAINING_OPTIONS[REMAINING_OPTIONS.length - 1]
      : [...REMAINING_OPTIONS].reverse().find(o => o < cur) ?? REMAINING_OPTIONS[0];
    setRemaining(task.id, next);
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
      {#if !isExpanded}
        <span class="task-subline">
          {#if isPastScheduled}
            <span class="status-dot" style="background:{pillColor}"></span>
            <span class="past-flag" title="Past scheduled time">past scheduled time</span>
          {:else if showFooter}
            {#if isScheduled}
              ◷ {scheduledBadge} · {remainingLabel}
            {:else}
              Unscheduled · {remainingLabel}
            {/if}
          {:else}
            <span class="status-dot" style="background:{pillColor}"></span>
            {pressureTier?.label ?? 'Unscheduled'} · peaks {peaksLabel(task.peak)}
          {/if}
        </span>
      {/if}
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
          <span class="chip-duration">{formatDuration(remainMinutes)}</span>
        </div>
      {:else if !isScheduled}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="task-chip" class:is-dragging={isChipDragging} class:is-locked={isLocked} style="--spine:{pillColor}" title="Drag to schedule"
          use:draggableTask={{ taskId: task.id }}
          onclick={(e) => e.stopPropagation()}>
          <div class="chip-accent"></div>
          <span class="chip-handle">⠿</span>
          <span class="chip-duration" title={hasProgress ? `${formatDuration(remainMinutes)} left of ${formatDuration(task.estimatedMinutes)} est` : null}>{formatDuration(remainMinutes)}</span>
          <button
            class="chip-lock"
            class:is-locked={isLocked}
            title={isLocked
              ? 'Locked — auto-scheduler will skip this task'
              : 'Lock to keep the auto-scheduler from scheduling this task'}
            onmousedown={(e) => e.stopPropagation()}
            onclick={(e) => { e.stopPropagation(); toggleLock(task.id); }}
          ><LockIcon locked={isLocked} size={14} /></button>
        </div>
      {:else}
        <span class="berth-schedule" title="Scheduled">◷ {scheduledBadge}</span>
      {/if}
    </div>

  </div>

  <!-- ── Timer footer (compact; expanded panel takes over when open) ── -->
  {#if showFooter && !isExpanded}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="task-footer" onclick={(e) => e.stopPropagation()}>
      <span class="footer-elapsed">{formatClock(totalElapsedSeconds)}</span>
      <div class="footer-bar-track">
        <div class="footer-bar-fill" style="width:{progressFrac * 100}%"></div>
      </div>
      <span class="footer-est" title="est {formatDuration(task.estimatedMinutes)}">{formatDuration(remainMinutes)} left</span>
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

      <!-- 3-panel stat row: ELAPSED (read-only) · LEFT (editable, the number the
           scheduler uses) · ESTIMATE (read-only, set at creation). -->
      <div class="stat-row" onclick={(e) => e.stopPropagation()}>
        <div class="stat-panel">
          <span class="stat-label">Elapsed</span>
          <span class="stat-value">{formatHM(totalElapsedSeconds / 60)}</span>
        </div>

        <div class="stat-panel stat-panel-left">
          <span class="stat-label">Left</span>
          <div class="stat-stepper">
            <button class="stepper-btn" title="Less time left"
              onclick={(e) => { e.stopPropagation(); stepRemaining(-1); }}>−</button>
            <span class="stat-value">{formatHM(remainMinutes)}</span>
            <button class="stepper-btn" title="More time left"
              onclick={(e) => { e.stopPropagation(); stepRemaining(1); }}>＋</button>
          </div>
        </div>

        <div class="stat-panel">
          <span class="stat-label">Estimate</span>
          <span class="stat-value">{formatHM(task.estimatedMinutes)}</span>
        </div>
      </div>

      <!-- Progress bar (remaining-based) + override reset affordance -->
      <div class="expanded-progress">
        <div class="footer-bar-track">
          <div class="footer-bar-fill" style="width:{progressFrac * 100}%"></div>
        </div>
        {#if task.remainingOverride != null}
          <span class="override-note">
            overridden · <button class="link-btn" onclick={(e) => { e.stopPropagation(); setRemaining(task.id, null); }}>reset</button>
          </span>
        {/if}
      </div>

      <!-- Full-width timer controls -->
      <div class="expanded-timer" onclick={(e) => e.stopPropagation()}>
        {#if isTimerRunning && !isTimerPaused}
          <button class="timer-btn" onclick={() => pauseTimer(task.id)}>⏸ Pause</button>
        {:else if isTimerPaused}
          <button class="timer-btn" onclick={() => resumeTimer(task.id)}>▶ Resume</button>
        {:else}
          <button class="timer-btn" onclick={() => startTimer(task.id)}>▶ Start</button>
        {/if}
        <button class="timer-btn" onclick={() => finishTimer(task.id)}>■ Stop</button>
      </div>

      <!-- Envelope editor with current-pressure pill -->
      <div class="envelope-section">
        <div class="envelope-header">
          <span class="section-label">Pressure envelope</span>
          <span class="pressure-pill" style="--pill:{pillColor}">
            {pressureTier?.label ?? '—'} · {Math.round(currentPressure * 100)}%
          </span>
        </div>
        <EnvelopeEditor {task} onchange={handleEnvelopeChange} showNowBadge={false} />
      </div>

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

  /* Lock toggle on the chip: hidden until hover, but always shown when locked */
  .chip-lock {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-text-faint);
    cursor: pointer;
    overflow: hidden;
    opacity: 0;
    transition: width 0.12s, opacity 0.12s, color 0.1s;
  }

  .task-chip:hover .chip-lock,
  .chip-lock.is-locked {
    width: 22px;
    opacity: 1;
  }

  .chip-lock:hover { color: var(--color-text-muted); }
  .chip-lock.is-locked { color: var(--color-accent); }

  .task-chip.is-locked {
    border-color: var(--color-border);
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

  .footer-est {
    font-size: 12px;
    color: var(--color-text-muted);
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

  /* ── 3-panel stat row (Elapsed | Left | Estimate) ──
     One unified control: a single rounded container with the three sections
     divided by thin internal borders, not separate cards with gaps. */
  .stat-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    margin: 6px 0 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-card);
    overflow: hidden;
  }

  .stat-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 8px;
  }

  /* Internal dividers between the three segments. */
  .stat-panel + .stat-panel {
    border-left: 1px solid var(--color-border);
  }

  /* The editable middle panel is the emphasis of the row. */
  .stat-panel-left {
    background: color-mix(in srgb, #6E8B63 7%, var(--color-card));
  }

  .stat-label {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-faint);
  }

  .stat-value {
    font-size: 19px;
    font-weight: 600;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }

  .stat-panel .stat-value { color: var(--color-text-muted); }
  .stat-panel-left .stat-label { color: #6E8B63; }
  .stat-panel-left .stat-value { color: var(--color-text); font-weight: 700; min-width: 44px; text-align: center; }

  .stat-stepper {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .stepper-btn {
    width: 28px;
    height: 28px;
    border: 1px solid var(--color-border);
    background: var(--color-card);
    color: var(--color-text-muted);
    border-radius: var(--radius-sm);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.1s, color 0.1s;
    flex-shrink: 0;
  }
  .stepper-btn:hover { border-color: var(--color-text-muted); color: var(--color-text); }

  /* ── Progress bar + override reset ── */
  .expanded-progress {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 2px 0 10px;
  }

  .expanded-progress .footer-bar-track { flex: 1; }

  .override-note {
    font-size: 11px;
    color: var(--color-text-faint);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .link-btn {
    font-size: 11px;
    color: var(--color-primary);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-decoration: underline;
  }

  /* ── Full-width timer controls ── */
  .expanded-timer {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 12px;
  }

  .timer-btn {
    padding: 11px 0;
    border: 1px solid var(--color-border);
    background: var(--color-card);
    color: var(--color-text);
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.1s, background 0.1s;
  }
  .timer-btn:hover { border-color: var(--color-text-muted); background: var(--color-panel); }

  /* ── Envelope section ── */
  .envelope-section { margin: 2px 0 8px; }

  .envelope-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }

  .section-label {
    font-size: 12.5px;
    font-weight: 400;
    color: var(--color-text-muted);
  }

  .pressure-pill {
    font-size: 11px;
    font-weight: 600;
    color: color-mix(in srgb, var(--pill) 70%, var(--color-text));
    background: color-mix(in srgb, var(--pill) 15%, var(--color-card));
    border: 1px solid color-mix(in srgb, var(--pill) 35%, transparent);
    border-radius: 999px;
    padding: 3px 9px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  /* ── Actions ── */
  .expanded-actions {
    margin-top: 4px;
    display: flex;
    justify-content: flex-end;
    gap: 14px;
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
