<script>
  import { editTask, deleteTask, completeTask, unscheduleTask, startTimer } from '../../stores/tasks.svelte.js';
  import { setExpandedTask, expandedTaskId, activeTimer } from '../../stores/ui.svelte.js';
  import { draggableTask } from '../dnd.js';
  import { minutesToTimeString, toISODate } from '../calendar.js';
  import { clock } from '../../stores/clock.svelte.js';
  import { pAt, pToColor, getPressureTier } from '../envelope.js';
  import PressureSparkline from './PressureSparkline.svelte';
  import EnvelopeEditor from './EnvelopeEditor.svelte';

  let { task } = $props();

  const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 480];

  let isTimerRunning  = $derived(activeTimer.value?.taskId === task.id);
  let isScheduled     = $derived(task.scheduledBlocks.length > 0);
  let isExpanded      = $derived(expandedTaskId.value === task.id);
  let isPastScheduled = $derived(task.scheduledBlocks.some(b => b.date < clock.today));

  let currentPressure = $derived(pAt(task, clock.minute));
  let pressureTier    = $derived(getPressureTier(currentPressure));
  let pillColor       = $derived(pToColor(currentPressure));

  let editValue     = $state(task.description);
  let isEditingDesc = $state(false);

  let totalElapsedSeconds = $derived((() => {
    const t = activeTimer.value;
    if (!t || t.taskId !== task.id) return task.elapsedSeconds ?? 0;
    if (!t.startedAt) return t.baseSeconds;
    void clock.now;
    return t.baseSeconds + Math.max(0, Math.floor((Date.now() - new Date(t.startedAt)) / 1000));
  })());

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

  function firstScheduledBadge(blocks) {
    if (!blocks.length) return null;
    const sorted = [...blocks].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMinutes - b.startMinutes
    );
    const b = sorted[0];
    const d = new Date(b.date + 'T00:00:00');
    const today = toISODate(new Date());
    const tomorrow = toISODate(new Date(Date.now() + 24 * 60 * 60 * 1000));
    if (b.date === today) return minutesToTimeString(b.startMinutes);
    if (b.date === tomorrow) return `Tmrw ${minutesToTimeString(b.startMinutes)}`;
    const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
    return dateStr;
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
  class:timer-running={isTimerRunning}
  class:past-scheduled={isPastScheduled}
>
  <!-- ── Collapsed header ── -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="task-header" onclick={() => setExpandedTask(task.id)}>

    <!-- Circle checkbox (complete button) -->
    <button
      class="check-btn"
      style="border-color:{pillColor}"
      title="Mark complete"
      onclick={(e) => { e.stopPropagation(); completeTask(task.id); }}
    >
      {#if isTimerRunning}
        <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#4CAF50"/></svg>
      {/if}
    </button>

    <!-- Description + sub-line -->
    <div class="task-main">
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
      <span class="task-subline">
        {#if isScheduled && scheduledBadge}
          ◷ {scheduledBadge} · {formatDuration(task.estimatedMinutes)}
        {:else if task.estimatedMinutes}
          {formatDuration(task.estimatedMinutes)}
          {#if isPastScheduled}<span class="past-flag" title="Past scheduled time"> !</span>{/if}
        {:else}
          Unscheduled
        {/if}
      </span>
    </div>

    <!-- Sparkline (right) + hover actions -->
    <div class="task-right">
      <div class="task-actions">
        <button class="action-btn play-btn" title="Start timer"
          onclick={(e) => { e.stopPropagation(); startTimer(task.id); }}>
          <svg width="10" height="11" viewBox="0 0 11 12" fill="currentColor"><path d="M1 1l9 5-9 5V1z"/></svg>
        </button>
        {#if !isScheduled}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="drag-handle" title="Drag to schedule" use:draggableTask={{ taskId: task.id }}
            onclick={(e) => e.stopPropagation()}>
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
              <circle cx="3" cy="2.5" r="1.2"/><circle cx="7" cy="2.5" r="1.2"/>
              <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
              <circle cx="3" cy="11.5" r="1.2"/><circle cx="7" cy="11.5" r="1.2"/>
            </svg>
          </div>
        {/if}
      </div>
      <div class="sparkline-wrap">
        <PressureSparkline {task} />
      </div>
    </div>

  </div>

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
    background: var(--color-card);
    border-radius: var(--radius-lg);
    margin: 6px 10px;
    border: 1px solid var(--color-border-light);
    box-shadow: none;
    transition: box-shadow 0.15s, border-color 0.15s;
  }

  .task-card:hover {
    border-color: var(--color-border);
    box-shadow: 0 2px 8px rgba(42,37,33,0.07);
  }

  .task-card.timer-running {
    border-color: #A8D5A2;
    box-shadow: 0 2px 12px rgba(110,139,99,0.15);
  }

  .task-card.is-expanded {
    border-color: #E6BBAA;
    box-shadow: 0 6px 18px rgba(200,85,60,0.10);
  }

  .task-card.past-scheduled {
    border-left: 3px solid var(--color-accent);
  }

  /* ── Collapsed header ── */
  .task-header {
    display: flex;
    align-items: center;
    padding: 10px 10px 10px 12px;
    gap: 8px;
    cursor: pointer;
    min-width: 0;
  }

  /* ── Circle checkbox ── */
  .check-btn {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2.5px solid var(--color-border);
    background: transparent;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.15s, background 0.15s;
    padding: 0;
  }

  .check-btn:hover {
    background: var(--color-panel);
  }

  /* ── Description block ── */
  .task-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
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
    font-size: 12px;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .past-flag {
    color: var(--color-accent);
    font-weight: 700;
  }

  /* ── Right side: actions + sparkline ── */
  .task-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .task-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    width: 0;
    overflow: hidden;
    transition: width 0.15s;
  }

  .task-card:hover .task-actions,
  .task-card.timer-running .task-actions { width: auto; overflow: visible; }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    color: var(--color-text-muted);
    transition: background 0.1s, color 0.1s;
  }

  .play-btn:hover { background: rgba(110,139,99,0.12); color: #6E8B63; }

  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    color: var(--color-border);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .drag-handle:active { cursor: grabbing; }

  .sparkline-wrap { flex-shrink: 0; }

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
