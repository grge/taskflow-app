<script>
  import { activeTasks, completedTasks, autoScheduleAll, clearSchedule } from '../../stores/tasks.svelte.js';
  import { estimationMultiplier } from '../../stores/estimation.svelte.js';
  import { openModal } from '../../stores/ui.svelte.js';
  import { workSchedule } from '../../stores/schedule.svelte.js';
  import { calculateProblemness } from '../envelope.js';
  import TaskRow from './TaskRow.svelte';
  import '../../styles/tasklist.css';

  let showCompleted = $state(false);
  let sortKey = $state('date-added');

  const SORT_OPTIONS = [
    { key: 'date-added',      label: 'Added'       },
    { key: 'name',            label: 'Name'        },
    { key: 'urgency',         label: 'Urgency'     },
    { key: 'importance',      label: 'Importance'  },
    { key: 'problemness',     label: 'Problemness' },
    { key: 'scheduled-time',  label: 'Scheduled'   },
  ];

  const URGENCY_ORDER = ['next-couple-hours', 'cob-today', 'cob-tomorrow', 'end-of-week', 'few-days', 'whenever'];
  const IMPORTANCE_ORDER = { high: 0, medium: 1, low: 2 };

  function firstBlockStart(task) {
    if (!task.scheduledBlocks.length) return Infinity;
    const first = task.scheduledBlocks.reduce((a, b) =>
      a.date < b.date || (a.date === b.date && a.startMinutes < b.startMinutes) ? a : b
    );
    return first.date + String(first.startMinutes).padStart(4, '0');
  }

  let sortedTasks = $derived(() => {
    const now = new Date();
    const tasks = [...activeTasks.value];
    switch (sortKey) {
      case 'name':
        return tasks.sort((a, b) => a.description.localeCompare(b.description));
      case 'urgency':
        return tasks.sort((a, b) =>
          URGENCY_ORDER.indexOf(a.urgencyProfile) - URGENCY_ORDER.indexOf(b.urgencyProfile)
        );
      case 'importance':
        return tasks.sort((a, b) =>
          IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance]
        );
      case 'problemness':
        return tasks.sort((a, b) =>
          calculateProblemness(b, now) - calculateProblemness(a, now)
        );
      case 'scheduled-time':
        return tasks.sort((a, b) => {
          const as_ = firstBlockStart(a);
          const bs_ = firstBlockStart(b);
          if (as_ === Infinity && bs_ === Infinity) return 0;
          if (as_ === Infinity) return 1;
          if (bs_ === Infinity) return -1;
          return as_ < bs_ ? -1 : as_ > bs_ ? 1 : 0;
        });
      default: // date-added: insertion order
        return tasks;
    }
  });
</script>

<div class="task-list-panel">
  <div class="task-list-header">
    <h2>Tasks</h2>
    <div class="task-list-actions">
      <button class="btn btn-ghost" onclick={clearSchedule}>Clear</button>
      <button class="btn btn-ghost" onclick={() => autoScheduleAll(estimationMultiplier.value)}>Auto Schedule</button>
      <button class="btn btn-primary" onclick={() => openModal('add-task')}>+ Add Task</button>
    </div>
  </div>

  <div class="sort-bar">
    <span class="sort-label">Sort by</span>
    {#each SORT_OPTIONS as opt}
      <button
        class="sort-pill"
        class:active={sortKey === opt.key}
        onclick={() => sortKey = opt.key}
      >{opt.label}</button>
    {/each}
  </div>

  <div class="task-list-scroll">
    {#if sortedTasks().length === 0 && !showCompleted}
      <div class="empty-state">
        <p>No tasks yet.</p>
        <p>Click <strong>+ Add Task</strong> to get started.</p>
      </div>
    {:else}
      {#each sortedTasks() as task (task.id)}
        <TaskRow {task} windowHours={workSchedule.value.envelopeWindowHours ?? 48} />
      {/each}
    {/if}

    {#if completedTasks.value.length > 0}
      <button
        class="completed-toggle"
        onclick={() => showCompleted = !showCompleted}
      >
        {showCompleted ? '▾' : '▸'} {completedTasks.value.length} completed
      </button>

      {#if showCompleted}
        {#each completedTasks.value as task (task.id)}
          <div class="completed-row">
            <span class="completed-check">✓</span>
            <span class="completed-desc">{task.description}</span>
            <span class="completed-meta">{task.estimatedMinutes}m</span>
          </div>
        {/each}
      {/if}
    {/if}
  </div>
</div>

<style>
  .completed-toggle {
    width: 100%;
    padding: 8px 16px;
    text-align: left;
    background: none;
    border: none;
    border-top: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .completed-toggle:hover {
    background: var(--color-bg);
    color: var(--color-text);
  }

  .completed-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--color-border);
    opacity: 0.5;
  }

  .completed-check {
    color: #4CAF50;
    font-size: 13px;
    flex-shrink: 0;
  }

  .completed-desc {
    flex: 1;
    font-size: 13px;
    text-decoration: line-through;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .completed-meta {
    font-size: 11px;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
</style>
