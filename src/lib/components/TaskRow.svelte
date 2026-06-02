<script>
  import { calculateProblemness, getProblemnessTier } from '../envelope.js';
  import { URGENCY_PROFILE_LABELS, URGENCY_PROFILE_ORDER } from '../constants.js';
  import { editTask, deleteTask, completeTask, unscheduleTask } from '../../stores/tasks.svelte.js';
  import { setEditingTask, editingTaskId } from '../../stores/ui.svelte.js';
  import { draggableTask } from '../dnd.js';
  import { minutesToTimeString, toISODate } from '../calendar.js';

  let { task } = $props();

  const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 480];

  let now = $state(new Date());

  $effect(() => {
    const interval = setInterval(() => { now = new Date(); }, 60000);
    return () => clearInterval(interval);
  });

  let problemness = $derived(calculateProblemness(task, now));
  let tier = $derived(getProblemnessTier(problemness));
  let isScheduled = $derived(task.scheduledBlocks.length > 0);
  let isEditing = $derived(editingTaskId.value === task.id);

  let editValue = $state(task.description);
  let showDurationPicker = $state(false);

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
</script>

<div class="task-row">
  <!-- Drag handle or scheduled indicator -->
  {#if isScheduled}
    <div class="scheduled-dot" title="Scheduled — drag off matrix to unschedule">✓</div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="drag-handle"
      title="Drag to schedule"
      use:draggableTask={{ taskId: task.id }}
    >⠿</div>
  {/if}

  <div class="task-body">
    <div class="task-top-row">
      <!-- Problemness badge -->
      <span
        class="problemness-badge"
        style="background: {tier.color}22; color: {tier.color}; border: 1px solid {tier.color}44"
      >
        {tier.emoji} {tier.label}
      </span>

      <!-- Description -->
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
        <span class="task-description" onclick={startEdit} title="Click to edit">{task.description}</span>
      {/if}
    </div>

    <!-- Controls row -->
    <div class="task-controls">
      <!-- Urgency picker -->
      <div class="urgency-picker">
        <button onclick={() => cycleUrgency(-1)} title="Previous">‹</button>
        <span class="urgency-label">{URGENCY_PROFILE_LABELS[task.urgencyProfile]}</span>
        <button onclick={() => cycleUrgency(1)} title="Next">›</button>
      </div>

      <!-- Importance picker -->
      <div class="importance-picker">
        {#each ['low', 'medium', 'high'] as level}
          <button
            class:active={task.importance === level}
            onclick={() => setImportance(level)}
          >
            {level === 'low' ? 'L' : level === 'medium' ? 'M' : 'H'}
          </button>
        {/each}
      </div>

      <!-- Duration -->
      <div style="position:relative">
        <button class="duration-display" onclick={() => showDurationPicker = !showDurationPicker}>
          {task.estimatedMinutes}m
        </button>
        {#if showDurationPicker}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="duration-popup" onmouseleave={() => showDurationPicker = false}>
            {#each DURATION_OPTIONS as mins}
              <button
                class:active={task.estimatedMinutes === mins}
                onclick={() => setDuration(mins)}
              >
                {mins >= 60 ? `${mins/60}h` : `${mins}m`}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      {#if isScheduled}
        <span class="scheduled-info">📅 {formatScheduled(task.scheduledBlocks)}</span>
        <button class="btn-ghost complete-btn" title="Complete" onclick={() => completeTask(task.id)}>✓</button>
      {:else}
        <button class="btn-ghost complete-btn" title="Complete" onclick={() => completeTask(task.id)}>✓</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .duration-popup {
    position: absolute;
    top: 100%;
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
  .duration-popup button.active {
    background: var(--color-primary);
    color: white;
  }
</style>
