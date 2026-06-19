<script>
  import { activeTasks, completedTasks, restoreTask } from '../../stores/tasks.svelte.js';
  import { estimationMultiplier } from '../../stores/estimation.svelte.js';
  import { openModal } from '../../stores/ui.svelte.js';
  import { pAt, getPressureTier } from '../envelope.js';
  import { clock } from '../../stores/clock.svelte.js';
  import TaskRow from './TaskRow.svelte';
  import '../../styles/tasklist.css';

  let showCompleted = $state(false);
  let sortKey       = $state('pressure');

  const SORT_OPTIONS = [
    { key: 'pressure',  label: 'Pressure'  },
    { key: 'name',      label: 'Name'      },
    { key: 'scheduled', label: 'Scheduled' },
  ];

  function firstBlockStart(task) {
    if (!task.scheduledBlocks.length) return Infinity;
    const first = task.scheduledBlocks.reduce((a, b) =>
      a.date < b.date || (a.date === b.date && a.startMinutes < b.startMinutes) ? a : b
    );
    return first.date + String(first.startMinutes).padStart(4, '0');
  }

  let sortedTasks = $derived((() => {
    const now   = clock.minute;
    const tasks = [...activeTasks.value];
    switch (sortKey) {
      case 'name':
        return tasks.sort((a, b) => a.description.localeCompare(b.description));
      case 'scheduled':
        return tasks.sort((a, b) => {
          const as_ = firstBlockStart(a);
          const bs_ = firstBlockStart(b);
          if (as_ === Infinity && bs_ === Infinity) return 0;
          if (as_ === Infinity) return 1;
          if (bs_ === Infinity) return -1;
          return as_ < bs_ ? -1 : as_ > bs_ ? 1 : 0;
        });
      default: // pressure
        return tasks.sort((a, b) => pAt(b, now) - pAt(a, now));
    }
  })());

  let totalCount       = $derived(activeTasks.value.length);
  let unscheduledCount = $derived(activeTasks.value.filter(t => !t.scheduledBlocks.length).length);

  function formatElapsed(seconds) {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
  }

  function estimationDelta(task) {
    if (!task.elapsedSeconds || !task.estimatedMinutes) return null;
    const actualMin = task.elapsedSeconds / 60;
    const ratio = actualMin / task.estimatedMinutes;
    const pct = Math.round((ratio - 1) * 100);
    if (Math.abs(pct) < 5) return 'on time';
    return pct > 0 ? `+${pct}% over` : `${pct}% under`;
  }
</script>

<div class="task-list-panel">
  <div class="task-list-header">
    <div class="task-heading">
      <span class="task-heading-title">Tasks</span>
      <span class="task-count">{totalCount} total · {unscheduledCount} unscheduled</span>
    </div>
    <button class="add-btn" onclick={() => openModal('add-task')} title="Add task">＋</button>
  </div>

  <div class="sort-bar">
    <span class="sort-label">Sort</span>
    {#each SORT_OPTIONS as opt}
      <button
        class="sort-pill"
        class:active={sortKey === opt.key}
        onclick={() => sortKey = opt.key}
      >{opt.label}</button>
    {/each}
  </div>

  <div class="task-list-scroll">
    {#if sortedTasks.length === 0 && !showCompleted}
      <div class="empty-state">
        <p>No tasks yet.</p>
        <p>Click <strong>+ Add Task</strong> to get started.</p>
      </div>
    {:else}
      {#each sortedTasks as task (task.id)}
        <TaskRow {task} />
      {/each}
    {/if}

    {#if completedTasks.value.length > 0}
      <button
        class="completed-toggle"
        onclick={() => showCompleted = !showCompleted}
      >
        {showCompleted ? '▾' : '▸'} {completedTasks.value.length} completed today
      </button>

      {#if showCompleted}
        {#each completedTasks.value as task (task.id)}
          <div class="completed-row">
            <span class="completed-check">✓</span>
            <span class="completed-desc">{task.description}</span>
            <div class="completed-meta">
              {#if task.estimatedMinutes}
                <span class="est-label">{task.estimatedMinutes}m est</span>
              {/if}
              {#if task.elapsedSeconds}
                <span class="actual-label">{formatElapsed(task.elapsedSeconds)} actual</span>
              {/if}
              {#if estimationDelta(task)}
                <span class="delta-label">{estimationDelta(task)}</span>
              {/if}
            </div>
            <button class="restore-btn" onclick={() => restoreTask(task.id)} title="Restore task">↩</button>
          </div>
        {/each}
      {/if}
    {/if}
  </div>
</div>

<style>
  .task-list-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .task-list-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 14px 10px;
    border-bottom: 1px solid var(--color-border-light);
    flex-shrink: 0;
    gap: 8px;
  }

  .task-heading {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }

  .task-heading-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--color-text);
    flex-shrink: 0;
  }

  .task-count {
    font-size: 12px;
    font-weight: 400;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .add-btn {
    width: 30px;
    height: 30px;
    border-radius: var(--radius);
    border: 1px solid var(--color-border);
    background: var(--color-card);
    color: var(--color-text-muted);
    font-size: 18px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    padding: 0;
    flex-shrink: 0;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .add-btn:hover { border-color: var(--color-text-muted); color: var(--color-text); background: var(--color-surface); }

  .sort-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 7px 14px;
    border-bottom: 1px solid var(--color-border-light);
    flex-shrink: 0;
  }

  .sort-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-faint);
    margin-right: 2px;
  }

  .sort-pill {
    padding: 3px 10px;
    border-radius: 20px;
    border: 1px solid var(--color-border);
    background: transparent;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-muted);
    cursor: pointer;
    font-family: inherit;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }

  .sort-pill:hover {
    background: var(--color-card);
    color: var(--color-text);
  }

  .sort-pill.active {
    background: var(--color-text);
    color: var(--color-surface);
    border-color: var(--color-text);
  }

  .task-list-scroll {
    flex: 1;
    overflow-y: auto;
    padding-bottom: 8px;
  }

  .empty-state {
    padding: 40px 20px;
    text-align: center;
    color: var(--color-text-muted);
    line-height: 1.8;
    font-size: 14px;
  }

  .completed-toggle {
    width: 100%;
    padding: 10px 14px;
    text-align: left;
    background: none;
    border: none;
    border-top: 1px solid var(--color-border-light);
    color: var(--color-text-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    margin-top: 4px;
  }
  .completed-toggle:hover { color: var(--color-text); }

  .completed-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--color-border-light);
    opacity: 0.65;
  }

  .completed-check {
    color: #6E8B63;
    font-size: 13px;
    flex-shrink: 0;
  }

  .completed-desc {
    flex: 1;
    font-size: 14px;
    text-decoration: line-through;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .completed-meta {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-shrink: 0;
    font-size: 11px;
    color: var(--color-text-faint);
  }

  .est-label, .actual-label { white-space: nowrap; }
  .delta-label {
    font-weight: 600;
    color: #C8553C;
    white-space: nowrap;
  }

  .restore-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 2px 4px;
    font-size: 14px;
    color: var(--color-text-muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
    line-height: 1;
  }
  .completed-row:hover .restore-btn { opacity: 1; }
  .restore-btn:hover { color: var(--color-text); }
</style>
