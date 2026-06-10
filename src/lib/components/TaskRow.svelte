<script>
  import { URGENCY_PROFILE_LABELS, URGENCY_PROFILE_ORDER } from '../constants.js';
  import { editTask, deleteTask, completeTask, unscheduleTask, startTimer } from '../../stores/tasks.svelte.js';
  import { setEditingTask, editingTaskId, activeTimer } from '../../stores/ui.svelte.js';
  import { draggableTask } from '../dnd.js';
  import { minutesToTimeString } from '../calendar.js';
  import { clock } from '../../stores/clock.svelte.js';
  import EnvelopeChart from './EnvelopeChart.svelte';

  let { task, windowHours = 48 } = $props();

  const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 480];

  let isTimerRunning = $derived(activeTimer.value?.taskId === task.id);
  let isScheduled = $derived(task.scheduledBlocks.length > 0);
  let isEditing = $derived(editingTaskId.value === task.id);

  let editValue = $state(task.description);
  let showDurationPicker = $state(false);

  let totalElapsedSeconds = $derived(
    (() => {
      const t = activeTimer.value;
      if (!t || t.taskId !== task.id) return task.elapsedSeconds ?? 0;
      if (!t.startedAt) return t.baseSeconds; // paused
      void clock.now; // subscribe to clock ticks for reactivity
      return t.baseSeconds + Math.max(0, Math.floor((Date.now() - new Date(t.startedAt)) / 1000));
    })()
  );

  function formatElapsed(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60) % 60;
    const h = Math.floor(seconds / 3600);
    if (h > 0) return m === 0 ? `${h}h` : `${h}h ${m}m`;
    return `${m}m`;
  }

  function startEdit() {
    editValue = task.description;
    setEditingTask(task.id);
  }

  function commitEdit() {
    if (editValue.trim() && editValue !== task.description) {
      editTask(task.id, { description: editValue.trim() });
    }
    setEditingTask(null);
  }

  function onDescKeydown(e) {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditingTask(null);
  }

  function cycleUrgency(dir) {
    const idx = URGENCY_PROFILE_ORDER.indexOf(task.urgencyProfile);
    const next = (idx + dir + URGENCY_PROFILE_ORDER.length) % URGENCY_PROFILE_ORDER.length;
    editTask(task.id, { urgencyProfile: URGENCY_PROFILE_ORDER[next] });
  }

  function setImportance(level) {
    editTask(task.id, { importance: level });
  }

  function setDuration(mins) {
    editTask(task.id, { estimatedMinutes: mins });
    showDurationPicker = false;
  }

  function formatScheduled(blocks) {
    if (!blocks.length) return '';
    const b = blocks[0];
    const d = new Date(b.date + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    d.setHours(0,0,0,0);
    let dayLabel;
    if (d.getTime() === today.getTime()) dayLabel = 'Today';
    else if (d.getTime() === tomorrow.getTime()) dayLabel = 'Tomorrow';
    else dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
    return `${dayLabel} ${minutesToTimeString(b.startMinutes)}`;
  }

  const IMPORTANCE_LABELS = { low: 'Low', medium: 'Med', high: 'High' };
  const IMPORTANCE_COLORS = { low: '#8BC34A', medium: '#FFA726', high: '#EF5350' };
</script>

<div class="task-row" class:is-scheduled={isScheduled} class:timer-running={isTimerRunning}>

  <EnvelopeChart {task} {windowHours} />

  <!-- Drag handle (unscheduled) or scheduled check (scheduled) -->
  {#if isScheduled}
    <div class="task-status scheduled" title="Scheduled — drag off matrix to unschedule">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="task-status drag-handle" title="Drag to schedule" use:draggableTask={{ taskId: task.id }}>
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
        <circle cx="3" cy="2.5" r="1.2"/><circle cx="7" cy="2.5" r="1.2"/>
        <circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/>
        <circle cx="3" cy="11.5" r="1.2"/><circle cx="7" cy="11.5" r="1.2"/>
      </svg>
    </div>
  {/if}

  <div class="task-body">

    <!-- Primary row: description + action buttons -->
    <div class="task-primary">
      {#if isEditing}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="task-description-input"
          type="text"
          bind:value={editValue}
          onblur={commitEdit}
          onkeydown={onDescKeydown}
          autofocus
        />
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <span class="task-description" onclick={startEdit} title="Click to edit">
          {task.description}
        </span>
      {/if}

      <div class="task-actions">
        {#if isTimerRunning}
          <span class="timer-dot" title="Timer running">
            <svg width="7" height="7" viewBox="0 0 7 7"><circle cx="3.5" cy="3.5" r="3.5" fill="#4CAF50"/></svg>
          </span>
        {:else}
          <button class="action-btn play-btn" title="Start timer" onclick={() => startTimer(task.id)}>
            <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor">
              <path d="M1 1l9 5-9 5V1z"/>
            </svg>
          </button>
        {/if}
        <button class="action-btn complete-btn" title="Mark complete" onclick={() => completeTask(task.id)}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1.5 6l3.5 3.5 5.5-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Secondary row: metadata chips -->
    <div class="task-meta">

      <!-- Urgency -->
      <span class="meta-chip urgency-chip">
        <button class="urgency-arrow" onclick={() => cycleUrgency(-1)} title="Previous">‹</button>
        <span class="urgency-label">{URGENCY_PROFILE_LABELS[task.urgencyProfile]}</span>
        <button class="urgency-arrow" onclick={() => cycleUrgency(1)} title="Next">›</button>
      </span>

      <!-- Importance -->
      <span class="meta-chip importance-chip" style="color:{IMPORTANCE_COLORS[task.importance]}">
        {#each ['low', 'medium', 'high'] as level}
          <button
            class="imp-btn"
            class:active={task.importance === level}
            style={task.importance === level ? `background:${IMPORTANCE_COLORS[level]}` : ''}
            onclick={() => setImportance(level)}
            title="{IMPORTANCE_LABELS[level]} importance"
          >{level[0].toUpperCase()}</button>
        {/each}
      </span>

      <!-- Duration -->
      <div class="meta-chip-wrap" style="position:relative">
        <button
          class="meta-chip duration-chip"
          onclick={() => showDurationPicker = !showDurationPicker}
          title="Estimated duration"
        >
          {task.estimatedMinutes >= 60
            ? `${task.estimatedMinutes / 60 === Math.floor(task.estimatedMinutes / 60) ? task.estimatedMinutes/60 : (task.estimatedMinutes/60).toFixed(1)}h`
            : `${task.estimatedMinutes}m`}
        </button>
        {#if showDurationPicker}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="duration-popup" onmouseleave={() => showDurationPicker = false}>
            {#each DURATION_OPTIONS as mins}
              <button
                class:active={task.estimatedMinutes === mins}
                onclick={() => setDuration(mins)}
              >{mins >= 60 ? `${mins/60}h` : `${mins}m`}</button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Scheduled time (if scheduled) -->
      {#if isScheduled}
        <span class="meta-chip scheduled-chip">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style="flex-shrink:0">
            <rect x="1" y="2" width="8" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/>
            <path d="M1 4.5h8M3 1v2M7 1v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
          {formatScheduled(task.scheduledBlocks)}
        </span>
      {/if}

      <!-- Elapsed time (if any) -->
      {#if totalElapsedSeconds > 0}
        <span class="meta-chip elapsed-chip" class:elapsed-running={isTimerRunning}>
          {formatElapsed(totalElapsedSeconds)}
        </span>
      {/if}

    </div>
  </div>
</div>

<style>
  .task-row {
    position: relative;
    display: flex;
    align-items: flex-start;
    padding: 10px 14px 10px 10px;
    border-bottom: 1px solid var(--color-border);
    gap: 8px;
    transition: background 0.1s;
  }

  .task-row:hover { background: rgba(250,250,250,0.7); }
  .task-row.timer-running { background: rgba(240,255,244,0.7); }

  /* ── Status column ── */
  .task-status {
    flex-shrink: 0;
    width: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 3px;
    position: relative;
    z-index: 1;
  }

  .drag-handle {
    color: #CCCCCC;
    cursor: grab;
    touch-action: none;
    user-select: none;
    transition: color 0.15s;
  }

  .task-row:hover .drag-handle { color: #AAAAAA; }
  .drag-handle:active { cursor: grabbing; }

  .scheduled {
    color: #4CAF50;
  }

  /* ── Body ── */
  .task-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    position: relative;
    z-index: 1;
  }

  /* ── Primary row ── */
  .task-primary {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .task-description {
    flex: 1;
    font-size: 14px;
    font-weight: 500;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: text;
    min-width: 0;
  }

  .task-description:hover { color: var(--color-primary); }

  .task-description-input {
    flex: 1;
    font-size: 14px;
    font-weight: 500;
    border: none;
    border-bottom: 2px solid var(--color-primary);
    background: transparent;
    outline: none;
    min-width: 0;
    padding: 0;
  }

  /* ── Action buttons (appear on hover) ── */
  .task-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .task-row:hover .task-actions,
  .task-row.timer-running .task-actions { opacity: 1; }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    color: var(--color-text-muted);
    transition: background 0.1s, color 0.1s;
  }

  .play-btn:hover { background: #E8F5E9; color: #4CAF50; }
  .complete-btn:hover { background: #E3F2FD; color: var(--color-primary); }

  .timer-dot {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
  }

  /* ── Meta row ── */
  .task-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  /* Base chip style */
  .meta-chip {
    font-size: 11px;
    color: var(--color-text-muted);
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 1px 6px;
    white-space: nowrap;
    line-height: 18px;
  }

  /* Urgency */
  .urgency-chip {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0;
    overflow: hidden;
  }

  .urgency-arrow {
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    font-size: 14px;
    line-height: 1;
    padding: 0 4px;
    cursor: pointer;
    transition: color 0.1s;
  }

  .urgency-arrow:hover { color: var(--color-primary); }

  .urgency-label {
    font-size: 11px;
    color: var(--color-text-muted);
    padding: 0 2px;
    white-space: nowrap;
    width: 92px; /* wide enough for "Next Couple Hours" */
    text-align: center;
  }

  /* Importance: inline segmented buttons */
  .importance-chip {
    padding: 0;
    overflow: hidden;
    display: flex;
    gap: 0;
  }

  .imp-btn {
    padding: 1px 6px;
    border: none;
    background: transparent;
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-muted);
    cursor: pointer;
    line-height: 18px;
    transition: background 0.1s, color 0.1s;
  }

  .imp-btn + .imp-btn { border-left: 1px solid var(--color-border); }

  .imp-btn.active { color: white; }
  .imp-btn:not(.active):hover { background: var(--color-bg); color: var(--color-text); }

  /* Duration: clickable */
  .duration-chip {
    cursor: pointer;
    font-weight: 500;
    transition: border-color 0.1s, color 0.1s;
  }

  .duration-chip:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
  }

  .meta-chip-wrap { position: relative; }

  /* Scheduled chip */
  .scheduled-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #4CAF50;
    border-color: #C8E6C9;
    background: #F1F8E9;
  }

  /* Elapsed chip */
  .elapsed-chip { font-variant-numeric: tabular-nums; }
  .elapsed-chip.elapsed-running { color: #4CAF50; border-color: #C8E6C9; background: #F1F8E9; }

  /* Duration popup */
  .duration-popup {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    background: white;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    z-index: 50;
    display: flex;
    flex-wrap: wrap;
    padding: 4px;
    gap: 2px;
    width: 120px;
  }

  .duration-popup button {
    padding: 4px 8px;
    border: none;
    background: none;
    font-size: 11px;
    border-radius: 3px;
    cursor: pointer;
    width: calc(33% - 2px);
  }

  .duration-popup button:hover { background: var(--color-bg); }
  .duration-popup button.active { background: var(--color-primary); color: white; }
</style>
