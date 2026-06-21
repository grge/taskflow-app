<script>
  import { tasks, unscheduleTask, editTask } from '../../stores/tasks.svelte.js';
  import { workSchedule } from '../../stores/schedule.svelte.js';
  import { outlookPreview, dragState, plannerDate } from '../../stores/ui.svelte.js';
  import { clock } from '../../stores/clock.svelte.js';
  import { pAt, pToColor } from '../envelope.js';
  import { getVisibleWorkDays, toISODate, formatDateLabel } from '../calendar.js';
  import { draggableOutlookCard } from '../dnd.js';

  // All work days after the currently-viewed planner day, up to one day past the last scheduled task
  let outlookDays = $derived((() => {
    const viewStr     = plannerDate.value;
    const viewDateObj = new Date(viewStr + 'T00:00:00');
    const visibleDays = getVisibleWorkDays(workSchedule.value, 14, viewDateObj);
    const futureDays  = visibleDays.filter(({ date }) => toISODate(date) > viewStr);

    const activeTasks = tasks.value.filter(t => !t.isCompleted && !t.isDeleted);
    const byDay = new Map();

    for (const t of activeTasks) {
      for (const b of t.scheduledBlocks) {
        if (b.date > viewStr) {
          if (!byDay.has(b.date)) byDay.set(b.date, []);
          byDay.get(b.date).push({ task: t, block: b });
        }
      }
    }

    for (const [, arr] of byDay) {
      arr.sort((a, b) => a.block.startMinutes - b.block.startMinutes);
    }

    const lastTaskDay = futureDays.filter(({ date }) => byDay.has(toISODate(date))).at(-1);
    const lastTaskIdx = lastTaskDay ? futureDays.indexOf(lastTaskDay) : -1;

    return futureDays.slice(0, lastTaskIdx + 2).map(({ date }) => {
      const fl = formatDateLabel(date);
      return {
        dateStr: toISODate(date),
        date,
        label:   fl.label,
        short:   fl.short,
        entries: byDay.get(toISODate(date)) ?? []
      };
    });
  })());

  function pressureAtBlock(task, block) {
    const completionMs = new Date(block.date + 'T00:00:00').getTime()
      + (block.startMinutes + block.durationMinutes) * 60_000;
    return pAt(task, completionMs);
  }

  function formatDuration(mins) {
    if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
    if (mins >= 60) return `${(mins / 60).toFixed(1)}h`;
    return `${mins}m`;
  }

  let editingTaskId    = $state(null);
  let editingTaskLabel = $state('');

  function startEdit(task) {
    editingTaskId    = task.id;
    editingTaskLabel = task.description;
  }

  function commitEdit() {
    if (editingTaskId && editingTaskLabel.trim()) {
      editTask(editingTaskId, { description: editingTaskLabel.trim() });
    }
    editingTaskId = null;
  }

  function onKeydown(e) {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') editingTaskId = null;
  }
</script>

