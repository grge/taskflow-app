<script>
  import { editTask, deleteTask, completeTask, unscheduleTask, toggleLock, setRemaining, setElapsed, startTimer, pauseTimer, resumeTimer, finishTimer, liveSeconds, scheduleTaskNext, restoreBlocks } from '../../stores/tasks.svelte.js';
  import { setExpandedTask, expandedTaskId, activeTimer, berthGhost, dragState } from '../../stores/ui.svelte.js';
  import { draggableTask } from '../dnd.js';
  import { minutesToTimeString, toISODate, parseLocalDate } from '../calendar.js';
  import { clock } from '../../stores/clock.svelte.js';
  import { pAt, pToColor, getPressureTier } from '../envelope.js';
  import { remainingMinutes } from '../tasks.js';
  import { formatDuration, formatHoursMinutes, formatClock, peaksLabel, parseDuration } from '../format.js';
  import { createInlineEdit } from '../inline-edit.svelte.js';
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

  const rename = createInlineEdit((id, value) => editTask(id, { description: value }));

  // Click-to-edit for logged elapsed time. Parses "1h 47m" / "1:47" / "90m";
  // ignores unparseable input (commit is a no-op, leaving the value unchanged).
  const editElapsed = createInlineEdit((id, value) => {
    const mins = parseDuration(value);
    if (mins != null) setElapsed(id, mins * 60);
  });

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

  // True once remaining has diverged from the plain estimate — i.e. work has
  // been logged or the user set a manual override. Drives "X left" vs "est X".
  let hasProgress    = $derived(totalElapsedSeconds > 0 || task.remainingOverride != null);
  let remainingLabel = $derived(
    hasProgress ? `${formatDuration(remainMinutes)} left` : `est ${formatDuration(task.estimatedMinutes)}`
  );

  function firstScheduledBadge(blocks) {
    if (!blocks.length) return null;
    const sorted = [...blocks].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMinutes - b.startMinutes
    );
    const b = sorted[0];
    const today = toISODate(new Date());
    if (b.date === today) return minutesToTimeString(b.startMinutes);
    const d = parseLocalDate(b.date);
    return d.toLocaleDateString('en-US', { weekday: 'short' });
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

  // Transient result line for the schedule action. Lives in the sub-line when
  // collapsed and in the actions row when expanded, so it never adds height.
  // { kind: 'ok' | 'fail', text, undo? }
  let flash = $state(null);
  let flashTimer = null;

  function setFlash(next) {
    clearTimeout(flashTimer);
    flash = next;
    if (next) flashTimer = setTimeout(() => { flash = null; }, 7000);
  }

  $effect(() => () => clearTimeout(flashTimer));

  const FLASH_REASONS = {
    'no-room':      'No free slot in the next 7 work days',
    'no-work-days': 'No work days enabled — check Settings',
    'unavailable':  'This task can no longer be scheduled'
  };

  function handleScheduleNext(e) {
    e.stopPropagation();
    const before = task.scheduledBlocks;
    const res = scheduleTaskNext(task.id);

    if (!res.ok) {
      setFlash({ kind: 'fail', text: FLASH_REASONS[res.reason] ?? 'Could not schedule' });
      return;
    }
    setFlash({
      kind: 'ok',
      text: `Scheduled ${firstScheduledBadge(res.blocks)}`,
      undo: () => { restoreBlocks(task.id, before); setFlash(null); }
    });
  }
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
        {#if rename.isEditing(task.id)}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="inline-edit desc-input"
            bind:value={rename.draft}
            onblur={rename.commit}
            onkeydown={rename.onKeydown}
            onclick={(e) => e.stopPropagation()}
            autofocus
          />
        {:else}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="task-desc"
            title={task.description}
            onclick={(e) => e.stopPropagation()}
            ondblclick={(e) => { e.stopPropagation(); rename.start(task.id, task.description); }}
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
          {#if flash}
            <span class="flash" class:flash-fail={flash.kind === 'fail'}>{flash.text}</span>
            {#if flash.undo}
              <button class="flash-undo" onclick={(e) => { e.stopPropagation(); flash.undo(); }}>Undo</button>
            {/if}
          {:else if isPastScheduled}
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

    <!-- Schedule at the next free slot. .reveal-btn so it hover-reveals with a
         mouse and stays visible on touch, where there is no reveal gesture. -->
    <button
      class="reveal-btn schedule-btn"
      title={isScheduled ? 'Move to the next free slot' : 'Schedule at the next free slot'}
      onclick={handleScheduleNext}
    >✦</button>

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
        <div class="task-chip" class:is-dragging={isChipDragging} class:is-locked={isLocked} style="--spine:{pillColor}" title="Drag to schedule, or use ✦ for the next free slot"
          use:draggableTask={{ taskId: task.id }}
          onclick={(e) => e.stopPropagation()}>
          <div class="chip-accent"></div>
          <span class="chip-handle">⠿</span>
          <span class="chip-duration" title={hasProgress ? `${formatDuration(remainMinutes)} left of ${formatDuration(task.estimatedMinutes)} est` : null}>{formatDuration(remainMinutes)}</span>
          <button
            class="reveal-btn chip-lock"
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
            <button class="btn-icon footer-btn" title="Resume timer" onclick={() => resumeTimer(task.id)}>▶</button>
          {:else}
            <button class="btn-icon footer-btn" title="Pause timer" onclick={() => pauseTimer(task.id)}>⏸</button>
          {/if}
        {:else}
          <button class="btn-icon footer-btn" title="Start timer" onclick={() => startTimer(task.id)}>▶</button>
        {/if}
        <button class="btn-icon footer-btn" title="Stop timer" onclick={() => finishTimer(task.id)}>■</button>
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
          {#if editElapsed.isEditing(task.id)}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="inline-edit elapsed-input"
              bind:value={editElapsed.draft}
              onblur={editElapsed.commit}
              onkeydown={editElapsed.onKeydown}
              autofocus
            />
          {:else}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <span
              class="stat-value stat-value-editable"
              title="Click to edit logged time"
              onclick={() => editElapsed.start(task.id, formatHoursMinutes(totalElapsedSeconds / 60))}
            >{formatHoursMinutes(totalElapsedSeconds / 60)}</span>
          {/if}
        </div>

        <div class="stat-panel stat-panel-left">
          <span class="stat-label">Left</span>
          <div class="stat-stepper">
            <button class="btn-icon stepper-btn" title="Less time left"
              onclick={(e) => { e.stopPropagation(); stepRemaining(-1); }}>−</button>
            <span class="stat-value">{formatHoursMinutes(remainMinutes)}</span>
            <button class="btn-icon stepper-btn" title="More time left"
              onclick={(e) => { e.stopPropagation(); stepRemaining(1); }}>＋</button>
          </div>
        </div>

        <div class="stat-panel">
          <span class="stat-label">Estimate</span>
          <span class="stat-value">{formatHoursMinutes(task.estimatedMinutes)}</span>
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
        {#if flash}
          <div class="flash-row">
            <span class="flash" class:flash-fail={flash.kind === 'fail'}>{flash.text}</span>
            {#if flash.undo}
              <button class="flash-undo" onclick={(e) => { e.stopPropagation(); flash.undo(); }}>Undo</button>
            {/if}
          </div>
        {/if}
        <button class="action-text schedule-action"
          title={isScheduled ? 'Move to the next free slot' : 'Schedule at the next free slot'}
          onclick={handleScheduleNext}>
          {isScheduled ? 'Reschedule' : 'Schedule'}
        </button>
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
    background: var(--color-success);
    border-color: var(--color-success);
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
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: 0.03em;
    padding: 2px 7px;
    border-radius: 999px;
    white-space: nowrap;
  }

  .badge-working {
    background: var(--color-success-tint);
    color: var(--color-success);
  }

  .badge-paused {
    background: var(--color-border-light);
    color: var(--color-text-muted);
  }

  .task-desc {
    font-size: var(--text-base);
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

  /* .inline-edit provides the transparent/underline base */
  .desc-input {
    width: 100%;
    font-size: var(--text-base);
    font-weight: 500;
    line-height: 1.3;
  }

  .task-subline {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-sm);
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
    font-size: var(--text-xs);
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
    font-size: var(--text-xs);
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
    font-size: var(--text-2xs);
    color: var(--color-text-faint);
  }

  .chip-duration {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--color-text);
    white-space: nowrap;
  }

  /* Lock toggle on the chip: .reveal-btn provides the opacity base; this adds
     the width-expand animation (hidden until hover, always shown when locked). */
  .chip-lock {
    flex-shrink: 0;
    width: 0;
    color: var(--color-text-faint);
    overflow: hidden;
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
    color: var(--color-success);
    flex-shrink: 0;
    min-width: 44px;
  }

  .footer-bar-track {
    flex: 1;
    height: 6px;
    border-radius: var(--radius-xs);
    background: var(--color-border-light);
    overflow: hidden;
  }

  .footer-bar-fill {
    height: 100%;
    border-radius: var(--radius-xs);
    background: var(--color-success);
    transition: width 0.2s;
  }

  .footer-est {
    font-size: var(--text-sm);
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

  /* .btn-icon provides the 26px square base + hover; just set the glyph size */
  .footer-btn {
    font-size: var(--text-2xs);
  }

  /* ── Expanded panel ── */
  .task-expanded {
    padding: 0 14px 14px;
    border-top: 1px solid var(--color-border-light);
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
    background: color-mix(in srgb, var(--color-success) 7%, var(--color-card));
  }

  .stat-label {
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-faint);
  }

  .stat-value {
    font-size: var(--text-xl);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
    /* color is set per-panel below: muted default, full-color for the Left panel */
  }

  .stat-panel .stat-value { color: var(--color-text-muted); }

  /* Editable Elapsed value: hint it's clickable, matching the .task-desc cue. */
  .stat-value-editable { cursor: text; }
  .stat-value-editable:hover { color: var(--color-text); }

  /* .inline-edit provides the transparent/underline base; size to the stat value. */
  .elapsed-input {
    width: 100%;
    text-align: center;
    font-size: var(--text-xl);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
    color: var(--color-text);
  }

  .stat-panel-left .stat-label { color: var(--color-success); }
  .stat-panel-left .stat-value { color: var(--color-text); font-weight: 700; min-width: 44px; text-align: center; }

  .stat-stepper {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* .btn-icon provides the base; override to the slightly larger 28px stepper */
  .stepper-btn {
    width: 28px;
    height: 28px;
    font-size: 15px;
    font-weight: 600;
    flex-shrink: 0;
  }

  /* ── Progress bar + override reset ── */
  .expanded-progress {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 2px 0 10px;
  }

  .expanded-progress .footer-bar-track { flex: 1; }

  .override-note {
    font-size: var(--text-xs);
    color: var(--color-text-faint);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .link-btn {
    font-size: var(--text-xs);
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
    font-size: var(--text-base);
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
    font-size: var(--text-md);
    font-weight: 400;
    color: var(--color-text-muted);
  }

  .pressure-pill {
    font-size: var(--text-xs);
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
    font-size: var(--text-sm);
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


  /* Touch: a finger landing on a card must still be able to scroll the list.
     These cards cover nearly the whole panel, so touch-action: none made the
     list unscrollable on a phone. Vertical dragging comes back behind a
     long-press to lift; until then a swipe scrolls, which is the more
     fundamental of the two. Pointer-keyed, so mouse behaviour is unchanged. */
  @media (pointer: coarse) {
    .task-chip { touch-action: pan-y; }

    /* A primary action needs a real target, not just the shared ::after nudge
       that .reveal-btn gets — 14px of glyph is nowhere near 44px. Sized rather
       than overlaid so the flex row spaces it off its neighbours instead of
       stacking invisible hit areas on top of them. */
    .schedule-btn {
      min-width: 44px;
      min-height: 44px;
      font-size: var(--text-md);
    }

    .schedule-btn::after { content: none; }

    .complete-circle,
    .stepper-btn { position: relative; }

    .complete-circle::after,
    .stepper-btn::after {
      content: '';
      position: absolute;
      inset: -9px;
    }
  }

  /* No hover means no reveal — show the play control outright. */
  @media (hover: none) {
    .play-hover-btn { width: 26px; opacity: 1; }
  }

  /* ── Schedule action ── */
  .schedule-btn {
    flex-shrink: 0;
    font-size: var(--text-sm);
    line-height: 1;
  }

  .task-card:hover .schedule-btn { opacity: 1; }
  .schedule-btn:hover { color: var(--color-accent); }

  .schedule-action { color: var(--color-accent); }

  /* Result line. Sits in the sub-line's place so the row never changes height. */
  .flash { color: var(--color-success, var(--color-text-muted)); font-weight: 600; }
  .flash-fail { color: var(--color-danger); }

  /* The sub-line is a flex row with overflow: hidden, so both children shrink
     and the control was the half that got clipped. Pin the control and let the
     message ellipsize instead — an unreadable message beats an untappable undo. */
  .flash {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .flash-undo {
    flex-shrink: 0;
    border: none;
    background: none;
    padding: 0 0 0 6px;
    font: inherit;
    font-weight: 600;
    color: var(--color-accent);
    cursor: pointer;
    text-decoration: underline;
  }

  /* Result line and its undo share a full-width row above the actions: the line
     never squeezes them, and undo stays with the thing it undoes rather than
     landing next to Delete. */
  .expanded-actions { flex-wrap: wrap; }

  .flash-row {
    flex-basis: 100%;
    display: flex;
    align-items: center;
    justify-content: flex-start;
  }

  .expanded-actions .flash { overflow: visible; }
</style>