<div class="outlook-section">
  <div class="outlook-header">Upcoming</div>

  {#if outlookDays.length === 0}
    <div class="outlook-empty">No tasks scheduled after this day.</div>
  {:else}
    {#each outlookDays as day (day.dateStr)}
      {@const ghost     = outlookPreview.value?.dateStr === day.dateStr ? outlookPreview.value : null}
      {@const ghostTask = ghost ? tasks.value.find(t => t.id === ghost.ghostTaskId) : null}
      <div class="outlook-day" data-outlook-day={day.dateStr}>
        <div class="day-header">
          <span class="day-label">{day.label}</span>
          <span class="day-short">{day.short}</span>
        </div>

        {#if day.entries.length === 0 && !ghost}
          <div class="day-empty">Drop tasks here</div>
        {:else}
          {#each day.entries as { task, block } (task.id)}
            {#if ghost && ghost.insertBeforeTaskId === task.id}
              <div class="outlook-card outlook-card-ghost">
                <div class="card-accent"></div>
                <div class="card-body">
                  <span class="card-desc">{ghostTask?.description ?? '…'}</span>
                  {#if ghostTask}<span class="card-duration">{formatDuration(ghostTask.estimatedMinutes)}</span>{/if}
                </div>
              </div>
            {/if}
            {@const p     = pressureAtBlock(task, block)}
            {@const color = pToColor(p)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="outlook-card"
              class:is-dragging={dragState.value?.taskId === task.id}
              data-outlook-task-id={task.id}
              use:draggableOutlookCard={{ taskId: task.id, dateStr: day.dateStr }}
            >
              <div class="card-accent" style="background:{color}"></div>
              <div class="card-body">
                {#if editingTaskId === task.id}
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    class="card-desc-input"
                    bind:value={editingTaskLabel}
                    onblur={commitEdit}
                    onkeydown={onKeydown}
                    onclick={(e) => e.stopPropagation()}
                    autofocus
                  />
                {:else}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span
                    class="card-desc"
                    onclick={(e) => e.stopPropagation()}
                    ondblclick={(e) => { e.stopPropagation(); startEdit(task); }}
                  >{task.description}</span>
                {/if}
                <span class="card-duration">{formatDuration(block.durationMinutes)}</span>
              </div>
              <button class="card-unschedule" onclick={() => unscheduleTask(task.id)} title="Unschedule">×</button>
            </div>
          {/each}
          {#if ghost && ghost.insertBeforeTaskId === null}
            <div class="outlook-card outlook-card-ghost">
              <div class="card-accent"></div>
              <div class="card-body">
                <span class="card-desc">{ghostTask?.description ?? '…'}</span>
                {#if ghostTask}<span class="card-duration">{formatDuration(ghostTask.estimatedMinutes)}</span>{/if}
              </div>
            </div>
          {/if}
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .outlook-section {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .outlook-header {
    font-size: 16px;
    font-weight: 700;
    color: var(--color-text);
    padding: 16px 14px 4px;
    flex-shrink: 0;
  }

  .outlook-empty {
    padding: 16px 14px;
    font-size: 13px;
    color: var(--color-text-muted);
  }

  /* ── Day group ── */
  .outlook-day {
    margin-bottom: 2px;
  }

  .day-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 10px 14px 4px;
    background: var(--color-panel);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .day-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text);
  }

  .day-short {
    font-size: 11px;
    font-weight: 400;
    color: var(--color-text-muted);
  }

  .day-empty {
    font-size: 12px;
    color: var(--color-text-faint);
    padding: 6px 14px 10px;
    font-style: italic;
    border: 1px dashed var(--color-border);
    margin: 4px 10px;
    border-radius: var(--radius-sm);
    text-align: center;
  }

  /* ── Outlook card ── */
  .outlook-card {
    display: flex;
    align-items: stretch;
    gap: 0;
    margin: 2px 10px;
    background: var(--color-card);
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius);
    cursor: grab;
    touch-action: none;
    user-select: none;
    transition: box-shadow 0.1s, border-color 0.1s;
    position: relative;
    overflow: hidden;
    box-shadow: 0 1px 3px var(--color-shadow);
  }

  .outlook-card:hover {
    box-shadow: 0 2px 6px var(--color-shadow);
    border-color: var(--color-border);
  }

  .outlook-card:active { cursor: grabbing; }

  .outlook-card.is-dragging {
    opacity: 0.35;
    box-shadow: none;
  }

  .outlook-card.outlook-card-ghost {
    opacity: 0.45;
    border: 1.5px dashed var(--color-border);
    cursor: default;
    pointer-events: none;
    background: var(--color-panel);
    box-shadow: none;
  }

  .outlook-card.outlook-card-ghost .card-accent {
    background: var(--color-border);
  }

  .card-accent {
    width: 5px;
    flex-shrink: 0;
  }

  .card-body {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 8px 10px;
  }

  .card-desc {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
    cursor: default;
    width: fit-content;
    max-width: 100%;
  }

  .card-desc:hover {
    cursor: text;
  }

  .card-desc-input {
    font-size: 13px;
    font-weight: 500;
    font-family: inherit;
    color: var(--color-text);
    background: transparent;
    border: none;
    border-bottom: 1.5px solid var(--color-text-muted);
    outline: none;
    padding: 0;
    flex: 1;
    min-width: 0;
    width: 100%;
  }

  .card-duration {
    font-size: 12px;
    color: var(--color-text-muted);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .card-unschedule {
    flex-shrink: 0;
    background: none;
    border: none;
    font-size: 15px;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 0 2px;
    opacity: 0;
    transition: opacity 0.1s, color 0.1s;
    line-height: 1;
  }

  .outlook-card:hover .card-unschedule { opacity: 1; }
  .card-unschedule:hover { color: #EF5350; }
</style>
